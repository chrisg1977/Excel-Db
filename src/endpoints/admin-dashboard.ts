import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import { roundSSNumeric } from '../utils/rounding';

export default defineEndpoint((router: Router, { database, logger }: any) => {
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
