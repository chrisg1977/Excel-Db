#!/usr/bin/env python3
"""
Test runner for wage calculator
Setup test data + call API endpoints to verify wage calculation
"""

import os
import sys
import requests

# Directus API endpoint
API_BASE = "http://localhost:8055"
API_PREFIX = "/wage-calculator"
API_TOKEN = os.getenv("DIRECTUS_TOKEN", "YOUR_DIRECTUS_TOKEN_HERE")

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_TOKEN}",
}


def test_preview_wages() -> bool:
    """Test GET preview endpoint"""
    print("\n" + "=" * 70)
    print("TEST 1: Preview wage calculation (no insert)")
    print("=" * 70)

    emp_id = 2018004
    year = 2026
    month = 2

    url = f"{API_BASE}{API_PREFIX}/payroll/calculate-wages/{emp_id}/{year}/{month}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()

        data = response.json()

        if data.get("ok"):
            print(f"\nOK Preview successful for employee {emp_id}")

            wage_calc = data.get("wage_calculation", {})
            ss_contrib = data.get("social_security_contributions", {})

            print(f"\n  Basic Wage: EUR {wage_calc.get('basic_wage', 0):.2f}")
            print(f"  Weekly Wage: EUR {wage_calc.get('weekly_wage', 0):.2f}")
            print(f"  SS Class: {wage_calc.get('ss_class', 'N/A')}")
            print(f"  Tax Rate: {wage_calc.get('tax_rate', 0):.2%}")
            print(f"  Tax Deducted: EUR {wage_calc.get('tax_deducted', 0):.2f}")

            print("\n  SS Contributions:")
            print(f"    Employee: EUR {ss_contrib.get('employee_contribution', 0):.2f}")
            print(f"    Employer: EUR {ss_contrib.get('employer_contribution', 0):.2f}")
            print(f"    MLF: EUR {ss_contrib.get('mlf_contribution', 0):.2f}")

            gross = wage_calc.get("basic_wage", 0)
            total_deductions = wage_calc.get("tax_deducted", 0) + ss_contrib.get("employee_contribution", 0)
            net = gross - total_deductions

            print(f"\n  Gross Earnings: EUR {gross:.2f}")
            print(f"  Total Deductions: EUR {total_deductions:.2f}")
            print(f"  Net Payment: EUR {net:.2f}")
            return True

        print(f"[!] Error: {data.get('error', 'Unknown error')}")
        return False

    except requests.exceptions.RequestException as exc:
        print(f"[!] Request failed: {exc}")
        return False


def test_calculate_wages() -> bool:
    """Test POST calculate endpoint (actually inserts data)"""
    print("\n" + "=" * 70)
    print("TEST 2: Calculate wages (insert payroll_lines)")
    print("=" * 70)

    emp_id = 2018004
    year = 2026
    month = 2

    url = f"{API_BASE}{API_PREFIX}/payroll/calculate-wages"
    payload = {
        "employee_id": emp_id,
        "payroll_year": year,
        "payroll_month": month,
    }

    try:
        response = requests.post(url, json=payload, headers=HEADERS, timeout=30)
        response.raise_for_status()

        data = response.json()

        if data.get("ok"):
            print("\nOK Wage calculation successful")
            print(f"  Period: {data.get('period', 'N/A')}")
            print(f"  Subscriptions processed: {data.get('subscriptions_processed', 0)}")
            print(f"  Payroll lines created: {data.get('payroll_lines_created', 0)}")

            lines = data.get("payroll_lines", [])
            if lines:
                line = lines[0]
                print("\nPayroll Line Details:")
                print(f"  Hours worked: {line.get('hours_worked', 0)}")
                print(f"  Gross earnings: EUR {line.get('gross_earnings', 0):.2f}")
                print(f"  SS employee contribution: EUR {line.get('ss_employee_contribution', 0):.2f}")
                print(f"  Tax deduction: EUR {line.get('tax_deduction', 0):.2f}")
                print(f"  Total deductions: EUR {line.get('total_deductions', 0):.2f}")
                print(f"  Net payment: EUR {line.get('net_payment', 0):.2f}")
            return True

        print(f"[!] Error: {data.get('error', 'Unknown error')}")
        return False

    except requests.exceptions.RequestException as exc:
        print(f"[!] Request failed: {exc}")
        return False


def test_payslip() -> bool:
    """Test GET payslip endpoint"""
    print("\n" + "=" * 70)
    print("TEST 3: Generate payslip PDF")
    print("=" * 70)

    emp_id = 2018004
    year = 2026
    month = 2

    url = f"{API_BASE}{API_PREFIX}/payroll/payslip/{emp_id}/{year}/{month}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()

        if response.headers.get("content-type") == "application/pdf":
            filename = f"payslip_{emp_id}_{year}{month:02d}.pdf"
            with open(filename, "wb") as handle:
                handle.write(response.content)

            print("\nOK Payslip generated successfully")
            print(f"  Saved to: {filename}")
            print(f"  File size: {len(response.content)} bytes")
            return True

        print(f"[!] Unexpected response type: {response.headers.get('content-type')}")
        print(response.text[:500])
        return False

    except requests.exceptions.RequestException as exc:
        print(f"[!] Request failed: {exc}")
        return False


def main() -> int:
    print("\n" + "=" * 70)
    print("WAGE CALCULATOR TEST SUITE")
    print("Employee 2018004, February 2026")
    print("=" * 70)

    if not API_TOKEN or API_TOKEN == "YOUR_DIRECTUS_TOKEN_HERE":
        print("\n[!] ERROR: Set API_TOKEN before running tests")
        print("   Set environment variable DIRECTUS_TOKEN")
        return 1

    results = []
    results.append(("Preview wages", test_preview_wages()))
    results.append(("Calculate wages", test_calculate_wages()))
    results.append(("Generate payslip", test_payslip()))

    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  {status}: {name}")

    passed_count = sum(1 for _, p in results if p)
    total = len(results)

    print(f"\n  {passed_count}/{total} tests passed")
    print("=" * 70 + "\n")

    return 0 if passed_count == total else 1


if __name__ == "__main__":
    sys.exit(main())
