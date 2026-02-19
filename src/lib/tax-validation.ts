/**
 * Tax Rate Validation Library
 * 
 * Pre-publish validation checks for:
 * - Duplicate bands (same category + band_from + band_to)
 * - Overlapping ranges (same category with conflicting bands)
 * - Missing required bands (ensure all required categories have at least one band)
 * - Year consistency (all records have same year)
 */

export type ValidationError = {
  type: 'duplicate_band' | 'overlapping_range' | 'missing_category' | 'year_mismatch' | 'invalid_band_range' | 'missing_required_code';
  message: string;
  details?: any;
};

export type TaxRecord = {
  year: number;
  category_code: string | null;
  raw_category_label: string;
  band_from: number;
  band_to: number | null;
  rate: number;
  subtract: number;
  source_url?: string;
};

const REQUIRED_CATEGORY_CODES = new Set(['sng', 'mar1', 'mar2', 'par1', 'par2']);

/**
 * Check for duplicate bands within same category
 * Same category cannot have identical band_from + band_to combinations
 */
export const validateNoDuplicateBands = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const bandMap = new Map<string, Set<string>>();

  for (const record of records) {
    if (!record.category_code) continue;

    const key = `${record.category_code}`;
    const bandKey = `${record.band_from}-${record.band_to ?? 'unbounded'}`;
    
    if (!bandMap.has(key)) {
      bandMap.set(key, new Set<string>());
    }

    const bands = bandMap.get(key)!;
    if (bands.has(bandKey)) {
      errors.push({
        type: 'duplicate_band',
        message: `Duplicate band for category ${record.category_code}: €${record.band_from} - ${record.band_to ? `€${record.band_to}` : 'unbounded'}`,
        details: {
          category_code: record.category_code,
          band_from: record.band_from,
          band_to: record.band_to
        }
      });
    } else {
      bands.add(bandKey);
    }
  }

  return errors;
};

/**
 * Check for overlapping bands within same category
 * Two bands with same category cannot partially overlap
 * Example: [0-10000] and [8000-15000] -> overlapping
 */
export const validateNoOverlappingRanges = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const categorized = new Map<string, TaxRecord[]>();

  // Group by category
  for (const record of records) {
    if (!record.category_code) continue;
    if (!categorized.has(record.category_code)) {
      categorized.set(record.category_code, []);
    }
    categorized.get(record.category_code)!.push(record);
  }

  // Check each category for overlaps
  for (const [categoryCode, categoryRecords] of categorized) {
    for (let i = 0; i < categoryRecords.length; i++) {
      for (let j = i + 1; j < categoryRecords.length; j++) {
        const r1 = categoryRecords[i];
        const r2 = categoryRecords[j];

        // Check if ranges overlap
        const r1End = r1.band_to ?? Infinity;
        const r2End = r2.band_to ?? Infinity;

        // Overlap occurs if:
        // r1.band_from <= r2.band_from <= r1End  OR
        // r2.band_from <= r1.band_from <= r2End
        const overlap =
          (r1.band_from <= r2.band_from && r2.band_from < r1End) ||
          (r2.band_from <= r1.band_from && r1.band_from < r2End);

        if (overlap) {
          errors.push({
            type: 'overlapping_range',
            message: `Overlapping bands for category ${categoryCode}: €${r1.band_from}-${r1.band_to ?? 'unbounded'} overlaps with €${r2.band_from}-${r2.band_to ?? 'unbounded'}`,
            details: {
              category_code: categoryCode,
              band1: { from: r1.band_from, to: r1.band_to },
              band2: { from: r2.band_from, to: r2.band_to }
            }
          });
        }
      }
    }
  }

  return errors;
};

/**
 * Check that all required tax categories are present
 * Malta requires: Single, Married rates 1 & 2, Parent rates 1 & 2 (sng, mar1, mar2, par1, par2)
 */
export const validateAllRequiredCategories = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const presentCategories = new Set(
    records
      .map((r) => r.category_code)
      .filter((c) => c !== null) as string[]
  );

  for (const required of REQUIRED_CATEGORY_CODES) {
    if (!presentCategories.has(required)) {
      const categoryNames: Record<string, string> = {
        sng: 'Single Rates',
        mar1: 'Married Rates 1',
        mar2: 'Married Rates 2',
        par1: 'Parent Rates 1',
        par2: 'Parent Rates 2'
      };

      errors.push({
        type: 'missing_category',
        message: `Missing required tax category: ${categoryNames[required]} (${required})`,
        details: { missing_code: required }
      });
    }
  }

  return errors;
};

/**
 * Check year consistency - all records in batch must have same year
 */
export const validateYearConsistency = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const years = new Set(records.map((r) => r.year));

  if (years.size > 1) {
    errors.push({
      type: 'year_mismatch',
      message: `Year mismatch: batch contains records for multiple years: ${Array.from(years).join(', ')}`,
      details: { years: Array.from(years) }
    });
  }

  return errors;
};

/**
 * Check band ranges are valid
 * - band_from should be >= 0
 * - band_to should be > band_from (if present)
 * - band_to = null means "unbounded" (to infinity)
 */
export const validateBandRanges = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const record of records) {
    if (record.band_from < 0) {
      errors.push({
        type: 'invalid_band_range',
        message: `Invalid band_from: ${record.band_from} (must be >= 0)`,
        details: { category: record.category_code, band_from: record.band_from }
      });
    }

    if (record.band_to !== null && record.band_to !== undefined) {
      if (record.band_to <= record.band_from) {
        errors.push({
          type: 'invalid_band_range',
          message: `Invalid band range for ${record.category_code}: band_to (${record.band_to}) must be > band_from (${record.band_from})`,
          details: {
            category: record.category_code,
            band_from: record.band_from,
            band_to: record.band_to
          }
        });
      }
    }
  }

  return errors;
};

/**
 * Check that all mapped categories are canonical (not null)
 */
export const validateMappedCategories = (records: TaxRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const unmapped = records.filter((r) => !r.category_code);

  if (unmapped.length > 0) {
    const unmappedLabels = Array.from(new Set(unmapped.map((r) => r.raw_category_label)));
    errors.push({
      type: 'missing_required_code',
      message: `${unmapped.length} record(s) with unmapped category codes: ${unmappedLabels.join(', ')}`,
      details: { count: unmapped.length, labels: unmappedLabels }
    });
  }

  return errors;
};

/**
 * Run all validations and return combined results
 */
export const validateTaxRatesBatch = (records: TaxRecord[]): ValidationError[] => {
  if (!records || records.length === 0) {
    return [
      {
        type: 'invalid_band_range',
        message: 'No records to validate'
      }
    ];
  }

  const allErrors: ValidationError[] = [];

  // Run all validation checks
  allErrors.push(...validateYearConsistency(records));
  allErrors.push(...validateMappedCategories(records));
  allErrors.push(...validateBandRanges(records));
  allErrors.push(...validateNoDuplicateBands(records));
  allErrors.push(...validateNoOverlappingRanges(records));
  allErrors.push(...validateAllRequiredCategories(records));

  return allErrors;
};

/**
 * Summary of validation results
 */
export type ValidationSummary = {
  isValid: boolean;
  totalErrors: number;
  errorsByType: Record<string, number>;
  errors: ValidationError[];
};

/**
 * Get validation summary
 */
export const getValidationSummary = (errors: ValidationError[]): ValidationSummary => {
  const errorsByType: Record<string, number> = {};

  for (const error of errors) {
    errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1;
  }

  return {
    isValid: errors.length === 0,
    totalErrors: errors.length,
    errorsByType,
    errors
  };
};
