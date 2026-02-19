/**
 * Social Security Rate Validation Library
 * 
 * Pre-publish validation checks for:
 * - Duplicate class codes (each class code should appear once per year)
 * - Missing required fields
 * - Year consistency
 * - Rate range validity
 */

export type ValidationError = {
  type: 'duplicate_class' | 'missing_required_field' | 'year_mismatch' | 'invalid_rate' | 'invalid_cap' | 'missing_required_class';
  message: string;
  details?: any;
};

export type SSRecord = {
  year: number;
  class_code: string;
  class_name: string;
  employee_percentage?: number;
  employee_fixed?: number;
  employer_percentage?: number;
  employer_fixed?: number;
  mlf_percentage?: number;
  mlf_fixed?: number;
  mlf_max?: number;
  lower_earnings_limit?: number;
  upper_earnings_limit?: number;
  source_url?: string;
};

// Required SS classes in Malta
const REQUIRED_SS_CLASSES = new Set(['EMP', 'SELF', 'APP']);

/**
 * Check for duplicate class codes within batch
 * Each class code should appear only once per year
 */
export const validateNoDuplicateClasses = (records: SSRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const classMap = new Map<string, number>();

  for (const record of records) {
    const key = `${record.year}-${record.class_code}`;
    classMap.set(key, (classMap.get(key) ?? 0) + 1);
  }

  for (const [key, count] of classMap) {
    if (count > 1) {
      const [year, classCode] = key.split('-');
      errors.push({
        type: 'duplicate_class',
        message: `Duplicate class code: ${classCode} appears ${count} times for year ${year}`,
        details: { class_code: classCode, year: parseInt(year), count }
      });
    }
  }

  return errors;
};

/**
 * Check year consistency - all records in batch must have same year
 */
export const validateYearConsistency = (records: SSRecord[]): ValidationError[] => {
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
 * Check that rates are valid numbers between 0 and 100 (for percentages)
 */
export const validateRateRanges = (records: SSRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const record of records) {
    const percentageFields = [
      'employee_percentage',
      'employer_percentage',
      'mlf_percentage'
    ] as const;

    for (const field of percentageFields) {
      const value = record[field];
      if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || value < 0 || value > 100) {
          errors.push({
            type: 'invalid_rate',
            message: `Invalid ${field} for class ${record.class_code}: ${value} (must be between 0-100)`,
            details: {
              class_code: record.class_code,
              field,
              value
            }
          });
        }
      }
    }

    // Check that either percentage or fixed amount is defined (not both, not neither)
    const hasEmpPercentage = record.employee_percentage !== undefined && record.employee_percentage !== null;
    const hasEmpFixed = record.employee_fixed !== undefined && record.employee_fixed !== null;

    if (!hasEmpPercentage && !hasEmpFixed) {
      errors.push({
        type: 'missing_required_field',
        message: `Class ${record.class_code}: must have either employee_percentage or employee_fixed`,
        details: { class_code: record.class_code }
      });
    }

    const hasEmpPercentageOrFixed = hasEmpPercentage || hasEmpFixed;
    const hasEmployerPercentage = record.employer_percentage !== undefined && record.employer_percentage !== null;
    const hasEmployerFixed = record.employer_fixed !== undefined && record.employer_fixed !== null;

    if (hasEmpPercentageOrFixed && !hasEmployerPercentage && !hasEmployerFixed) {
      errors.push({
        type: 'missing_required_field',
        message: `Class ${record.class_code}: must have employer_percentage or employer_fixed when employee contributions exist`,
        details: { class_code: record.class_code }
      });
    }
  }

  return errors;
};

/**
 * Check MLF contribution caps
 * mlf_max should be greater than 0 if specified
 */
export const validateMLFCaps = (records: SSRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const record of records) {
    if (record.mlf_max !== undefined && record.mlf_max !== null) {
      if (record.mlf_max < 0) {
        errors.push({
          type: 'invalid_cap',
          message: `Invalid mlf_max for class ${record.class_code}: ${record.mlf_max} (must be >= 0)`,
          details: {
            class_code: record.class_code,
            mlf_max: record.mlf_max
          }
        });
      }
    }
  }

  return errors;
};

/**
 * Check earnings limits are reasonable
 * lower_earnings_limit < upper_earnings_limit if both specified
 */
export const validateEarningsLimits = (records: SSRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const record of records) {
    const hasLower = record.lower_earnings_limit !== undefined && record.lower_earnings_limit !== null;
    const hasUpper = record.upper_earnings_limit !== undefined && record.upper_earnings_limit !== null;

    if (hasLower && hasUpper) {
      if (record.lower_earnings_limit! >= record.upper_earnings_limit!) {
        errors.push({
          type: 'invalid_rate',
          message: `Class ${record.class_code}: lower_earnings_limit (${record.lower_earnings_limit}) must be < upper_earnings_limit (${record.upper_earnings_limit})`,
          details: {
            class_code: record.class_code,
            lower: record.lower_earnings_limit,
            upper: record.upper_earnings_limit
          }
        });
      }
    }

    if (hasLower && record.lower_earnings_limit! < 0) {
      errors.push({
        type: 'invalid_rate',
        message: `Class ${record.class_code}: lower_earnings_limit must be >= 0`,
        details: {
          class_code: record.class_code,
          value: record.lower_earnings_limit
        }
      });
    }
  }

  return errors;
};

/**
 * Check all required classes are present
 */
export const validateAllRequiredClasses = (records: SSRecord[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  const presentClasses = new Set(records.map((r) => r.class_code));

  for (const required of REQUIRED_SS_CLASSES) {
    if (!presentClasses.has(required)) {
      const classNames: Record<string, string> = {
        EMP: 'Employee',
        SELF: 'Self-Employed',
        APP: 'Apprentice'
      };

      errors.push({
        type: 'missing_required_class',
        message: `Missing required SS class: ${classNames[required]} (${required})`,
        details: { missing_code: required }
      });
    }
  }

  return errors;
};

/**
 * Run all validations and return combined results
 */
export const validateSSRatesBatch = (records: SSRecord[]): ValidationError[] => {
  if (!records || records.length === 0) {
    return [
      {
        type: 'missing_required_field',
        message: 'No records to validate'
      }
    ];
  }

  const allErrors: ValidationError[] = [];

  // Run all validation checks
  allErrors.push(...validateYearConsistency(records));
  allErrors.push(...validateNoDuplicateClasses(records));
  allErrors.push(...validateRateRanges(records));
  allErrors.push(...validateMLFCaps(records));
  allErrors.push(...validateEarningsLimits(records));
  allErrors.push(...validateAllRequiredClasses(records));

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
