import type { Pool as PgPool } from 'pg';
import type { Pool as MysqlPool } from 'mysql2/promise';
import { addDays, diffDays, toIsoDate, chunkArray } from './utils.js';
import { config } from './config.js';

export type ProviderProductionImportRequest = {
  period_month?: string; // YYYY-MM
  date_from?: string; // YYYY-MM-DD
  date_to?: string; // YYYY-MM-DD
  od_prov_num: number;
  clinic_nums?: number[];
  split_by_clinic?: boolean;
  dry_run?: boolean;
};

export type ProviderProductionImportResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  total_rows: number;
  period_start: string;
  period_end: string;
  monthly_total_proc_fee: number;
  totals_by_clinic?: Array<{ clinic_num: number | null; total_proc_fee: number }>;
};

type OdProcRow = {
  ProcNum: number;
  ProcDate: string;
  ProcFee: number | string;
  ProvNum: number;
  ClinicNum: number | null;
};

type MappedProcRow = {
  period_start: string;
  period_end: string;
  provider_id: string;
  od_prov_num: number;
  proc_date: string;
  clinic_num: number | null;
  source_proc_num: number;
  proc_fee_gross: number;
};

const parsePeriod = (payload: ProviderProductionImportRequest) => {
  const today = new Date();

  let periodStart = '';
  let periodEnd = '';

  if (payload.date_from && payload.date_to) {
    periodStart = toIsoDate(payload.date_from);
    periodEnd = toIsoDate(payload.date_to);
  } else {
    const month = payload.period_month ?? `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('period_month must be in YYYY-MM format');
    }
    const [year, mm] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, mm - 1, 1));
    const end = new Date(Date.UTC(year, mm, 0));
    periodStart = start.toISOString().slice(0, 10);
    periodEnd = end.toISOString().slice(0, 10);
  }

  if (diffDays(periodStart, periodEnd) < 0) {
    throw new Error('period end must be on or after period start');
  }
  const days = diffDays(periodStart, periodEnd) + 1;
  if (days > config.maxDays) {
    throw new Error(`Date range exceeds max of ${config.maxDays} days`);
  }

  return { periodStart, periodEnd };
};

const loadProviderId = async (pg: PgPool, odProvNum: number): Promise<string> => {
  const result = await pg.query(
    `SELECT provider_id
     FROM od_provider_map
     WHERE od_prov_num = $1
     LIMIT 1`,
    [odProvNum]
  );

  if (!result.rows.length) {
    throw new Error(`No od_provider_map row found for od_prov_num=${odProvNum}`);
  }

  return String(result.rows[0].provider_id);
};

const loadOpenDentalProduction = async (
  mysql: MysqlPool,
  periodStart: string,
  periodEnd: string,
  odProvNum: number,
  clinicNums?: number[]
): Promise<OdProcRow[]> => {
  const start = `${periodStart} 00:00:00`;
  const endExclusive = `${addDays(periodEnd, 1)} 00:00:00`;

  const clinicFilter = clinicNums && clinicNums.length > 0
    ? ` AND IFNULL(ClinicNum, -1) IN (${clinicNums.map(() => '?').join(',')})`
    : '';

  const [rows] = await mysql.query(
    `SELECT ProcNum, ProcDate, ProcFee, ProvNum, ClinicNum
     FROM procedurelog
     WHERE ProcStatus = 2
       AND ProcDate >= ?
       AND ProcDate < ?
       AND ProvNum = ?${clinicFilter}
     ORDER BY ProcDate ASC, ProcNum ASC`,
    clinicNums && clinicNums.length > 0
      ? [start, endExclusive, odProvNum, ...clinicNums]
      : [start, endExclusive, odProvNum]
  );

  return rows as OdProcRow[];
};

const mapRows = (
  rows: OdProcRow[],
  providerId: string,
  periodStart: string,
  periodEnd: string
): MappedProcRow[] => rows.map((row) => ({
  period_start: periodStart,
  period_end: periodEnd,
  provider_id: providerId,
  od_prov_num: Number(row.ProvNum),
  proc_date: new Date(row.ProcDate).toISOString().slice(0, 10),
  clinic_num: row.ClinicNum ?? null,
  source_proc_num: Number(row.ProcNum),
  proc_fee_gross: Number(row.ProcFee) || 0
}));

const insertImportLog = async (
  pg: PgPool,
  periodStart: string,
  periodEnd: string,
  odProvNum: number,
  clinicNums: number[] | undefined,
  splitByClinic: boolean
): Promise<number> => {
  const result = await pg.query(
    `INSERT INTO od_provider_production_import_log
      (period_start, period_end, od_prov_num, clinic_nums, split_by_clinic, status)
     VALUES ($1, $2, $3, $4, $5, 'STARTED')
     RETURNING id`,
    [periodStart, periodEnd, odProvNum, clinicNums ?? null, splitByClinic]
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
    `UPDATE od_provider_production_import_log
     SET inserted_count = $1,
         updated_count = $2,
         skipped_count = $3,
         status = $4,
         error_message = $5,
         completed_at = NOW()
     WHERE id = $6`,
    [payload.inserted, payload.updated, payload.skipped, payload.status, payload.error_message ?? null, id]
  );
};

const upsertProviderProduction = async (pg: PgPool, rows: MappedProcRow[], importBatchId: number) => {
  let inserted = 0;
  let updated = 0;

  const chunks = chunkArray(rows, 500);
  for (const chunk of chunks) {
    const values: string[] = [];
    const params: Array<string | number | null> = [];

    chunk.forEach((row, idx) => {
      const base = idx * 9;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);
      params.push(
        importBatchId,
        row.period_start,
        row.period_end,
        row.provider_id,
        row.od_prov_num,
        row.proc_date,
        row.clinic_num,
        row.source_proc_num,
        row.proc_fee_gross
      );
    });

    const result = await pg.query(
      `INSERT INTO od_provider_production
        (import_batch_id, period_start, period_end, provider_id, od_prov_num, proc_date, clinic_num, source_proc_num, proc_fee_gross)
       VALUES ${values.join(',')}
       ON CONFLICT (source_system, source_proc_num, od_prov_num)
       DO UPDATE SET
         import_batch_id = EXCLUDED.import_batch_id,
         period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         provider_id = EXCLUDED.provider_id,
         proc_date = EXCLUDED.proc_date,
         clinic_num = EXCLUDED.clinic_num,
         proc_fee_gross = EXCLUDED.proc_fee_gross,
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      params
    );

    for (const row of result.rows) {
      if (row.inserted) inserted += 1;
      else updated += 1;
    }
  }

  return { inserted, updated };
};

const calcTotalsByClinic = (rows: MappedProcRow[]) => {
  const totals = new Map<number | null, number>();
  for (const row of rows) {
    const prev = totals.get(row.clinic_num) ?? 0;
    totals.set(row.clinic_num, prev + row.proc_fee_gross);
  }
  return Array.from(totals.entries()).map(([clinic_num, total_proc_fee]) => ({ clinic_num, total_proc_fee }));
};

export const runProviderProductionImport = async (
  pg: PgPool,
  mysql: MysqlPool,
  payload: ProviderProductionImportRequest
): Promise<ProviderProductionImportResult> => {
  const odProvNum = Number(payload.od_prov_num);
  if (!Number.isFinite(odProvNum) || odProvNum <= 0) {
    throw new Error('od_prov_num is required and must be a positive integer');
  }

  const clinicNums = payload.clinic_nums?.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  const splitByClinic = Boolean(payload.split_by_clinic);
  const dryRun = Boolean(payload.dry_run);

  const { periodStart, periodEnd } = parsePeriod(payload);
  const providerId = await loadProviderId(pg, odProvNum);
  const importId = await insertImportLog(pg, periodStart, periodEnd, odProvNum, clinicNums, splitByClinic);

  try {
    const rawRows = await loadOpenDentalProduction(mysql, periodStart, periodEnd, odProvNum, clinicNums);
    const mapped = mapRows(rawRows, providerId, periodStart, periodEnd);

    let inserted = 0;
    let updated = 0;

    if (!dryRun) {
      const upserted = await upsertProviderProduction(pg, mapped, importId);
      inserted = upserted.inserted;
      updated = upserted.updated;
    }

    const skipped = dryRun ? 0 : Math.max(0, mapped.length - inserted - updated);
    const monthlyTotal = mapped.reduce((acc, row) => acc + row.proc_fee_gross, 0);
    const totalsByClinic = splitByClinic ? calcTotalsByClinic(mapped) : undefined;

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
      total_rows: mapped.length,
      period_start: periodStart,
      period_end: periodEnd,
      monthly_total_proc_fee: monthlyTotal,
      totals_by_clinic: totalsByClinic
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
