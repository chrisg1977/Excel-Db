import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import * as cheerio from 'cheerio';
import { randomUUID } from 'node:crypto';

type RawSsRate = {
  raw_category_label?: string;
  category_code?: string | null;
  band_from?: number | string | null;
  band_to?: number | string | null;
  employee_rate?: number | string | null;
  employer_rate?: number | string | null;
  total_rate?: number | string | null;
  employee_amount?: number | string | null;
  employer_amount?: number | string | null;
  total_amount?: number | string | null;
  source_url?: string | null;
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanCell = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const parseNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[%â‚¬,]/g, '').replace(/\s+/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

const parseRate = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const numeric = parseNumeric(text);
  if (numeric === null) return null;
  if (text.includes('%') || numeric > 1) return numeric / 100;
  return numeric;
};

const parseRange = (value: string): { from: number | null; to: number | null } | null => {
  const text = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return null;

  const between = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:-|â€“|â€”|to)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (between) {
    return {
      from: parseNumeric(between[1]),
      to: parseNumeric(between[2])
    };
  }

  const openEnded = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\+|and over|over|above)/i);
  if (openEnded) {
    return {
      from: parseNumeric(openEnded[1]),
      to: null
    };
  }

  return null;
};

const looksLikeHeader = (cells: string[]) => {
  const joined = cells.join(' ').toLowerCase();
  const keys = ['class', 'category', 'contribution', 'employee', 'employer', 'weekly', 'from', 'to', 'rate'];
  return keys.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(joined)).length >= 2;
};

const parseRatesFromHtml = (html: string): RawSsRate[] => {
  const $ = cheerio.load(html);
  const out: RawSsRate[] = [];

  $('table').each((_, table) => {
    let currentCategory = cleanCell($(table).prevAll('h1,h2,h3,h4,strong,p').first().text());

    $(table)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .find('th,td')
          .toArray()
          .map((c) => cleanCell($(c).text()))
          .filter(Boolean);

        const hasHeaderCell = $(tr).find('th').length > 0;
        if (!cells.length || hasHeaderCell || looksLikeHeader(cells)) return;

        if (cells.length === 1) {
          currentCategory = cells[0];
          return;
        }

        let rawLabel = currentCategory || cells[0];
        let index = 0;
        if (cells[0] && !parseRange(cells[0]) && parseNumeric(cells[0]) === null && !cells[0].includes('%')) {
          rawLabel = cells[0];
          index = 1;
        }

        let bandFrom: number | null = null;
        let bandTo: number | null = null;

        const parsedRange = parseRange(cells[index] || '');
        if (parsedRange) {
          bandFrom = parsedRange.from;
          bandTo = parsedRange.to;
          index += 1;
        } else {
          const maybeFrom = parseNumeric(cells[index]);
          const maybeTo = parseNumeric(cells[index + 1]);
          if (maybeFrom !== null && maybeTo !== null) {
            bandFrom = maybeFrom;
            bandTo = maybeTo;
            index += 2;
          }
        }

        const rest = cells.slice(index);
        const rateValues = rest.filter((c) => c.includes('%')).map((c) => parseRate(c)).filter((n) => n !== null) as number[];
        const numValues = rest
          .filter((c) => !c.includes('%'))
          .map((c) => parseNumeric(c))
          .filter((n) => n !== null) as number[];

        out.push({
          raw_category_label: rawLabel || 'unknown',
          band_from: bandFrom,
          band_to: bandTo,
          employee_rate: rateValues[0] ?? null,
          employer_rate: rateValues[1] ?? null,
          total_rate: rateValues[2] ?? null,
          employee_amount: numValues[0] ?? null,
          employer_amount: numValues[1] ?? null,
          total_amount: numValues[2] ?? null
        });
      });
  });

  return out;
};

const fetchHtml = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': 'directus-social-security-sync/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.post('/ss/source-check/:year', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required'
        });
      }

      const parsedYear = Number.parseInt(req.params.year, 10);
      if (Number.isNaN(parsedYear)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid year parameter'
        });
      }

      const sourceUrlInput = typeof req.body?.source_url === 'string' ? req.body.source_url.trim() : '';
      const defaultTemplate =
        process.env.SOCIAL_SECURITY_CLASS1_URL ||
        'https://socialsecurity.gov.mt/en/information-and-applications-for-benefits-and-services/social-security-contributions/social-security-contributions-class-1-{year}/';
      const sourceUrl = (sourceUrlInput || defaultTemplate).replace('{year}', String(parsedYear));

      const html = await fetchHtml(sourceUrl);
      const parsedRows = parseRatesFromHtml(html);
      if (!parsedRows.length) {
        return res.status(422).json({
          status: 'error',
          message: 'Source fetch succeeded but parser detected no social security rows'
        });
      }

      const categories = Array.from(new Set(parsedRows.map((r) => r.raw_category_label || 'unknown')));

      return res.json({
        status: 'success',
        data: {
          year: parsedYear,
          sourceUrl,
          rowsDetected: parsedRows.length,
          categoriesDetected: categories,
          checkedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Social security source check failed:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Social security source check failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/ss/sync-preview/:year', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required'
        });
      }

      const parsedYear = Number.parseInt(req.params.year, 10);
      if (Number.isNaN(parsedYear)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid year parameter'
        });
      }

      const sourceUrlInput = typeof req.body?.source_url === 'string' ? req.body.source_url.trim() : '';
      const sourceHtmlInput = typeof req.body?.source_html === 'string' ? req.body.source_html.trim() : '';
      const defaultTemplate =
        process.env.SOCIAL_SECURITY_CLASS1_URL ||
        'https://socialsecurity.gov.mt/en/information-and-applications-for-benefits-and-services/social-security-contributions/social-security-contributions-class-1-{year}/';
      const sourceUrl = (sourceUrlInput || defaultTemplate).replace('{year}', String(parsedYear));

      let sourceRows: RawSsRate[] = [];
      let sourceType = 'payload';

      if (Array.isArray(req.body?.rates) && req.body.rates.length > 0) {
        sourceRows = req.body.rates as RawSsRate[];
      } else if (sourceUrl) {
        try {
          sourceType = 'ss_fetch';
          const html = await fetchHtml(sourceUrl);
          sourceRows = parseRatesFromHtml(html).map((r) => ({ ...r, source_url: sourceUrl }));
        } catch (fetchError) {
          if (!sourceHtmlInput) throw fetchError;
          sourceType = 'source_html_fallback';
          sourceRows = parseRatesFromHtml(sourceHtmlInput).map((r) => ({ ...r, source_url: sourceUrl || 'source_html' }));
        }
      } else if (sourceHtmlInput) {
        sourceType = 'source_html';
        sourceRows = parseRatesFromHtml(sourceHtmlInput).map((r) => ({ ...r, source_url: sourceUrl || 'source_html' }));
      } else {
        sourceType = 'live_snapshot';
        const liveRows = await database('social_security_rates_live').where('year', '=', parsedYear);
        sourceRows = liveRows.map((r: any) => ({
          raw_category_label: r.raw_category_label || r.category_code,
          category_code: r.category_code,
          band_from: r.band_from,
          band_to: r.band_to,
          employee_rate: r.employee_rate,
          employer_rate: r.employer_rate,
          total_rate: r.total_rate,
          employee_amount: r.employee_amount,
          employer_amount: r.employer_amount,
          total_amount: r.total_amount,
          source_url: r.source_url
        }));
      }

      if (!sourceRows.length) {
        return res.status(422).json({
          status: 'error',
          message: 'No social security rows detected in source'
        });
      }

      const categoryMap = new Map<string, string>();
      try {
        const mapRows = await database('social_security_category_map')
          .select('raw_category_label', 'category_code')
          .where('enabled', '=', true);
        for (const row of mapRows) {
          if (row.raw_category_label && row.category_code) {
            categoryMap.set(normalizeKey(row.raw_category_label), row.category_code);
          }
        }
      } catch (err) {
        logger.warn('social_security_category_map unavailable, using raw labels only');
        logger.warn(err);
      }

      const batchId = randomUUID();

      const stagedRows = sourceRows
        .map((row) => {
          const rawLabel = cleanCell(String(row.raw_category_label || 'unknown'));
          const categoryCode = categoryMap.get(normalizeKey(rawLabel)) || row.category_code || null;
          const bandFrom = parseNumeric(row.band_from);
          const employeeRate = parseRate(row.employee_rate);
          const employerRate = parseRate(row.employer_rate);
          const totalRate = parseRate(row.total_rate);
          const employeeAmount = parseNumeric(row.employee_amount);
          const employerAmount = parseNumeric(row.employer_amount);
          const totalAmount = parseNumeric(row.total_amount);

          if (
            bandFrom === null &&
            employeeRate === null &&
            employerRate === null &&
            totalRate === null &&
            employeeAmount === null &&
            employerAmount === null &&
            totalAmount === null
          ) {
            return null;
          }

          return {
            batch_id: batchId,
            year: parsedYear,
            raw_category_label: rawLabel,
            category_code: categoryCode,
            band_from: bandFrom,
            band_to: parseNumeric(row.band_to),
            employee_rate: employeeRate,
            employer_rate: employerRate,
            total_rate: totalRate,
            employee_amount: employeeAmount,
            employer_amount: employerAmount,
            total_amount: totalAmount,
            status: 'draft',
            source_url: row.source_url || sourceUrl || null,
            date_created: new Date()
          };
        })
        .filter(Boolean);

      if (!stagedRows.length) {
        return res.status(422).json({
          status: 'error',
          message: 'No valid social security rows found after normalization'
        });
      }

      await database('social_security_rates_import').insert(stagedRows);

      const unknownCategories = Array.from(
        new Set(stagedRows.filter((r: any) => !r.category_code).map((r: any) => r.raw_category_label))
      );

      return res.json({
        status: 'success',
        data: {
          batchId,
          year: parsedYear,
          sourceType,
          sourceUrl: sourceUrl || null,
          timestamp: new Date().toISOString(),
          summary: {
            rowsInserted: stagedRows.length,
            mappedRows: stagedRows.length - stagedRows.filter((r: any) => !r.category_code).length,
            unknownCategoryCount: unknownCategories.length
          },
          unknownCategories,
          sampleData: stagedRows.slice(0, 10)
        }
      });
    } catch (error) {
      logger.error('Social security preview error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to generate social security preview',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
});
