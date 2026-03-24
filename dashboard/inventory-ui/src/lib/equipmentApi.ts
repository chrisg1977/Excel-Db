import { getRuntimeDepartmentId, getRuntimeUserId } from './transferApi';

export type EquipmentAssetStatus = 'active' | 'inactive' | 'maintenance' | 'retired';

export type EquipmentAssetRow = {
  equipment_id: number;
  asset_code: string;
  asset_name: string;
  asset_type: string | null;
  serial_number: string | null;
  supplier_id: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  warranty_start_date: string | null;
  warranty_expiry_date: string | null;
  warranty_end_date: string | null;
  invoice_reference: string | null;
  is_active: boolean;
  department_id: number | null;
  department_code: string | null;
  department_name: string | null;
  location_id: number | null;
  location_code: string | null;
  location_name: string | null;
  status: EquipmentAssetStatus;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EquipmentMovementRow = {
  history_id: number;
  equipment_id: number;
  from_department_id: number | null;
  from_department_code: string | null;
  from_department_name: string | null;
  from_location_id: number | null;
  from_location_code: string | null;
  from_location_name: string | null;
  to_department_id: number | null;
  to_department_code: string | null;
  to_department_name: string | null;
  to_location_id: number | null;
  to_location_code: string | null;
  to_location_name: string | null;
  moved_by: number | null;
  moved_by_username: string | null;
  moved_at: string | null;
  reason: string | null;
};

export type PaginatedResponse<T> = {
  rows: T[];
  data?: T[];
  total_count: number;
  limit: number;
  offset: number;
  sort_by?: string;
  sort_dir?: string;
};

function appendParam(params: URLSearchParams, key: string, value: number | string | null | undefined): void {
  if (value === null || value === undefined) return;
  const safe = typeof value === 'number' ? String(value) : value.trim();
  if (!safe) return;
  params.set(key, safe);
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof (body as { error?: string }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchEquipmentAssets(input: {
  userId?: number;
  departmentId?: number | null;
  locationId?: number | null;
  status?: string;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'department_id', input.departmentId ?? getRuntimeDepartmentId());
  appendParam(params, 'location_id', input.locationId ?? null);
  appendParam(params, 'status', input.status ?? '');
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/equipment/assets?${params.toString()}`);
  return readJson<PaginatedResponse<EquipmentAssetRow>>(res);
}

export async function createEquipmentAsset(input: {
  user_id: number;
  asset_code: string;
  asset_name: string;
  asset_type?: string | null;
  serial_number?: string | null;
  supplier_id?: number | null;
  purchase_date?: string | null;
  purchase_cost?: number | null;
  warranty_start_date?: string | null;
  warranty_end_date?: string | null;
  warranty_expiry_date?: string | null;
  invoice_reference?: string | null;
  is_active?: boolean;
  department_id: number;
  location_id?: number | null;
  status?: EquipmentAssetStatus;
  notes?: string | null;
}) {
  const res = await fetch('/api/inventory/equipment/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<EquipmentAssetRow>(res);
}

export async function updateEquipmentAsset(input: {
  equipment_id: number;
  user_id: number;
  asset_code?: string;
  asset_name?: string;
  asset_type?: string | null;
  serial_number?: string | null;
  supplier_id?: number | null;
  purchase_date?: string | null;
  purchase_cost?: number | null;
  warranty_start_date?: string | null;
  warranty_end_date?: string | null;
  invoice_reference?: string | null;
  is_active?: boolean;
  department_id?: number;
  location_id?: number | null;
  status?: EquipmentAssetStatus;
  notes?: string | null;
}) {
  const res = await fetch(`/api/inventory/equipment/assets/${input.equipment_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: input.user_id,
      asset_code: input.asset_code,
      asset_name: input.asset_name,
      asset_type: input.asset_type,
      serial_number: input.serial_number,
      supplier_id: input.supplier_id,
      purchase_date: input.purchase_date,
      purchase_cost: input.purchase_cost,
      warranty_start_date: input.warranty_start_date,
      warranty_end_date: input.warranty_end_date,
      invoice_reference: input.invoice_reference,
      is_active: input.is_active,
      department_id: input.department_id,
      location_id: input.location_id,
      status: input.status,
      notes: input.notes,
    }),
  });
  return readJson<EquipmentAssetRow>(res);
}

export async function moveEquipmentAsset(input: {
  equipment_id: number;
  user_id: number;
  to_department_id: number;
  to_location_id: number;
  moved_at?: string | null;
  reason?: string | null;
}) {
  const res = await fetch(`/api/inventory/equipment/assets/${input.equipment_id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: input.user_id,
      to_department_id: input.to_department_id,
      to_location_id: input.to_location_id,
      moved_at: input.moved_at ?? null,
      reason: input.reason ?? null,
    }),
  });
  return readJson<{
    equipment: EquipmentAssetRow;
    movement: {
      history_id: number | null;
      moved_by: number;
      moved_at: string | null;
      from_department_id: number | null;
      from_location_id: number | null;
      to_department_id: number;
      to_location_id: number;
    };
  }>(res);
}

export async function fetchEquipmentMovements(input: {
  equipmentId: number;
  userId?: number;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/equipment/assets/${input.equipmentId}/movements?${params.toString()}`);
  return readJson<PaginatedResponse<EquipmentMovementRow> & { equipment: EquipmentAssetRow }>(res);
}
