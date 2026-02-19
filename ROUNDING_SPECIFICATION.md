# Rounding Consistency Specification

## Overview
This document defines the rounding rules for all contribution calculations across the system (SQL, TypeScript endpoints, and UI). **Critical requirement:** If one query returns 19.00, all must return 19.00 (never 19.01).

## Rounding Rules

### Social Security & Maternity Leave Fund (MLF)
- **Rule**: Round to **nearest cent (2 decimal places)**
- **SQL**: `ROUND(value, 2)`
- **TypeScript**: `roundSSNumeric(value)` or `value.toFixed(2)`
- **Examples**:
  - 19.004 → 19.00
  - 19.005 → 19.01
  - 35.126 → 35.13
  - 10.00 → 10.00

### Tax Contributions
- **Rule**: Round **DOWN** to **nearest euro (floor, 0 decimal places)**
- **SQL**: `FLOOR(value)` or `TRUNC(value)`
- **TypeScript**: `roundTaxNumeric(value)` or `Math.floor(value)`
- **Examples**:
  - 19.9 → 19 (always down)
  - 19.1 → 19 (always down)
  - 19.0 → 19
  - 100.5 → 100 (always down)

## Implementation Locations

### 1. TypeScript Endpoint (`src/endpoints/admin-dashboard.ts`)
- **File**: `/ss-class-for` POST endpoint
- **Utility function**: `roundSSNumeric()` from `src/utils/rounding.ts`
- **Applied to**: 
  - Employee contribution (percentage-based)
  - Employer contribution (percentage-based)
  - MLF contribution (fixed or percentage, with cap applied)
- **Code use**:
  ```typescript
  import { roundSSNumeric } from '../utils/rounding';
  
  const result = roundSSNumeric((10.0 / 100) * 350); // = 35.00
  ```

### 2. SQL Queries
- **Rule in SQL**: Use `ROUND(value, 2)` for SS/MLF, `ROUND(value, 0)` for tax
- **Apply rounding immediately** after percentage calculation, not later
- **Example for SS percentage**:
  ```sql
  ROUND((employee_percentage / 100) * weekly_wage, 2) AS employee_contribution
  ```
- **Example with MLF cap**:
  ```sql
  LEAST(
    ROUND((mlf_percentage / 100) * wage, 2),
    COALESCE(mlf_max, ROUND((mlf_percentage / 100) * wage, 2))
  ) AS mlf_contribution
  ```

### 3. UI Display (Vue/TypeScript)
- **Currency formatting**: Use `Intl.NumberFormat` to display with locale-appropriate symbols
- **Decimal places**:
  - SS/MLF: Always show 2 places (€19.00, not €19)
  - Tax: Always show 0 places (€19, not €19.00)
- **No rounding in UI**: Use pre-rounded values from API/database

### 4. Fixed Amounts (No Rounding Needed)
- Values already stored in `social_security_classes`:
  - `employee_fixed`, `employer_fixed`, `mlf_fixed` (pre-rounded to 2 places)
- **Use as-is**, do not apply additional rounding

## Testing Checklist

- [ ] Endpoint `/ss-class-for` returns values rounded to 2 decimal places for SS/MLF
- [ ] SQL queries use `ROUND(..., 2)` immediately after percentage calculations
- [ ] Fixed amounts from `social_security_classes` are used without rounding
- [ ] MLF cap logic: `LEAST(rounded_pct_result, mlf_max)` (compare after rounding)
- [ ] Test value 19.005 returns 19.01 consistently across SQL, endpoint, and UI
- [ ] Test value 19.004 returns 19.00 consistently across SQL, endpoint, and UI
- [ ] No floating-point precision issues (e.g., 19.00000001 should become 19.00)
- [ ] Tax calculations use `ROUND(..., 0)` consistently

## Files Involved

- `src/utils/rounding.ts` — Shared rounding utility functions
- `src/endpoints/admin-dashboard.ts` — `/ss-class-for` endpoint (uses `roundSSNumeric`)
- `sql/ROUNDING_RULES_AND_EXAMPLES.sql` — SQL rounding examples and guidance
- `src/panels/tax-admin.vue` — (UI formatting, if applies)

## Consistency Guarantee

If these rules are followed:
1. All SS/MLF calculations will use `ROUND(..., 2)` before returning
2. All tax calculations will use `ROUND(..., 0)` before returning
3. No calculation will return different values on subsequent runs
4. Fixed amounts will never be re-rounded and will keep exact DB values
