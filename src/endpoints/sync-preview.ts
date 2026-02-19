import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import * as cheerio from 'cheerio';
import { randomUUID } from 'node:crypto';

type ParsedRate = {
  raw_category_label: string;
  category_code: string | null;
  band_from: number;
  band_to: number | null;
  rate: number;
  subtract: number;
};

type RawRate = {
  raw_category_label?: string;
  category_code?: string | null;
  band_from?: number | string | null;
  band_to?: number | string | null;
  rate?: number | string | null;
  subtract?: number | string | null;
  source_url?: string | null;
};

const CANONICAL_TAX_CODES = new Set(['sng', 'mar1', 'mar2', 'mar', 'par1', 'par2', 'par']);

const FALLBACK_CATEGORY_CODES: Record<string, string> = {
  singlerates: 'sng',
  single: 'sng',
  marriedrates1: 'mar1',
  marriedrate1: 'mar1',
  mar1: 'mar1',
  marriedrates2: 'mar2',
  marriedrate2: 'mar2',
  mar2: 'mar2',
  parentrates1: 'par1',
  parentrate1: 'par1',
  par1: 'par1',
  parentrates2: 'par2',
  parentrate2: 'par2',
  par2: 'par2',
  marriedrates: 'mar',
  marriedrate: 'mar',
  mar: 'mar',
  parentrates: 'par',
  parentrate: 'par',
  par: 'par'
};

const parseNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[%€,]/g, '').replace(/\s+/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

const parseRate = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = parseNumeric(trimmed);
  if (numeric === null) return null;
  if (trimmed.includes('%') || numeric > 1) return numeric / 100;
  return numeric;
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const normalizeLabel = (raw: string): string => {
  const text = raw.replace(/\s+/g, ' ').trim();
  const key = normalizeKey(text);
  if (/^married(rates?)?1$|^mar1$/.test(key) || (key.includes('married') && (key.includes('1child') || key.includes('onechild')))) {
    return 'Married Rates 1';
  }
  if (
    /^married(rates?)?2$|^mar2$/.test(key) ||
    (key.includes('married') &&
      (key.includes('2child') || key.includes('twochild') || key.includes('2children') || key.includes('twochildren')))
  ) {
    return 'Married Rates 2';
  }
  if (/^parent(rates?)?1$|^par1$/.test(key) || (key.includes('parent') && (key.includes('1child') || key.includes('onechild')))) {
    return 'Parent Rates 1';
  }
  if (
    /^parent(rates?)?2$|^par2$/.test(key) ||
    (key.includes('parent') &&
      (key.includes('2child') || key.includes('twochild') || key.includes('2children') || key.includes('twochildren')))
  ) {
    return 'Parent Rates 2';
  }
  if (/^single(rates?)?$|^sng$/.test(key)) return 'Single Rates';
  if (/^married(rates?)?$|^mar$/.test(key)) return 'Married Rates';
  if (/^parent(rates?)?$|^par$/.test(key)) return 'Parent Rates';
  return text;
};

const detectCategory = (text: string): string | null => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const key = normalizeKey(cleaned);
  if (
    key.includes('married') ||
    key.includes('parent') ||
    key.includes('single') ||
    key === 'mar1' ||
    key === 'mar2' ||
    key === 'par1' ||
    key === 'par2' ||
    key === 'sng'
  ) {
    return normalizeLabel(cleaned);
  }
  return null;
};

const parseRangeCell = (value: string): { from: number | null; to: number | null } | null => {
  const text = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return null;

  const hyphen = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:-|–|—|to)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (hyphen) {
    return {
      from: parseNumeric(hyphen[1]),
      to: parseNumeric(hyphen[2])
    };
  }

  const plus = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\+|and over|over|above)/i);
  if (plus) {
    return {
      from: parseNumeric(plus[1]),
      to: null
    };
  }

  return null;
};

const cleanCell = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const looksLikeHeader = (cells: string[]) => {
  const joined = cells.join(' ').toLowerCase();
  const matches = ['category', 'band', 'from', 'to', 'rate', 'tax', 'subtract', 'income'].filter((k) =>
    new RegExp(`\\b${k}\\b`, 'i').test(joined)
  );
  return matches.length >= 2;
};

const rowToRate = (cells: string[], currentCategory: string | null): Omit<ParsedRate, 'category_code'> | null => {
  if (!cells.length) return null;

  let category = currentCategory;
  let dataCells = [...cells];

  const firstCategory = detectCategory(dataCells[0]);
  if (firstCategory) {
    category = firstCategory;
    dataCells = dataCells.slice(1);
  }

  if (!category || dataCells.length < 2) return null;

  let bandFrom: number | null = null;
  let bandTo: number | null = null;

  const fromToRange = parseRangeCell(dataCells[0]);
  if (fromToRange) {
    bandFrom = fromToRange.from;
    bandTo = fromToRange.to;
    dataCells = dataCells.slice(1);
  } else if (dataCells.length >= 3) {
    bandFrom = parseNumeric(dataCells[0]);
    bandTo = parseNumeric(dataCells[1]);
    dataCells = dataCells.slice(2);
  }

  if (bandFrom === null) return null;

  const rate = parseRate(dataCells[0] || '');
  if (rate === null) return null;

  const subtract = parseNumeric(dataCells[1] || '0') ?? 0;

  return {
    raw_category_label: normalizeLabel(category),
    band_from: bandFrom,
    band_to: bandTo,
    rate,
    subtract
  };
};

const parseRatesFromHtml = (html: string): Omit<ParsedRate, 'category_code'>[] => {
  const $ = cheerio.load(html);
  const parsed: Omit<ParsedRate, 'category_code'>[] = [];

  $('table').each((_, table) => {
    let currentCategory: string | null = null;
    const heading = $(table).prevAll('h1,h2,h3,h4,strong,p').first().text();
    const headingCategory = detectCategory(cleanCell(heading));
    if (headingCategory) currentCategory = headingCategory;

    $(table)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .find('th,td')
          .toArray()
          .map((c) => cleanCell($(c).text()))
          .filter(Boolean);
        const hasHeaderCell = $(tr).find('th').length > 0;

        if (!cells.length) return;
        if (hasHeaderCell || looksLikeHeader(cells)) return;

        if (cells.length === 1) {
          const rowCategory = detectCategory(cells[0]);
          if (rowCategory) currentCategory = rowCategory;
          return;
        }

        const rate = rowToRate(cells, currentCategory);
        if (rate) parsed.push(rate);
      });
  });

  return parsed;
};

const fetchHtml = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': 'directus-tax-sync/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Source returned ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.post('/tax/source-check/:year', async (req: any, res: any) => {
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
      const defaultTemplate = process.env.MTCA_TAX_RATES_URL || '';
      const sourceUrl = (sourceUrlInput || defaultTemplate).replace('{year}', String(parsedYear));

      if (!sourceUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'Source URL is required. Set MTCA_TAX_RATES_URL or pass source_url in request body.'
        });
      }

      const html = await fetchHtml(sourceUrl);
      const parsedRows = parseRatesFromHtml(html);
      if (!parsedRows.length) {
        return res.status(422).json({
          status: 'error',
          message: 'Source fetch succeeded but parser detected no tax rows'
        });
      }

      const categories = Array.from(new Set(parsedRows.map((r) => r.raw_category_label)));

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
      logger.error('Tax source check failed:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Tax source check failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/tax/sync-preview/:year', async (req: any, res: any) => {
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
      const defaultTemplate = process.env.MTCA_TAX_RATES_URL || '';
      const sourceUrl = (sourceUrlInput || defaultTemplate).replace('{year}', String(parsedYear));

      let sourceRates: RawRate[] = [];
      let sourceType = 'payload';

      if (Array.isArray(req.body?.rates) && req.body.rates.length > 0) {
        sourceRates = req.body.rates as RawRate[];
      } else if (sourceUrl) {
        try {
          sourceType = 'mtca_fetch';
          const html = await fetchHtml(sourceUrl);
          const parsed = parseRatesFromHtml(html);
          if (!parsed.length) {
            return res.status(422).json({
              status: 'error',
              message: 'No tax rows detected in source page. Verify URL/parser assumptions.'
            });
          }
          sourceRates = parsed.map((r) => ({ ...r, source_url: sourceUrl }));
        } catch (fetchError) {
          if (!sourceHtmlInput) throw fetchError;
          sourceType = 'source_html_fallback';
          const parsed = parseRatesFromHtml(sourceHtmlInput);
          if (!parsed.length) {
            return res.status(422).json({
              status: 'error',
              message: 'URL fetch failed and no valid tax rows detected in source_html fallback'
            });
          }
          sourceRates = parsed.map((r) => ({ ...r, source_url: sourceUrl || 'source_html' }));
        }
      } else if (sourceHtmlInput) {
        sourceType = 'source_html';
        const parsed = parseRatesFromHtml(sourceHtmlInput);
        if (!parsed.length) {
          return res.status(422).json({
            status: 'error',
            message: 'No tax rows detected in source_html payload'
          });
        }
        sourceRates = parsed.map((r) => ({ ...r, source_url: sourceUrl || 'source_html' }));
      } else {
        sourceType = 'live_snapshot';
        const liveRows = await database('tax_rates_live')
          .select('raw_category_label', 'category_code', 'band_from', 'band_to', 'rate', 'subtract', 'source_url')
          .where('year', '=', parsedYear);

        sourceRates = liveRows.map((row: any) => ({
          raw_category_label: row.raw_category_label || row.category_code,
          category_code: row.category_code,
          band_from: row.band_from,
          band_to: row.band_to,
          rate: row.rate,
          subtract: row.subtract,
          source_url: row.source_url
        }));
      }

      const categoryMap = new Map<string, string>();
      try {
        const mapRows = await database('tax_category_map')
          .select('raw_category_label', 'category_code')
          .where('enabled', '=', true);
        for (const row of mapRows) {
          if (row.raw_category_label && row.category_code) {
            categoryMap.set(normalizeKey(row.raw_category_label), row.category_code);
          }
        }
      } catch (mapError) {
        logger.warn('tax_category_map unavailable, using built-in mapping only');
        logger.warn(mapError);
      }

      const batchId = randomUUID();

      const stagedRows = sourceRates
        .map((rate) => {
          const rawLabel = normalizeLabel(String(rate.raw_category_label || '').trim() || 'unknown');
          const key = normalizeKey(rawLabel);
          const candidateCode = categoryMap.get(key) || FALLBACK_CATEGORY_CODES[key] || rate.category_code || null;
          const categoryCode = candidateCode && CANONICAL_TAX_CODES.has(candidateCode) ? candidateCode : null;
          const bandFrom = parseNumeric(rate.band_from);
          const parsedRate = parseRate(String(rate.rate ?? ''));
          if (bandFrom === null || parsedRate === null) return null;

          return {
            batch_id: batchId,
            year: parsedYear,
            raw_category_label: rawLabel,
            category_code: categoryCode,
            band_from: bandFrom,
            band_to: parseNumeric(rate.band_to),
            rate: parsedRate,
            subtract: parseNumeric(rate.subtract) ?? 0,
            status: 'draft',
            source_url: rate.source_url || sourceUrl || null,
            date_created: new Date()
          };
        })
        .filter(Boolean);

      if (!stagedRows.length) {
        return res.status(422).json({
          status: 'error',
          message: 'No valid rows found after parsing and normalization'
        });
      }

      await database('tax_rates_import').insert(stagedRows);

      const unknownCategories = Array.from(
        new Set(stagedRows.filter((r: any) => !r.category_code).map((r: any) => r.raw_category_label))
      );

      const preview = {
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
      };

      res.json({ status: 'success', data: preview });
    } catch (error) {
      logger.error('Sync preview error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to generate preview',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
});
