import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

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

const asDate = (value: unknown): string | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
};

const asMoney = (value: unknown): number | null => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num * 100) / 100;
  return rounded >= 0 ? rounded : null;
};

const asAge = (value: unknown): number | null => {
  const num = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
};

async function getActor(database: any, userId: string) {
  const row = await database
    .withSchema('directus')
    .from('directus_users as u')
    .leftJoin('directus_roles as r', 'u.role', 'r.id')
    .select('u.id', 'u.email', 'r.name as role_name')
    .where('u.id', userId)
    .first();

  return {
    id: String(row?.id || '').trim(),
    email: String(row?.email || '').trim().toLowerCase(),
    roleName: String(row?.role_name || '').trim(),
    roleRank: normalizeRoleRank(row?.role_name),
  };
}

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.get('/ecotax-settings/current', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ error: 'Unauthorized' });

      const actor = await getActor(database, String(req.accountability.user));
      if (actor.roleRank < ROLE_RANK.management) {
        return res.status(403).json({ error: 'Ecotax settings require management role or above.' });
      }

      const current = await database('ecotax_rates')
        .select('*')
        .where('is_active', true)
        .orderBy('effective_from', 'desc')
        .orderBy('id', 'desc')
        .first();

      const previous = await database('ecotax_rates')
        .select('id', 'rate_per_night', 'charge_age_from', 'max_fee', 'effective_from', 'previous_rate_valid_until', 'created_at')
        .orderBy('effective_from', 'desc')
        .orderBy('id', 'desc')
        .limit(10);

      return res.json({
        ok: true,
        current: current || null,
        recent: previous || [],
        actor: {
          id: actor.id,
          email: actor.email,
          role_name: actor.roleName,
          role_rank: actor.roleRank,
        },
      });
    } catch (error) {
      logger.error(error);
      return res.status(500).json({ error: 'Failed to load ecotax settings.' });
    }
  });

  router.post('/ecotax-settings/current', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ error: 'Unauthorized' });

      const actor = await getActor(database, String(req.accountability.user));
      if (actor.roleRank < ROLE_RANK.management) {
        return res.status(403).json({ error: 'Ecotax settings require management role or above.' });
      }

      const ratePerNight = asMoney(req.body?.rate_per_night);
      const chargeAgeFrom = asAge(req.body?.charge_age_from);
      const maxFee = asMoney(req.body?.max_fee);
      const effectiveFrom = asDate(req.body?.effective_from);
      const previousRateValidUntil = req.body?.previous_rate_valid_until ? asDate(req.body?.previous_rate_valid_until) : null;
      const notes = String(req.body?.notes || '').trim() || null;

      if (ratePerNight === null || chargeAgeFrom === null || maxFee === null || !effectiveFrom) {
        return res.status(400).json({
          error: 'Missing or invalid required fields. Required: rate_per_night, charge_age_from, max_fee, effective_from.',
        });
      }

      if (previousRateValidUntil && previousRateValidUntil >= effectiveFrom) {
        return res.status(400).json({
          error: 'previous_rate_valid_until must be before effective_from.',
        });
      }

      await database.transaction(async (trx: any) => {
        await trx('ecotax_rates').where('is_active', true).update({
          is_active: false,
          updated_by_user_id: actor.id || null,
          updated_by_email: actor.email || null,
          updated_at: trx.fn.now(),
        });

        await trx('ecotax_rates').insert({
          rate_per_night: ratePerNight,
          charge_age_from: chargeAgeFrom,
          max_fee: maxFee,
          effective_from: effectiveFrom,
          previous_rate_valid_until: previousRateValidUntil,
          notes,
          is_active: true,
          created_by_user_id: actor.id || null,
          created_by_email: actor.email || null,
          updated_by_user_id: actor.id || null,
          updated_by_email: actor.email || null,
        });
      });

      const saved = await database('ecotax_rates')
        .select('*')
        .where('is_active', true)
        .orderBy('effective_from', 'desc')
        .orderBy('id', 'desc')
        .first();

      return res.json({ ok: true, current: saved || null });
    } catch (error) {
      logger.error(error);
      return res.status(500).json({ error: 'Failed to save ecotax settings.' });
    }
  });
});
