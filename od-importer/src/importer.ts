import type { Pool as PgPool } from 'pg';
import type { Pool as MysqlPool } from 'mysql2/promise';
import { config } from './config.js';
import { addDays, chunkArray, diffDays, toIsoDate } from './utils.js';

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
  message?: string;
  diagnostics?: {
    date_from: string;
    date_to: string;
    selected_employee_ids: number[];
    mapped_od_users: number[];
    mapped_od_employee_nums?: number[];
  };
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

type UserMapRow = {
  employee_id: number;
  od_user_num: number;
};

type OdUserRow = {
  UserNum: number;
  EmployeeNum: number;
  UserName?: string;
};

type TimesheetRow = {
  employee_id: number;
  work_date: string;
  hours: number;
};

type TimesheetConflictRow = {
  employee_id: number;
  work_date: string;
  imported_hours: number;
  notes: string;
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

const loadUserMapRows = async (pg: PgPool, employeeIds?: number[]) => {
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
  return result.rows.map((row) => ({
    employee_id: Number(row.employee_id),
    od_user_num: Number(row.od_user_num)
  })) satisfies UserMapRow[];
};

const loadOpenDentalUsers = async (mysql: MysqlPool, odUserNums: number[]) => {
  if (!odUserNums.length) {
    return new Map<number, OdUserRow>();
  }

  const [rows] = await mysql.query(
    `SELECT UserNum, EmployeeNum, UserName
     FROM userod
     WHERE UserNum IN (${odUserNums.map(() => '?').join(',')})`,
    odUserNums
  );

  const userMap = new Map<number, OdUserRow>();
  for (const row of rows as OdUserRow[]) {
    userMap.set(Number(row.UserNum), {
      UserNum: Number(row.UserNum),
      EmployeeNum: Number(row.EmployeeNum),
      UserName: row.UserName ? String(row.UserName) : undefined
    });
  }
  return userMap;
};

const loadUserMap = async (pg: PgPool, mysql: MysqlPool, employeeIds?: number[]) => {
  const mappingRows = await loadUserMapRows(pg, employeeIds);
  const odUsers = await loadOpenDentalUsers(
    mysql,
    mappingRows.map((row) => row.od_user_num)
  );

  const odEmployeeNumToEmployee = new Map<number, number>();
  const mappedOdUsers: number[] = [];
  const mappedOdEmployeeNums: number[] = [];

  for (const row of mappingRows) {
    const odUserNum = Number(row.od_user_num);
    const odUser = odUsers.get(odUserNum);
    const odEmployeeNum = Number(odUser?.EmployeeNum || 0);
    const clockEmployeeNum = odEmployeeNum > 0 ? odEmployeeNum : odUserNum;

    odEmployeeNumToEmployee.set(clockEmployeeNum, Number(row.employee_id));
    mappedOdUsers.push(odUserNum);
    mappedOdEmployeeNums.push(clockEmployeeNum);
  }

  return {
    odEmployeeNumToEmployee,
    mappedOdUsers,
    mappedOdEmployeeNums,
    odUsers
  };
};

const loadOpenDentalEvents = async (
  mysql: MysqlPool,
  dateFrom: string,
  dateTo: string,
  employeeNums: number[]
): Promise<OdEventRow[]> => {
  const start = `${dateFrom} 00:00:00`;
  const endExclusive = `${addDays(dateTo, 1)} 00:00:00`;

  if (!employeeNums.length) return [];

  const [rows] = await mysql.query(
    `SELECT ClockEventNum, EmployeeNum, TimeDisplayed1, ClockStatus, Note, ClinicNum
     FROM clockevent
     WHERE TimeDisplayed1 >= ?
       AND TimeDisplayed1 < ?
       AND EmployeeNum IN (${employeeNums.map(() => '?').join(',')})
     ORDER BY TimeDisplayed1 ASC`,
    [start, endExclusive, ...employeeNums]
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
    const odEmployeeNum = Number(row.EmployeeNum);
    const employeeId = userMap.get(odEmployeeNum);
    if (!employeeId) {
      missing.add(odEmployeeNum);
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

const buildTimesheetRows = (events: MappedEvent[]) => {
  const eventsByEmployeeDate = new Map<string, MappedEvent[]>();
  for (const event of events) {
    const workDate = event.event_datetime.slice(0, 10);
    const key = `${event.employee_id}|${workDate}`;
    if (!eventsByEmployeeDate.has(key)) {
      eventsByEmployeeDate.set(key, []);
    }
    eventsByEmployeeDate.get(key)!.push(event);
  }

  const rows: TimesheetRow[] = [];
  const conflicts: TimesheetConflictRow[] = [];
  for (const [key, dayEvents] of eventsByEmployeeDate.entries()) {
    dayEvents.sort((a, b) => a.event_datetime.localeCompare(b.event_datetime));
    let openIn: Date | null = null;
    let hours = 0;
    let hasUnpaired = false;
    for (const event of dayEvents) {
      const dt = new Date(event.event_datetime);
      if (event.status === 'IN') {
        if (openIn) {
          hasUnpaired = true;
        }
        openIn = dt;
        continue;
      }
      if (event.status === 'OUT' && openIn) {
        const diffHours = (dt.getTime() - openIn.getTime()) / (1000 * 60 * 60);
        if (diffHours > 0) {
          hours += diffHours;
        } else {
          hasUnpaired = true;
        }
        openIn = null;
        continue;
      }
      hasUnpaired = true;
    }
    if (openIn) {
      hasUnpaired = true;
    }

    const [employeeIdText, workDate] = key.split('|');
    if (hours > 0) {
      rows.push({
        employee_id: Number(employeeIdText),
        work_date: workDate,
        hours: Math.round(hours * 100) / 100
      });
    }
    if (hasUnpaired) {
      conflicts.push({
        employee_id: Number(employeeIdText),
        work_date: workDate,
        imported_hours: Math.round(hours * 100) / 100,
        notes: `Unpaired OpenDental clockevents: ${dayEvents
          .map((event) => `${event.status}@${event.event_datetime.slice(11, 16)}`)
          .join(', ')}`
      });
    }
  }

  return { rows, conflicts };
};

const refreshOpenDentalTimesheets = async (
  pg: PgPool,
  dateFrom: string,
  dateTo: string,
  employeeIds: number[],
  rows: TimesheetRow[],
  conflicts: TimesheetConflictRow[],
  dryRun: boolean
) => {
  if (dryRun) {
    return;
  }

  const deleteParams: (string | number[] )[] = [dateFrom, dateTo];
  let deleteEmployeeFilter = '';
  if (employeeIds.length) {
    deleteParams.push(employeeIds);
    deleteEmployeeFilter = ' AND emp_id = ANY($3::int[])';
  }

  await pg.query(
    `DELETE FROM timesheets
     WHERE source = 'OpenDental'
       AND work_date >= $1::date
       AND work_date <= $2::date${deleteEmployeeFilter}`,
    deleteParams
  );
  await pg.query(
    `DELETE FROM timesheet_import_conflicts
     WHERE source_system = 'OpenDental'
       AND work_date >= $1::date
       AND work_date <= $2::date${deleteEmployeeFilter}`,
    deleteParams
  );

  if (rows.length) {
    const chunks = chunkArray(rows, 500);
    for (const chunk of chunks) {
      const values: string[] = [];
      const params: Array<string | number> = [];
      chunk.forEach((row, idx) => {
        const base = idx * 4;
        values.push(`($${base + 1}::int, $${base + 2}::date, $${base + 3}::numeric, 'WORK', 'PAID', 'OpenDental', $${base + 4}::varchar, 'Imported from OpenDental clockevents', NOW(), 'od-importer', 'system')`);
        params.push(
          row.employee_id,
          row.work_date,
          row.hours,
          `OD:${row.employee_id}:${row.work_date}`
        );
      });

      await pg.query(
        `INSERT INTO timesheets
           (emp_id, work_date, hours, hour_type, leave_status, source, source_reference_id, notes, import_date, imported_by, imported_by_role)
         VALUES ${values.join(',')}`,
        params
      );
    }
  }

  if (conflicts.length) {
    const chunks = chunkArray(conflicts, 500);
    for (const chunk of chunks) {
      const values: string[] = [];
      const params: Array<string | number> = [];
      chunk.forEach((row, idx) => {
        const base = idx * 4;
        values.push(`($${base + 1}::int, $${base + 2}::date, 0::numeric, $${base + 3}::numeric, 'PENDING', 'OpenDental', $${base + 4}::text, 'od-importer')`);
        params.push(
          row.employee_id,
          row.work_date,
          row.imported_hours,
          row.notes
        );
      });

      await pg.query(
        `INSERT INTO timesheet_import_conflicts
           (emp_id, work_date, existing_hours, imported_hours, status, source_system, notes, created_by)
         VALUES ${values.join(',')}`,
        params
      );
    }
  }
};

const syncOdUserMapMetadata = async (
  pg: PgPool,
  mappingRows: UserMapRow[],
  odUsers: Map<number, OdUserRow>
) => {
  if (!mappingRows.length) return;

  const params: Array<number | string | null> = [];
  const values: string[] = [];
  mappingRows.forEach((row, idx) => {
    const odUser = odUsers.get(row.od_user_num);
    const base = idx * 4;
    values.push(`($${base + 1}::int, $${base + 2}::int, $${base + 3}::int, $${base + 4}::text)`);
    params.push(
      row.employee_id,
      row.od_user_num,
      Number(odUser?.EmployeeNum || 0) || null,
      odUser?.UserName ? String(odUser.UserName) : null
    );
  });

  await pg.query(
    `UPDATE od_user_map AS m
     SET od_employee_num = v.od_employee_num,
         od_username = COALESCE(v.od_username, m.od_username),
         updated_at = NOW()
     FROM (
       VALUES ${values.join(',')}
     ) AS v(employee_id, od_user_num, od_employee_num, od_username)
     WHERE m.employee_id = v.employee_id
       AND m.od_user_num = v.od_user_num`,
    params
  );
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
    const mappingRows = await loadUserMapRows(pg, employeeIds);
    const { odEmployeeNumToEmployee: userMap, mappedOdUsers, mappedOdEmployeeNums, odUsers } = await loadUserMap(pg, mysql, employeeIds);
    const employeeNums = Array.from(userMap.keys());
    const diagnostics = {
      date_from: dateFrom,
      date_to: dateTo,
      selected_employee_ids: employeeIds ?? [],
      mapped_od_users: mappedOdUsers,
      mapped_od_employee_nums: mappedOdEmployeeNums
    };
    if (!employeeNums.length) {
      await updateImportLog(pg, importId, {
        inserted: 0,
        updated: 0,
        skipped: 0,
        status: 'COMPLETED'
      });
      return {
        ok: true,
        inserted: 0,
        updated: 0,
        skipped: 0,
        missing_mappings: [],
        total_events: 0,
        message: 'No active OpenDental user mappings found for the selected employees.',
        diagnostics
      };
    }
    await syncOdUserMapMetadata(pg, mappingRows, odUsers);
    const events = await loadOpenDentalEvents(mysql, dateFrom, dateTo, employeeNums);
    const { mapped, missing } = mapEvents(events, userMap);
    const timesheetMaterialized = buildTimesheetRows(mapped);

    let inserted = 0;
    let updated = 0;
    if (!dryRun) {
      const upserted = await upsertEvents(pg, mapped);
      inserted = upserted.inserted;
      updated = upserted.updated;
      await refreshOpenDentalTimesheets(
        pg,
        dateFrom,
        dateTo,
        employeeIds ?? [],
        timesheetMaterialized.rows,
        timesheetMaterialized.conflicts,
        dryRun
      );
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
      total_events: events.length,
      message: events.length === 0
        ? 'No OpenDental clock events found for the selected employees in the selected date range.'
        : undefined,
      diagnostics
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
