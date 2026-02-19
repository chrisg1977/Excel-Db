#!/usr/bin/env python3
"""
Test Setup: Import OpenDental timesheets + create payroll test data
Tests wage calculation for employee 2018004 for Feb 2026
"""

import psycopg2
import psycopg2.extras
from datetime import datetime, date, timedelta
import sys

# PostgreSQL connection
DB_CONFIG = {
    "host": "localhost",
    "port": 55432,
    "dbname": "exceldb",
    "user": "excel",
    "password": "excelpass"
}

# OpenDental connection (adjust as needed)
OD_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "database": "opendental",
    "user": "root",
    "password": ""  # Adjust
}

def setup_test_payroll():
    """Create test payroll data for employee 2018004, Feb 2026"""
    
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    print("[*] Setting up test payroll data...")
    
    emp_id = 2018004
    year = 2026
    month = 2  # February
    
    try:
        # 1. Ensure employee exists (or use existing)
        cur.execute("SELECT emp_id FROM employees WHERE emp_id = %s", (emp_id,))
        emp = cur.fetchone()
        
        if not emp:
            print(f"[!] Employee {emp_id} not found. Creating test employee...")
            cur.execute("""
                INSERT INTO employees 
                (emp_id, name, surname, dob, tax_status, contracted_hours, 
                 date_first_employed, employment_type, position_held)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (emp_id) DO NOTHING
            """, (
                emp_id,
                "John",
                "Test",
                date(1980, 5, 15),
                "SIN",
                40,
                date(2020, 1, 1),
                "FT",
                "Software Developer"
            ))
            conn.commit()
            print(f"[+] Created test employee {emp_id}")
        else:
            print(f"[+] Using existing employee {emp_id}")
        
        # 2. Add wage history if not exists
        cur.execute("""
            SELECT 1 FROM wage_history 
            WHERE emp_id = %s AND effective_date <= %s
            ORDER BY effective_date DESC LIMIT 1
        """, (emp_id, f"{year}-{month:02d}-01"))
        
        if not cur.fetchone():
            print("[*] Adding wage history (€12.50/hr)...")
            cur.execute("""
                INSERT INTO wage_history 
                (emp_id, effective_date, hourly_rate, change_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (emp_id, date(2024, 1, 1), 12.50, "INITIAL"))
            conn.commit()
        
        # 3. Create payroll subscription (MAIN)
        cur.execute("""
            SELECT 1 FROM payroll_subscriptions 
            WHERE employee_id = %s AND payroll_type = %s
        """, (emp_id, "MAIN"))
        
        if not cur.fetchone():
            print("[*] Creating MAIN payroll subscription...")
            cur.execute("""
                INSERT INTO payroll_subscriptions
                (employee_id, payroll_type, employment_number, active_from)
                VALUES (%s, %s, %s, %s)
            """, (emp_id, "MAIN", f"EMP-{emp_id}", date(2024, 1, 1)))
            conn.commit()
        
        # 4. Clear existing timesheets for Feb 2026
        print(f"[*] Clearing timesheets for {year}-{month:02d}...")
        period_start = date(year, month, 1)
        period_end = date(year, month if month < 12 else 1, 28 if month == 2 else 31)
        
        cur.execute("""
            DELETE FROM timesheets 
            WHERE emp_id = %s AND work_date >= %s AND work_date <= %s
        """, (emp_id, period_start, period_end))
        conn.commit()
        
        # 5. Insert test timesheets (40 hours/week, standard work days)
        print(f"[*] Creating test timesheets for Feb 2026...")
        
        timesheets = []
        current_date = period_start
        work_hours_remaining = 160  # ~40 hours/week for 4 weeks
        
        while current_date <= period_end:
            # Skip weekends
            if current_date.weekday() >= 5:
                current_date += timedelta(days=1)
                continue
            
            # Standard 8-hour work day
            hours = min(8, work_hours_remaining)
            if hours > 0:
                timesheets.append((
                    emp_id,
                    current_date,
                    hours,
                    "WORK",
                    "PAID"
                ))
                work_hours_remaining -= hours
            
            current_date += timedelta(days=1)
        
        # Insert all timesheets
        for ts in timesheets:
            cur.execute("""
                INSERT INTO timesheets
                (emp_id, work_date, hours, hour_type, leave_status)
                VALUES (%s, %s, %s, %s, %s)
            """, ts)
        
        conn.commit()
        print(f"[+] Created {len(timesheets)} timesheet entries")
        
        # 6. Create payroll entry for the month
        print(f"[*] Creating payroll entry for {year}-{month:02d}...")
        cur.execute("""
            SELECT 1 FROM payroll_entries 
            WHERE payroll_year = %s AND payroll_month = %s
        """, (year, month))
        
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO payroll_entries
                (payroll_year, payroll_month, period_from, period_to, status)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                year,
                month,
                period_start,
                period_end,
                "DRAFT"
            ))
            conn.commit()
            print("[+] Payroll entry created")
        
        # 7. Summary
        print("\n" + "="*60)
        print(f"✓ Test setup complete for employee {emp_id}, {year}-{month:02d}")
        print("="*60)
        print("\nTo test wage calculation:")
        print(f"  POST /payroll/calculate-wages")
        print(f"  Body: {{'employee_id': {emp_id}, 'year': {year}, 'month': {month}}}")
        print(f"\nOr preview:")
        print(f"  GET /payroll/calculate-wages/{emp_id}/{year}/{month}")
        print(f"\nGenerate payslip:")
        print(f"  GET /payroll/payslip/{emp_id}/{year}/{month}")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"[!] Error: {e}")
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    setup_test_payroll()
