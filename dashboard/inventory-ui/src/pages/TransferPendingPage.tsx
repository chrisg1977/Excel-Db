import { useEffect, useState } from 'react';
import {
  buildTransferPrintUrl,
  fetchPendingDashboard,
  fetchPendingTransfers,
  fetchTransferFormOptions,
  formatTransferDepartmentLabel,
  formatTransferEndpointLabel,
  getRuntimeDepartmentId,
  getRuntimeUserId,
  setRuntimeContext,
  TransferDepartmentOption,
  PendingTransferDashboard,
  TransferSummaryRecord,
} from '../lib/transferApi';

export function TransferPendingPage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [dashboard, setDashboard] = useState<PendingTransferDashboard | null>(null);
  const [rows, setRows] = useState<TransferSummaryRecord[]>([]);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function loadTransferOptions() {
      try {
        const data = await fetchTransferFormOptions();
        if (cancelled) return;
        setDepartments(data.departments);
        if (!data.departments.some((department) => department.department_id === departmentId) && data.departments.length > 0) {
          setDepartmentId(data.departments[0].department_id);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(`Department lookup failed: ${(err as Error).message}`);
        }
      }
    }

    void loadTransferOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const [dash, pending] = await Promise.all([
        fetchPendingDashboard(userId, departmentId),
        fetchPendingTransfers(userId, departmentId),
      ]);
      setDashboard(dash);
      setRows(pending.data);
      setStatus(`Loaded ${pending.data.length} row(s)`);
    } catch (err) {
      setStatus(`Refresh failed: ${(err as Error).message}`);
    }
  }

  useEffect(() => {
    if (departmentId) {
      void refresh();
    }
  }, [departmentId]);

  return (
    <section>
      <h2>Pending Transfers Dashboard</h2>
      <p>Track pending incoming transfers by department and location.</p>

      <section className="panel">
        <div className="grid-4">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value))} />
          </label>
          <label>
            Department
            {departments.length > 0 ? (
              <select value={departmentId || ''} onChange={(e) => setDepartmentId(Number(e.target.value))}>
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {formatTransferDepartmentLabel(department)}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" min={1} value={departmentId || ''} onChange={(e) => setDepartmentId(Number(e.target.value))} />
            )}
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={refresh}>Refresh</button>
          </div>
        </div>

        {dashboard ? (
          <div className="metrics">
            <article><span>Pending Dispatch</span><strong>{String(dashboard.pending_dispatch_count ?? 0)}</strong></article>
            <article><span>Awaiting Receipt</span><strong>{String(dashboard.awaiting_receipt_count ?? 0)}</strong></article>
            <article><span>Partially Received</span><strong>{String(dashboard.partially_received_count ?? 0)}</strong></article>
            <article><span>Overdue</span><strong>{String(dashboard.overdue_count ?? 0)}</strong></article>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Transfer #</th>
              <th>Status</th>
              <th>Source</th>
              <th>Target</th>
              <th>Expected Arrival</th>
              <th>Alert</th>
              <th>Print</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const transferId = Number(row.transfer_id);
              return (
                <tr key={String(row.transfer_id)}>
                  <td>{String(row.transfer_id)}</td>
                  <td>{String(row.transfer_number)}</td>
                  <td>{String(row.transfer_status)}</td>
                  <td>{formatTransferEndpointLabel({
                    department_code: row.source_department_code,
                    department_name: row.source_department_name,
                    location_code: row.source_location_code,
                    location_name: row.source_location_name,
                  })}</td>
                  <td>{formatTransferEndpointLabel({
                    department_code: row.target_department_code,
                    department_name: row.target_department_name,
                    location_code: row.target_location_code,
                    location_name: row.target_location_name,
                  })}</td>
                  <td>{String(row.expected_arrival_date || '')}</td>
                  <td>{row.pending_receipt_alert ? String(row.pending_receipt_alert) : '-'}</td>
                  <td>
                    <a href={buildTransferPrintUrl(userId, transferId)} target="_blank" rel="noreferrer">Print Note</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
