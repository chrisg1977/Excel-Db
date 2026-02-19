/**
 * Validation Test Script
 * Demonstrates pre-publish validation for tax rates
 */

import { 
  validateTaxRatesBatch, 
  getValidationSummary,
  type TaxRecord
} from '../lib/tax-validation.js';

// Test Case 1: Overlapping Bands (INVALID)
const testCase1: TaxRecord[] = [
  {
    year: 2026,
    category_code: 'sng',
    raw_category_label: 'Single Rates',
    band_from: 0,
    band_to: 10000,
    rate: 0.10,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'sng',
    raw_category_label: 'Single Rates',
    band_from: 8000,        // OVERLAPS with 0-10000!
    band_to: 18000,
    rate: 0.12,
    subtract: 0
  }
];

// Test Case 2: Missing Required Categories (INVALID)
const testCase2: TaxRecord[] = [
  {
    year: 2026,
    category_code: 'sng',
    raw_category_label: 'Single Rates',
    band_from: 0,
    band_to: 10000,
    rate: 0.10,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'sng',
    raw_category_label: 'Single Rates',
    band_from: 10000,
    band_to: 30000,
    rate: 0.15,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'mar1',
    raw_category_label: 'Married Rates 1',
    band_from: 0,
    band_to: 12000,
    rate: 0.08,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'mar1',
    raw_category_label: 'Married Rates 1',
    band_from: 12000,
    band_to: 40000,
    rate: 0.12,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'mar2',
    raw_category_label: 'Married Rates 2',
    band_from: 0,
    band_to: 14000,
    rate: 0.07,
    subtract: 0
  },
  {
    year: 2026,
    category_code: 'mar2',
    raw_category_label: 'Married Rates 2',
    band_from: 14000,
    band_to: 45000,
    rate: 0.11,
    subtract: 0
  }
  // Missing par1, par2 - should fail validation!
];

// Test Case 3: Valid Complete Tax Rates
const testCase3: TaxRecord[] = [
  // Single Rates
  { year: 2026, category_code: 'sng', raw_category_label: 'Single Rates', band_from: 0, band_to: 10000, rate: 0.10, subtract: 0 },
  { year: 2026, category_code: 'sng', raw_category_label: 'Single Rates', band_from: 10000, band_to: 30000, rate: 0.15, subtract: 0 },
  { year: 2026, category_code: 'sng', raw_category_label: 'Single Rates', band_from: 30000, band_to: null as any, rate: 0.20, subtract: 0 },
  // Married Rates 1
  { year: 2026, category_code: 'mar1', raw_category_label: 'Married Rates 1', band_from: 0, band_to: 12000, rate: 0.08, subtract: 0 },
  { year: 2026, category_code: 'mar1', raw_category_label: 'Married Rates 1', band_from: 12000, band_to: 40000, rate: 0.12, subtract: 0 },
  { year: 2026, category_code: 'mar1', raw_category_label: 'Married Rates 1', band_from: 40000, band_to: null as any, rate: 0.18, subtract: 0 },
  // Married Rates 2
  { year: 2026, category_code: 'mar2', raw_category_label: 'Married Rates 2', band_from: 0, band_to: 14000, rate: 0.07, subtract: 0 },
  { year: 2026, category_code: 'mar2', raw_category_label: 'Married Rates 2', band_from: 14000, band_to: 45000, rate: 0.11, subtract: 0 },
  { year: 2026, category_code: 'mar2', raw_category_label: 'Married Rates 2', band_from: 45000, band_to: null as any, rate: 0.17, subtract: 0 },
  // Parent Rates 1
  { year: 2026, category_code: 'par1', raw_category_label: 'Parent Rates 1', band_from: 0, band_to: 11000, rate: 0.08, subtract: 0 },
  { year: 2026, category_code: 'par1', raw_category_label: 'Parent Rates 1', band_from: 11000, band_to: 35000, rate: 0.13, subtract: 0 },
  { year: 2026, category_code: 'par1', raw_category_label: 'Parent Rates 1', band_from: 35000, band_to: null as any, rate: 0.19, subtract: 0 },
  // Parent Rates 2
  { year: 2026, category_code: 'par2', raw_category_label: 'Parent Rates 2', band_from: 0, band_to: 13000, rate: 0.07, subtract: 0 },
  { year: 2026, category_code: 'par2', raw_category_label: 'Parent Rates 2', band_from: 13000, band_to: 42000, rate: 0.11, subtract: 0 },
  { year: 2026, category_code: 'par2', raw_category_label: 'Parent Rates 2', band_from: 42000, band_to: null as any, rate: 0.16, subtract: 0 }
];

// ============================================================================
// RUN TESTS
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('TAX RATE VALIDATION TEST SUITE');
console.log('='.repeat(80));

// Test Case 1
console.log('\n📋 TEST CASE 1: OVERLAPPING BANDS (SHOULD FAIL)');
console.log('-'.repeat(80));
const errors1 = validateTaxRatesBatch(testCase1);
const summary1 = getValidationSummary(errors1);

console.log(`Status: ${summary1.isValid ? '✅ VALID' : '❌ INVALID'}`);
console.log(`Total Errors: ${summary1.totalErrors}`);
console.log(`Error Types: ${JSON.stringify(summary1.errorsByType)}`);
console.log('\nDetailed Errors:');
summary1.errors.forEach((err, idx) => {
  console.log(`\n  ${idx + 1}. [${err.type}] ${err.message}`);
  if (err.details) {
    console.log(`     Details: ${JSON.stringify(err.details)}`);
  }
});

// Test Case 2
console.log('\n\n📋 TEST CASE 2: MISSING REQUIRED CATEGORIES (SHOULD FAIL)');
console.log('-'.repeat(80));
const errors2 = validateTaxRatesBatch(testCase2);
const summary2 = getValidationSummary(errors2);

console.log(`Status: ${summary2.isValid ? '✅ VALID' : '❌ INVALID'}`);
console.log(`Total Errors: ${summary2.totalErrors}`);
console.log(`Error Types: ${JSON.stringify(summary2.errorsByType)}`);
console.log('\nDetailed Errors:');
summary2.errors.forEach((err, idx) => {
  console.log(`\n  ${idx + 1}. [${err.type}] ${err.message}`);
  if (err.details) {
    console.log(`     Details: ${JSON.stringify(err.details)}`);
  }
});

// Test Case 3
console.log('\n\n📋 TEST CASE 3: VALID COMPLETE TAX RATES (SHOULD PASS)');
console.log('-'.repeat(80));
const errors3 = validateTaxRatesBatch(testCase3);
const summary3 = getValidationSummary(errors3);

console.log(`Status: ${summary3.isValid ? '✅ VALID' : '❌ INVALID'}`);
console.log(`Total Errors: ${summary3.totalErrors}`);
if (summary3.totalErrors === 0) {
  console.log('✅ All validations PASSED!');
  console.log(`\nDataset Summary:`);
  console.log(`  - Total Records: ${testCase3.length}`);
  console.log(`  - Categories: ${Array.from(new Set(testCase3.map(r => r.category_code))).join(', ')}`);
  console.log(`  - Year: ${testCase3[0].year}`);
  console.log(`  - Tax Bands Defined:`);
  
  const categoryGroups = new Map<string | null, TaxRecord[]>();
  for (const rec of testCase3) {
    if (!categoryGroups.has(rec.category_code)) {
      categoryGroups.set(rec.category_code, []);
    }
    categoryGroups.get(rec.category_code)!.push(rec);
  }
  
  for (const [cat, recs] of categoryGroups) {
    console.log(`    ${cat}:`);
    recs.sort((a, b) => a.band_from - b.band_from).forEach(r => {
      const bandTo = r.band_to !== null ? `€${r.band_to}` : '∞';
      console.log(`      €${r.band_from} - ${bandTo} → ${(r.rate * 100).toFixed(2)}%`);
    });
  }
} else {
  console.log(`Error Types: ${JSON.stringify(summary3.errorsByType)}`);
}

// Summary
console.log('\n\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`Test Case 1 (Overlapping Bands):      ${summary1.isValid ? '❌ FAILED (expected)' : '✅ BLOCKED (expected)'}`);
console.log(`Test Case 2 (Missing Categories):    ${summary2.isValid ? '❌ FAILED (expected)' : '✅ BLOCKED (expected)'}`);
console.log(`Test Case 3 (Valid Complete):        ${summary3.isValid ? '✅ PASSED (expected)' : '❌ FAILED (unexpected)'}`);
console.log('='.repeat(80) + '\n');
