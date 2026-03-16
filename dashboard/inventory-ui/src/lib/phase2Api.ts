import { getRuntimeDepartmentId, getRuntimeUserId } from './transferApi';

export type PaginatedResponse<T> = {
  rows: T[];
  data?: T[];
  total_count: number;
  limit: number;
  offset: number;
};

export type Phase2SupplierRow = {
  supplier_id: number;
  supplier_code: string | null;
  supplier_name: string;
  supplier_status: string | null;
  currency_code: string | null;
  main_phone: string | null;
  main_email: string | null;
  updated_at: string | null;
};

export type Phase2SupplierDetail = Phase2SupplierRow & {
  legal_name: string | null;
  trade_name: string | null;
  vat_number: string | null;
  registration_number: string | null;
  is_active: boolean;
  website: string | null;
  payment_terms_days: number | null;
  lead_time_days: number | null;
  minimum_order_value: number | null;
  minimum_order_qty: number | null;
  preferred_order_method: string | null;
  delivery_notes: string | null;
  default_tax_code: string | null;
  notes_internal: string | null;
};

export type Phase2SupplierContact = {
  supplier_contact_id: number;
  contact_name: string;
  job_title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  is_primary: boolean;
  is_active: boolean;
};

export type Phase2SupplierAddress = {
  supplier_address_id: number;
  address_type: string;
  line_1: string;
  city: string | null;
  country: string | null;
  is_active: boolean;
};

export type Phase2SupplierContract = {
  supplier_contract_id: number;
  contract_type: string | null;
  contract_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  service_contract_flag: boolean;
  is_active: boolean;
};

export type Phase2SupplierCategory = {
  supplier_category_id: number;
  category_code: string;
  category_name: string;
  category_group: string | null;
  is_active: boolean;
};

export type Phase2SupplierCategoryLink = {
  supplier_category_link_id: number;
  supplier_id: number;
  supplier_category_id: number;
  is_primary: boolean;
  is_active: boolean;
  category_code: string;
  category_name: string;
  category_group: string | null;
};

export type Phase2PurchaseOrderRow = {
  po_id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  department_id: number;
  department_name: string;
  status: string;
  order_date: string | null;
  expected_date: string | null;
  currency_code: string | null;
  notes: string | null;
};

export type Phase2AssetRow = {
  equipment_id: number;
  asset_code: string;
  asset_name: string;
  status: string;
  department_id: number | null;
  department_name: string | null;
  location_id: number | null;
  location_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  warranty_start_date: string | null;
  warranty_expiry_date: string | null;
  warranty_status: string;
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

export async function fetchPhase2Suppliers(input: {
  userId?: number;
  query?: string;
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
  supplierStatus?: string;
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'limit', input.limit ?? 50);
  appendParam(params, 'offset', input.offset ?? 0);
  appendParam(params, 'include_inactive', input.includeInactive ?? false);
  appendParam(params, 'supplier_status', input.supplierStatus ?? '');
  const res = await fetch(`/api/inventory/phase2/suppliers?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierRow>>(res);
}

export async function fetchPhase2SupplierDetail(input: { userId?: number; supplierId: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplierId}?${params.toString()}`);
  return readJson<Phase2SupplierDetail>(res);
}

export async function updatePhase2Supplier(input: {
  user_id: number;
  supplier_id: number;
  supplier_status?: string;
  main_phone?: string | null;
  main_email?: string | null;
  payment_terms_days?: number | null;
  notes_internal?: string | null;
}) {
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplier_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<Phase2SupplierDetail>(res);
}

export async function fetchPhase2SupplierCategoriesCatalog(input: { userId?: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/supplier-categories?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierCategory>>(res);
}

export async function fetchPhase2SupplierCategories(input: { userId?: number; supplierId: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplierId}/categories?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierCategoryLink>>(res);
}

export async function fetchPhase2SupplierContacts(input: { userId?: number; supplierId: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplierId}/contacts?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierContact>>(res);
}

export async function fetchPhase2SupplierAddresses(input: { userId?: number; supplierId: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplierId}/addresses?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierAddress>>(res);
}

export async function fetchPhase2SupplierContracts(input: { userId?: number; supplierId: number }) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  const res = await fetch(`/api/inventory/phase2/suppliers/${input.supplierId}/contracts?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2SupplierContract>>(res);
}

export async function fetchPhase2PurchaseOrders(input: {
  userId?: number;
  query?: string;
  departmentId?: number | null;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'department_id', input.departmentId ?? getRuntimeDepartmentId());
  appendParam(params, 'limit', input.limit ?? 50);
  appendParam(params, 'offset', input.offset ?? 0);
  const res = await fetch(`/api/inventory/phase2/purchase-orders?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2PurchaseOrderRow>>(res);
}

export async function createPhase2PurchaseOrder(input: {
  user_id: number;
  supplier_id: number;
  department_id: number;
  location_id?: number | null;
  expected_date?: string | null;
  notes?: string | null;
  lines: Array<{
    product_id?: number | null;
    uom_id?: number | null;
    ordered_qty: number;
    unit_cost: number;
    description?: string | null;
    item_type?: string;
  }>;
}) {
  const res = await fetch('/api/inventory/phase2/purchase-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<Phase2PurchaseOrderRow>(res);
}

export async function fetchPhase2Assets(input: {
  userId?: number;
  query?: string;
  departmentId?: number | null;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  appendParam(params, 'user_id', input.userId ?? getRuntimeUserId());
  appendParam(params, 'q', input.query ?? '');
  appendParam(params, 'department_id', input.departmentId ?? getRuntimeDepartmentId());
  appendParam(params, 'limit', input.limit ?? 50);
  appendParam(params, 'offset', input.offset ?? 0);
  const res = await fetch(`/api/inventory/phase2/assets?${params.toString()}`);
  return readJson<PaginatedResponse<Phase2AssetRow>>(res);
}

export async function createPhase2MaintenanceEvent(input: {
  user_id: number;
  equipment_id: number;
  maintenance_type: string;
  opened_date: string;
  scheduled_date?: string | null;
  completed_date?: string | null;
  cost?: number;
  issue_summary?: string | null;
  work_done?: string | null;
}) {
  const res = await fetch(`/api/inventory/phase2/assets/${input.equipment_id}/maintenance-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<{ maintenance_event_id: number }>(res);
}

export async function disposePhase2Asset(input: {
  user_id: number;
  equipment_id: number;
  disposal_date?: string | null;
  disposal_reason: string;
  disposal_method?: string | null;
  residual_value?: number | null;
  notes?: string | null;
}) {
  const res = await fetch(`/api/inventory/phase2/assets/${input.equipment_id}/disposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<{ equipment_id: number; status: string }>(res);
}
