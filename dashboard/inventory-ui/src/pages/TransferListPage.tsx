import { useEffect, useMemo, useState } from 'react';
import {
  fetchTransferFormOptions,
  getTransferLocationsForDepartment,
  getRuntimeDepartmentId,
  getRuntimeUserId,
  setRuntimeContext,
  type TransferDepartmentOption,
  type TransferLocationOption,
} from '../lib/transferApi';
import { fetchTransferList, formatLocationFallback, type TransferListRow } from '../lib/inventoryApi';

const transferStatuses = ['', 'draft', 'dispatched', 'partially_received', 'received', 'cancelled', 'reversed'];

function formatEndpoint(departmentCode: string, departmentName: string, locationCode: string | null, locationName: string | null): string {
  const departmentLabel = `${departmentCode} - ${departmentName}`;
  return `${departmentLabel} / ${formatLocationFallback(locationCode, locationName)}`;
}

export function TransferListPage() {
  const pageSize = 50;
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [locationId, setLocationId] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>('transfer_id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [locations, setLocations] = useState<TransferLocationOption[]>([]);
  const [rows, setRows] = useState<TransferListRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const visibleLocations = useMemo(
    () => (departmentId ? getTransferLocationsForDepartment(locations, departmentId, 'any') : locations),
    [locations, departmentId]
  );

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const [options, transfers] = await Promise.all([
        fetchTransferFormOptions(),
        fetchTransferList({
          userId,
          departmentId,
          locationId: locationId > 0 ? locationId : null,
          status: statusFilter,
          query,
          limit: pageSize,
          offset: nextOffset,
          sortBy,
          sortDir,
        }),
      ]);
      setDepartments(options.departments);
      setLocations(options.locations);
      setRows(transfers.rows || transfers.data || []);
      setTotalCount(Number(transfers.total_count || 0));
      setOffset(nextOffset);
      setStatus(`Loaded ${(transfers.rows || transfers.data || []).length} transfer(s) of ${Number(transfers.total_count || 0)}`);
    } catch (err) {
      setStatus(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;

  return (
    <section>
      <h2>Transfers</h2>
      <p>Search and filter transfers by department/location, with sender and receiver accountability.</p>

      <section className="panel">
        <div className="grid-6">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value) || 0)} />
          </label>
          <label>
            Department
            <select
              value={departmentId || ''}
              onChange={(e) => {
                setDepartmentId(Number(e.target.value) || 0);
                setLocationId(0);
              }}
            >
              <option value="">All allowed departments</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select value={locationId || ''} onChange={(e) => setLocationId(Number(e.target.value) || 0)}>
              <option value="">Any source/target location</option>
              {visibleLocations.map((location) => (
                <option key={location.location_id} value={location.location_id}>
                  {location.location_code} - {location.location_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {transferStatuses.map((entry) => (
                <option key={entry || 'all'} value={entry}>{entry || 'all'}</option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="text"
              placeholder="Transfer #, tracking, courier, department"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="transfer_id">ID</option>
              <option value="transfer_number">Transfer #</option>
              <option value="transfer_status">Status</option>
              <option value="created_at">Created At</option>
              <option value="dispatched_at">Dispatched At</option>
              <option value="received_at">Received At</option>
              <option value="is_overdue">Overdue</option>
              <option value="line_count">Line Count</option>
            </select>
          </label>
          <label>
            Sort Dir
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value === 'asc' ? 'asc' : 'desc')}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={() => void refresh(0)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
      </section>

      <section className="panel">
        {!loading && rows.length === 0 ? <p>No transfers found for the current filters.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Transfer #</th>
              <th>Status</th>
              <th>Source</th>
              <th>Target</th>
              <th>Lines</th>
              <th>Dispatched At</th>
              <th>Received At</th>
              <th>Cancelled At</th>
              <th>Overdue</th>
              <th>Alert</th>
              <th>Dispatched By</th>
              <th>Received By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.transfer_id}>
                <td>{row.transfer_number}</td>
                <td>{row.transfer_status}</td>
                <td>{formatEndpoint(row.source_department_code, row.source_department_name, row.source_location_code, row.source_location_name)}</td>
                <td>{formatEndpoint(row.target_department_code, row.target_department_name, row.target_location_code, row.target_location_name)}</td>
                <td>{row.line_count}</td>
                <td>{row.dispatched_at || ''}</td>
                <td>{row.received_at || ''}</td>
                <td>{row.cancelled_at || ''}</td>
                <td>{row.is_overdue ? 'yes' : 'no'}</td>
                <td>{row.pending_receipt_alert || '-'}</td>
                <td>{row.dispatched_by_username || '-'}</td>
                <td>{row.received_by_username || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions">
          <button type="button" className="ghost" onClick={() => void refresh(Math.max(offset - pageSize, 0))} disabled={!canPrev || loading}>Previous</button>
          <span>Showing {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {totalCount}</span>
          <button type="button" className="ghost" onClick={() => void refresh(offset + pageSize)} disabled={!canNext || loading}>Next</button>
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
