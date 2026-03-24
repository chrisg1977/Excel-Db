import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createEquipmentAsset,
  EquipmentAssetRow,
  EquipmentMovementRow,
  fetchEquipmentAssets,
  fetchEquipmentMovements,
  moveEquipmentAsset,
  updateEquipmentAsset,
} from '../lib/equipmentApi';
import {
  fetchTransferFormOptions,
  getTransferLocationsForDepartment,
  getRuntimeDepartmentId,
  getRuntimeUserId,
  setRuntimeContext,
  TransferDepartmentOption,
  TransferLocationOption,
} from '../lib/transferApi';
import { createSupplier, searchSuppliers, SupplierRow } from '../lib/supplierApi';

const pageSize = 50;

function locationLabel(row: {
  department_code?: string | null;
  department_name?: string | null;
  location_code?: string | null;
  location_name?: string | null;
}): string {
  const departmentPart = row.department_code && row.department_name
    ? `${row.department_code} - ${row.department_name}`
    : (row.department_code || row.department_name || 'No department');
  const locationPart = row.location_code && row.location_name
    ? `${row.location_code} - ${row.location_name}`
    : (row.location_code || row.location_name || 'No location');
  return `${departmentPart} / ${locationPart}`;
}

export function EquipmentPlacementPage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [locations, setLocations] = useState<TransferLocationOption[]>([]);

  const [filterDepartmentId, setFilterDepartmentId] = useState<number>(0);
  const [filterLocationId, setFilterLocationId] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [rows, setRows] = useState<EquipmentAssetRow[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number>(0);
  const [movementRows, setMovementRows] = useState<EquipmentMovementRow[]>([]);

  const [newAssetCode, setNewAssetCode] = useState<string>('');
  const [newAssetName, setNewAssetName] = useState<string>('');
  const [newAssetType, setNewAssetType] = useState<string>('');
  const [newAssetSerial, setNewAssetSerial] = useState<string>('');
  const [newAssetSupplierId, setNewAssetSupplierId] = useState<number>(0);
  const [newAssetSupplierQuery, setNewAssetSupplierQuery] = useState<string>('');
  const [includeInactiveSuppliers, setIncludeInactiveSuppliers] = useState<boolean>(false);
  const [allowNullSupplier, setAllowNullSupplier] = useState<boolean>(false);
  const [newAssetPurchaseDate, setNewAssetPurchaseDate] = useState<string>('');
  const [newAssetPurchaseCost, setNewAssetPurchaseCost] = useState<string>('');
  const [newAssetWarrantyStartDate, setNewAssetWarrantyStartDate] = useState<string>('');
  const [newAssetWarrantyEndDate, setNewAssetWarrantyEndDate] = useState<string>('');
  const [newAssetInvoiceReference, setNewAssetInvoiceReference] = useState<string>('');
  const [newAssetIsActive, setNewAssetIsActive] = useState<boolean>(true);
  const [newAssetDepartmentId, setNewAssetDepartmentId] = useState<number>(departmentId);
  const [newAssetLocationId, setNewAssetLocationId] = useState<number>(0);
  const [newAssetStatus, setNewAssetStatus] = useState<'active' | 'inactive' | 'maintenance' | 'retired'>('active');
  const [newAssetNotes, setNewAssetNotes] = useState<string>('');

  const [supplierOptions, setSupplierOptions] = useState<SupplierRow[]>([]);
  const [supplierLoading, setSupplierLoading] = useState<boolean>(false);
  const [showCreateSupplier, setShowCreateSupplier] = useState<boolean>(false);
  const [createSupplierName, setCreateSupplierName] = useState<string>('');
  const [createSupplierCode, setCreateSupplierCode] = useState<string>('');
  const [createSupplierContactName, setCreateSupplierContactName] = useState<string>('');
  const [createSupplierPhone, setCreateSupplierPhone] = useState<string>('');
  const [createSupplierEmail, setCreateSupplierEmail] = useState<string>('');
  const [createSupplierLeadTimeDays, setCreateSupplierLeadTimeDays] = useState<string>('');
  const [createSupplierMinimumOrderValue, setCreateSupplierMinimumOrderValue] = useState<string>('');
  const [createSupplierCurrencyCode, setCreateSupplierCurrencyCode] = useState<string>('EUR');
  const [createSupplierNotes, setCreateSupplierNotes] = useState<string>('');

  const [editAssetCode, setEditAssetCode] = useState<string>('');
  const [editAssetName, setEditAssetName] = useState<string>('');
  const [editAssetType, setEditAssetType] = useState<string>('');
  const [editAssetSerial, setEditAssetSerial] = useState<string>('');
  const [editDepartmentId, setEditDepartmentId] = useState<number>(0);
  const [editLocationId, setEditLocationId] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<'active' | 'inactive' | 'maintenance' | 'retired'>('active');
  const [editPurchaseDate, setEditPurchaseDate] = useState<string>('');
  const [editPurchaseCost, setEditPurchaseCost] = useState<string>('');
  const [editWarrantyStartDate, setEditWarrantyStartDate] = useState<string>('');
  const [editWarrantyEndDate, setEditWarrantyEndDate] = useState<string>('');
  const [editInvoiceReference, setEditInvoiceReference] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editIsActive, setEditIsActive] = useState<boolean>(true);

  const [moveToDepartmentId, setMoveToDepartmentId] = useState<number>(departmentId);
  const [moveToLocationId, setMoveToLocationId] = useState<number>(0);
  const [moveReason, setMoveReason] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const selectedSupplier = useMemo(
    () => supplierOptions.find((row) => row.supplier_id === newAssetSupplierId) || null,
    [supplierOptions, newAssetSupplierId]
  );

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;

  const visibleFilterLocations = useMemo(
    () => (filterDepartmentId > 0
      ? getTransferLocationsForDepartment(locations, filterDepartmentId, 'any')
      : locations),
    [locations, filterDepartmentId]
  );

  const newAssetLocations = useMemo(
    () => (newAssetDepartmentId > 0
      ? getTransferLocationsForDepartment(locations, newAssetDepartmentId, 'any')
      : []),
    [locations, newAssetDepartmentId]
  );

  const moveLocations = useMemo(
    () => (moveToDepartmentId > 0
      ? getTransferLocationsForDepartment(locations, moveToDepartmentId, 'any')
      : []),
    [locations, moveToDepartmentId]
  );

  const selectedAsset = useMemo(
    () => rows.find((row) => row.equipment_id === selectedAssetId) || null,
    [rows, selectedAssetId]
  );

  const editLocations = useMemo(
    () => (editDepartmentId > 0
      ? getTransferLocationsForDepartment(locations, editDepartmentId, 'any')
      : []),
    [locations, editDepartmentId]
  );

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
  setRuntimeContext(userId, departmentId);
    try {
      const [options, assets] = await Promise.all([
        fetchTransferFormOptions({ userId }),
        fetchEquipmentAssets({
          userId,
          departmentId: filterDepartmentId > 0 ? filterDepartmentId : null,
          locationId: filterLocationId > 0 ? filterLocationId : null,
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
      const list = assets.rows || assets.data || [];
      setRows(list);
      setTotalCount(Number(assets.total_count || 0));
      setOffset(nextOffset);

      if (selectedAssetId && !list.some((row) => row.equipment_id === selectedAssetId)) {
        setSelectedAssetId(0);
        setMovementRows([]);
      }

      setStatus(`Loaded ${list.length} asset(s) of ${Number(assets.total_count || 0)}`);
    } catch (err) {
      setStatus(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadMovements(equipmentId: number) {
    setLoading(true);
    setStatus('');
    try {
      const result = await fetchEquipmentMovements({
        equipmentId,
        userId,
        limit: 100,
        offset: 0,
        sortBy: 'moved_at',
        sortDir: 'desc',
      });
      const list = result.rows || result.data || [];
      setMovementRows(list);
      setStatus(`Loaded ${list.length} movement record(s)`);
    } catch (err) {
      setStatus(`Load movement history failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      setSupplierLoading(true);
      try {
        const result = await searchSuppliers({
          userId,
          query: newAssetSupplierQuery,
          limit: 20,
          offset: 0,
          includeInactive: includeInactiveSuppliers,
        });
        if (!cancelled) {
          setSupplierOptions(result.rows || result.data || []);
        }
      } catch {
        if (!cancelled) {
          setSupplierOptions([]);
        }
      } finally {
        if (!cancelled) {
          setSupplierLoading(false);
        }
      }
    }

    void loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, [userId, newAssetSupplierQuery, includeInactiveSuppliers]);

  useEffect(() => {
    if (!selectedAsset) {
      setEditAssetCode('');
      setEditAssetName('');
      setEditAssetType('');
      setEditAssetSerial('');
      setEditDepartmentId(0);
      setEditLocationId(0);
      setEditStatus('active');
      setEditPurchaseDate('');
      setEditPurchaseCost('');
      setEditWarrantyStartDate('');
      setEditWarrantyEndDate('');
      setEditInvoiceReference('');
      setEditNotes('');
      setEditIsActive(true);
      return;
    }

    setEditAssetCode(selectedAsset.asset_code || '');
    setEditAssetName(selectedAsset.asset_name || '');
    setEditAssetType(selectedAsset.asset_type || '');
    setEditAssetSerial(selectedAsset.serial_number || '');
    setEditDepartmentId(selectedAsset.department_id || 0);
    setEditLocationId(selectedAsset.location_id || 0);
    setEditStatus((selectedAsset.status || 'active') as 'active' | 'inactive' | 'maintenance' | 'retired');
    setEditPurchaseDate(selectedAsset.purchase_date || '');
    setEditPurchaseCost(selectedAsset.purchase_cost == null ? '' : String(selectedAsset.purchase_cost));
    setEditWarrantyStartDate(selectedAsset.warranty_start_date || '');
    setEditWarrantyEndDate(selectedAsset.warranty_end_date || selectedAsset.warranty_expiry_date || '');
    setEditInvoiceReference(selectedAsset.invoice_reference || '');
    setEditNotes(selectedAsset.notes || '');
    setEditIsActive(Boolean(selectedAsset.is_active));
    setNewAssetSupplierId(selectedAsset.supplier_id || 0);
    setNewAssetSupplierQuery(selectedAsset.supplier_name || '');
  }, [selectedAsset]);

  async function handleCreateSupplierFromModal() {
    setSaving(true);
    setStatus('');
    try {
      if (!createSupplierName.trim()) {
        setStatus('supplier_name is required');
        setSaving(false);
        return;
      }

      const created = await createSupplier({
        user_id: userId,
        supplier_name: createSupplierName.trim(),
        supplier_code: createSupplierCode.trim() || null,
        contact_name: createSupplierContactName.trim() || null,
        phone: createSupplierPhone.trim() || null,
        email: createSupplierEmail.trim() || null,
        lead_time_days: createSupplierLeadTimeDays ? Number(createSupplierLeadTimeDays) : null,
        minimum_order_value: createSupplierMinimumOrderValue ? Number(createSupplierMinimumOrderValue) : null,
        currency_code: createSupplierCurrencyCode.trim() || 'EUR',
        notes: createSupplierNotes.trim() || null,
        is_active: true,
      });

      setNewAssetSupplierId(created.supplier_id);
      setNewAssetSupplierQuery(created.supplier_name);
      setShowCreateSupplier(false);
      setCreateSupplierName('');
      setCreateSupplierCode('');
      setCreateSupplierContactName('');
      setCreateSupplierPhone('');
      setCreateSupplierEmail('');
      setCreateSupplierLeadTimeDays('');
      setCreateSupplierMinimumOrderValue('');
      setCreateSupplierCurrencyCode('EUR');
      setCreateSupplierNotes('');
      setStatus(`Supplier created: ${created.supplier_name}`);
    } catch (err) {
      setStatus(`Create supplier failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAsset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!newAssetCode.trim() || !newAssetName.trim()) {
        setStatus('asset_code and asset_name are required');
        setSaving(false);
        return;
      }
      if (!newAssetDepartmentId || !newAssetLocationId) {
        setStatus('department and location are required for placement');
        setSaving(false);
        return;
      }
      if (!newAssetSupplierId && !allowNullSupplier) {
        setStatus('Supplier is required unless "Allow No Supplier" is enabled');
        setSaving(false);
        return;
      }
      if (newAssetWarrantyStartDate && newAssetWarrantyEndDate && newAssetWarrantyStartDate > newAssetWarrantyEndDate) {
        setStatus('Warranty end must be on or after warranty start');
        setSaving(false);
        return;
      }

      const created = await createEquipmentAsset({
        user_id: userId,
        asset_code: newAssetCode.trim(),
        asset_name: newAssetName.trim(),
        asset_type: newAssetType.trim() || null,
        serial_number: newAssetSerial.trim() || null,
        supplier_id: newAssetSupplierId || null,
        purchase_date: newAssetPurchaseDate || null,
        purchase_cost: newAssetPurchaseCost ? Number(newAssetPurchaseCost) : null,
        warranty_start_date: newAssetWarrantyStartDate || null,
        warranty_end_date: newAssetWarrantyEndDate || null,
        invoice_reference: newAssetInvoiceReference.trim() || null,
        is_active: newAssetIsActive,
        department_id: newAssetDepartmentId,
        location_id: newAssetLocationId,
        status: newAssetStatus,
        notes: newAssetNotes.trim() || null,
      });

      setStatus(`Asset created: ${created.asset_code}`);
      setNewAssetCode('');
      setNewAssetName('');
      setNewAssetType('');
      setNewAssetSerial('');
      setNewAssetSupplierId(0);
      setNewAssetSupplierQuery('');
      setNewAssetPurchaseDate('');
      setNewAssetPurchaseCost('');
      setNewAssetWarrantyStartDate('');
      setNewAssetWarrantyEndDate('');
      setNewAssetInvoiceReference('');
      setNewAssetIsActive(true);
      setAllowNullSupplier(false);
      setNewAssetNotes('');
      setNewAssetStatus('active');
      setSelectedAssetId(created.equipment_id);
      setMoveToDepartmentId(created.department_id || departmentId);
      setMoveToLocationId(created.location_id || 0);

      await refresh(0);
      await loadMovements(created.equipment_id);
    } catch (err) {
      setStatus(`Create asset failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateAsset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!selectedAssetId) {
        setStatus('Select an asset first');
        setSaving(false);
        return;
      }
      if (!editAssetCode.trim() || !editAssetName.trim()) {
        setStatus('asset_code and asset_name are required');
        setSaving(false);
        return;
      }
      if (!newAssetSupplierId && !allowNullSupplier) {
        setStatus('Supplier is required unless "Allow No Supplier" is enabled');
        setSaving(false);
        return;
      }
      if (editWarrantyStartDate && editWarrantyEndDate && editWarrantyStartDate > editWarrantyEndDate) {
        setStatus('Warranty end must be on or after warranty start');
        setSaving(false);
        return;
      }

      const updated = await updateEquipmentAsset({
        equipment_id: selectedAssetId,
        user_id: userId,
        asset_code: editAssetCode.trim(),
        asset_name: editAssetName.trim(),
        asset_type: editAssetType.trim() || null,
        serial_number: editAssetSerial.trim() || null,
        supplier_id: newAssetSupplierId || null,
        purchase_date: editPurchaseDate || null,
        purchase_cost: editPurchaseCost ? Number(editPurchaseCost) : null,
        warranty_start_date: editWarrantyStartDate || null,
        warranty_end_date: editWarrantyEndDate || null,
        invoice_reference: editInvoiceReference.trim() || null,
        is_active: editIsActive,
        department_id: editDepartmentId || undefined,
        location_id: editLocationId || null,
        status: editStatus,
        notes: editNotes.trim() || null,
      });

      setStatus(`Asset updated: ${updated.asset_code}`);
      await refresh(offset);
      await loadMovements(selectedAssetId);
    } catch (err) {
      setStatus(`Update asset failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveAsset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!selectedAssetId) {
        setStatus('Select an asset first');
        setSaving(false);
        return;
      }
      if (!moveToDepartmentId || !moveToLocationId) {
        setStatus('to_department and to_location are required');
        setSaving(false);
        return;
      }

      const moved = await moveEquipmentAsset({
        equipment_id: selectedAssetId,
        user_id: userId,
        to_department_id: moveToDepartmentId,
        to_location_id: moveToLocationId,
        reason: moveReason.trim() || null,
      });

      setStatus(`Asset moved to ${locationLabel(moved.equipment)}`);
      setMoveReason('');
      await refresh(offset);
      await loadMovements(selectedAssetId);
    } catch (err) {
      setStatus(`Move failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Equipment Placement</h2>
      <p>Basic asset placement and movement audit using centralized department/location assignments.</p>

      <section className="panel">
        <div className="grid-6">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value) || 0)} />
          </label>
          <label>
            Runtime Department
            <input type="number" min={1} value={departmentId || ''} onChange={(e) => setDepartmentId(Number(e.target.value) || 0)} />
          </label>
          <label>
            Filter Department
            <select value={filterDepartmentId || ''} onChange={(e) => {
              setFilterDepartmentId(Number(e.target.value) || 0);
              setFilterLocationId(0);
            }}>
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter Location
            <select value={filterLocationId || ''} onChange={(e) => setFilterLocationId(Number(e.target.value) || 0)}>
              <option value="">All locations</option>
              {visibleFilterLocations.map((location) => (
                <option key={location.location_id} value={location.location_id}>
                  {location.location_code} - {location.location_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">all</option>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="maintenance">maintenance</option>
              <option value="retired">retired</option>
            </select>
          </label>
          <label>
            Search
            <input
              type="text"
              value={query}
              placeholder="asset code, name, serial, location"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="updated_at">Updated At</option>
              <option value="asset_code">Asset Code</option>
              <option value="asset_name">Asset Name</option>
              <option value="supplier_name">Supplier</option>
              <option value="purchase_date">Purchase Date</option>
              <option value="warranty_end_date">Warranty End</option>
              <option value="department_name">Department</option>
              <option value="location_name">Location</option>
              <option value="status">Status</option>
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
        <h3>Create Asset</h3>
        <form onSubmit={handleCreateAsset}>
          <div className="grid-6">
            <label>
              Asset Code
              <input value={newAssetCode} onChange={(e) => setNewAssetCode(e.target.value)} required />
            </label>
            <label>
              Asset Name
              <input value={newAssetName} onChange={(e) => setNewAssetName(e.target.value)} required />
            </label>
            <label>
              Asset Type
              <input value={newAssetType} onChange={(e) => setNewAssetType(e.target.value)} placeholder="chair, xray, scanner" />
            </label>
            <label>
              Serial Number
              <input value={newAssetSerial} onChange={(e) => setNewAssetSerial(e.target.value)} />
            </label>
            <label>
              Supplier Search
              <input
                value={newAssetSupplierQuery}
                onChange={(e) => setNewAssetSupplierQuery(e.target.value)}
                placeholder="type supplier name/code"
              />
            </label>
            <label>
              Include Inactive Suppliers
              <select value={includeInactiveSuppliers ? '1' : '0'} onChange={(e) => setIncludeInactiveSuppliers(e.target.value === '1')}>
                <option value="0">no</option>
                <option value="1">yes</option>
              </select>
            </label>
            <label>
              Supplier
              <select value={newAssetSupplierId || ''} onChange={(e) => setNewAssetSupplierId(Number(e.target.value) || 0)}>
                <option value="">No supplier</option>
                {supplierOptions.map((supplier) => (
                  <option key={supplier.supplier_id} value={supplier.supplier_id}>
                    {supplier.supplier_name}{supplier.supplier_code ? ` (${supplier.supplier_code})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="row-actions tight">
              <button type="button" className="ghost" onClick={() => setShowCreateSupplier(true)} disabled={saving}>
                {newAssetSupplierQuery.trim() ? `Create new supplier "${newAssetSupplierQuery.trim()}"` : 'Create Supplier'}
              </button>
            </div>
            <label>
              Allow No Supplier
              <select value={allowNullSupplier ? '1' : '0'} onChange={(e) => setAllowNullSupplier(e.target.value === '1')}>
                <option value="0">no</option>
                <option value="1">yes</option>
              </select>
            </label>
            <label>
              Department
              <select value={newAssetDepartmentId || ''} onChange={(e) => {
                setNewAssetDepartmentId(Number(e.target.value) || 0);
                setNewAssetLocationId(0);
              }}>
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {department.department_code} - {department.department_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Location
              <select value={newAssetLocationId || ''} onChange={(e) => setNewAssetLocationId(Number(e.target.value) || 0)}>
                <option value="">Select location</option>
                {newAssetLocations.map((location) => (
                  <option key={location.location_id} value={location.location_id}>
                    {location.location_code} - {location.location_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={newAssetStatus} onChange={(e) => setNewAssetStatus(e.target.value as 'active' | 'inactive' | 'maintenance' | 'retired')}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="maintenance">maintenance</option>
                <option value="retired">retired</option>
              </select>
            </label>
            <label>
              Purchase Date
              <input type="date" value={newAssetPurchaseDate} onChange={(e) => setNewAssetPurchaseDate(e.target.value)} />
            </label>
            <label>
              Purchase Cost
              <input
                type="number"
                min="0"
                step="0.01"
                value={newAssetPurchaseCost}
                onChange={(e) => setNewAssetPurchaseCost(e.target.value)}
              />
            </label>
            <label>
              Warranty Start
              <input type="date" value={newAssetWarrantyStartDate} onChange={(e) => setNewAssetWarrantyStartDate(e.target.value)} />
            </label>
            <label>
              Warranty End
              <input type="date" value={newAssetWarrantyEndDate} onChange={(e) => setNewAssetWarrantyEndDate(e.target.value)} />
            </label>
            <label>
              Invoice Ref
              <input value={newAssetInvoiceReference} onChange={(e) => setNewAssetInvoiceReference(e.target.value)} />
            </label>
            <label>
              Active Flag
              <select value={newAssetIsActive ? '1' : '0'} onChange={(e) => setNewAssetIsActive(e.target.value === '1')}>
                <option value="1">active</option>
                <option value="0">inactive</option>
              </select>
            </label>
            <label>
              Notes
              <input value={newAssetNotes} onChange={(e) => setNewAssetNotes(e.target.value)} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Asset'}</button>
            </div>
          </div>
          <p>
            Supplier: {selectedSupplier ? selectedSupplier.supplier_name : (supplierLoading ? 'loading suggestions...' : 'none selected')}
          </p>
        </form>

        {showCreateSupplier ? (
          <div className="panel">
            <h4>Create Supplier</h4>
            <div className="grid-6">
              <label>
                Supplier Name
                <input value={createSupplierName} onChange={(e) => setCreateSupplierName(e.target.value)} required />
              </label>
              <label>
                Supplier Code
                <input value={createSupplierCode} onChange={(e) => setCreateSupplierCode(e.target.value)} />
              </label>
              <label>
                Contact Name
                <input value={createSupplierContactName} onChange={(e) => setCreateSupplierContactName(e.target.value)} />
              </label>
              <label>
                Phone
                <input value={createSupplierPhone} onChange={(e) => setCreateSupplierPhone(e.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={createSupplierEmail} onChange={(e) => setCreateSupplierEmail(e.target.value)} />
              </label>
              <label>
                Lead Time Days
                <input type="number" min="0" value={createSupplierLeadTimeDays} onChange={(e) => setCreateSupplierLeadTimeDays(e.target.value)} />
              </label>
              <label>
                Minimum Order Value
                <input type="number" min="0" step="0.01" value={createSupplierMinimumOrderValue} onChange={(e) => setCreateSupplierMinimumOrderValue(e.target.value)} />
              </label>
              <label>
                Currency Code
                <input value={createSupplierCurrencyCode} onChange={(e) => setCreateSupplierCurrencyCode(e.target.value)} />
              </label>
              <label>
                Notes
                <input value={createSupplierNotes} onChange={(e) => setCreateSupplierNotes(e.target.value)} />
              </label>
              <div className="row-actions tight">
                <button type="button" onClick={() => void handleCreateSupplierFromModal()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Supplier'}
                </button>
                <button type="button" className="ghost" onClick={() => setShowCreateSupplier(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h3>Edit Selected Asset</h3>
        <form onSubmit={handleUpdateAsset}>
          <div className="grid-6">
            <label>
              Selected Asset
              <input value={selectedAsset ? `${selectedAsset.asset_code} - ${selectedAsset.asset_name}` : ''} readOnly placeholder="Select from table" />
            </label>
            <label>
              Asset Code
              <input value={editAssetCode} onChange={(e) => setEditAssetCode(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Asset Name
              <input value={editAssetName} onChange={(e) => setEditAssetName(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Asset Type
              <input value={editAssetType} onChange={(e) => setEditAssetType(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Serial Number
              <input value={editAssetSerial} onChange={(e) => setEditAssetSerial(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Department
              <select value={editDepartmentId || ''} onChange={(e) => {
                setEditDepartmentId(Number(e.target.value) || 0);
                setEditLocationId(0);
              }} disabled={!selectedAsset}>
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {department.department_code} - {department.department_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Location
              <select value={editLocationId || ''} onChange={(e) => setEditLocationId(Number(e.target.value) || 0)} disabled={!selectedAsset}>
                <option value="">Select location</option>
                {editLocations.map((location) => (
                  <option key={location.location_id} value={location.location_id}>
                    {location.location_code} - {location.location_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive' | 'maintenance' | 'retired')} disabled={!selectedAsset}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="maintenance">maintenance</option>
                <option value="retired">retired</option>
              </select>
            </label>
            <label>
              Purchase Date
              <input type="date" value={editPurchaseDate} onChange={(e) => setEditPurchaseDate(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Purchase Cost
              <input type="number" min="0" step="0.01" value={editPurchaseCost} onChange={(e) => setEditPurchaseCost(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Warranty Start
              <input type="date" value={editWarrantyStartDate} onChange={(e) => setEditWarrantyStartDate(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Warranty End
              <input type="date" value={editWarrantyEndDate} onChange={(e) => setEditWarrantyEndDate(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Invoice Ref
              <input value={editInvoiceReference} onChange={(e) => setEditInvoiceReference(e.target.value)} disabled={!selectedAsset} />
            </label>
            <label>
              Active Flag
              <select value={editIsActive ? '1' : '0'} onChange={(e) => setEditIsActive(e.target.value === '1')} disabled={!selectedAsset}>
                <option value="1">active</option>
                <option value="0">inactive</option>
              </select>
            </label>
            <label>
              Notes
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} disabled={!selectedAsset} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving || !selectedAsset}>{saving ? 'Saving...' : 'Save Asset'}</button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Asset Placement</h3>
        {!loading && rows.length === 0 ? <p>No assets found for the current filters.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>Asset Code</th>
              <th>Asset Name</th>
              <th>Type</th>
              <th>Serial</th>
              <th>Supplier</th>
              <th>Purchase</th>
              <th>Warranty End</th>
              <th>Placement</th>
              <th>Status</th>
              <th>Active</th>
              <th>Updated At</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.equipment_id}>
                <td>
                  <label className="inline">
                    <input
                      type="radio"
                      checked={selectedAssetId === row.equipment_id}
                      onChange={() => {
                        setSelectedAssetId(row.equipment_id);
                        setMoveToDepartmentId(row.department_id || departmentId);
                        setMoveToLocationId(row.location_id || 0);
                        void loadMovements(row.equipment_id);
                      }}
                    />
                    pick
                  </label>
                </td>
                <td>{row.asset_code}</td>
                <td>{row.asset_name}</td>
                <td>{row.asset_type || '-'}</td>
                <td>{row.serial_number || '-'}</td>
                <td>{row.supplier_name || '-'}</td>
                <td>{row.purchase_date || '-'}</td>
                <td>{row.warranty_end_date || row.warranty_expiry_date || '-'}</td>
                <td>{locationLabel(row)}</td>
                <td>{row.status}</td>
                <td>{row.is_active ? 'yes' : 'no'}</td>
                <td>{row.updated_at || ''}</td>
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

      <section className="panel">
        <h3>Move Selected Asset</h3>
        <form onSubmit={handleMoveAsset}>
          <div className="grid-6">
            <label>
              Selected Asset
              <input value={selectedAsset ? `${selectedAsset.asset_code} - ${selectedAsset.asset_name}` : ''} readOnly placeholder="Select from table" />
            </label>
            <label>
              To Department
              <select value={moveToDepartmentId || ''} onChange={(e) => {
                setMoveToDepartmentId(Number(e.target.value) || 0);
                setMoveToLocationId(0);
              }}>
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.department_id} value={department.department_id}>
                    {department.department_code} - {department.department_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To Location
              <select value={moveToLocationId || ''} onChange={(e) => setMoveToLocationId(Number(e.target.value) || 0)}>
                <option value="">Select location</option>
                {moveLocations.map((location) => (
                  <option key={location.location_id} value={location.location_id}>
                    {location.location_code} - {location.location_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Move Reason
              <input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="Optional note" />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving || !selectedAssetId}>{saving ? 'Saving...' : 'Move Asset'}</button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Movement History (Selected Asset)</h3>
        {!selectedAssetId ? <p>Select an asset to view movement history.</p> : null}
        {selectedAssetId && movementRows.length === 0 ? <p>No movement history yet for this asset.</p> : null}
        {movementRows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Moved At</th>
                <th>Moved By</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {movementRows.map((row) => (
                <tr key={row.history_id}>
                  <td>{row.moved_at || ''}</td>
                  <td>{row.moved_by_username || row.moved_by || '-'}</td>
                  <td>{locationLabel({
                    department_code: row.from_department_code,
                    department_name: row.from_department_name,
                    location_code: row.from_location_code,
                    location_name: row.from_location_name,
                  })}</td>
                  <td>{locationLabel({
                    department_code: row.to_department_code,
                    department_name: row.to_department_name,
                    location_code: row.to_location_code,
                    location_name: row.to_location_name,
                  })}</td>
                  <td>{row.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
