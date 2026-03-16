import { FormEvent, useEffect, useState } from 'react';
import {
  createPhase2MaintenanceEvent,
  disposePhase2Asset,
  fetchPhase2Assets,
  Phase2AssetRow,
} from '../lib/phase2Api';
import { getRuntimeDepartmentId, getRuntimeUserId } from '../lib/transferApi';

export function AssetLifecyclePage() {
  const [userId] = useState<number>(getRuntimeUserId());
  const [departmentId] = useState<number>(getRuntimeDepartmentId());
  const [query, setQuery] = useState<string>('');
  const [rows, setRows] = useState<Phase2AssetRow[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const [maintenanceType, setMaintenanceType] = useState<string>('preventive');
  const [openedDate, setOpenedDate] = useState<string>('');
  const [maintenanceCost, setMaintenanceCost] = useState<string>('0');
  const [maintenanceSummary, setMaintenanceSummary] = useState<string>('');

  const [disposalReason, setDisposalReason] = useState<string>('obsolete');
  const [disposalDate, setDisposalDate] = useState<string>('');
  const [disposalMethod, setDisposalMethod] = useState<string>('');

  const selectedAsset = rows.find((row) => row.equipment_id === selectedAssetId) || null;

  async function refresh() {
    setLoading(true);
    setStatus('');
    try {
      const result = await fetchPhase2Assets({ userId, departmentId, query, limit: 100, offset: 0 });
      setRows(result.rows || result.data || []);
      setStatus(`Loaded ${result.total_count} asset(s)`);
    } catch (err) {
      setStatus(`Load assets failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateMaintenance(e: FormEvent) {
    e.preventDefault();
    if (!selectedAssetId) {
      setStatus('Select an asset first');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const cost = Number(maintenanceCost);
      if (!Number.isFinite(cost) || cost < 0) {
        setStatus('Maintenance cost must be >= 0');
        setSaving(false);
        return;
      }
      if (!openedDate) {
        setStatus('Opened date is required');
        setSaving(false);
        return;
      }

      await createPhase2MaintenanceEvent({
        user_id: userId,
        equipment_id: selectedAssetId,
        maintenance_type: maintenanceType,
        opened_date: openedDate,
        cost,
        issue_summary: maintenanceSummary || null,
      });

      setOpenedDate('');
      setMaintenanceCost('0');
      setMaintenanceSummary('');
      setStatus('Maintenance event created');
    } catch (err) {
      setStatus(`Create maintenance failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisposeAsset(e: FormEvent) {
    e.preventDefault();
    if (!selectedAssetId) {
      setStatus('Select an asset first');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      await disposePhase2Asset({
        user_id: userId,
        equipment_id: selectedAssetId,
        disposal_reason: disposalReason,
        disposal_date: disposalDate || null,
        disposal_method: disposalMethod || null,
      });
      setStatus('Asset disposed');
      await refresh();
    } catch (err) {
      setStatus(`Dispose asset failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Asset Lifecycle</h2>
        <div className="toolbar-inline">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset code/name/supplier" />
          <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset Code</th>
                <th>Asset Name</th>
                <th>Status</th>
                <th>Warranty Status</th>
                <th>Supplier</th>
                <th>Warranty Expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.equipment_id}
                  onClick={() => setSelectedAssetId(row.equipment_id)}
                  style={{ cursor: 'pointer', background: row.equipment_id === selectedAssetId ? 'rgba(0,0,0,0.06)' : undefined }}
                >
                  <td>{row.asset_code}</td>
                  <td>{row.asset_name}</td>
                  <td>{row.status}</td>
                  <td>{row.warranty_status}</td>
                  <td>{row.supplier_name || '-'}</td>
                  <td>{row.warranty_expiry_date || '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6}>No assets</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>Lifecycle Actions</h3>
        <p>Selected: {selectedAsset ? `${selectedAsset.asset_code} - ${selectedAsset.asset_name}` : 'none'}</p>

        <form onSubmit={handleCreateMaintenance}>
          <h4>Add Maintenance Event</h4>
          <div className="grid-4">
            <label>
              Type
              <select value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)}>
                <option value="preventive">preventive</option>
                <option value="corrective">corrective</option>
                <option value="inspection">inspection</option>
                <option value="calibration">calibration</option>
                <option value="cleaning">cleaning</option>
                <option value="emergency_repair">emergency_repair</option>
              </select>
            </label>
            <label>
              Opened Date
              <input type="date" value={openedDate} onChange={(e) => setOpenedDate(e.target.value)} />
            </label>
            <label>
              Cost
              <input type="number" min="0" step="0.0001" value={maintenanceCost} onChange={(e) => setMaintenanceCost(e.target.value)} />
            </label>
            <label>
              Issue Summary
              <input value={maintenanceSummary} onChange={(e) => setMaintenanceSummary(e.target.value)} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving || !selectedAssetId}>{saving ? 'Saving...' : 'Create Maintenance'}</button>
            </div>
          </div>
        </form>

        <form onSubmit={handleDisposeAsset}>
          <h4>Dispose Asset</h4>
          <div className="grid-4">
            <label>
              Disposal Reason
              <select value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)}>
                <option value="obsolete">obsolete</option>
                <option value="broken_beyond_repair">broken_beyond_repair</option>
                <option value="sold">sold</option>
                <option value="donated">donated</option>
                <option value="scrapped">scrapped</option>
                <option value="lost_stolen">lost_stolen</option>
              </select>
            </label>
            <label>
              Disposal Date
              <input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} />
            </label>
            <label>
              Disposal Method
              <input value={disposalMethod} onChange={(e) => setDisposalMethod(e.target.value)} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving || !selectedAssetId}>Dispose</button>
            </div>
          </div>
        </form>
        <p className="status">{status}</p>
      </section>
    </div>
  );
}
