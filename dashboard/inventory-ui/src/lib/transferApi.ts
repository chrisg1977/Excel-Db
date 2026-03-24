type TransferLinePayload = {
  product_id: number;
  uom_id?: number;
  qty: number;
  unit_cost?: number;
  line_notes?: string;
};

type ReceiveLinePayload = {
  line_no: number;
  received_qty: number;
  damaged_qty: number;
  lost_qty: number;
};

export type TransferDepartmentOption = {
  department_id: number;
  department_code: string;
  department_name: string;
  department_type: string;
  is_active: boolean;
};

export type TransferLocationOption = {
  location_id: number;
  location_code: string;
  location_name: string;
  department_id: number;
  department_code: string;
  department_name: string;
  location_type: string;
  can_receive_stock: boolean;
  can_issue_stock: boolean;
  is_active: boolean;
  availability_status: string;
};

export type TransferFormOptions = {
  departments: TransferDepartmentOption[];
  locations: TransferLocationOption[];
};

export type TransferSummaryRecord = {
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
  notes_sender: string | null;
  notes_receiver: string | null;
  courier: string | null;
  transport_method: string | null;
  tracking_number: string | null;
  dispatch_reference: string | null;
  line_count: number;
  dispatched_qty_total: number;
  received_qty_total: number;
  remaining_qty_total: number;
};

export type TransferDetailLine = {
  transfer_line_id: number;
  line_no: number;
  product_id: number;
  sku: string;
  product_name: string;
  uom_id: number | null;
  requested_qty: number;
  dispatched_qty: number;
  received_qty: number;
  damaged_qty: number;
  lost_qty: number;
  remaining_qty: number;
  unit_cost: number | null;
  line_notes: string | null;
};

export type TransferDetailRecord = TransferSummaryRecord & {
  lines: TransferDetailLine[];
};

export type PendingTransferDashboard = {
  department_id: number;
  pending_dispatch_count: number;
  awaiting_receipt_count: number;
  partially_received_count: number;
  overdue_count: number;
  latest_dispatch_ts: string | null;
};

export type TransferLocationCapability = 'any' | 'issue' | 'receive';

function getStoredNumber(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getRuntimeUserId(): number {
  return getStoredNumber('eos.inventory.userId', 1);
}

export function getRuntimeDepartmentId(): number {
  return getStoredNumber('eos.inventory.departmentId', 1);
}

export function setRuntimeContext(userId: number, departmentId: number): void {
  window.localStorage.setItem('eos.inventory.userId', String(userId));
  window.localStorage.setItem('eos.inventory.departmentId', String(departmentId));
}

export function findTransferDepartment(
  departments: TransferDepartmentOption[],
  departmentId: number | null | undefined,
): TransferDepartmentOption | null {
  if (!departmentId) return null;
  return departments.find((department) => department.department_id === departmentId) ?? null;
}

export function findTransferLocation(
  locations: TransferLocationOption[],
  locationId: number | null | undefined,
): TransferLocationOption | null {
  if (!locationId) return null;
  return locations.find((location) => location.location_id === locationId) ?? null;
}

export function getTransferLocationsForDepartment(
  locations: TransferLocationOption[],
  departmentId: number | null | undefined,
  capability: TransferLocationCapability = 'any',
): TransferLocationOption[] {
  if (!departmentId) return [];
  return locations.filter((location) => {
    if (location.department_id !== departmentId) return false;
    if (location.is_active !== true || location.availability_status !== 'active') return false;
    if (capability === 'issue' && location.can_issue_stock !== true) return false;
    if (capability === 'receive' && location.can_receive_stock !== true) return false;
    return true;
  });
}

export function formatTransferDepartmentLabel(department: Pick<TransferDepartmentOption, 'department_code' | 'department_name'> | null | undefined): string {
  if (!department) return 'Unknown department';
  return `${department.department_code} - ${department.department_name}`;
}

export function formatTransferLocationLabel(
  location: Pick<TransferLocationOption, 'location_code' | 'location_name'> | null | undefined,
  emptyLabel = 'Department level',
): string {
  if (!location) return emptyLabel;
  return `${location.location_code} - ${location.location_name}`;
}

export function formatTransferEndpointLabel(endpoint: {
  department_code?: string | null;
  department_name?: string | null;
  location_code?: string | null;
  location_name?: string | null;
}): string {
  const departmentCode = String(endpoint.department_code || '').trim();
  const departmentName = String(endpoint.department_name || '').trim();
  const locationCode = String(endpoint.location_code || '').trim();
  const locationName = String(endpoint.location_name || '').trim();
  const departmentLabel = departmentCode && departmentName
    ? `${departmentCode} - ${departmentName}`
    : departmentCode || departmentName || 'Unknown department';
  const locationLabel = locationCode && locationName
    ? `${locationCode} - ${locationName}`
    : locationCode || locationName || 'Department level';
  return `${departmentLabel} / ${locationLabel}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof (body as { error?: string }).error === 'string' ? (body as { error: string }).error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export async function fetchPendingTransfers(userId: number, departmentId: number) {
  const res = await fetch(`/api/inventory/transfers/pending?user_id=${userId}&department_id=${departmentId}`);
  return readJson<{ data: TransferSummaryRecord[] }>(res);
}

export async function fetchPendingDashboard(userId: number, departmentId: number) {
  const res = await fetch(`/api/inventory/transfers/dashboard/pending?user_id=${userId}&department_id=${departmentId}`);
  return readJson<PendingTransferDashboard>(res);
}

export async function fetchTransferFormOptions(input?: { userId?: number; departmentId?: number | null }) {
  const params = new URLSearchParams();
  params.set('user_id', String(input?.userId ?? getRuntimeUserId()));
  const departmentId = input?.departmentId ?? getRuntimeDepartmentId();
  if (Number.isFinite(departmentId) && departmentId > 0) {
    params.set('department_id', String(departmentId));
  }
  const res = await fetch(`/api/inventory/transfer-form-options?${params.toString()}`);
  return readJson<TransferFormOptions>(res);
}

export async function fetchTransferById(userId: number, transferId: number) {
  const res = await fetch(`/api/inventory/transfers/${transferId}?user_id=${userId}`);
  return readJson<TransferDetailRecord>(res);
}

export async function lookupTransferByNumber(userId: number, transferNumber: string) {
  const res = await fetch(`/api/inventory/transfers/lookup/${encodeURIComponent(transferNumber)}?user_id=${userId}`);
  return readJson<TransferSummaryRecord>(res);
}

export async function createTransfer(payload: {
  user_id: number;
  source_department_id: number;
  source_location_id?: number | null;
  target_department_id: number;
  target_location_id?: number | null;
  notes_sender?: string;
  expected_arrival_date?: string;
  courier?: string;
  transport_method?: string;
  tracking_number?: string;
  dispatch_reference?: string;
  lines: TransferLinePayload[];
}) {
  const res = await fetch('/api/inventory/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<{ transfer_id: number }>(res);
}

export async function dispatchTransfer(payload: {
  transfer_id: number;
  user_id: number;
  sender_confirmation: boolean;
  notes_sender?: string;
}) {
  const res = await fetch(`/api/inventory/transfers/${payload.transfer_id}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<{ ok: boolean; status: string }>(res);
}

export async function receiveTransfer(payload: {
  transfer_id: number;
  user_id: number;
  receiver_department_id: number;
  receiver_location_id?: number | null;
  receiver_confirmation: boolean;
  notes_receiver?: string;
  lines: ReceiveLinePayload[];
}) {
  const res = await fetch(`/api/inventory/transfers/${payload.transfer_id}/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readJson<{ ok: boolean; status: string }>(res);
}

export function buildTransferPrintUrl(userId: number, transferId: number): string {
  return `/api/inventory/transfers/${transferId}/print?user_id=${userId}`;
}
