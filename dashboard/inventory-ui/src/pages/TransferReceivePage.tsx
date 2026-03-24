import { useEffect, useMemo, useState } from 'react';
import {
  fetchPendingTransfers,
  fetchTransferById,
  fetchTransferFormOptions,
  formatTransferDepartmentLabel,
  formatTransferEndpointLabel,
  formatTransferLocationLabel,
  getRuntimeDepartmentId,
  getRuntimeUserId,
  getTransferLocationsForDepartment,
  lookupTransferByNumber,
  receiveTransfer,
  setRuntimeContext,
  TransferDepartmentOption,
  TransferDetailRecord,
  TransferLocationOption,
  TransferSummaryRecord,
} from '../lib/transferApi';

type ReceiveLine = {
  line_no: number;
  product_name: string;
  requested_qty: number;
  dispatched_qty: number;
  received_qty: number;
  damaged_qty: number;
  lost_qty: number;
  remaining_qty: number;
  receive_now: number;
  damaged_now: number;
  lost_now: number;
};

type TransferTimelineItem = {
  key: string;
  label: string;
  at: string | null;
  note?: string;
};

function buildTransferTimeline(transfer: TransferDetailRecord): TransferTimelineItem[] {
  const timeline: TransferTimelineItem[] = [
    { key: 'created', label: 'Created', at: transfer.created_at },
    { key: 'dispatched', label: 'Dispatched', at: transfer.dispatched_at },
    { key: 'received', label: 'Received', at: transfer.received_at },
  ];

  if (transfer.transfer_status === 'cancelled') {
    timeline.push({ key: 'cancelled', label: 'Cancelled', at: transfer.cancelled_at, note: 'Transfer cancelled' });
  }
  if (transfer.transfer_status === 'reversed') {
    timeline.push({ key: 'reversed', label: 'Reversed', at: null, note: 'Transfer reversed (timestamp unavailable in current contract)' });
  }
  return timeline;
}

export function TransferReceivePage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [receiverDepartmentId, setReceiverDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [receiverLocationId, setReceiverLocationId] = useState<number>(0);
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [locations, setLocations] = useState<TransferLocationOption[]>([]);
  const [transferNumber, setTransferNumber] = useState<string>('');
  const [pendingRows, setPendingRows] = useState<TransferSummaryRecord[]>([]);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferDetailRecord | null>(null);
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [notesReceiver, setNotesReceiver] = useState<string>('');
  const [confirmReceive, setConfirmReceive] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  const receiverLocations = useMemo(
    () => getTransferLocationsForDepartment(locations, receiverDepartmentId, 'receive'),
    [locations, receiverDepartmentId],
  );
  const totalProcessNow = useMemo(
    () => lines.reduce((sum, line) => sum + line.receive_now + line.damaged_now + line.lost_now, 0),
    [lines],
  );
  const selectedTargetDepartmentLabel = useMemo(() => {
    if (!selectedTransfer) return 'No transfer loaded';
    return formatTransferDepartmentLabel({
      department_code: selectedTransfer.target_department_code,
      department_name: selectedTransfer.target_department_name,
    });
  }, [selectedTransfer]);
  const selectedReceiverLocationLabel = useMemo(() => {
    const location = receiverLocations.find((row) => row.location_id === receiverLocationId) ?? null;
    return formatTransferLocationLabel(location);
  }, [receiverLocationId, receiverLocations]);

  useEffect(() => {
    let cancelled = false;

    async function loadTransferOptions() {
      try {
        const data = await fetchTransferFormOptions();
        if (cancelled) return;
        setDepartments(data.departments);
        setLocations(data.locations);

        if (!data.departments.some((department) => department.department_id === departmentId) && data.departments.length > 0) {
          setDepartmentId(data.departments[0].department_id);
          setReceiverDepartmentId(data.departments[0].department_id);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(`Department/location lookup failed: ${(err as Error).message}`);
        }
      }
    }

    void loadTransferOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (receiverLocationId && !receiverLocations.some((location) => location.location_id === receiverLocationId)) {
      setReceiverLocationId(0);
    }
  }, [receiverLocationId, receiverLocations]);

  function updateLine(lineNo: number, field: 'receive_now' | 'damaged_now' | 'lost_now', value: number) {
    setLines((prev) => prev.map((line) => (line.line_no === lineNo ? { ...line, [field]: value } : line)));
  }

  async function loadPending() {
    setBusy(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const data = await fetchPendingTransfers(userId, departmentId);
      setPendingRows(data.data);
      setStatus(`Loaded ${data.data.length} pending transfer(s)`);
    } catch (err) {
      setStatus(`Load pending failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function openTransferById(transferId: number) {
    setBusy(true);
    setStatus('');
    try {
      const payload = await fetchTransferById(userId, transferId);
      const mapped: ReceiveLine[] = payload.lines.map((line) => ({
        line_no: Number(line.line_no),
        product_name: String(line.product_name || ''),
        requested_qty: Number(line.requested_qty || 0),
        dispatched_qty: Number(line.dispatched_qty || 0),
        received_qty: Number(line.received_qty || 0),
        damaged_qty: Number(line.damaged_qty || 0),
        lost_qty: Number(line.lost_qty || 0),
        remaining_qty: Number(line.remaining_qty || 0),
        receive_now: 0,
        damaged_now: 0,
        lost_now: 0,
      }));

      setSelectedTransfer(payload);
      setLines(mapped);
      setDepartmentId(Number(payload.target_department_id) || departmentId);
      setReceiverDepartmentId(Number(payload.target_department_id) || departmentId);
      setReceiverLocationId(Number(payload.target_location_id) || 0);
      setStatus(`Transfer #${payload.transfer_id} loaded`);
    } catch (err) {
      setStatus(`Open transfer failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function lookupTransfer() {
    if (!transferNumber.trim()) return;
    setBusy(true);
    setStatus('');
    try {
      const payload = await lookupTransferByNumber(userId, transferNumber.trim());
      await openTransferById(Number(payload.transfer_id));
    } catch (err) {
      setStatus(`Lookup failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitReceive() {
    if (!selectedTransfer) return;
    if (!confirmReceive) {
      setStatus('Receiver confirmation required');
      return;
    }

    const targetDepartmentId = Number(selectedTransfer.target_department_id || 0);
    if (!receiverDepartmentId) {
      setStatus('Receiver department is required.');
      return;
    }
    if (targetDepartmentId && receiverDepartmentId !== targetDepartmentId) {
      setStatus('Receiver department must match the transfer target department.');
      return;
    }
    if (receiverLocationId && !receiverLocations.some((location) => location.location_id === receiverLocationId)) {
      setStatus('Receiver location must belong to the target department and be allowed to receive stock.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      const receiveLines = lines
        .filter((line) => line.receive_now > 0 || line.damaged_now > 0 || line.lost_now > 0)
        .map((line) => ({
          line_no: line.line_no,
          received_qty: line.receive_now,
          damaged_qty: line.damaged_now,
          lost_qty: line.lost_now,
        }));

      if (receiveLines.length === 0) {
        setStatus('No line quantities entered for receive.');
        return;
      }

      const result = await receiveTransfer({
        transfer_id: selectedTransfer.transfer_id,
        user_id: userId,
        receiver_department_id: receiverDepartmentId,
        receiver_location_id: receiverLocationId || null,
        receiver_confirmation: true,
        notes_receiver: notesReceiver || undefined,
        lines: receiveLines,
      });

      setStatus(`Receive posted. New status: ${result.status}`);
      await openTransferById(selectedTransfer.transfer_id);
      await loadPending();
    } catch (err) {
      setStatus(`Receive failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Receive Transfer</h2>
      <p>Load pending dispatched transfers for the target department, then confirm receipt.</p>

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
          <label>
            Transfer Number
            <input value={transferNumber} onChange={(e) => setTransferNumber(e.target.value)} placeholder="TR-20260314-000123" />
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={loadPending} disabled={busy}>Load Pending</button>
            <button type="button" className="ghost" onClick={lookupTransfer} disabled={busy}>Lookup Transfer</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Pending Transfers</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Transfer #</th>
              <th>Status</th>
              <th>Source</th>
              <th>Target</th>
              <th>Dispatched At</th>
              <th>Overdue</th>
              <th>Alert</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendingRows.map((row) => (
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
                <td>{String(row.dispatched_at || '')}</td>
                <td>{row.is_overdue ? 'yes' : 'no'}</td>
                <td>{row.pending_receipt_alert || '-'}</td>
                <td><button type="button" className="ghost" onClick={() => openTransferById(Number(row.transfer_id))}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selectedTransfer ? (
        <section className="panel">
          <h3>Transfer #{selectedTransfer.transfer_id}</h3>

          <div className="metrics">
            <article>
              <span>Source</span>
              <strong>{formatTransferEndpointLabel({
                department_code: selectedTransfer.source_department_code,
                department_name: selectedTransfer.source_department_name,
                location_code: selectedTransfer.source_location_code,
                location_name: selectedTransfer.source_location_name,
              })}</strong>
            </article>
            <article>
              <span>Target</span>
              <strong>{formatTransferEndpointLabel({
                department_code: selectedTransfer.target_department_code,
                department_name: selectedTransfer.target_department_name,
                location_code: selectedTransfer.target_location_code,
                location_name: selectedTransfer.target_location_name,
              })}</strong>
            </article>
            <article>
              <span>Receiver Department</span>
              <strong>{selectedTargetDepartmentLabel}</strong>
            </article>
            <article>
              <span>Receiver Location</span>
              <strong>{selectedReceiverLocationLabel}</strong>
            </article>
            <article>
              <span>Receipt Alert</span>
              <strong>{selectedTransfer.pending_receipt_alert || 'No pending alert'}</strong>
            </article>
          </div>

          <h4>Transfer Timeline</h4>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Timestamp</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {buildTransferTimeline(selectedTransfer).map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{item.at || '-'}</td>
                  <td>{item.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid-4">
            <label>
              Receiver Department
              {departments.length > 0 ? (
                <select value={receiverDepartmentId || ''} onChange={(e) => setReceiverDepartmentId(Number(e.target.value))} disabled={true}>
                  <option value="">Select department</option>
                  {departments.map((department) => (
                    <option key={department.department_id} value={department.department_id}>
                      {formatTransferDepartmentLabel(department)}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="number" min={1} value={receiverDepartmentId || ''} readOnly />
              )}
            </label>
            <label>
              Receiver Location
              <select
                value={receiverLocationId || ''}
                onChange={(e) => setReceiverLocationId(Number(e.target.value) || 0)}
                disabled={!receiverDepartmentId}
              >
                <option value="">Department level</option>
                {receiverLocations.map((location) => (
                  <option key={location.location_id} value={location.location_id}>
                    {formatTransferLocationLabel(location)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Product</th>
                <th>Dispatched</th>
                <th>Already Received</th>
                <th>Remaining</th>
                <th>Receive Now</th>
                <th>Damaged</th>
                <th>Lost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.line_no}>
                  <td>{line.line_no}</td>
                  <td>{line.product_name}</td>
                  <td>{line.dispatched_qty}</td>
                  <td>{line.received_qty}</td>
                  <td>{line.remaining_qty}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={line.remaining_qty}
                      step="0.0001"
                      value={line.receive_now}
                      onChange={(e) => updateLine(line.line_no, 'receive_now', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={line.remaining_qty}
                      step="0.0001"
                      value={line.damaged_now}
                      onChange={(e) => updateLine(line.line_no, 'damaged_now', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={line.remaining_qty}
                      step="0.0001"
                      value={line.lost_now}
                      onChange={(e) => updateLine(line.line_no, 'lost_now', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label>
            Receiver Notes
            <input value={notesReceiver} onChange={(e) => setNotesReceiver(e.target.value)} placeholder="Received and placed" />
          </label>
          <label className="inline">
            <input type="checkbox" checked={confirmReceive} onChange={(e) => setConfirmReceive(e.target.checked)} />
            I confirm these quantities are received and placed.
          </label>

          <div className="row-actions">
            <div className="chip">Processed now: {totalProcessNow.toFixed(4)}</div>
            <button type="button" onClick={submitReceive} disabled={!confirmReceive || busy}>Post Receive</button>
          </div>
        </section>
      ) : null}

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
