import { getRuntimeUserId } from './transferApi';

export type ProductRow = {
  product_id: number;
  sku: string;
  product_name: string;
  product_type: string;
  default_cost: number;
  default_sell_price: number;
  is_purchasable: boolean;
  is_active: boolean;
  updated_at: string | null;
  supplier_id: number | null;
  preferred_supplier_id: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
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

export async function fetchProducts(input: {
  userId?: number;
  query?: string;
  supplierId?: number | null;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'supplier_id', input.supplierId ?? null);
  appendParam(params, 'include_inactive', input.includeInactive ?? false);
  appendParam(params, 'limit', input.limit ?? 50);
  appendParam(params, 'offset', input.offset ?? 0);
  appendParam(params, 'sort_by', input.sortBy ?? 'product_name');
  appendParam(params, 'sort_dir', input.sortDir ?? 'asc');
  const res = await fetch(`/api/inventory/products?${params.toString()}`);
  return readJson<PaginatedResponse<ProductRow>>(res);
}

export async function createProduct(input: {
  user_id: number;
  sku: string;
  product_name: string;
  product_type?: string;
  supplier_id?: number | null;
  default_cost?: number | null;
  is_purchasable?: boolean;
  is_active?: boolean;
}) {
  const res = await fetch('/api/inventory/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<ProductRow>(res);
}

export async function updateProduct(input: {
  product_id: number;
  user_id: number;
  sku?: string;
  product_name?: string;
  supplier_id?: number | null;
  default_cost?: number | null;
  is_purchasable?: boolean;
  is_active?: boolean;
}) {
  const res = await fetch(`/api/inventory/products/${input.product_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: input.user_id,
      sku: input.sku,
      product_name: input.product_name,
      supplier_id: input.supplier_id,
      default_cost: input.default_cost,
      is_purchasable: input.is_purchasable,
      is_active: input.is_active,
    }),
  });
  return readJson<ProductRow>(res);
}
