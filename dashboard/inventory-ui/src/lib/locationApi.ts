import { getRuntimeUserId } from './transferApi';

export type LocationAvailabilityStatus =
  | 'active'
  | 'inactive'
  | 'rented_out'
  | 'under_maintenance'
  | 'unavailable'
  | 'archived';

export type LocationType =
  | 'store'
  | 'cupboard'
  | 'clinic'
  | 'office'
  | 'apartment'
  | 'cabinet'
  | 'warehouse'
  | 'room'
  | 'temporary'
  | 'external';

export type LocationRecord = {
  location_id: number;
  location_code: string;
  location_name: string;
  department_id: number;
  department_code?: string;
  department_name?: string;
  parent_location_id: number | null;
  parent_location_code?: string | null;
  parent_location_name?: string | null;
  location_type: LocationType;
  can_hold_stock: boolean;
  can_receive_stock: boolean;
  can_issue_stock: boolean;
  can_store_equipment: boolean;
  is_active: boolean;
  availability_status: LocationAvailabilityStatus;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
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

type ListLocationInput = {
  userId?: number;
  departmentId?: number | null;
  query?: string;
  activeOnly?: boolean;
  availabilityStatus?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

export type SaveLocationPayload = {
  user_id: number;
  location_code: string;
  location_name: string;
  department_id: number;
  parent_location_id: number | null;
  location_type: LocationType;
  can_hold_stock: boolean;
  can_receive_stock: boolean;
  can_issue_stock: boolean;
  can_store_equipment: boolean;
  is_active: boolean;
  availability_status: LocationAvailabilityStatus;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
};

function appendParam(params: URLSearchParams, key: string, value: number | string | boolean | null | undefined): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') {
    params.set(key, value ? 'true' : 'false');
    return;
  }
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

export async function fetchLocations(input: ListLocationInput) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'department_id', input.departmentId ?? null);
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'active_only', input.activeOnly ?? true);
  appendParam(params, 'availability_status', input.availabilityStatus ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/locations?${params.toString()}`);
  return readJson<PaginatedResponse<LocationRecord>>(res);
}

export async function createLocation(payload: SaveLocationPayload) {
  const res = await fetch('/api/inventory/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<LocationRecord>(res);
}

export async function updateLocation(locationId: number, payload: Partial<SaveLocationPayload> & { user_id: number }) {
  const res = await fetch(`/api/inventory/locations/${locationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<LocationRecord>(res);
}

export async function deactivateLocation(payload: {
  user_id: number;
  location_id: number;
  availability_status: Exclude<LocationAvailabilityStatus, 'active'>;
  effective_to?: string | null;
  notes?: string | null;
}) {
  const res = await fetch(`/api/inventory/locations/${payload.location_id}/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<LocationRecord>(res);
}
