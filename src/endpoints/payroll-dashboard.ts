import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

type FrontendPayroll = 'MAIN' | 'O3P' | 'PROV';

type PeriodInfo = {
  year: number;
  month: number;
  periodFrom: string;
  periodTo: string;
};

type PaydayMeta = {
  daysToPayday: number;
  lastPayday: string;
};

const PAYROLL_ALIAS_TO_DB: Record<FrontendPayroll, string> = {
  MAIN: 'MAIN',
  O3P: 'THIRDPARTY',
  PROV: 'PROVIDER',
};

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
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

const normalizeFrontendPayroll = (value: unknown): FrontendPayroll => {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'O3P') return 'O3P';
  if (raw === 'PROV' || raw === 'PROVIDER') return 'PROV';
  return 'MAIN';
};

const lastDayOfMonth = (year: number, month: number): string => {
  const date = new Date(year, month, 0);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const parsePeriod = (value: unknown): PeriodInfo => {
  const raw = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const safeYear = Number.isFinite(year) ? year : now.getFullYear();
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1;
  return {
    year: safeYear,
    month: safeMonth,
    periodFrom: `${safeYear}-${String(safeMonth).padStart(2, '0')}-01`,
    periodTo: lastDayOfMonth(safeYear, safeMonth),
  };
};

const diffDays = (fromIso: string, toIso: string): number => {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
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

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const cleanDesignationText = (value: unknown): string => {
  return String(value || '')
    .replace(/^\s*\d+[\.)\-]?\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const pickLatestByEmp = <T extends Record<string, unknown>>(rows: T[], key: keyof T): Map<number, T> => {
  const map = new Map<number, T>();
  rows.forEach((row) => {
    const empId = Number(row.emp_id);
    if (!Number.isFinite(empId) || map.has(empId)) return;
    map.set(empId, row);
  });
  return map;
};

const payrollLineScore = (row: Record<string, unknown>, payrollType: string): number => {
  const notes = String(row.notes || '').toUpperCase();
  let score = 0;
  if (notes.includes(payrollType)) score += 100;
  if (String(row.status || '').toUpperCase() === 'PAID') score += 20;
  if (row.payment_date) score += 10;
  if (row.net_payment != null) score += 5;
  return score;
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.get('/payroll/dashboard/overview', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const frontendPayroll = normalizeFrontendPayroll(req.query.payroll);
      const dbPayroll = PAYROLL_ALIAS_TO_DB[frontendPayroll];
      const period = parsePeriod(req.query.period);
      const paydayMeta = buildPaydayMeta();

      const activeSubscriptions = await database('payroll_subscriptions')
        .select('employee_id', 'active_from', 'active_to')
        .where('payroll_type', dbPayroll)
        .where('active_from', '<=', period.periodTo)
        .where((qb: any) => qb.whereNull('active_to').orWhere('active_to', '>=', period.periodFrom));

      const subscribedEmpIds = Array.from(new Set(activeSubscriptions
        .map((row: Record<string, unknown>) => Number(row.employee_id))
        .filter((value: number) => Number.isFinite(value))));

      if (!subscribedEmpIds.length) {
        return res.json({
          rows: [],
          totals: { net: 0, gross: 0, my_cost: 0 },
          meta: {
            viewer: {
              is_hr: false,
              role: req.accountability?.admin ? 'Administrator' : 'User',
            },
            selected_payroll: frontendPayroll,
            days_to_payday: paydayMeta.daysToPayday,
            payday_date: paydayMeta.lastPayday,
          },
        });
      }

      const employees = await database('vw_employee_current')
        .whereIn('emp_id', subscribedEmpIds)
        .select('*');

      const profileRows = await database('employee_form_profile')
        .whereIn('emp_id', subscribedEmpIds)
        .select('emp_id', 'designation');

      const profileByEmpId = new Map<number, Record<string, unknown>>(
        profileRows.map((row: Record<string, unknown>) => [Number(row.emp_id), row])
      );

      const employeeRows = employees.filter((row: Record<string, unknown>) => {
        const activeFrom = toIsoDate(row.active_from);
        const terminatedOn = toIsoDate(row.terminated_on);
        if (activeFrom && activeFrom > period.periodTo) return false;
        if (terminatedOn && terminatedOn < period.periodFrom) return false;
        return true;
      });

      const employeeIds = employeeRows
        .map((row: Record<string, unknown>) => Number(row.emp_id))
        .filter((value: number) => Number.isFinite(value));

      const [timesheets, wageHistory, payrollLines] = await Promise.all([
        database('timesheets')
          .whereIn('emp_id', employeeIds)
          .whereBetween('work_date', [period.periodFrom, period.periodTo])
          .select('emp_id', 'import_date', 'created_at', 'updated_at'),
        database('wage_history')
          .whereIn('emp_id', employeeIds)
          .where('effective_date', '<=', period.periodTo)
          .orderBy([{ column: 'emp_id', order: 'asc' }, { column: 'effective_date', order: 'desc' }])
          .select('emp_id', 'hourly_rate', 'effective_date'),
        database('payroll_lines as pl')
          .join('payroll_entries as pe', 'pl.payroll_entry_id', 'pe.id')
          .whereIn('pl.emp_id', employeeIds)
          .where('pe.payroll_year', period.year)
          .whereBetween('pe.payroll_month', [period.periodFrom, period.periodTo])
          .select(
            'pl.emp_id',
            'pl.hourly_rate',
            'pl.gross_earnings',
            'pl.net_payment',
            'pl.banked_hours_balance',
            'pl.ss_employer_contribution',
            'pl.mlf_contribution',
            'pl.notes',
            'pe.status',
            'pe.payment_date'
          ),
      ]);

      const timesheetMeta = new Map<number, { count: number; latestDate: string | null }>();
      (timesheets as Record<string, unknown>[]).forEach((row) => {
        const empId = Number(row.emp_id);
        if (!Number.isFinite(empId)) return;
        const latestCandidate = toIsoDate(row.import_date) || toIsoDate(row.updated_at) || toIsoDate(row.created_at);
        const current = timesheetMeta.get(empId) || { count: 0, latestDate: null };
        current.count += 1;
        if (latestCandidate && (!current.latestDate || latestCandidate > current.latestDate)) {
          current.latestDate = latestCandidate;
        }
        timesheetMeta.set(empId, current);
      });

      const wageByEmp = pickLatestByEmp(wageHistory as Record<string, unknown>[], 'effective_date');

      const payrollByEmp = new Map<number, Record<string, unknown>>();
      (payrollLines as Record<string, unknown>[]).forEach((row) => {
        const empId = Number(row.emp_id);
        if (!Number.isFinite(empId)) return;
        const current = payrollByEmp.get(empId);
        if (!current || payrollLineScore(row, dbPayroll) > payrollLineScore(current, dbPayroll)) {
          payrollByEmp.set(empId, row);
        }
      });

      const rows = employeeRows.map((employee: Record<string, unknown>) => {
        const empId = Number(employee.emp_id);
        const profile = profileByEmpId.get(empId) || {};
        const payrollLine = payrollByEmp.get(empId);
        const wage = wageByEmp.get(empId);
        const timesheet = timesheetMeta.get(empId);
        const terminatedOn = toIsoDate(employee.terminated_on);
        const warnings: string[] = [];

        if (!timesheet?.count) warnings.push('Timesheet pending');
        if (terminatedOn) warnings.push(`Terminated ${terminatedOn}`);

        const gross = toNumber(payrollLine?.gross_earnings);
        const myCost = gross + toNumber(payrollLine?.ss_employer_contribution) + toNumber(payrollLine?.mlf_contribution);

        return {
          emp_id: empId,
          surname: String(employee.surname || ''),
          first_name: String(employee.first_name || ''),
          designation: cleanDesignationText(profile.designation || employee.position_held || ''),
          department: String(employee.department_code || ''),
          period_from: period.periodFrom,
          period_to: period.periodTo,
          timesheet_acquired: timesheet?.latestDate ? `Latest ${timesheet.latestDate}` : 'Pending',
          hourly_rate: payrollLine?.hourly_rate ?? wage?.hourly_rate ?? 0,
          net_payment: toNumber(payrollLine?.net_payment),
          gross_including_bonuses: gross,
          my_cost_per_cheque: myCost,
          vl_pending: 0,
          sl_pending: 0,
          banked_hours_balance: toNumber(payrollLine?.banked_hours_balance),
          warnings,
        };
      });

      const totals = rows.reduce((acc, row) => {
        acc.net += toNumber(row.net_payment);
        acc.gross += toNumber(row.gross_including_bonuses);
        acc.my_cost += toNumber(row.my_cost_per_cheque);
        return acc;
      }, { net: 0, gross: 0, my_cost: 0 });

      return res.json({
        rows,
        totals,
        meta: {
          viewer: {
            is_hr: false,
            role: req.accountability?.admin ? 'Administrator' : 'User',
          },
          selected_payroll: frontendPayroll,
          days_to_payday: paydayMeta.daysToPayday,
          payday_date: paydayMeta.lastPayday,
        },
      });
    } catch (error: any) {
      logger.error('Payroll dashboard overview failed', error);
      return res.status(500).json({
        error: 'Failed to load payroll dashboard',
        message: error?.message || 'Unknown error',
      });
    }
  });

  router.post('/payroll/dashboard/actions/issue', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const action = String(req.body?.action || '').trim();
      const frontendPayroll = normalizeFrontendPayroll(req.body?.payroll);
      const period = parsePeriod(req.body?.period);
      const employeeIds = Array.isArray(req.body?.employee_ids)
        ? req.body.employee_ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
        : [];

      if (!action) {
        return res.status(400).json({ error: 'action is required' });
      }
      if (!employeeIds.length) {
        return res.status(400).json({ error: 'employee_ids are required' });
      }

      return res.json({
        ok: true,
        action,
        payroll: frontendPayroll,
        period: `${period.year}-${String(period.month).padStart(2, '0')}`,
        employee_ids: employeeIds,
        message: `${action.replace(/_/g, ' ')} queued for ${employeeIds.length} employee${employeeIds.length === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      logger.error('Payroll dashboard issue action failed', error);
      return res.status(500).json({
        error: 'Failed to issue payroll action',
        message: error?.message || 'Unknown error',
      });
    }
  });
});
