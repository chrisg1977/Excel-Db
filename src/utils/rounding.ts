/**
 * Rounding utilities for consistent contribution calculations
 * Critical: All queries (SQL, endpoint, UI) must use the same rounding rules
 * to ensure no discrepancies (e.g., 19.00 must always be 19.00, never 19.01)
 */

/**
 * Round social security and MLF contributions to nearest cent (2 decimal places)
 * @param value The value to round
 * @returns Rounded value as string with 2 decimal places, or null if input is null/undefined
 */
export function roundSocialSecurity(value: any): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return Number(num.toFixed(2)).toString();
}

/**
 * Round tax contributions down to euro (0 decimal places)
 * Always rounds DOWN, never up (e.g., 19.9 -> 19, not 20)
 * @param value The value to round
 * @returns Rounded value as string with no decimal places, or null if input is null/undefined
 */
export function roundTax(value: any): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return Math.floor(num).toString();
}

/**
 * Return numeric value rounded to cents (for comparisons and calculations)
 * @param value The value to round
 * @returns Numeric value rounded to 2 decimal places, or null
 */
export function roundSSNumeric(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Return numeric value rounded down to euros (for comparisons and calculations)
 * Always rounds DOWN, never up (e.g., 19.9 -> 19, not 20)
 * @param value The value to round
 * @returns Numeric value rounded down to nearest integer, or null
 */
export function roundTaxNumeric(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return Math.floor(num);
}
