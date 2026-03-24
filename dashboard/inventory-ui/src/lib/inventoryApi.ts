import { getRuntimeDepartmentId, getRuntimeUserId } from './transferApi';

export type StockByDepartmentRow = {
  department_id: number;
  department_code: string;
  department_name: string;
  product_id: number;
  sku: string;
  product_name: string;
  on_hand_qty: number;
  stock_value: number;
};

export type StockByLocationRow = {
  department_id: number;
  department_code: string;
  department_name: string;
  location_id: number;
  location_code: string;
  location_name: string;
  product_id: number;
  sku: string;
  product_name: string;
  on_hand_qty: number;
  stock_value: number;
};

export type ProductStockBreakdownRow = {
  department_id: number;
  department_code: string;
  department_name: string;
  location_id: number | null;
  location_code: string | null;
  location_name: string | null;
  on_hand_qty: number;
  stock_value: number;
};

export type ProductStockBreakdownResponse = {
  product: {
    product_id: number;
    sku: string;
    product_name: string;
  };
  data: ProductStockBreakdownRow[];
};

export type TransferListRow = {
  transfer_id: number;
  transfer_number: string;
  transfer_status: string;
  created_at: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  expected_arrival_date: string | null;
  is_pending_dispatch: boolean;
  is_awaiting_receipt: boolean;
  is_overdue: boolean;
  pending_receipt_alert: string | null;
  source_department_id: number;
  source_department_code: string;
  source_department_name: string;
  source_location_id: number | null;
  source_location_code: string | null;
  source_location_name: string | null;
  target_department_id: number;
  target_department_code: string;
  target_department_name: string;
  target_location_id: number | null;
  target_location_code: string | null;
  target_location_name: string | null;
  dispatched_by: number | null;
  dispatched_by_username: string | null;
  received_by: number | null;
  received_by_username: string | null;
  line_count: number;
};

export type ReorderSuggestionRow = {
  reorder_suggestion_id: number;
  suggestion_date: string;
  department_id: number;
  department_code: string;
  department_name: string;
  product_id: number;
  sku: string;
  product_name: string;
  supplier_id: number | null;
  supplier_name: string | null;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
  min_qty: number;
  max_qty: number;
  reorder_qty: number;
  suggested_order_qty: number;
  reason_text: string | null;
  status: 'new' | 'reviewed' | 'converted' | 'ignored';
  location_count: number;
  zero_or_negative_location_count: number;
  location_aware_hint: string;
  po_conversion_ready: boolean;
};

export type GenerateReorderSuggestionsResponse = {
  suggestion_date: string | null;
  generated_count: number;
  regenerated: boolean;
  scope_department_id: number | null;
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

function appendParam(params: URLSearchParams, key: string, value: number | string | null | undefined): void {
  if (value === null || value === undefined) return;
  const safe = typeof value === 'number' ? String(value) : value.trim();
  if (!safe) return;
  params.set(key, safe);
}

export async function fetchStockByDepartment(input: {
  userId?: number;
  departmentId?: number | null;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'department_id', input.departmentId ?? getRuntimeDepartmentId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/stock/by-department?${params.toString()}`);
  return readJson<PaginatedResponse<StockByDepartmentRow>>(res);
}

export async function fetchStockByLocation(input: {
  userId?: number;
  departmentId?: number | null;
  locationId?: number | null;
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
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/stock/by-location?${params.toString()}`);
  return readJson<PaginatedResponse<StockByLocationRow>>(res);
}

export async function fetchProductStockBreakdown(input: {
  productId: number;
  userId?: number;
  departmentId?: number | null;
  locationId?: number | null;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'department_id', input.departmentId ?? null);
  appendParam(params, 'location_id', input.locationId ?? null);
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/stock/product/${input.productId}?${params.toString()}`);
  return readJson<ProductStockBreakdownResponse & PaginatedResponse<ProductStockBreakdownRow>>(res);
}

export async function fetchTransferList(input: {
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
  const res = await fetch(`/api/inventory/transfers?${params.toString()}`);
  return readJson<PaginatedResponse<TransferListRow>>(res);
}

export async function fetchReorderSuggestions(input: {
  userId?: number;
  departmentId?: number | null;
  suggestionDate?: string | null;
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
  appendParam(params, 'suggestion_date', input.suggestionDate ?? null);
  appendParam(params, 'status', input.status ?? '');
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? null);
  appendParam(params, 'offset', input.offset ?? null);
  appendParam(params, 'sort_by', input.sortBy ?? '');
  appendParam(params, 'sort_dir', input.sortDir ?? '');
  const res = await fetch(`/api/inventory/reorder/suggestions?${params.toString()}`);
  return readJson<PaginatedResponse<ReorderSuggestionRow>>(res);
}

export async function generateReorderSuggestions(input: {
  userId?: number;
  departmentId?: number | null;
  suggestionDate?: string | null;
  regenerate?: boolean;
}) {
  const res = await fetch('/api/inventory/reorder/suggestions/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: input.userId ?? getRuntimeUserId(),
      department_id: input.departmentId ?? getRuntimeDepartmentId(),
      suggestion_date: input.suggestionDate ?? null,
      regenerate: input.regenerate ?? true,
    }),
  });
  return readJson<GenerateReorderSuggestionsResponse>(res);
}

export function formatLocationFallback(locationCode: string | null, locationName: string | null): string {
  if (locationCode && locationName) return `${locationCode} - ${locationName}`;
  if (locationCode || locationName) return String(locationCode || locationName);
  return 'Department-level / Unspecified location';
}
