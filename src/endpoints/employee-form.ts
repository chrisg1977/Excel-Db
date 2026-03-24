import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

type PaydayMeta = {
  daysToPayday: number;
  lastPayday: string;
};

type ProfilePeriod = {
  period_from: string;
  period_to: string;
  paycheck_date: string;
  transaction_id: string | null;
  status: string;
  latest_activity_label: string | null;
};

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftIsoDate = (isoDate: string, deltaDays: number): string => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setDate(parsed.getDate() + deltaDays);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizePayrollSubscriptionType = (value: unknown): 'MAIN' | 'PROVIDER' | 'O3P' | '' => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MAIN') return 'MAIN';
  if (normalized === 'PROVIDER' || normalized === 'PROV') return 'PROVIDER';
  if (normalized === 'O3P' || normalized === 'THIRDPARTY' || normalized === '3P') return 'O3P';
  return '';
};

const buildPayrollSelectionFlags = (rows: Record<string, unknown>[], asOfDate: string) => {
  const flags = {
    payroll_main_tax: false,
    payroll_provider_tax: false,
    payroll_three_tax: false,
  };
  rows.forEach((row) => {
    const payrollType = normalizePayrollSubscriptionType(row.payroll_type);
    if (!payrollType) return;
    const activeFrom = toIsoDate(row.active_from);
    const activeTo = toIsoDate(row.active_to);
    const isActiveAsOf = (!activeFrom || activeFrom <= asOfDate) && (!activeTo || activeTo >= asOfDate);
    if (!isActiveAsOf) return;
    if (payrollType === 'MAIN') flags.payroll_main_tax = true;
    if (payrollType === 'PROVIDER') flags.payroll_provider_tax = true;
    if (payrollType === 'O3P') flags.payroll_three_tax = true;
  });
  return flags;
};

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const EU_NATIONALITY_KEYS = new Set([
  'MALTA', 'MALTESE', 'MT', 'AUSTRIA', 'AUSTRIAN', 'BELGIUM', 'BELGIAN', 'BULGARIA', 'BULGARIAN',
  'CROATIA', 'CROATIAN', 'CYPRUS', 'CYPRIOT', 'CZECH REPUBLIC', 'CZECHIA', 'CZECH', 'DENMARK', 'DANISH',
  'ESTONIA', 'ESTONIAN', 'FINLAND', 'FINNISH', 'FRANCE', 'FRENCH', 'GERMANY', 'GERMAN', 'GREECE', 'GREEK',
  'HUNGARY', 'HUNGARIAN', 'IRELAND', 'IRISH', 'ITALY', 'ITALIAN', 'LATVIA', 'LATVIAN', 'LITHUANIA', 'LITHUANIAN',
  'LUXEMBOURG', 'LUXEMBOURGER', 'NETHERLANDS', 'DUTCH', 'POLAND', 'POLISH', 'PORTUGAL', 'PORTUGUESE',
  'ROMANIA', 'ROMANIAN', 'SLOVAKIA', 'SLOVAK', 'SLOVENIA', 'SLOVENIAN', 'SPAIN', 'SPANISH', 'SWEDEN', 'SWEDISH',
]);

const normalizeNationalityCountry = (value: unknown): string => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const upper = text.toUpperCase();
  if (upper === 'NAN' || upper === 'EU' || upper === 'NON-EU' || upper === 'NON EU' || upper === 'OTHER') return '';
  if (upper === 'MALTA' || upper === 'MALTESE' || upper === 'MT') return 'Maltese';
  return text;
};

const normalizeNationalityRegion = (value: unknown): 'EU' | 'NON_EU' | '' => {
  const upper = String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!upper) return '';
  if (upper === 'EU') return 'EU';
  if (upper === 'NON-EU' || upper === 'NON_EU' || upper === 'OTHER') return 'NON_EU';
  return '';
};

const deriveNationalityRegionFromCountry = (country: string): 'EU' | 'NON_EU' | '' => {
  const normalizedCountry = normalizeNationalityCountry(country);
  if (!normalizedCountry) return '';
  return EU_NATIONALITY_KEYS.has(normalizedCountry.toUpperCase()) ? 'EU' : 'NON_EU';
};

const buildLegacyNationality = (country: string, region: 'EU' | 'NON_EU' | ''): string => {
  if (!country || !region) return '';
  return `${country}/${region === 'EU' ? 'EU' : 'Non-EU'}`;
};

const resolveNationalityParts = (
  legacyValue: unknown,
  countryValue?: unknown,
  regionValue?: unknown
): { country: string; region: 'EU' | 'NON_EU' | ''; legacy: string } => {
  const explicitCountry = normalizeNationalityCountry(countryValue);
  const explicitRegion = normalizeNationalityRegion(regionValue);

  const legacy = String(legacyValue || '').trim();
  const legacyUpper = legacy.toUpperCase();
  const legacyCountryRaw = legacy.includes('/') ? legacy.split('/')[0] : legacy;
  const legacyCountry = normalizeNationalityCountry(legacyCountryRaw);

  let derivedRegion: 'EU' | 'NON_EU' | '' = '';
  if (legacyUpper.includes('/NON-EU') || legacyUpper.includes('/NON EU') || legacyUpper.includes('/OTHER')) {
    derivedRegion = 'NON_EU';
  } else if (legacyUpper.includes('/EU') || legacyUpper === 'EU' || legacyUpper.includes('EUROPE')) {
    derivedRegion = 'EU';
  } else if (legacyUpper === 'NON-EU' || legacyUpper === 'NON EU' || legacyUpper === 'OTHER') {
    derivedRegion = 'NON_EU';
  }

  const country = explicitCountry || legacyCountry;
  const region = explicitRegion || derivedRegion || deriveNationalityRegionFromCountry(country);
  return {
    country,
    region,
    legacy: buildLegacyNationality(country, region),
  };
};

const lastDayOfMonth = (year: number, month: number): string => {
  const date = new Date(year, month, 0);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const lastFridayOfMonth = (year: number, month: number): string => {
  const date = new Date(year, month, 0);
  while (date.getDay() !== 5) {
    date.setDate(date.getDate() - 1);
  }
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const diffDays = (fromIso: string, toIso: string): number => {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
};

const buildPaydayMeta = (today = new Date()): PaydayMeta => {
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const thisMonthPayday = lastFridayOfMonth(today.getFullYear(), today.getMonth() + 1);
  if (todayIso <= thisMonthPayday) {
    const previousMonth = today.getMonth() === 0 ? 12 : today.getMonth();
    const previousYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    return {
      daysToPayday: diffDays(todayIso, thisMonthPayday),
      lastPayday: lastFridayOfMonth(previousYear, previousMonth),
    };
  }

  const nextMonth = today.getMonth() === 11 ? 1 : today.getMonth() + 2;
  const nextYear = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
  return {
    daysToPayday: diffDays(todayIso, lastFridayOfMonth(nextYear, nextMonth)),
    lastPayday: thisMonthPayday,
  };
};

const normalizeYear = (value: unknown): number => {
  const raw = Number(value);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(raw) || raw < 1900 || raw > currentYear) return currentYear;
  return Math.trunc(raw);
};

const monthKey = (isoDate: string): string => isoDate.slice(0, 7);

const describeLatestActivity = (row: Record<string, unknown>): string | null => {
  const latestDate = toIsoDate(row.import_date) || toIsoDate(row.updated_at) || toIsoDate(row.created_at);
  return latestDate ? `Imported ${latestDate}` : null;
};

const buildProfilePeriods = (
  year: number,
  timesheets: Record<string, unknown>[],
  payrollLines: Record<string, unknown>[]
): ProfilePeriod[] => {
  const periods = new Map<string, ProfilePeriod>();

  payrollLines.forEach((row) => {
    const periodFrom = toIsoDate(row.period_from);
    const periodTo = toIsoDate(row.period_to);
    if (!periodFrom || !periodTo) return;
    const key = `${periodFrom}|${periodTo}`;
    const existing = periods.get(key);
    const latestActivity = toIsoDate(row.entry_updated_at) || toIsoDate(row.line_updated_at) || toIsoDate(row.line_created_at);
    const candidate: ProfilePeriod = {
      period_from: periodFrom,
      period_to: periodTo,
      paycheck_date: toIsoDate(row.payment_date) || lastFridayOfMonth(Number(periodFrom.slice(0, 4)), Number(periodFrom.slice(5, 7))),
      transaction_id: row.payroll_number ? String(row.payroll_number) : (row.payroll_entry_id ? String(row.payroll_entry_id) : null),
      status: String(row.status || 'PENDING'),
      latest_activity_label: latestActivity ? `Updated ${latestActivity}` : null,
    };
    if (!existing || String(candidate.status || '').toUpperCase() !== 'PENDING') {
      periods.set(key, candidate);
    }
  });

  timesheets.forEach((row) => {
    const workDate = toIsoDate(row.work_date);
    if (!workDate || !workDate.startsWith(`${year}-`)) return;
    const [yyyy, mm] = workDate.split('-').map(Number);
    const periodFrom = `${yyyy}-${String(mm).padStart(2, '0')}-01`;
    const periodTo = lastDayOfMonth(yyyy, mm);
    const key = `${periodFrom}|${periodTo}`;
    const latestActivity = describeLatestActivity(row);
    const current = periods.get(key);
    if (!current) {
      periods.set(key, {
        period_from: periodFrom,
        period_to: periodTo,
        paycheck_date: lastFridayOfMonth(yyyy, mm),
        transaction_id: null,
        status: 'PENDING',
        latest_activity_label: latestActivity,
      });
      return;
    }
    if (latestActivity && (!current.latest_activity_label || latestActivity > current.latest_activity_label)) {
      current.latest_activity_label = latestActivity;
    }
  });

  return Array.from(periods.values()).sort((a, b) => b.period_from.localeCompare(a.period_from));
};

const buildWarningObjects = (
  employee: Record<string, unknown>,
  subscriptions: Record<string, unknown>[],
  timesheets: Record<string, unknown>[],
  year: number
): Array<{ text: string }> => {
  const warnings: Array<{ text: string }> = [];
  const terminatedOn = toIsoDate(employee.terminated_on);
  if (terminatedOn) {
    warnings.push({ text: `Employee terminated on ${terminatedOn}` });
  }
  if (!subscriptions.length) {
    warnings.push({ text: 'No payroll subscriptions found' });
  }
  if (!timesheets.length) {
    warnings.push({ text: `No timesheets recorded for ${year}` });
  }
  return warnings;
};

const mapLeaveRow = (row: Record<string, unknown>) => ({
  work_date: toIsoDate(row.work_date),
  hours: toNumber(row.hours),
  leave_status: row.leave_status ? String(row.leave_status) : 'Pending',
  notes: row.notes ? String(row.notes) : '',
});

const groupOtherLeaveTypes = (timesheets: Record<string, unknown>[]) => {
  const groups = new Map<string, Array<{ work_date: string | null; hours: number; leave_status: string; notes: string }>>();
  timesheets.forEach((row) => {
    const leaveType = String(row.hour_type || '').trim().toUpperCase();
    if (!leaveType || leaveType === 'WORK' || leaveType === 'VACATION_LEAVE' || leaveType === 'SICK_LEAVE') return;
    const group = groups.get(leaveType) || [];
    group.push(mapLeaveRow(row));
    groups.set(leaveType, group);
  });
  return Array.from(groups.entries()).map(([leaveType, rows]) => ({
    leave_type: leaveType,
    rows,
  }));
};

const GEO_LOCALITY_FALLBACK = [
  'Valletta', 'Birkirkara', 'Mosta', 'Sliema', 'Naxxar', 'Zabbar', 'Mellieha', 'Mgarr', 'Birzebbugia',
  'Marsaskala', 'Marsaxlokk', 'Zejtun', 'Zurrieq', 'Rabat', 'Mdina', 'Attard', 'Balzan', 'Lija',
  "St Julian's", 'Swieqi', 'Pembroke', 'Gzira', 'Msida', 'Hamrun', 'Qormi', 'Paola', 'Fgura', 'Tarxien',
  'Santa Venera', 'Floriana', 'Kalkara', 'Senglea', 'Cospicua', 'Vittoriosa', 'Ghaxaq', 'Luqa',
  'Gudja', 'Safi', 'Mqabba', 'Qrendi', 'Siggiewi', 'Dingli'
];

const cleanDesignationText = (value: unknown): string => {
  return String(value || '')
    .replace(/^\s*\d+[\.)\-]?\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const normalizePermissionLevel = (roleName: unknown): string => {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return 'General User';
  if (normalized.includes('hr')) return 'HR';
  if (normalized.includes('manag')) return 'Management';
  if (normalized.includes('full') || normalized.includes('admin') || normalized.includes('super')) return 'Full';
  return 'General User';
};

const ROLE_RANK = {
  'general user': 1,
  management: 2,
  hr: 3,
  full: 4,
  admin: 5,
  administrator: 5,
  superadmin: 5,
};

const normalizeRoleRank = (roleName: unknown): number => {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return 0;
  if ((ROLE_RANK as Record<string, number>)[normalized]) return (ROLE_RANK as Record<string, number>)[normalized];
  if (normalized.includes('super') || normalized.includes('admin')) return ROLE_RANK.admin;
  if (normalized.includes('full')) return ROLE_RANK.full;
  if (normalized.includes('hr')) return ROLE_RANK.hr;
  if (normalized.includes('manag')) return ROLE_RANK.management;
  if (normalized.includes('general') || normalized.includes('user')) return ROLE_RANK['general user'];
  return 0;
};

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

const TIMESHEET_MODE_VALUES = new Set(['OPENDENTAL', 'CSV', 'MANUAL', 'NONE']);

const normalizeTimesheetMode = (value: unknown, fallbackRequired: unknown = null): string | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (TIMESHEET_MODE_VALUES.has(normalized)) return normalized;
  if (normalized === 'TRUE') return 'OPENDENTAL';
  if (normalized === 'FALSE') return 'NONE';
  if (fallbackRequired === false) return 'NONE';
  if (fallbackRequired === true) return 'OPENDENTAL';
  return null;
};

const timesheetModeRequiresTimesheet = (mode: unknown, fallbackRequired: unknown = null): boolean => {
  const normalized = normalizeTimesheetMode(mode, fallbackRequired);
  if (!normalized) return false;
  return normalized !== 'NONE';
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(String(value ?? ''));
  }
};

const parseEmpIdList = (value: unknown): number[] => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return Array.from(new Set(raw
    .split(',')
    .map((entry) => Number(String(entry || '').trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)));
};

const parseYearMonth = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null;
};

const parsePayrollScope = (value: unknown): string => {
  const raw = String(value || 'MAIN').trim().toUpperCase();
  if (raw === 'PROV') return 'PROVIDER';
  if (raw === 'O3P') return 'THIRDPARTY';
  if (raw === 'PROVIDER' || raw === 'THIRDPARTY' || raw === 'MAIN') return raw;
  return 'MAIN';
};

const getOrCreateOverlay = async (database: any, empId: number) => {
  const existing = await database('employee_self_service_profile').where('emp_id', empId).first();
  if (existing) return existing;
  const inserted = await database('employee_self_service_profile')
    .insert({ emp_id: empId })
    .returning('*');
  return inserted?.[0] || inserted;
};

const assertYourInfoTables = async (database: any) => {
  const required = [
    'employee_self_service_profile',
    'employee_self_service_audit_log',
    'employee_self_service_change_requests',
    'employee_bank_change_confirmation',
  ];

  const rows = await database('information_schema.tables')
    .select('table_name')
    .where('table_schema', 'public')
    .whereIn('table_name', required);

  const found = new Set(rows.map((row: Record<string, unknown>) => String(row.table_name || '')));
  const missing = required.filter((name) => !found.has(name));
  if (missing.length > 0) {
    const err = new Error(`YOUR INFO migration missing tables: ${missing.join(', ')}`);
    (err as any).statusCode = 503;
    throw err;
  }
};

const getActorContext = async (database: any, userId: string) => {
  const actor = await database.withSchema('directus')
    .from('directus_users as u')
    .leftJoin('directus_roles as r', 'u.role', 'r.id')
    .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'r.name as role_name', 'u.status')
    .where('u.id', userId)
    .first();

  if (!actor || String(actor.status || '').toLowerCase() !== 'active') {
    return null;
  }

  const actorEmail = normalizeEmail(actor.email);
  let employeeId: number | null = null;

  if (actorEmail) {
    const mappedByEmail = await database('vw_employee_current')
      .select('emp_id')
      .whereRaw("lower(coalesce(email, '')) = lower(?)", [actorEmail])
      .first();
    const mappedEmpId = Number(mappedByEmail?.emp_id);
    if (Number.isFinite(mappedEmpId) && mappedEmpId > 0) {
      employeeId = mappedEmpId;
    }
  }

  return {
    user_id: String(actor.id),
    email: actorEmail,
    role_name: String(actor.role_name || '').trim(),
    role_rank: normalizeRoleRank(actor.role_name),
    label: [String(actor.first_name || '').trim(), String(actor.last_name || '').trim()].filter(Boolean).join(' ') || actorEmail || 'User',
    employee_id: employeeId,
  };
};

const queueHrHandover = async (
  database: any,
  actor: Record<string, unknown>,
  targetEmpId: number,
  note: string
) => {
  const hrUsers = await database.withSchema('directus')
    .from('directus_users as u')
    .leftJoin('directus_roles as r', 'u.role', 'r.id')
    .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'r.name as role_name')
    .where('u.status', 'active');

  const recipients = (hrUsers as Record<string, unknown>[])
    .filter((row) => normalizeRoleRank(row.role_name) >= ROLE_RANK.hr)
    .map((row) => {
      const email = normalizeEmail(row.email);
      return {
        user_id: String(row.id || '').trim(),
        email,
        label: [String(row.first_name || '').trim(), String(row.last_name || '').trim()].filter(Boolean).join(' ') || email || 'User',
      };
    })
    .filter((recipient) => recipient.email && recipient.email !== normalizeEmail(actor.email));

  if (!recipients.length) return;

  const inserted = await database('handover_items')
    .insert({
      source: 'handover',
      title: `YOUR INFO change - Emp ${targetEmpId}`,
      details: note,
      target_type: 'group',
      target_user_id: null,
      target_user_email: null,
      target_group: 'hr_admin',
      due_at: null,
      created_by_user_id: String(actor.user_id || ''),
      created_by_email: normalizeEmail(actor.email),
      created_by_label: String(actor.label || 'System'),
      status: 'open',
    })
    .returning(['id']);

  const itemId = Number(inserted?.[0]?.id || inserted?.id);
  if (!Number.isFinite(itemId) || itemId <= 0) return;

  await database('handover_item_events').insert({
    item_id: itemId,
    event_type: 'created',
    actor_user_id: String(actor.user_id || ''),
    actor_label: String(actor.label || 'System'),
    note,
    payload: {
      source: 'handover',
      recipient_mode: 'group',
      completion_mode: 'all',
      recipients,
      tag: 'your-info-change',
      target_emp_id: targetEmpId,
    },
  });
};

const sortUniqueText = (values: unknown[]): string[] => Array.from(new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)).sort((a, b) => a.localeCompare(b));

const normalizeEmploymentStatus = (
  rawStatus: unknown,
  terminatedOn: unknown,
  sourceTransition: EmployeeTransitionRow | null = null,
  targetTransition: EmployeeTransitionRow | null = null
): 'CURRENT' | 'PROSPECTIVE' | 'ARCHIVED' | 'TERMINATED' => {
  const sourceEmpId = Number(sourceTransition?.source_emp_id);
  if (Number.isFinite(sourceEmpId) && sourceEmpId > 0) {
    return 'ARCHIVED';
  }

  const targetEmpId = Number(targetTransition?.target_emp_id);
  const targetEffectiveOn = toIsoDate(targetTransition?.effective_on);
  if (Number.isFinite(targetEmpId) && targetEmpId > 0 && targetEffectiveOn) {
    const effectiveDate = new Date(`${targetEffectiveOn}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(effectiveDate.getTime()) && effectiveDate > today) {
      return 'PROSPECTIVE';
    }
  }

  const normalized = String(rawStatus || '').trim().toUpperCase();
  if (normalized === 'CURRENT' || normalized === 'PROSPECTIVE' || normalized === 'ARCHIVED' || normalized === 'TERMINATED') {
    return normalized as 'CURRENT' | 'PROSPECTIVE' | 'ARCHIVED' | 'TERMINATED';
  }
  return toIsoDate(terminatedOn) ? 'TERMINATED' : 'CURRENT';
};

type EmployeeTransitionRow = {
  source_emp_id?: unknown;
  target_emp_id?: unknown;
  effective_on?: unknown;
  status?: unknown;
};

const toPositiveEmpId = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const buildTransitionMeta = (
  empId: number,
  employmentStatus: 'CURRENT' | 'PROSPECTIVE' | 'ARCHIVED' | 'TERMINATED',
  sourceTransition: EmployeeTransitionRow | null,
  targetTransition: EmployeeTransitionRow | null
) => {
  const pendingCloneNewEmpId = sourceTransition?.target_emp_id ? String(sourceTransition.target_emp_id).trim() : '';
  const pendingCloneEffectiveOn = toIsoDate(sourceTransition?.effective_on) || '';
  const sourceFileEmpId = targetTransition?.source_emp_id ? String(targetTransition.source_emp_id).trim() : '';
  const prospectiveUntilEffectiveOn = employmentStatus === 'PROSPECTIVE'
    ? (toIsoDate(targetTransition?.effective_on) || '')
    : '';
  const archivedSourceEmpId = employmentStatus === 'PROSPECTIVE' || employmentStatus === 'CURRENT'
    ? sourceFileEmpId
    : '';

  return {
    pending_clone_new_emp_id: pendingCloneNewEmpId,
    pending_clone_effective_on: pendingCloneEffectiveOn,
    source_file_emp_id: sourceFileEmpId,
    prospective_until_effective_on: prospectiveUntilEffectiveOn,
    archived_source_emp_id: archivedSourceEmpId,
    is_active: employmentStatus !== 'ARCHIVED' && employmentStatus !== 'TERMINATED',
    employment_status: employmentStatus,
    current_emp_id: String(empId || '').trim(),
  };
};

const findRootSourceEmpId = (
  empId: number,
  targetTransitionByEmpId: Map<number, EmployeeTransitionRow>
): number => {
  let currentEmpId = empId;
  const seen = new Set<number>();

  while (!seen.has(currentEmpId)) {
    seen.add(currentEmpId);
    const transition = targetTransitionByEmpId.get(currentEmpId);
    const sourceEmpId = toPositiveEmpId(transition?.source_emp_id);
    if (!sourceEmpId) break;
    currentEmpId = sourceEmpId;
  }

  return currentEmpId;
};

const mapEmployeeFormRow = (
  current: Record<string, unknown>,
  employeeCore: Record<string, unknown> | null,
  profile: Record<string, unknown> | null,
  extras: Record<string, unknown> = {}
) => {
  const nationality = resolveNationalityParts(
    current.nationality || employeeCore?.nationality,
    current.nationality_country || employeeCore?.nationality_country,
    current.nationality_region || employeeCore?.nationality_region
  );

  return ({
  emp_id: current.emp_id,
  title_prefix: profile?.title_prefix || '',
  surname: current.surname || '',
  first_name: current.first_name || '',
  middle_name: profile?.middle_name || '',
  gender: profile?.gender || '',
  dob: toIsoDate(employeeCore?.dob) || '',
  passport: current.passport_no || employeeCore?.passport_no || '',
  id_card: current.national_id || employeeCore?.national_id || current.eu_residency_no || employeeCore?.eu_residency_no || '',
  ssn: current.social_security_no || employeeCore?.social_security_no || '',
  spouse_id_tax: profile?.spouse_id_tax || '',
  designation: cleanDesignationText(profile?.designation || current.position_held || ''),
  department: profile?.department || current.department_code || '',
  address_house: profile?.address_house || current.address1 || '',
  address_street: profile?.address_street || current.address2 || '',
  address_city: current.city || '',
  address_postcode: current.postcode || '',
  phone_1: current.phone_primary || '',
  phone_2: current.phone_secondary || '',
  phone_whatsapp: profile?.whatsapp_phone || '',
  email: current.email || '',
  iban: current.iban || '',
  record_created: toIsoDate(current.file_created_at) || '',
  papers_sent: toIsoDate(profile?.papers_sent) || '',
  approval_date: toIsoDate(profile?.approval_date) || '',
  start_date: toIsoDate(profile?.start_date) || toIsoDate(current.active_from) || '',
  tax_update: profile?.tax_employment_type || current.employment_type || '',
  fixed_hours_week: profile?.fixed_hours_week || current.weekly_hours || '',
  timesheet_mode: normalizeTimesheetMode(profile?.timesheet_mode, profile?.timesheet_required) || '',
  timesheet_required: timesheetModeRequiresTimesheet(profile?.timesheet_mode, profile?.timesheet_required),
  fs4_status_update: profile?.fs4_status || current.fs_status || '',
  marital_update: profile?.marital_status || 'Single',
  termination_date: toIsoDate(profile?.termination_date) || toIsoDate(current.terminated_on) || '',
  termination_reason: profile?.termination_reason || '',
  termination_notes: profile?.termination_notes || '',
  od_username_override: profile?.od_username_override || '',
  od_security_level: profile?.od_security_level || 'Regular users',
  od_force_password_change: profile?.od_force_password_change !== false,
  nationality: nationality.legacy,
  nationality_country: nationality.country,
  nationality_region: nationality.region,
  other_nationality: nationality.country,
  payroll_main_tax: false,
  payroll_provider_tax: false,
  payroll_three_tax: false,
  payroll_source_main: '',
  payroll_source_provider: '',
  payroll_source_o3p: '',
  payroll_method_main: '',
  payroll_method_provider: '',
  payroll_method_o3p: '',
  permission_level: normalizePermissionLevel(profile?.app_permission_level),
  mediatrix_start_date: toIsoDate(profile?.mediatrix_start_date) || toIsoDate(profile?.start_date) || toIsoDate(current.active_from) || '',
  pending_surname: '',
  pending_surname_effective_from: '',
  is_active: extras.is_active ?? !current.terminated_on,
  employment_status: String(extras.employment_status || '').trim().toUpperCase() || (!current.terminated_on ? 'CURRENT' : 'TERMINATED'),
  pending_clone_new_emp_id: String(extras.pending_clone_new_emp_id || '').trim(),
  pending_clone_effective_on: String(extras.pending_clone_effective_on || '').trim(),
  source_file_emp_id: String(extras.source_file_emp_id || '').trim(),
  prospective_until_effective_on: String(extras.prospective_until_effective_on || '').trim(),
  archived_source_emp_id: String(extras.archived_source_emp_id || '').trim(),
  });
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.get('/payroll/employee-form-access', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const actor = await database.withSchema('directus')
        .from('directus_users as u')
        .leftJoin('directus_roles as r', 'u.role', 'r.id')
        .select('u.email', 'r.name as role_name')
        .where('u.id', req.accountability.user)
        .first();

      return res.json({
        actor_email: String(actor?.email || '').trim().toLowerCase(),
        permission_level_cap: normalizePermissionLevel(actor?.role_name),
      });
    } catch (error: any) {
      logger.error('Employee form access lookup failed', error);
      return res.status(500).json({
        error: 'Failed to load employee form access',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/employee-form/lookups', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const profileRows = await database('employee_form_profile')
        .select('department', 'designation');

      return res.json({
        departments: sortUniqueText(
          profileRows.map((row: Record<string, unknown>) => row.department)
        ),
        designations: sortUniqueText(
          profileRows.map((row: Record<string, unknown>) => row.designation)
        ),
        provider_designations: [],
      });
    } catch (error: any) {
      logger.error('Employee form lookups failed', error);
      return res.status(500).json({
        error: 'Failed to load employee form lookups',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/employee-form', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const [currentRows, profileRows, hrRows, sourceTransitions, targetTransitions, subscriptionRows] = await Promise.all([
        database('vw_employee_current')
          .select(
            'emp_id',
            'first_name',
            'surname',
            'national_id',
            'eu_residency_no',
            'nationality',
            'nationality_country',
            'nationality_region',
            'department_code',
            'terminated_on',
            'employment_type'
          )
          .orderBy('emp_id', 'asc'),
        database('employee_form_profile')
          .select('emp_id', 'department', 'designation', 'tax_employment_type', 'marital_status', 'timesheet_mode', 'timesheet_required'),
        database('vw_hr_employee_dashboard_sorted')
          .select('emp_id', 'employment_status'),
        database('employee_file_transitions')
          .select('source_emp_id', 'target_emp_id', 'effective_on', 'status', 'updated_at', 'created_at')
          .whereNotNull('source_emp_id')
          .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }]),
        database('employee_file_transitions')
          .select('source_emp_id', 'target_emp_id', 'effective_on', 'status', 'updated_at', 'created_at')
          .whereNotNull('target_emp_id')
          .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }]),
        database('payroll_subscriptions')
          .select('employee_id', 'payroll_type', 'active_from', 'active_to'),
      ]);

      const profileByEmpId = new Map<number, Record<string, unknown>>(
        profileRows.map((row: Record<string, unknown>) => [Number(row.emp_id), row])
      );
      const hrByEmpId = new Map<number, Record<string, unknown>>(
        hrRows.map((row: Record<string, unknown>) => [Number(row.emp_id), row])
      );
      const latestSourceTransitionByEmpId = new Map<number, EmployeeTransitionRow>();
      (sourceTransitions as Record<string, unknown>[]).forEach((row) => {
        const sourceEmpId = Number(row.source_emp_id);
        if (Number.isFinite(sourceEmpId) && sourceEmpId > 0 && !latestSourceTransitionByEmpId.has(sourceEmpId)) {
          latestSourceTransitionByEmpId.set(sourceEmpId, row);
        }
      });
      const latestTargetTransitionByEmpId = new Map<number, EmployeeTransitionRow>();
      (targetTransitions as Record<string, unknown>[]).forEach((row) => {
        const targetEmpId = Number(row.target_emp_id);
        if (Number.isFinite(targetEmpId) && targetEmpId > 0 && !latestTargetTransitionByEmpId.has(targetEmpId)) {
          latestTargetTransitionByEmpId.set(targetEmpId, row);
        }
      });

      const currentByEmpId = new Map<number, Record<string, unknown>>(
        currentRows.map((row: Record<string, unknown>) => [Number(row.emp_id), row])
      );
      const subscriptionsByEmpId = new Map<number, Record<string, unknown>[]>();
      (subscriptionRows as Record<string, unknown>[]).forEach((row) => {
        const empId = Number(row.employee_id);
        if (!Number.isFinite(empId) || empId <= 0) return;
        const currentRowsForEmp = subscriptionsByEmpId.get(empId) || [];
        currentRowsForEmp.push(row);
        subscriptionsByEmpId.set(empId, currentRowsForEmp);
      });
      const todayIso = toIsoDate(new Date()) || '';

      const employees = currentRows.map((row: Record<string, unknown>) => {
        const profile = profileByEmpId.get(Number(row.emp_id)) || {};
        const hrRow = hrByEmpId.get(Number(row.emp_id)) || {};
        const sourceTransition = latestSourceTransitionByEmpId.get(Number(row.emp_id)) || null;
        const targetTransition = latestTargetTransitionByEmpId.get(Number(row.emp_id)) || null;
        const employmentStatus = normalizeEmploymentStatus(
          hrRow?.employment_status,
          row.terminated_on,
          sourceTransition,
          targetTransition
        );
        const transitionMeta = buildTransitionMeta(
          Number(row.emp_id),
          employmentStatus,
          sourceTransition,
          targetTransition
        );
        const payrollFlags = buildPayrollSelectionFlags(
          subscriptionsByEmpId.get(Number(row.emp_id)) || [],
          todayIso
        );
        const nationality = resolveNationalityParts(
          row.nationality,
          row.nationality_country,
          row.nationality_region
        );
        return {
          emp_id: row.emp_id,
          first_name: row.first_name || '',
          surname: row.surname || '',
          id_card: row.national_id || row.eu_residency_no || '',
          designation: cleanDesignationText(profile?.designation || ''),
          department: profile.department || row.department_code || '',
          tax_update: profile.tax_employment_type || row.employment_type || '',
          marital_update: profile.marital_status || 'Single',
          nationality: nationality.legacy,
          nationality_country: nationality.country,
          nationality_region: nationality.region,
          payroll_main_tax: payrollFlags.payroll_main_tax,
          payroll_provider_tax: payrollFlags.payroll_provider_tax,
          payroll_three_tax: payrollFlags.payroll_three_tax,
          timesheet_mode: normalizeTimesheetMode(profile.timesheet_mode, profile.timesheet_required) || '',
          timesheet_mode_pending: !normalizeTimesheetMode(profile.timesheet_mode, profile.timesheet_required),
          terminated_on: toIsoDate(row.terminated_on),
          employment_status: employmentStatus,
          pending_clone_new_emp_id: transitionMeta.pending_clone_new_emp_id,
          pending_clone_effective_on: transitionMeta.pending_clone_effective_on,
          source_file_emp_id: transitionMeta.source_file_emp_id,
          prospective_until_effective_on: transitionMeta.prospective_until_effective_on,
          archived_source_emp_id: transitionMeta.archived_source_emp_id,
          record_created: toIsoDate(targetTransition?.effective_on) || toIsoDate(row.file_created_at) || '',
          original_start_date: (() => {
            const rootSourceEmpId = findRootSourceEmpId(Number(row.emp_id), latestTargetTransitionByEmpId);
            const rootRow = currentByEmpId.get(rootSourceEmpId);
            return toIsoDate(rootRow?.active_from) || toIsoDate(row.active_from) || '';
          })(),
        };
      });

      return res.json({ employees });
    } catch (error: any) {
      logger.error('Employee form index failed', error);
      return res.status(500).json({
        error: 'Failed to load employee index',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/employee-form/:emp_id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const empId = Number(req.params.emp_id);
      if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const [current, employeeCore, profile, hrRow, sourceTransition, targetTransition, allTargetTransitions, allCurrentRows, subscriptions] = await Promise.all([
        database('vw_employee_current')
          .where('emp_id', empId)
          .first(),
        database('employees')
          .where('emp_id', empId)
          .first(),
        database('employee_form_profile')
          .where('emp_id', empId)
          .first(),
        database('vw_hr_employee_dashboard_sorted')
          .where('emp_id', empId)
          .first(),
        database('employee_file_transitions')
          .where('source_emp_id', empId)
          .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }])
          .first(),
        database('employee_file_transitions')
          .where('target_emp_id', empId)
          .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }])
          .first(),
        database('employee_file_transitions')
          .select('source_emp_id', 'target_emp_id', 'effective_on', 'status', 'updated_at', 'created_at')
          .whereNotNull('target_emp_id')
          .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'created_at', order: 'desc' }]),
        database('vw_employee_current')
          .select('emp_id', 'active_from'),
        database('payroll_subscriptions')
          .where('employee_id', empId)
          .orderBy([{ column: 'active_from', order: 'desc' }, { column: 'id', order: 'desc' }]),
      ]);

      if (!current) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const employmentStatus = normalizeEmploymentStatus(
        hrRow?.employment_status,
        current.terminated_on,
        sourceTransition || null,
        targetTransition || null
      );
      const transitionMeta = buildTransitionMeta(
        empId,
        employmentStatus,
        sourceTransition || null,
        targetTransition || null
      );
      const latestTargetTransitionByEmpId = new Map<number, EmployeeTransitionRow>();
      (allTargetTransitions as Record<string, unknown>[]).forEach((row) => {
        const targetEmpId = Number(row.target_emp_id);
        if (Number.isFinite(targetEmpId) && targetEmpId > 0 && !latestTargetTransitionByEmpId.has(targetEmpId)) {
          latestTargetTransitionByEmpId.set(targetEmpId, row);
        }
      });
      const currentByEmpId = new Map<number, Record<string, unknown>>(
        (allCurrentRows as Record<string, unknown>[]).map((row) => [Number(row.emp_id), row])
      );
      const rootSourceEmpId = findRootSourceEmpId(empId, latestTargetTransitionByEmpId);
      const rootRow = currentByEmpId.get(rootSourceEmpId);
      const recordCreated = toIsoDate(targetTransition?.effective_on) || toIsoDate(current.file_created_at) || '';
      const originalStartDate = toIsoDate(rootRow?.active_from) || toIsoDate(current.active_from) || '';
      const payrollFlags = buildPayrollSelectionFlags(subscriptions as Record<string, unknown>[], toIsoDate(new Date()) || '');

      return res.json({
        employee: {
          ...mapEmployeeFormRow(current, employeeCore || null, profile || null, transitionMeta),
          record_created: recordCreated,
          start_date: originalStartDate,
          mediatrix_start_date: originalStartDate,
          ...payrollFlags,
        },
        payroll_detail: { bonuses: [] },
        documents: [],
      });
    } catch (error: any) {
      logger.error('Employee form load failed', error);
      return res.status(500).json({
        error: 'Failed to load employee form',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.post('/payroll/employee-form/:emp_id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const targetEmpId = Number(req.params.emp_id);
      if (!Number.isFinite(targetEmpId) || targetEmpId <= 0) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const canReadOtherProfiles = Number(actor.role_rank) >= ROLE_RANK.hr;
      const isSelf = Number(actor.employee_id) === targetEmpId;
      if (!isSelf && !canReadOtherProfiles) {
        return res.status(403).json({ error: 'Access denied: can only update own profile' });
      }

      const incomingEmployee = req.body?.employee || {};
      const existingProfile = await database('employee_form_profile').where('emp_id', targetEmpId).first();
      const asText = (value: unknown) => String(value ?? '').trim();
      const asNullableText = (value: unknown) => {
        const text = asText(value);
        return text || null;
      };
      const asIsoDate = (value: unknown) => toIsoDate(value);
      const asNullableNumber = (value: unknown) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };

      const terminationDate = asIsoDate(incomingEmployee.termination_date);
      const startDate = asIsoDate(incomingEmployee.start_date);
      const dob = asIsoDate(incomingEmployee.dob);
      const papersSent = asIsoDate(incomingEmployee.papers_sent);
      const approvalDate = asIsoDate(incomingEmployee.approval_date);
      const fixedHoursWeek = asNullableNumber(incomingEmployee.fixed_hours_week);
      const canEditTimesheetMode = Number(actor.role_rank) >= ROLE_RANK.full;
      const existingTimesheetMode = normalizeTimesheetMode(existingProfile?.timesheet_mode, existingProfile?.timesheet_required);
      const requestedTimesheetMode = normalizeTimesheetMode(incomingEmployee.timesheet_mode, incomingEmployee.timesheet_required);
      const effectiveTimesheetMode = canEditTimesheetMode ? requestedTimesheetMode : existingTimesheetMode;
      const timesheetRequired = canEditTimesheetMode
        ? timesheetModeRequiresTimesheet(effectiveTimesheetMode)
        : timesheetModeRequiresTimesheet(existingTimesheetMode, existingProfile?.timesheet_required);
      const payrollEffectiveDate = asIsoDate(incomingEmployee.payroll_effective_date) || startDate || (toIsoDate(new Date()) as string);
      const nationality = resolveNationalityParts(
        incomingEmployee.nationality,
        incomingEmployee.nationality_country,
        incomingEmployee.nationality_region
      );
      const selectedPayrollTypes = Array.from(new Set([
        incomingEmployee.payroll_main_tax ? 'MAIN' : '',
        incomingEmployee.payroll_provider_tax ? 'PROVIDER' : '',
        incomingEmployee.payroll_three_tax ? 'O3P' : '',
      ].filter(Boolean)));

      await database.transaction(async (trx) => {
        await trx('employees')
          .where('emp_id', targetEmpId)
          .update({
            national_id: asNullableText(incomingEmployee.id_card),
            passport_no: asNullableText(incomingEmployee.passport),
            social_security_no: asNullableText(incomingEmployee.ssn),
            spouse_national_id: asNullableText(incomingEmployee.spouse_id_tax),
            nationality: asNullableText(nationality.legacy),
            nationality_country: asNullableText(nationality.country),
            nationality_region: asNullableText(nationality.region),
            dob: dob,
            email: asNullableText(incomingEmployee.email),
            phone_primary: asNullableText(incomingEmployee.phone_1),
            phone_secondary: asNullableText(incomingEmployee.phone_2),
            iban: asNullableText(incomingEmployee.iban),
            address1: asNullableText(incomingEmployee.address_house),
            address2: asNullableText(incomingEmployee.address_street),
            city: asNullableText(incomingEmployee.address_city),
            postcode: asNullableText(incomingEmployee.address_postcode),
            active_from: startDate || undefined,
            terminated_on: terminationDate,
            is_active: !terminationDate,
            department_code: asText(incomingEmployee.department) || 'MDC',
            updated_at: new Date(),
          });

        await trx('employee_form_profile')
          .insert({
            emp_id: targetEmpId,
            title_prefix: asNullableText(incomingEmployee.title_prefix),
            middle_name: asNullableText(incomingEmployee.middle_name),
            gender: asNullableText(incomingEmployee.gender),
            passport_no: asNullableText(incomingEmployee.passport),
            department: asNullableText(incomingEmployee.department),
            designation: asNullableText(incomingEmployee.designation),
            address_house: asNullableText(incomingEmployee.address_house),
            address_street: asNullableText(incomingEmployee.address_street),
            papers_sent: papersSent,
            approval_date: approvalDate,
            start_date: startDate,
            mediatrix_start_date: startDate,
            tax_employment_type: asNullableText(incomingEmployee.tax_update),
            fs4_status: asNullableText(incomingEmployee.fs4_status_update),
            marital_status: asNullableText(incomingEmployee.marital_update),
            spouse_id_tax: asNullableText(incomingEmployee.spouse_id_tax),
            fixed_hours_week: fixedHoursWeek,
            timesheet_mode: effectiveTimesheetMode,
            timesheet_required: timesheetRequired,
            termination_date: terminationDate,
            termination_reason: asNullableText(incomingEmployee.termination_reason),
            termination_notes: asNullableText(incomingEmployee.termination_notes),
            od_username_override: asNullableText(incomingEmployee.od_username_override),
            od_security_level: asNullableText(incomingEmployee.od_security_level),
            od_force_password_change: incomingEmployee.od_force_password_change === false ? false : true,
            app_permission_level: Number(actor.role_rank) >= ROLE_RANK.hr
              ? asNullableText(incomingEmployee.permission_level)
              : undefined,
            whatsapp_phone: asNullableText(incomingEmployee.phone_whatsapp),
            updated_by: String(actor.user_id || ''),
            updated_at: new Date(),
          })
          .onConflict('emp_id')
          .merge({
            title_prefix: asNullableText(incomingEmployee.title_prefix),
            middle_name: asNullableText(incomingEmployee.middle_name),
            gender: asNullableText(incomingEmployee.gender),
            passport_no: asNullableText(incomingEmployee.passport),
            department: asNullableText(incomingEmployee.department),
            designation: asNullableText(incomingEmployee.designation),
            address_house: asNullableText(incomingEmployee.address_house),
            address_street: asNullableText(incomingEmployee.address_street),
            papers_sent: papersSent,
            approval_date: approvalDate,
            start_date: startDate,
            mediatrix_start_date: startDate,
            tax_employment_type: asNullableText(incomingEmployee.tax_update),
            fs4_status: asNullableText(incomingEmployee.fs4_status_update),
            marital_status: asNullableText(incomingEmployee.marital_update),
            spouse_id_tax: asNullableText(incomingEmployee.spouse_id_tax),
            fixed_hours_week: fixedHoursWeek,
            timesheet_mode: effectiveTimesheetMode,
            timesheet_required: timesheetRequired,
            termination_date: terminationDate,
            termination_reason: asNullableText(incomingEmployee.termination_reason),
            termination_notes: asNullableText(incomingEmployee.termination_notes),
            od_username_override: asNullableText(incomingEmployee.od_username_override),
            od_security_level: asNullableText(incomingEmployee.od_security_level),
            od_force_password_change: incomingEmployee.od_force_password_change === false ? false : true,
            ...(Number(actor.role_rank) >= ROLE_RANK.hr
              ? { app_permission_level: asNullableText(incomingEmployee.permission_level) }
              : {}),
            whatsapp_phone: asNullableText(incomingEmployee.phone_whatsapp),
            updated_by: String(actor.user_id || ''),
            updated_at: new Date(),
          });

        await trx('employee_name_history')
          .where('emp_id', targetEmpId)
          .whereNull('effective_to')
          .update({
            first_name: asNullableText(incomingEmployee.first_name),
            surname: asNullableText(incomingEmployee.surname),
            short_name: asNullableText(incomingEmployee.new_surname) || asNullableText(incomingEmployee.first_name),
          });

        await trx('employee_employment_terms')
          .where('emp_id', targetEmpId)
          .whereNull('effective_to')
          .update({
            position_held: asNullableText(incomingEmployee.designation),
            weekly_hours: fixedHoursWeek,
            employment_type: asNullableText(incomingEmployee.tax_update),
            date_first_employed: startDate,
          });

        await trx('employee_current')
          .where('emp_id', targetEmpId)
          .update({
            surname: asNullableText(incomingEmployee.surname),
            first_name: asNullableText(incomingEmployee.first_name),
            national_id: asNullableText(incomingEmployee.id_card),
            passport_no: asNullableText(incomingEmployee.passport),
            social_security_no: asNullableText(incomingEmployee.ssn),
            nationality: asNullableText(nationality.legacy),
            nationality_country: asNullableText(nationality.country),
            nationality_region: asNullableText(nationality.region),
            email: asNullableText(incomingEmployee.email),
            phone_primary: asNullableText(incomingEmployee.phone_1),
            phone_secondary: asNullableText(incomingEmployee.phone_2),
            iban: asNullableText(incomingEmployee.iban),
            address1: asNullableText(incomingEmployee.address_house),
            address2: asNullableText(incomingEmployee.address_street),
            city: asNullableText(incomingEmployee.address_city),
            postcode: asNullableText(incomingEmployee.address_postcode),
            department_code: asText(incomingEmployee.department) || 'MDC',
            position_held: asNullableText(incomingEmployee.designation),
            weekly_hours: fixedHoursWeek,
            employment_type: asNullableText(incomingEmployee.tax_update),
            active_from: startDate,
            terminated_on: terminationDate,
            fs_status: asNullableText(incomingEmployee.fs4_status_update),
          });

        const existingSubscriptions = await trx('payroll_subscriptions')
          .where('employee_id', targetEmpId)
          .orderBy([{ column: 'active_from', order: 'desc' }, { column: 'id', order: 'desc' }]);

        for (const payrollType of ['MAIN', 'PROVIDER', 'O3P']) {
          const rowsForType = (existingSubscriptions as Record<string, unknown>[])
            .filter((row) => normalizePayrollSubscriptionType(row.payroll_type) === payrollType);
          const selected = selectedPayrollTypes.includes(payrollType);
          const activeRows = rowsForType.filter((row) => {
            const activeFrom = toIsoDate(row.active_from);
            const activeTo = toIsoDate(row.active_to);
            return (!activeFrom || activeFrom <= payrollEffectiveDate) && (!activeTo || activeTo >= payrollEffectiveDate);
          });

          if (selected) {
            if (!activeRows.length) {
              await trx('payroll_subscriptions').insert({
                employee_id: targetEmpId,
                payroll_type: payrollType,
                active_from: payrollEffectiveDate,
                active_to: null,
                is_sync_to_opendental: false,
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
            continue;
          }

          const closeDateBase = shiftIsoDate(payrollEffectiveDate, -1);
          for (const row of activeRows) {
            const rowId = Number(row.id);
            if (!Number.isFinite(rowId) || rowId <= 0) continue;
            const activeFrom = toIsoDate(row.active_from) || payrollEffectiveDate;
            const closeDate = closeDateBase < activeFrom ? activeFrom : closeDateBase;
            await trx('payroll_subscriptions')
              .where('id', rowId)
              .update({
                active_to: closeDate,
                updated_at: new Date(),
              });
          }
        }
      });

      return res.json({ ok: true, emp_id: targetEmpId });
    } catch (error: any) {
      logger.error('Employee form save failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to save employee form',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/geo/localities', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const query = String(req.query.q || '').trim().toLowerCase();
      const rows = await database('vw_employee_current')
        .distinct('city')
        .whereNotNull('city');

      const localities = sortUniqueText([
        ...rows.map((row: Record<string, unknown>) => row.city),
        ...GEO_LOCALITY_FALLBACK,
      ]).filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 30);

      return res.json({ localities });
    } catch (error: any) {
      logger.error('Geo locality lookup failed', error);
      return res.status(500).json({
        error: 'Failed to load localities',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/geo/streets', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const locality = String(req.query.locality || '').trim();
      const query = String(req.query.q || '').trim().toLowerCase();
      if (!locality) {
        return res.json({ streets: [] });
      }

      const rows = await database('vw_employee_current')
        .distinct('address2')
        .whereRaw('lower(coalesce(city, \'\')) = lower(?)', [locality])
        .whereNotNull('address2');

      const streets = sortUniqueText(rows.map((row: Record<string, unknown>) => row.address2))
        .filter((name) => !query || name.toLowerCase().includes(query))
        .slice(0, 30);

      return res.json({ streets });
    } catch (error: any) {
      logger.error('Geo street lookup failed', error);
      return res.status(500).json({
        error: 'Failed to load streets',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/employee-profile/settings/leave-types', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      return res.json({
        leave_types: [
          { code: 'VACATION_LEAVE', display_name: 'Vacation Leave' },
          { code: 'SICK_LEAVE', display_name: 'Sick Leave' },
          { code: 'UNPAID_LEAVE', display_name: 'Unpaid Leave' },
          { code: 'MATERNITY', display_name: 'Maternity Leave' },
        ],
      });
    } catch (error: any) {
      logger.error('Leave types lookup failed', error);
      return res.status(500).json({
        error: 'Failed to load leave types',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/employee-profile/:emp_id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const empId = Number(req.params.emp_id);
      if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const year = normalizeYear(req.query.year);
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const paydayMeta = buildPaydayMeta();

      const employee = await database('vw_employee_current')
        .where('emp_id', empId)
        .first();
      const employeeCore = await database('employees')
        .where('emp_id', empId)
        .first();

      if (!employee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const [subscriptions, timesheets, payrollLines] = await Promise.all([
        database('payroll_subscriptions')
          .where('employee_id', empId)
          .orderBy([{ column: 'active_from', order: 'desc' }, { column: 'payroll_type', order: 'asc' }]),
        database('timesheets')
          .where('emp_id', empId)
          .whereBetween('work_date', [yearStart, yearEnd])
          .orderBy([{ column: 'work_date', order: 'desc' }, { column: 'id', order: 'desc' }]),
        database('payroll_lines as pl')
          .join('payroll_entries as pe', 'pl.payroll_entry_id', 'pe.id')
          .where('pl.emp_id', empId)
          .where('pe.payroll_year', year)
          .select(
            'pl.payroll_entry_id',
            'pl.banked_hours_balance',
            'pl.created_at as line_created_at',
            'pl.updated_at as line_updated_at',
            'pe.period_from',
            'pe.period_to',
            'pe.payment_date',
            'pe.status',
            'pe.payroll_number',
            'pe.updated_at as entry_updated_at'
          )
          .orderBy('pe.period_from', 'desc'),
      ]);

      let leaveBalance: Record<string, unknown> | null = null;
      try {
        leaveBalance = await database('leave_balance')
          .where('emp_id', empId)
          .where('payroll_year', year)
          .first();
      } catch {
        leaveBalance = null;
      }

      const subscriptionLabels = Array.from(new Set((subscriptions as Record<string, unknown>[])
        .map((row) => String(row.payroll_type || '').trim())
        .filter(Boolean)));

      const typedTimesheets = timesheets as Record<string, unknown>[];
      const vacationRows = typedTimesheets.filter((row) => String(row.hour_type || '').toUpperCase() === 'VACATION_LEAVE');
      const sickRows = typedTimesheets.filter((row) => String(row.hour_type || '').toUpperCase() === 'SICK_LEAVE');
      const vacationRequested = vacationRows.filter((row) => !String(row.leave_status || '').trim());
      const vacationTaken = vacationRows.filter((row) => String(row.leave_status || '').trim());
      const sickTaken = sickRows;
      const latestPayrollLine = (payrollLines as Record<string, unknown>[])[0];
      const usedVacationHours = vacationRows.reduce((sum, row) => sum + toNumber(row.hours), 0);
      const usedSickHours = sickRows.reduce((sum, row) => sum + toNumber(row.hours), 0);

      const profileNationality = resolveNationalityParts(
        employeeCore?.nationality || employee?.nationality,
        employeeCore?.nationality_country || employee?.nationality_country,
        employeeCore?.nationality_region || employee?.nationality_region
      );

      return res.json({
        employee: {
          emp_id: empId,
          full_name: [String(employee.first_name || '').trim(), String(employee.surname || '').trim()].filter(Boolean).join(' '),
          designation: cleanDesignationText(String(employee.position_held || '')),
          department: String(employee.department_code || ''),
          begin_employment: toIsoDate(employee.active_from),
          dob: toIsoDate(employeeCore?.dob),
          national_id: String(employee.national_id || employeeCore?.national_id || '').trim(),
          eu_residency_no: String(employee.eu_residency_no || employeeCore?.eu_residency_no || '').trim(),
          passport_no: String(employee.passport_no || employeeCore?.passport_no || '').trim(),
          social_security_no: String(employeeCore?.social_security_no || '').trim(),
          tax_number: String(employeeCore?.tax_number || '').trim(),
          nationality: profileNationality.legacy,
          nationality_country: profileNationality.country,
          nationality_region: profileNationality.region,
          spouse_national_id: String(employeeCore?.spouse_national_id || '').trim(),
          email: String(employee.email || employeeCore?.email || '').trim(),
          phone_primary: String(employeeCore?.phone_primary || '').trim(),
          phone_secondary: String(employeeCore?.phone_secondary || '').trim(),
          iban: String(employee.iban || employeeCore?.iban || '').trim(),
          address1: String(employeeCore?.address1 || '').trim(),
          address2: String(employee.address2 || employeeCore?.address2 || '').trim(),
          city: String(employee.city || employeeCore?.city || '').trim(),
          postcode: String(employee.postcode || employeeCore?.postcode || '').trim(),
          pe_number: String(employee.pe_number || employeeCore?.pe_number || '').trim(),
          subscriptions: subscriptionLabels,
          warnings: buildWarningObjects(employee as Record<string, unknown>, subscriptions as Record<string, unknown>[], typedTimesheets, year),
        },
        payday: {
          days_to_payday: paydayMeta.daysToPayday,
          last_payday: paydayMeta.lastPayday,
        },
        timesheet_periods: buildProfilePeriods(year, typedTimesheets, payrollLines as Record<string, unknown>[]),
        leave: {
          vl_requested: vacationRequested.map(mapLeaveRow),
          vl_taken: vacationTaken.map(mapLeaveRow),
          sl_taken: sickTaken.map(mapLeaveRow),
          other_by_type: groupOtherLeaveTypes(typedTimesheets),
        },
        leave_balances: {
          vl_total: toNumber(leaveBalance?.vl_total_hours ?? leaveBalance?.vl_entitlement_hours ?? usedVacationHours),
          vl_used: toNumber(leaveBalance?.vl_used_hours ?? usedVacationHours),
          sl_total: toNumber(leaveBalance?.sl_total_hours ?? leaveBalance?.sl_entitlement_hours ?? usedSickHours),
          sl_used: toNumber(leaveBalance?.sl_used_hours ?? usedSickHours),
          banked_hours: toNumber(leaveBalance?.banked_hours ?? latestPayrollLine?.banked_hours_balance),
        },
      });
    } catch (error: any) {
      logger.error('Employee payroll profile failed', error);
      return res.status(500).json({
        error: 'Failed to load employee profile',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/your-info', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await assertYourInfoTables(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const requestedEmpId = Number(req.query.emp_id);
      const targetEmpId = Number.isFinite(requestedEmpId) && requestedEmpId > 0
        ? requestedEmpId
        : Number(actor.employee_id);

      if (!Number.isFinite(targetEmpId) || targetEmpId <= 0) {
        return res.status(400).json({ error: 'No employee mapping found for this user' });
      }

      const canReadOtherProfiles = Number(actor.role_rank) >= ROLE_RANK.hr;
      const isSelf = Number(actor.employee_id) === targetEmpId;
      if (!isSelf && !canReadOtherProfiles) {
        return res.status(403).json({ error: 'Access denied: can only view own profile' });
      }

      const [current, profile, overlay, leaveBalance, openComms, vlPendingRows, slPendingRows] = await Promise.all([
        database('vw_employee_current').where('emp_id', targetEmpId).first(),
        database('employee_form_profile').where('emp_id', targetEmpId).first(),
        getOrCreateOverlay(database, targetEmpId),
        database('leave_balance').where('emp_id', targetEmpId).orderBy('payroll_year', 'desc').first().catch(() => null),
        database('handover_items as hi')
          .leftJoin('handover_item_events as ev', function () {
            this.on('ev.item_id', '=', 'hi.id').andOn('ev.event_type', '=', database.raw('?', ['created']));
          })
          .select('hi.id', 'hi.title', 'hi.details', 'hi.due_at', 'hi.created_at', 'hi.source', 'ev.payload')
          .where('hi.status', 'open')
          .andWhere(function () {
            this.whereRaw('lower(coalesce(hi.target_user_email, \'\')) = lower(?)', [normalizeEmail(actor.email)]);
            if (Number(actor.role_rank) >= ROLE_RANK.hr) {
              this.orWhere('hi.target_group', 'hr_admin');
            }
          })
          .orderBy('hi.created_at', 'desc')
          .limit(50),
        database('timesheets')
          .select('work_date', 'hours', 'leave_status', 'notes')
          .where('emp_id', targetEmpId)
          .where('hour_type', 'VACATION_LEAVE')
          .where(function () {
            this.whereNull('leave_status').orWhereRaw("trim(coalesce(leave_status, '')) = ''");
          })
          .orderBy('work_date', 'desc'),
        database('timesheets')
          .select('work_date', 'hours', 'leave_status', 'notes')
          .where('emp_id', targetEmpId)
          .where('hour_type', 'SICK_LEAVE')
          .where(function () {
            this.whereNull('leave_status').orWhereRaw("trim(coalesce(leave_status, '')) = ''");
          })
          .orderBy('work_date', 'desc'),
      ]);

      if (!current) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const canEditRole = Number(actor.role_rank) >= ROLE_RANK.hr;
      const history = canEditRole
        ? await database('employee_self_service_audit_log')
            .where('emp_id', targetEmpId)
            .orderBy('created_at', 'desc')
            .limit(200)
        : [];

      const details = {
        emp_id: targetEmpId,
        full_name: [String(current.name || '').trim(), String(current.surname || '').trim()].filter(Boolean).join(' ').trim(),
        first_name: String(current.name || ''),
        surname: String(current.surname || ''),
        role: String(profile?.app_permission_level || normalizePermissionLevel(actor.role_name)),
        designation: cleanDesignationText(String(profile?.designation || current.position_held || '')),
        department: String(profile?.department || ''),
        contact: {
          email: String(overlay?.email || current.email || ''),
          phone_1: String(overlay?.phone_1 || current.phone_primary || ''),
          phone_2: String(overlay?.phone_2 || current.phone_secondary || ''),
          phone_whatsapp: String(overlay?.phone_whatsapp || profile?.whatsapp_phone || ''),
          iban: String(overlay?.iban || current.iban || ''),
        },
        address: {
          address_house: String(overlay?.address_house || profile?.address_house || current.address1 || ''),
          address_street: String(overlay?.address_street || profile?.address_street || current.address2 || ''),
          address_city: String(overlay?.address_city || current.city || ''),
          address_postcode: String(overlay?.address_postcode || current.postcode || ''),
        },
        status: {
          marital_update: String(profile?.marital_status || 'Single'),
          tax_update: String(profile?.tax_employment_type || current.employment_type || ''),
        },
      };

      return res.json({
        actor: {
          user_id: actor.user_id,
          email: actor.email,
          role_name: actor.role_name,
          role_rank: actor.role_rank,
          employee_id: actor.employee_id,
        },
        permissions: {
          can_edit_role: canEditRole,
          can_view_history: canEditRole,
          can_edit_profile: isSelf || canEditRole,
          requires_hr_for_marital_tax: true,
        },
        details,
        leave: {
          vl_pending: (vlPendingRows as Record<string, unknown>[]).map(mapLeaveRow),
          sl_pending: (slPendingRows as Record<string, unknown>[]).map(mapLeaveRow),
          balances: {
            vl_total: toNumber(leaveBalance?.vl_total_hours ?? leaveBalance?.vl_entitlement_hours),
            vl_used: toNumber(leaveBalance?.vl_used_hours),
            sl_total: toNumber(leaveBalance?.sl_total_hours ?? leaveBalance?.sl_entitlement_hours),
            sl_used: toNumber(leaveBalance?.sl_used_hours),
            banked_hours: toNumber(leaveBalance?.banked_hours),
          },
        },
        communication_pending: openComms,
        history,
      });
    } catch (error: any) {
      logger.error('YOUR INFO load failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to load YOUR INFO',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.patch('/payroll/your-info/:emp_id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await assertYourInfoTables(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const targetEmpId = Number(req.params.emp_id);
      if (!Number.isFinite(targetEmpId) || targetEmpId <= 0) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const canReadOtherProfiles = Number(actor.role_rank) >= ROLE_RANK.hr;
      const isSelf = Number(actor.employee_id) === targetEmpId;
      if (!isSelf && !canReadOtherProfiles) {
        return res.status(403).json({ error: 'Access denied: can only update own profile' });
      }

      const [overlay, profile] = await Promise.all([
        getOrCreateOverlay(database, targetEmpId),
        database('employee_form_profile').where('emp_id', targetEmpId).first(),
      ]);

      const editableOverlayFields = [
        'address_house',
        'address_street',
        'address_city',
        'address_postcode',
        'phone_1',
        'phone_2',
        'phone_whatsapp',
        'email',
        'iban',
      ];

      const incoming = req.body || {};
      const overlayUpdates: Record<string, unknown> = {};
      const auditRows: Array<Record<string, unknown>> = [];

      editableOverlayFields.forEach((field) => {
        if (!(field in incoming)) return;
        const before = String(overlay?.[field] || '').trim();
        const after = String(incoming[field] || '').trim();
        if (before === after) return;
        overlayUpdates[field] = after;
        auditRows.push({
          emp_id: targetEmpId,
          field_name: field,
          old_value: safeJson(before),
          new_value: safeJson(after),
          change_channel: 'your_info',
          change_reason: isSelf ? 'self_edit' : 'hr_edit',
          changed_by_user_id: String(actor.user_id || ''),
          changed_by_email: normalizeEmail(actor.email),
          changed_by_role: String(actor.role_name || ''),
          requires_hr_intervention: false,
        });
      });

      if ('role' in incoming) {
        if (Number(actor.role_rank) < ROLE_RANK.hr) {
          return res.status(403).json({ error: 'Role can only be edited by HR and above' });
        }
        const beforeRole = String(profile?.app_permission_level || '').trim();
        const afterRole = String(incoming.role || '').trim();
        if (afterRole && beforeRole !== afterRole) {
          await database('employee_form_profile')
            .insert({ emp_id: targetEmpId, app_permission_level: afterRole })
            .onConflict('emp_id')
            .merge({ app_permission_level: afterRole });
          auditRows.push({
            emp_id: targetEmpId,
            field_name: 'role',
            old_value: safeJson(beforeRole),
            new_value: safeJson(afterRole),
            change_channel: 'your_info',
            change_reason: 'hr_role_update',
            changed_by_user_id: String(actor.user_id || ''),
            changed_by_email: normalizeEmail(actor.email),
            changed_by_role: String(actor.role_name || ''),
            requires_hr_intervention: false,
          });
        }
      }

      const requestOnlyFields = [
        { key: 'marital_update', type: 'marital_status' },
        { key: 'tax_update', type: 'tax_status' },
      ];
      const submittedRequests: Array<Record<string, unknown>> = [];

      for (const field of requestOnlyFields) {
        if (!(field.key in incoming)) continue;
        const requestedValue = String(incoming[field.key] || '').trim();
        if (!requestedValue) continue;
        if (Number(actor.role_rank) >= ROLE_RANK.hr) {
          const profilePatch = field.key === 'marital_update'
            ? { marital_status: requestedValue }
            : { tax_employment_type: requestedValue };
          await database('employee_form_profile')
            .insert({ emp_id: targetEmpId, ...profilePatch })
            .onConflict('emp_id')
            .merge(profilePatch);
          auditRows.push({
            emp_id: targetEmpId,
            field_name: field.key,
            old_value: safeJson(field.key === 'marital_update' ? profile?.marital_status : profile?.tax_employment_type),
            new_value: safeJson(requestedValue),
            change_channel: 'your_info',
            change_reason: 'hr_status_update',
            changed_by_user_id: String(actor.user_id || ''),
            changed_by_email: normalizeEmail(actor.email),
            changed_by_role: String(actor.role_name || ''),
            requires_hr_intervention: false,
          });
        } else {
          const insertedRequest = await database('employee_self_service_change_requests')
            .insert({
              emp_id: targetEmpId,
              request_type: field.type,
              requested_value: safeJson({ value: requestedValue }),
              requested_by_user_id: String(actor.user_id || ''),
              requested_by_email: normalizeEmail(actor.email),
              status: 'pending',
            })
            .returning('*');
          submittedRequests.push(insertedRequest?.[0] || insertedRequest);
          auditRows.push({
            emp_id: targetEmpId,
            field_name: field.key,
            old_value: safeJson(field.key === 'marital_update' ? profile?.marital_status : profile?.tax_employment_type),
            new_value: safeJson(requestedValue),
            change_channel: 'your_info',
            change_reason: 'request_hr_intervention',
            changed_by_user_id: String(actor.user_id || ''),
            changed_by_email: normalizeEmail(actor.email),
            changed_by_role: String(actor.role_name || ''),
            requires_hr_intervention: true,
          });
        }
      }

      if (Object.keys(overlayUpdates).length > 0) {
        overlayUpdates.updated_at = new Date();
        overlayUpdates.updated_by_user_id = String(actor.user_id || '');
        overlayUpdates.updated_by_email = normalizeEmail(actor.email);
        await database('employee_self_service_profile')
          .where('emp_id', targetEmpId)
          .update(overlayUpdates);
      }

      if (auditRows.length > 0) {
        await database('employee_self_service_audit_log').insert(auditRows);
        const changeSummary = auditRows
          .map((row) => String(row.field_name || '').trim())
          .filter(Boolean)
          .join(', ');
        await queueHrHandover(
          database,
          actor,
          targetEmpId,
          `YOUR INFO updated for employee ${targetEmpId}. Changed fields: ${changeSummary}`
        );
      }

      return res.json({
        ok: true,
        updated_fields: Object.keys(overlayUpdates).filter((field) => !['updated_at', 'updated_by_user_id', 'updated_by_email'].includes(field)),
        submitted_requests: submittedRequests,
      });
    } catch (error: any) {
      logger.error('YOUR INFO update failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to update YOUR INFO',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/your-info/:emp_id/audit', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      await assertYourInfoTables(database);
      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor || Number(actor.role_rank) < ROLE_RANK.hr) {
        return res.status(403).json({ error: 'Only HR and above can view change history' });
      }
      const empId = Number(req.params.emp_id);
      if (!Number.isFinite(empId) || empId <= 0) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const [audits, requests] = await Promise.all([
        database('employee_self_service_audit_log')
          .where('emp_id', empId)
          .orderBy('created_at', 'desc')
          .limit(500),
        database('employee_self_service_change_requests')
          .where('emp_id', empId)
          .orderBy('created_at', 'desc')
          .limit(500),
      ]);

      return res.json({ audits, change_requests: requests });
    } catch (error: any) {
      logger.error('YOUR INFO audit lookup failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to load YOUR INFO audit history',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/payroll/your-info/bank-change/pending', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await assertYourInfoTables(database);

      const period = parseYearMonth(req.query.period);
      if (!period) {
        return res.status(400).json({ error: 'period must be YYYY-MM' });
      }
      const payrollKind = parsePayrollScope(req.query.payroll);
      const employeeIds = parseEmpIdList(req.query.employee_ids);
      if (!employeeIds.length) {
        return res.json({ count: 0, pending: [] });
      }

      const auditRows = await database('employee_self_service_audit_log as a')
        .leftJoin('employee_bank_change_confirmation as c', function () {
          this.on('c.audit_log_id', '=', 'a.id')
            .andOn('c.payroll_period', '=', database.raw('?', [period]))
            .andOn('c.payroll_kind', '=', database.raw('?', [payrollKind]));
        })
        .leftJoin('vw_employee_current as e', 'e.emp_id', 'a.emp_id')
        .select(
          'a.id',
          'a.emp_id',
          'a.old_value',
          'a.new_value',
          'a.created_at',
          'e.name',
          'e.surname',
          database.raw('MAX(c.id) as confirmation_id')
        )
        .where('a.field_name', 'iban')
        .whereIn('a.emp_id', employeeIds)
        .groupBy('a.id', 'a.emp_id', 'a.old_value', 'a.new_value', 'a.created_at', 'e.name', 'e.surname')
        .orderBy('a.created_at', 'desc');

      const pending = (auditRows as Record<string, unknown>[])
        .filter((row) => !Number(row.confirmation_id))
        .map((row) => ({
          audit_id: Number(row.id),
          emp_id: Number(row.emp_id),
          employee_name: [String(row.name || '').trim(), String(row.surname || '').trim()].filter(Boolean).join(' ').trim(),
          old_iban: (() => {
            try {
              return JSON.parse(String(row.old_value || 'null'));
            } catch {
              return row.old_value;
            }
          })(),
          new_iban: (() => {
            try {
              return JSON.parse(String(row.new_value || 'null'));
            } catch {
              return row.new_value;
            }
          })(),
          changed_at: row.created_at,
        }));

      return res.json({ count: pending.length, pending });
    } catch (error: any) {
      logger.error('Pending bank change lookup failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to load pending bank changes',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.post('/payroll/your-info/bank-change/confirm', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      await assertYourInfoTables(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor || Number(actor.role_rank) < ROLE_RANK.full) {
        return res.status(403).json({ error: 'Only Full/Admin users can confirm bank change activation' });
      }

      const period = parseYearMonth(req.body?.period);
      if (!period) {
        return res.status(400).json({ error: 'period must be YYYY-MM' });
      }

      const payrollKind = parsePayrollScope(req.body?.payroll);
      const auditIds = Array.isArray(req.body?.audit_ids)
        ? Array.from(new Set(req.body.audit_ids
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isFinite(value) && value > 0)))
        : [];

      if (!auditIds.length) {
        return res.status(400).json({ error: 'audit_ids are required' });
      }

      const targetAudits = await database('employee_self_service_audit_log')
        .select('id', 'emp_id')
        .whereIn('id', auditIds)
        .where('field_name', 'iban');

      if (!targetAudits.length) {
        return res.status(404).json({ error: 'No matching IBAN change audits found' });
      }

      const inserts = (targetAudits as Record<string, unknown>[]).map((row) => ({
        audit_log_id: Number(row.id),
        emp_id: Number(row.emp_id),
        payroll_period: period,
        payroll_kind: payrollKind,
        confirmed_by_user_id: String(actor.user_id || ''),
        confirmed_by_email: normalizeEmail(actor.email),
        notes: String(req.body?.notes || '').trim() || null,
      }));

      await database('employee_bank_change_confirmation')
        .insert(inserts)
        .onConflict(['audit_log_id', 'payroll_period', 'payroll_kind'])
        .ignore();

      return res.json({ ok: true, confirmed_count: inserts.length });
    } catch (error: any) {
      logger.error('Bank change confirmation failed', error);
      return res.status(error?.statusCode || 500).json({
        error: 'Failed to confirm bank change activation',
        message: error?.message || 'Unknown error',
      });
    }
  });
});
