import type { Pool as PgPool } from 'pg';
import type { Pool as MysqlPool } from 'mysql2/promise';
import { config } from './config.js';
import { addDays, chunkArray, diffDays, toIsoDate } from './utils.js';
import { determinePayrollStreams } from './payroll-router.js';

export type ImportRequest = {
  date_from: string;
  date_to: string;
  employee_ids?: number[];
  dry_run?: boolean;
};

export type ImportResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  missing_mappings: number[];
  total_events: number;
};

type OdEventRow = {
  ClockEventNum: number;
  EmployeeNum: number;
  TimeDisplayed1: string;
  ClockStatus: number | string;
  Note: string | null;
  ClinicNum: number | null;
};

type MappedEvent = {
  employee_id: number;
  event_datetime: string;
  status: 'IN' | 'OUT';
  note: string | null;
  clinic_num: number | null;
  source_clockevent_num: number;
};

const parseRequest = (payload: ImportRequest) => {
  const dateFrom = toIsoDate(payload.date_from);
  const dateTo = toIsoDate(payload.date_to);
  if (diffDays(dateFrom, dateTo) < 0) {
    throw new Error('date_to must be on or after date_from');
  }
  const days = diffDays(dateFrom, dateTo) + 1;
  if (days > config.maxDays) {
    throw new Error(`Date range exceeds max of ${config.maxDays} days`);
  }
  return {
    dateFrom,
    dateTo,
    employeeIds: payload.employee_ids?.map((n) => Number(n)).filter((n) => Number.isFinite(n)),
    dryRun: Boolean(payload.dry_run)
  };
};

const loadUserMap = async (pg: PgPool, employeeIds?: number[]) => {
  const params: number[] = [];
  let filterSql = '';
  if (employeeIds && employeeIds.length > 0) {
    params.push(...employeeIds);
    const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(',');
    filterSql = ` AND employee_id IN (${placeholders})`;
  }
  const result = await pg.query(
    `SELECT employee_id, od_user_num
     FROM od_user_map
     WHERE is_active = TRUE${filterSql}`,
    params
  );
  const userNumToEmployee = new Map<number, number>();
  for (const row of result.rows) {
    userNumToEmployee.set(Number(row.od_user_num), Number(row.employee_id));
  }
  return userNumToEmployee;
};

const loadOpenDentalEvents = async (
  mysql: MysqlPool,
  dateFrom: string,
  dateTo: string,
  userNums: number[]
): Promise<OdEventRow[]> => {
  const start = `${dateFrom} 00:00:00`;
  const endExclusive = `${addDays(dateTo, 1)} 00:00:00`;

  if (!userNums.length) return [];

  const [rows] = await mysql.query(
    `SELECT ClockEventNum, EmployeeNum, TimeDisplayed1, ClockStatus, Note, ClinicNum
     FROM clockevent
     WHERE TimeDisplayed1 >= ?
       AND TimeDisplayed1 < ?
       AND EmployeeNum IN (${userNums.map(() => '?').join(',')})
     ORDER BY TimeDisplayed1 ASC`,
    [start, endExclusive, ...userNums]
  );

  return rows as OdEventRow[];
};

const normalizeStatus = (status: number | string): 'IN' | 'OUT' | null => {
  if (typeof status === 'number') {
    // OpenDental commonly stores numeric status; 1/2 are explicit, 0 is often neutral.
    if (status === 1) return 'IN';
    if (status === 2) return 'OUT';
    return null;
  }
  const trimmed = String(status).trim().toUpperCase();
  if (trimmed === 'IN' || trimmed === 'OUT') return trimmed;
  return null;
};

const mapEvents = (events: OdEventRow[], userMap: Map<number, number>) => {
  const mapped: MappedEvent[] = [];
  const missing = new Set<number>();
  const lastStatusByEmployee = new Map<number, 'IN' | 'OUT'>();

  for (const row of events) {
    const odUserNum = Number(row.EmployeeNum);
    const employeeId = userMap.get(odUserNum);
    if (!employeeId) {
      missing.add(odUserNum);
      continue;
    }

    let status = normalizeStatus(row.ClockStatus);
    if (!status) {
      const prev = lastStatusByEmployee.get(employeeId) ?? 'OUT';
      status = prev === 'IN' ? 'OUT' : 'IN';
    }
    lastStatusByEmployee.set(employeeId, status);

    mapped.push({
      employee_id: employeeId,
      event_datetime: new Date(row.TimeDisplayed1).toISOString(),
      status,
      note: row.Note ?? null,
      clinic_num: row.ClinicNum ?? null,
      source_clockevent_num: Number(row.ClockEventNum)
    });
  }

  return { mapped, missing: Array.from(missing) };
};

const upsertEvents = async (pg: PgPool, events: MappedEvent[]) => {
  let inserted = 0;
  let updated = 0;

  const chunks = chunkArray(events, 500);
  for (const chunk of chunks) {
    const values: string[] = [];
    const params: (string | number | null)[] = [];

    chunk.forEach((event, idx) => {
      const base = idx * 6;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      params.push(
        event.employee_id,
        event.event_datetime,
        event.status,
        event.note,
        event.clinic_num,
        event.source_clockevent_num
      );
    });

    const query = `
      INSERT INTO timesheet_events
        (employee_id, event_datetime, status, note, clinic_num, source_clockevent_num)
      VALUES ${values.join(',')}
      ON CONFLICT (source_system, source_clockevent_num)
      DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        event_datetime = EXCLUDED.event_datetime,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        clinic_num = EXCLUDED.clinic_num,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted;
    `;

    const result = await pg.query(query, params);
    for (const row of result.rows) {
      if (row.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
  }

  return { inserted, updated };
};

const insertImportLog = async (
  pg: PgPool,
  dateFrom: string,
  dateTo: string,
  employeeIds: number[] | undefined
) => {
  const result = await pg.query(
    `INSERT INTO import_log (date_from, date_to, employee_ids, status)
     VALUES ($1, $2, $3, 'STARTED')
     RETURNING id`,
    [dateFrom, dateTo, employeeIds ?? null]
  );
  return Number(result.rows[0].id);
};

const updateImportLog = async (
  pg: PgPool,
  id: number,
  payload: {
    inserted: number;
    updated: number;
    skipped: number;
    status: 'COMPLETED' | 'FAILED';
    error_message?: string;
  }
) => {
  await pg.query(
    `UPDATE import_log
     SET inserted_count = $1,
         updated_count = $2,
         skipped_count = $3,
         status = $4,
         error_message = $5
     WHERE id = $6`,
    [payload.inserted, payload.updated, payload.skipped, payload.status, payload.error_message ?? null, id]
  );
};

export const runImport = async (pg: PgPool, mysql: MysqlPool, payload: ImportRequest): Promise<ImportResult> => {
  const { dateFrom, dateTo, employeeIds, dryRun } = parseRequest(payload);

  const importId = await insertImportLog(pg, dateFrom, dateTo, employeeIds);

  try {
    const userMap = await loadUserMap(pg, employeeIds);
    const userNums = Array.from(userMap.keys());
    const events = await loadOpenDentalEvents(mysql, dateFrom, dateTo, userNums);
    const { mapped, missing } = mapEvents(events, userMap);

    let inserted = 0;
    let updated = 0;
    if (!dryRun) {
      const upserted = await upsertEvents(pg, mapped);
      inserted = upserted.inserted;
      updated = upserted.updated;
    }

    const skipped = dryRun ? 0 : Math.max(0, mapped.length - inserted - updated);

    await updateImportLog(pg, importId, {
      inserted,
      updated,
      skipped,
      status: 'COMPLETED'
    });

    return {
      ok: true,
      inserted,
      updated,
      skipped,
      missing_mappings: missing,
      total_events: events.length
    };
  } catch (error) {
    await updateImportLog(pg, importId, {
      inserted: 0,
      updated: 0,
      skipped: 0,
      status: 'FAILED',
      error_message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
