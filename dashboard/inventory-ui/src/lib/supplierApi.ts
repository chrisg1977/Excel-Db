import { getRuntimeUserId } from './transferApi';

export type SupplierRow = {
  supplier_id: number;
  supplier_code: string | null;
  supplier_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  lead_time_days: number | null;
  minimum_order_value: number | null;
  currency_code: string | null;
  notes: string | null;
  is_active: boolean;
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

function appendParam(params: URLSearchParams, key: string, value: number | string | boolean | null | undefined): void {
  if (value === null || value === undefined) return;
  const safe = typeof value === 'number' || typeof value === 'boolean' ? String(value) : value.trim();
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

export async function searchSuppliers(input: {
  userId?: number;
  query?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'include_inactive', input.includeInactive ?? false);
  appendParam(params, 'limit', input.limit ?? 20);
  appendParam(params, 'offset', input.offset ?? 0);
  const res = await fetch(`/api/inventory/suppliers?${params.toString()}`);
  return readJson<PaginatedResponse<SupplierRow>>(res);
}

export async function createSupplier(input: {
  user_id: number;
  supplier_name: string;
  supplier_code?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  lead_time_days?: number | null;
  minimum_order_value?: number | null;
  currency_code?: string | null;
  notes?: string | null;
  is_active?: boolean;
}) {
  const res = await fetch('/api/inventory/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<SupplierRow>(res);
}
