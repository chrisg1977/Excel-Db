import { FormEvent, useEffect, useMemo, useState } from 'react';
import { fetchTransferFormOptions, getRuntimeDepartmentId, getRuntimeUserId, setRuntimeContext, TransferDepartmentOption } from '../lib/transferApi';
import {
  createLocation,
  deactivateLocation,
  fetchLocations,
  LocationAvailabilityStatus,
  LocationRecord,
  LocationType,
  updateLocation,
} from '../lib/locationApi';

type LocationFormState = {
  location_code: string;
  location_name: string;
  department_id: number;
  parent_location_id: number;
  location_type: LocationType;
  can_hold_stock: boolean;
  can_receive_stock: boolean;
  can_issue_stock: boolean;
  can_store_equipment: boolean;
  is_active: boolean;
  availability_status: LocationAvailabilityStatus;
  effective_from: string;
  effective_to: string;
  notes: string;
};

const pageSize = 50;

const locationTypes: LocationType[] = [
  'store',
  'cupboard',
  'clinic',
  'office',
  'apartment',
  'cabinet',
  'warehouse',
  'room',
  'temporary',
  'external',
];

const availabilityStatuses: LocationAvailabilityStatus[] = [
  'active',
  'inactive',
  'rented_out',
  'under_maintenance',
  'unavailable',
  'archived',
];

function emptyForm(departmentId: number): LocationFormState {
  return {
    location_code: '',
    location_name: '',
    department_id: departmentId,
    parent_location_id: 0,
    location_type: 'room',
    can_hold_stock: true,
    can_receive_stock: true,
    can_issue_stock: true,
    can_store_equipment: false,
    is_active: true,
    availability_status: 'active',
    effective_from: '',
    effective_to: '',
    notes: '',
  };
}

function toDateInput(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).slice(0, 10);
}

function toPayload(form: LocationFormState, userId: number) {
  return {
    user_id: userId,
    location_code: form.location_code.trim(),
    location_name: form.location_name.trim(),
    department_id: form.department_id,
    parent_location_id: form.parent_location_id || null,
    location_type: form.location_type,
    can_hold_stock: form.can_hold_stock,
    can_receive_stock: form.can_receive_stock,
    can_issue_stock: form.can_issue_stock,
    can_store_equipment: form.can_store_equipment,
    is_active: form.is_active,
    availability_status: form.availability_status,
    effective_from: form.effective_from || null,
    effective_to: form.effective_to || null,
    notes: form.notes.trim() || null,
  };
}

export function LocationsPage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [departmentFilterId, setDepartmentFilterId] = useState<number>(0);
  const [query, setQuery] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>('location_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [rows, setRows] = useState<LocationRecord[]>([]);
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [form, setForm] = useState<LocationFormState>(emptyForm(departmentId));
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;

  const parentCandidates = useMemo(() => {
    return rows.filter((row) => {
      if (editingLocationId && row.location_id === editingLocationId) return false;
      return row.department_id === form.department_id;
    });
  }, [rows, editingLocationId, form.department_id]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const options = await fetchTransferFormOptions();
        if (cancelled) return;
        setDepartments(options.departments);
        if (!options.departments.some((department) => department.department_id === departmentId) && options.departments.length > 0) {
          setDepartmentId(options.departments[0].department_id);
          setForm((prev) => ({ ...prev, department_id: options.departments[0].department_id }));
        }
      } catch (err) {
        if (!cancelled) setStatus(`Load department options failed: ${(err as Error).message}`);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const result = await fetchLocations({
        userId,
        departmentId: departmentFilterId > 0 ? departmentFilterId : null,
        query,
        activeOnly,
        limit: pageSize,
        offset: nextOffset,
        sortBy,
        sortDir,
      });
      const list = result.rows || result.data || [];
      setRows(list);
      setTotalCount(Number(result.total_count || 0));
      setOffset(nextOffset);
      setStatus(`Loaded ${list.length} location(s) of ${Number(result.total_count || 0)}`);
    } catch (err) {
      setStatus(`Load locations failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly, departmentFilterId, sortBy, sortDir]);

  function startCreate() {
    setEditingLocationId(null);
    setForm(emptyForm(departmentId));
  }

  function startEdit(row: LocationRecord) {
    setEditingLocationId(row.location_id);
    setForm({
      location_code: row.location_code,
      location_name: row.location_name,
      department_id: row.department_id,
      parent_location_id: row.parent_location_id || 0,
      location_type: row.location_type,
      can_hold_stock: row.can_hold_stock,
      can_receive_stock: row.can_receive_stock,
      can_issue_stock: row.can_issue_stock,
      can_store_equipment: row.can_store_equipment,
      is_active: row.is_active,
      availability_status: row.availability_status,
      effective_from: toDateInput(row.effective_from),
      effective_to: toDateInput(row.effective_to),
      notes: row.notes || '',
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!form.department_id) {
        setStatus('department_id is required');
        setSaving(false);
        return;
      }
      if (!form.location_code.trim() || !form.location_name.trim()) {
        setStatus('location_code and location_name are required');
        setSaving(false);
        return;
      }

      if (editingLocationId) {
        await updateLocation(editingLocationId, toPayload(form, userId));
        setStatus(`Location #${editingLocationId} updated`);
      } else {
        const created = await createLocation(toPayload(form, userId));
        setStatus(`Location created: #${created.location_id}`);
      }

      await refresh(0);
      startCreate();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row: LocationRecord, nextStatus: Exclude<LocationAvailabilityStatus, 'active'>) {
    const confirmed = window.confirm(`Deactivate ${row.location_code} as ${nextStatus}? This preserves history.`);
    if (!confirmed) return;

    setSaving(true);
    setStatus('');
    try {
      await deactivateLocation({
        user_id: userId,
        location_id: row.location_id,
        availability_status: nextStatus,
        notes: `Deactivated from Location Master as ${nextStatus}`,
      });
      setStatus(`Location ${row.location_code} set to ${nextStatus}`);
      await refresh(offset);
    } catch (err) {
      setStatus(`Deactivate failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Location Master</h2>
      <p>Centralized location maintenance for inventory operations. Operational screens default to active locations only.</p>

      <section className="panel">
        <div className="grid-4">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value))} required />
          </label>
          <label>
            Context Department
            <input type="number" min={1} value={departmentId || ''} onChange={(e) => setDepartmentId(Number(e.target.value))} required />
          </label>
          <label>
            Filter Department
            <select value={departmentFilterId || ''} onChange={(e) => setDepartmentFilterId(Number(e.target.value) || 0)}>
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="text"
              placeholder="Code, name, notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="grid-4">
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="location_name">Location Name</option>
              <option value="location_code">Location Code</option>
              <option value="department_name">Department</option>
              <option value="location_type">Location Type</option>
              <option value="availability_status">Availability</option>
              <option value="effective_from">Effective From</option>
              <option value="updated_at">Updated At</option>
            </select>
          </label>
          <label>
            Sort Dir
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value === 'desc' ? 'desc' : 'asc')}>
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active-only filter
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={() => void refresh(0)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
            <button type="button" className="ghost" onClick={startCreate}>New Location</button>
          </div>
        </div>
      </section>

      <form className="panel" onSubmit={handleSave}>
        <h3>{editingLocationId ? `Edit Location #${editingLocationId}` : 'Create Location'}</h3>
        <div className="grid-4">
          <label>
            Location Code
            <input value={form.location_code} onChange={(e) => setForm((prev) => ({ ...prev, location_code: e.target.value }))} required />
          </label>
          <label>
            Location Name
            <input value={form.location_name} onChange={(e) => setForm((prev) => ({ ...prev, location_name: e.target.value }))} required />
          </label>
          <label>
            Department
            <select value={form.department_id || ''} onChange={(e) => setForm((prev) => ({ ...prev, department_id: Number(e.target.value) }))} required>
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Parent Location
            <select value={form.parent_location_id || ''} onChange={(e) => setForm((prev) => ({ ...prev, parent_location_id: Number(e.target.value) || 0 }))}>
              <option value="">None</option>
              {parentCandidates.map((candidate) => (
                <option key={candidate.location_id} value={candidate.location_id}>
                  {candidate.location_code} - {candidate.location_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-4">
          <label>
            Location Type
            <select value={form.location_type} onChange={(e) => setForm((prev) => ({ ...prev, location_type: e.target.value as LocationType }))}>
              {locationTypes.map((locationType) => (
                <option key={locationType} value={locationType}>{locationType}</option>
              ))}
            </select>
          </label>
          <label>
            Availability Status
            <select value={form.availability_status} onChange={(e) => setForm((prev) => ({ ...prev, availability_status: e.target.value as LocationAvailabilityStatus }))}>
              {availabilityStatuses.map((availabilityStatus) => (
                <option key={availabilityStatus} value={availabilityStatus}>{availabilityStatus}</option>
              ))}
            </select>
          </label>
          <label>
            Effective From
            <input type="date" value={form.effective_from} onChange={(e) => setForm((prev) => ({ ...prev, effective_from: e.target.value }))} />
          </label>
          <label>
            Effective To
            <input type="date" value={form.effective_to} onChange={(e) => setForm((prev) => ({ ...prev, effective_to: e.target.value }))} />
          </label>
        </div>

        <div className="grid-4">
          <label className="inline">
            <input type="checkbox" checked={form.can_hold_stock} onChange={(e) => setForm((prev) => ({ ...prev, can_hold_stock: e.target.checked }))} />
            Can hold stock
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.can_receive_stock} onChange={(e) => setForm((prev) => ({ ...prev, can_receive_stock: e.target.checked }))} />
            Can receive stock
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.can_issue_stock} onChange={(e) => setForm((prev) => ({ ...prev, can_issue_stock: e.target.checked }))} />
            Can issue stock
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.can_store_equipment} onChange={(e) => setForm((prev) => ({ ...prev, can_store_equipment: e.target.checked }))} />
            Can store equipment
          </label>
        </div>

        <div className="grid-4">
          <label className="inline">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
            Is active
          </label>
          <label>
            Notes
            <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={2} />
          </label>
        </div>

        <div className="row-actions">
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingLocationId ? 'Update Location' : 'Create Location'}</button>
          <button type="button" className="ghost" onClick={startCreate} disabled={saving}>Reset</button>
        </div>
      </form>

      <section className="panel">
        {!loading && rows.length === 0 ? <p>No locations found for current filters.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Department</th>
              <th>Parent</th>
              <th>Type</th>
              <th>Receive</th>
              <th>Issue</th>
              <th>Active</th>
              <th>Availability</th>
              <th>Effective</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.location_id}>
                <td>{row.location_code}</td>
                <td>{row.location_name}</td>
                <td>{row.department_code} - {row.department_name}</td>
                <td>{row.parent_location_code ? `${row.parent_location_code} - ${row.parent_location_name || ''}` : '-'}</td>
                <td>{row.location_type}</td>
                <td>{row.can_receive_stock ? 'Yes' : 'No'}</td>
                <td>{row.can_issue_stock ? 'Yes' : 'No'}</td>
                <td>{row.is_active ? 'Yes' : 'No'}</td>
                <td>{row.availability_status}</td>
                <td>{toDateInput(row.effective_from)}{row.effective_to ? ` to ${toDateInput(row.effective_to)}` : ''}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="ghost" onClick={() => startEdit(row)}>Edit</button>
                    <button type="button" className="ghost" onClick={() => void handleDeactivate(row, 'inactive')} disabled={!row.is_active || saving}>Inactive</button>
                    <button type="button" className="ghost" onClick={() => void handleDeactivate(row, 'rented_out')} disabled={saving}>Rented out</button>
                    <button type="button" className="ghost" onClick={() => void handleDeactivate(row, 'unavailable')} disabled={saving}>Unavailable</button>
                  </div>
                </td>
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
