import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import { roundSSNumeric } from '../utils/rounding';

const ROLE_RANK: Record<string, number> = {
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
  if (ROLE_RANK[normalized]) return ROLE_RANK[normalized];
  if (normalized.includes('super') || normalized.includes('admin')) return ROLE_RANK.admin;
  if (normalized.includes('full')) return ROLE_RANK.full;
  if (normalized.includes('hr')) return ROLE_RANK.hr;
  if (normalized.includes('manag')) return ROLE_RANK.management;
  if (normalized.includes('general') || normalized.includes('user')) return ROLE_RANK['general user'];
  return 0;
};

const normalizeAclRoleName = (roleName: unknown): string => {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return 'general user';
  if (normalized.includes('super') || normalized.includes('admin')) return 'admin';
  if (normalized.includes('full')) return 'full';
  if (normalized.includes('hr')) return 'hr';
  if (normalized.includes('manag')) return 'management';
  return 'general user';
};

const slugifyItemKey = (value: unknown): string => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

const csvToList = (value: unknown): string[] => {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry, index, arr) => arr.indexOf(entry) === index);
};

const listToCsv = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((entry, index, arr) => arr.indexOf(entry) === index)
    .join(',');
};

const parseDataUrl = (value: unknown): { base64: string; mimeType: string } | null => {
  const input = String(value || '').trim();
  if (!input) return null;
  const match = input.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || 'application/octet-stream').trim().toLowerCase(),
    base64: String(match[2] || '').trim(),
  };
};

const mapLibraryRow = (row: Record<string, any>) => ({
  id: Number(row.id),
  item_key: String(row.item_key || ''),
  title: String(row.title || ''),
  description: String(row.description || ''),
  file_name: String(row.file_name || ''),
  mime_type: String(row.mime_type || ''),
  allowed_roles: csvToList(row.allowed_roles_csv),
  allowed_apps: csvToList(row.allowed_apps_csv),
  is_active: row.is_active !== false,
  updated_at: row.updated_at,
  created_at: row.created_at,
});

const ensureItemLibraryTable = async (database: any) => {
  const exists = await database.schema.hasTable('admin_item_library');
  if (exists) return;

  await database.schema.createTable('admin_item_library', (table: any) => {
    table.increments('id').primary();
    table.string('item_key', 140).notNullable().unique();
    table.string('title', 240).notNullable();
    table.text('description');
    table.string('file_name', 255).notNullable();
    table.string('mime_type', 120).notNullable();
    table.text('file_base64');
    table.text('allowed_roles_csv');
    table.text('allowed_apps_csv');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.string('created_by_email', 255);
    table.string('updated_by_email', 255);
    table.timestamp('created_at').defaultTo(database.fn.now());
    table.timestamp('updated_at').defaultTo(database.fn.now());
  });
};

const getActorContext = async (database: any, userId: string) => {
  const row = await database('directus_users as u')
    .leftJoin('directus_roles as r', 'u.role', 'r.id')
    .select('u.id', 'u.email', 'r.name as role_name')
    .where('u.id', userId)
    .first();

  if (!row) return null;
  return {
    user_id: String(row.id || ''),
    email: String(row.email || '').trim().toLowerCase(),
    role_name: String(row.role_name || '').trim(),
    role_rank: normalizeRoleRank(row.role_name),
    acl_role: normalizeAclRoleName(row.role_name),
  };
};

const canAccessItem = (item: Record<string, any>, actor: Record<string, any>, appName: string): boolean => {
  if (Number(actor.role_rank) >= ROLE_RANK.admin) return true;
  const allowedRoles = csvToList(item.allowed_roles_csv);
  const allowedApps = csvToList(item.allowed_apps_csv);

  const roleAllowed = allowedRoles.includes('all') || allowedRoles.includes(String(actor.acl_role || '').toLowerCase());
  const appAllowed = !allowedApps.length
    || allowedApps.includes('all')
    || allowedApps.includes(String(appName || '').trim().toLowerCase());

  return roleAllowed && appAllowed;
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.get('/item-library/list', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ status: 'error', message: 'Authentication required' });
      await ensureItemLibraryTable(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor || Number(actor.role_rank) < ROLE_RANK.admin) {
        return res.status(403).json({ status: 'error', message: 'Admin access required' });
      }

      const rows = await database('admin_item_library')
        .select('*')
        .where('is_active', true)
        .orderBy('updated_at', 'desc');

      return res.json({ status: 'success', data: rows.map(mapLibraryRow) });
    } catch (error: any) {
      logger?.error('item-library/list failed', error);
      return res.status(500).json({ status: 'error', message: error?.message || 'Failed to load item library' });
    }
  });

  router.get('/item-library/available', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ status: 'error', message: 'Authentication required' });
      await ensureItemLibraryTable(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor) return res.status(403).json({ status: 'error', message: 'Access denied' });

      const appName = String(req.query?.app || 'all').trim().toLowerCase();
      const rows = await database('admin_item_library')
        .select('*')
        .where('is_active', true)
        .orderBy('updated_at', 'desc');

      const filtered = (rows as Record<string, any>[])
        .filter((row) => canAccessItem(row, actor, appName))
        .map(mapLibraryRow);

      return res.json({ status: 'success', data: filtered });
    } catch (error: any) {
      logger?.error('item-library/available failed', error);
      return res.status(500).json({ status: 'error', message: error?.message || 'Failed to load available items' });
    }
  });

  router.get('/item-library/:id/file', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ status: 'error', message: 'Authentication required' });
      await ensureItemLibraryTable(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor) return res.status(403).json({ status: 'error', message: 'Access denied' });

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ status: 'error', message: 'Invalid item ID' });
      }

      const appName = String(req.query?.app || 'all').trim().toLowerCase();
      const row = await database('admin_item_library').where('id', id).where('is_active', true).first();
      if (!row) return res.status(404).json({ status: 'error', message: 'Item not found' });
      if (!canAccessItem(row, actor, appName)) {
        return res.status(403).json({ status: 'error', message: 'No rights for this file' });
      }

      return res.json({
        status: 'success',
        data: {
          id: Number(row.id),
          file_name: String(row.file_name || ''),
          mime_type: String(row.mime_type || 'application/octet-stream'),
          file_base64: String(row.file_base64 || ''),
        },
      });
    } catch (error: any) {
      logger?.error('item-library/file failed', error);
      return res.status(500).json({ status: 'error', message: error?.message || 'Failed to load file' });
    }
  });

  router.post('/item-library/upsert', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ status: 'error', message: 'Authentication required' });
      await ensureItemLibraryTable(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor || Number(actor.role_rank) < ROLE_RANK.admin) {
        return res.status(403).json({ status: 'error', message: 'Admin access required' });
      }

      const body = req.body || {};
      const id = Number(body.id);
      const title = String(body.title || '').trim();
      if (!title) return res.status(400).json({ status: 'error', message: 'title is required' });

      const requestedKey = slugifyItemKey(body.item_key || title);
      if (!requestedKey) {
        return res.status(400).json({ status: 'error', message: 'item_key is invalid' });
      }

      const parsedFile = parseDataUrl(body.file_data_url);
      const rolesCsv = listToCsv(body.allowed_roles);
      const appsCsv = listToCsv(body.allowed_apps);

      let savedRow: Record<string, any> | null = null;

      if (Number.isFinite(id) && id > 0) {
        const existing = await database('admin_item_library').where('id', id).first();
        if (!existing) return res.status(404).json({ status: 'error', message: 'Item not found for update' });

        const keyConflict = await database('admin_item_library')
          .where('item_key', requestedKey)
          .whereNot('id', id)
          .first();
        if (keyConflict) {
          return res.status(409).json({ status: 'error', message: `Item key already exists: ${requestedKey}` });
        }

        await database('admin_item_library')
          .where('id', id)
          .update({
            item_key: requestedKey,
            title,
            description: String(body.description || '').trim() || null,
            file_name: parsedFile ? (String(body.file_name || '').trim() || existing.file_name) : existing.file_name,
            mime_type: parsedFile ? (String(body.mime_type || parsedFile.mimeType).trim() || parsedFile.mimeType) : existing.mime_type,
            file_base64: parsedFile ? parsedFile.base64 : existing.file_base64,
            allowed_roles_csv: rolesCsv,
            allowed_apps_csv: appsCsv,
            updated_by_email: actor.email || null,
            updated_at: new Date(),
          });

        savedRow = await database('admin_item_library').where('id', id).first();
      } else {
        if (!parsedFile) {
          return res.status(400).json({ status: 'error', message: 'file_data_url is required for new item' });
        }

        const existingKey = await database('admin_item_library').where('item_key', requestedKey).first();
        if (existingKey) {
          return res.status(409).json({ status: 'error', message: `Item key already exists: ${requestedKey}` });
        }

        const inserted = await database('admin_item_library')
          .insert({
            item_key: requestedKey,
            title,
            description: String(body.description || '').trim() || null,
            file_name: String(body.file_name || '').trim() || 'item.bin',
            mime_type: String(body.mime_type || parsedFile.mimeType).trim() || parsedFile.mimeType,
            file_base64: parsedFile.base64,
            allowed_roles_csv: rolesCsv,
            allowed_apps_csv: appsCsv,
            is_active: true,
            created_by_email: actor.email || null,
            updated_by_email: actor.email || null,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('*');

        savedRow = Array.isArray(inserted) ? inserted[0] : inserted;
      }

      const rows = await database('admin_item_library')
        .select('*')
        .where('is_active', true)
        .orderBy('updated_at', 'desc');

      return res.json({
        status: 'success',
        data: {
          item: savedRow ? mapLibraryRow(savedRow) : null,
          items: rows.map(mapLibraryRow),
        },
      });
    } catch (error: any) {
      logger?.error('item-library/upsert failed', error);
      return res.status(500).json({ status: 'error', message: error?.message || 'Failed to save item' });
    }
  });

  router.delete('/item-library/:id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ status: 'error', message: 'Authentication required' });
      await ensureItemLibraryTable(database);

      const actor = await getActorContext(database, String(req.accountability.user));
      if (!actor || Number(actor.role_rank) < ROLE_RANK.admin) {
        return res.status(403).json({ status: 'error', message: 'Admin access required' });
      }

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ status: 'error', message: 'Invalid item ID' });
      }

      const affected = await database('admin_item_library').where('id', id).update({
        is_active: false,
        updated_by_email: actor.email || null,
        updated_at: new Date(),
      });

      if (!affected) {
        return res.status(404).json({ status: 'error', message: 'Item not found' });
      }

      return res.json({ status: 'success', data: { id } });
    } catch (error: any) {
      logger?.error('item-library/delete failed', error);
      return res.status(500).json({ status: 'error', message: error?.message || 'Failed to delete item' });
    }
  });

  router.get('/tax-rates-live', async (req: any, res: any) => {
    try {
      const year = Number.parseInt(String(req.query?.year || ''), 10) || new Date().getFullYear();
      const rows = await database('tax_rates_live')
        .select('id', 'year', 'raw_category_label', 'category_code', 'band_from', 'band_to', 'rate', 'subtract')
        .where('year', '=', year)
        .orderBy('band_from', 'asc');

      return res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('tax-rates-live error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to load tax rates' });
    }
  });

  router.get('/ss-brackets', async (req: any, res: any) => {
    try {
      const year = Number.parseInt(String(req.query?.year || ''), 10) || new Date().getFullYear();
      const rows = await database('social_security_brackets')
        .select('id', 'year', 'band_from', 'band_to', 'employee_rate', 'employer_rate', 'notes')
        .where('year', '=', year)
        .orderBy('band_from', 'asc');

      return res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('ss-brackets error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to load social security brackets' });
    }
  });

  router.get('/ss-classes', async (req: any, res: any) => {
    try {
      const year = Number.parseInt(String(req.query?.year || ''), 10) || new Date().getFullYear();
      const rows = await database('social_security_classes')
        .select('*')
        .where('year', '=', year)
        .orderBy(['class_code', 'wage_from']);

      return res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('ss-classes error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to load social security classes' });
    }
  });

  router.post('/ss-class-for', async (req: any, res: any) => {
    try {
      const { weekly_wage, dob, year } = req.body || {};
      const wage = Number(weekly_wage);
      if (Number.isNaN(wage)) {
        return res.status(400).json({ status: 'error', message: 'weekly_wage is required and must be numeric' });
      }

      const parsedDob = dob ? new Date(dob) : null;
      if (dob && isNaN(parsedDob.getTime())) {
        return res.status(400).json({ status: 'error', message: 'dob must be a valid date (YYYY-MM-DD)' });
      }

      const qYear = Number.parseInt(String(year || ''), 10) || new Date().getFullYear();
      const rows = await database('social_security_classes').select('*').where('year', '=', qYear);

      const today = new Date();
      const age = parsedDob ? Math.floor((today.getTime() - parsedDob.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;

      const matches = rows.filter((r: any) => {
        const wf = Number(r.wage_from || 0);
        const wt = r.wage_to === null || r.wage_to === undefined ? Infinity : Number(r.wage_to);
        if (wage < wf || wage > wt) return false;

        if (r.dob_from || r.dob_to) {
          if (!parsedDob) return false;
          const df = r.dob_from ? new Date(r.dob_from) : null;
          const dt = r.dob_to ? new Date(r.dob_to) : null;
          if (df && parsedDob < df) return false;
          if (dt && parsedDob > dt) return false;
          return true;
        }

        if (r.min_age || r.max_age) {
          if (age === null) return false;
          if (r.min_age !== null && r.min_age !== undefined && age < Number(r.min_age)) return false;
          if (r.max_age !== null && r.max_age !== undefined && age > Number(r.max_age)) return false;
          return true;
        }

        return true;
      });

      // Prefer most specific match: DOB range > age range > generic
      const prefer = (m: any) => (m.dob_from || m.dob_to ? 3 : m.min_age || m.max_age ? 2 : 1);
      matches.sort((a: any, b: any) => prefer(b) - prefer(a));

      const chosen = matches[0];
      if (!chosen) return res.status(404).json({ status: 'error', message: 'No matching social security class found' });

      const computeContribution = (w: number, fixed: any, pct: any, cap: any) => {
        if (fixed !== null && fixed !== undefined) return Number(fixed);
        if (pct !== null && pct !== undefined) {
          const val = (Number(pct) / 100) * w;
          let result = val;
          if (cap !== null && cap !== undefined) result = Math.min(val, Number(cap));
          return roundSSNumeric(result);
        }
        return null;
      };

      const employeeContribution = computeContribution(wage, chosen.employee_fixed, chosen.employee_percentage, null);
      const employerContribution = computeContribution(wage, chosen.employer_fixed, chosen.employer_percentage, null);
      let mlf = computeContribution(wage, chosen.mlf_fixed, chosen.mlf_percentage, chosen.mlf_max);
      if (mlf !== null) mlf = roundSSNumeric(mlf);

      // Server-side validation: detect overlapping class definitions for this year
      const warnings: string[] = [];
      const intervalOverlap = (aFrom: number, aTo: number, bFrom: number, bTo: number) => {
        const Ato = aTo === null || aTo === undefined ? Infinity : aTo;
        const Bto = bTo === null || bTo === undefined ? Infinity : bTo;
        return Math.max(aFrom, bFrom) <= Math.min(Ato, Bto);
      };

      const cohortsOverlap = (a: any, b: any) => {
        // If either applies to all cohorts, assume overlap
        const aHasCohort = a.dob_from || a.dob_to || a.min_age || a.max_age;
        const bHasCohort = b.dob_from || b.dob_to || b.min_age || b.max_age;
        if (!aHasCohort || !bHasCohort) return true;

        // If both DOB ranges present
        if ((a.dob_from || a.dob_to) && (b.dob_from || b.dob_to)) {
          const aFrom = a.dob_from ? new Date(a.dob_from) : new Date('0001-01-01');
          const aTo = a.dob_to ? new Date(a.dob_to) : new Date('9999-12-31');
          const bFrom = b.dob_from ? new Date(b.dob_from) : new Date('0001-01-01');
          const bTo = b.dob_to ? new Date(b.dob_to) : new Date('9999-12-31');
          return aFrom <= bTo && bFrom <= aTo;
        }

        // If both age ranges present
        if ((a.min_age || a.max_age) && (b.min_age || b.max_age)) {
          const aMin = a.min_age === null || a.min_age === undefined ? 0 : Number(a.min_age);
          const aMax = a.max_age === null || a.max_age === undefined ? Infinity : Number(a.max_age);
          const bMin = b.min_age === null || b.min_age === undefined ? 0 : Number(b.min_age);
          const bMax = b.max_age === null || b.max_age === undefined ? Infinity : Number(b.max_age);
          return Math.max(aMin, bMin) <= Math.min(aMax, bMax);
        }

        // If mixed types (dob vs age), conservatively assume overlap
        return true;
      };

      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i];
          const b = rows[j];
          if (intervalOverlap(Number(a.wage_from || 0), a.wage_to === null ? null : Number(a.wage_to), Number(b.wage_from || 0), b.wage_to === null ? null : Number(b.wage_to)) && cohortsOverlap(a, b)) {
            warnings.push(`Overlapping classes detected: id=${a.id} (class ${a.class_code}) and id=${b.id} (class ${b.class_code})`);
          }
          // Basic validation
          if (a.wage_to !== null && a.wage_to !== undefined && Number(a.wage_from) > Number(a.wage_to)) {
            warnings.push(`Invalid wage range for id=${a.id}: wage_from > wage_to`);
          }
          if (b.wage_to !== null && b.wage_to !== undefined && Number(b.wage_from) > Number(b.wage_to)) {
            warnings.push(`Invalid wage range for id=${b.id}: wage_from > wage_to`);
          }
        }
      }

      return res.json({
        status: 'success',
        data: {
          class: chosen,
          computed: {
            weekly_wage: wage,
            employee: employeeContribution,
            employer: employerContribution,
            employer_mlf: mlf
          }
        },
        warnings: warnings.length ? Array.from(new Set(warnings)) : undefined
      });
    } catch (err) {
      logger?.error('ss-class-for error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to compute social security class' });
    }
  });

  router.get('/leave-policies', async (req: any, res: any) => {
    try {
      const year = Number.parseInt(String(req.query?.year || ''), 10) || new Date().getFullYear();
      const rows = await database('leave_policies as lp')
        .select(
          'lp.id',
          'lp.year',
          'lp.entitlement_hours',
          'lp.carry_forward_percent',
          'd.abbreviation as department_abbreviation',
          'd.name as department_name',
          'lt.code as leave_type_code',
          'lt.display_name as leave_type_name'
        )
        .leftJoin('departments as d', 'lp.dept_id', 'd.dept_id')
        .leftJoin('leave_types as lt', 'lp.leave_type_id', 'lt.id')
        .where('lp.year', '=', year)
        .orderBy(['d.abbreviation', 'lt.display_name']);

      return res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('leave-policies error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to load leave policies' });
    }
  });

  router.get('/cola-rates', async (req: any, res: any) => {
    try {
      const year = Number.parseInt(String(req.query?.year || ''), 10) || new Date().getFullYear();
      const rows = await database('cola_rates')
        .select('id', 'year', 'weekly_amount', 'standard_weekly_hours', 'hourly_amount', 'notes', 'created_at')
        .where('year', '=', year)
        .orderBy('year', 'desc');

      return res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('cola-rates error', err);
      return res.status(500).json({ status: 'error', message: 'Failed to load COLA rates' });
    }
  });
});
