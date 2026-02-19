#!/usr/bin/env python3
"""
Import timesheets from OpenDental
Maps OpenDental procedure logs to internal timesheet format
"""

import mysql.connector
import psycopg2
import psycopg2.extras
from datetime import datetime, date
from dateutil.parser import parse as parse_date

# OpenDental MySQL connection
OD_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "",  # Configure as needed
    "database": "opendental"
}

# Excel-Db PostgreSQL connection
PG_CONFIG = {
    "host": "localhost",
    "port": 55432,
    "dbname": "exceldb",
    "user": "excel",
    "password": "excelpass"
}

def map_od_emp_id(od_emp_id):
    """
    Map OpenDental employee ID to Excel-Db emp_id (YYYYNNN format)
    Adjust this mapping based on your actual OpenDental data structure
    """
    # Example: if OD has emp_id like 5, map to 2026005, etc.
    # For now, use a simple mapping
    if isinstance(od_emp_id, (int, str)):
        try:
            od_id = int(od_emp_id)
            # Assume current year is 2026, create emp_id as 2026NNN
            return 2026000 + min(od_id, 999)
        except:
            return None
    return None

def import_od_timesheets(emp_id=None, year=2026, month=2):
    """
    Import timesheets from OpenDental for given employee/period
    
    Args:
        emp_id: Excel-Db emp_id (e.g., 2018004) or None for all
        year: Payroll year (default 2026)
        month: Payroll month (default 2 = February)
    """
    
    try:
        # Connect to OpenDental
        od_conn = mysql.connector.connect(**OD_CONFIG)
        od_cur = od_conn.cursor(dictionary=True)
        
        # Connect to Excel-Db
        pg_conn = psycopg2.connect(**PG_CONFIG)
        pg_cur = pg_conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        print(f"[*] Importing OD timesheets for {year}-{month:02d}...")
        
        # Query OpenDental for procedure log entries (work time tracking)
        # Adjust based on your OpenDental schema
        query = """
            SELECT 
                proclog.CodeNum,
                proclog.Seconds / 3600.0 as hours,
                proclog.LogNote,
                proclog.ADateTime as work_date,
                employee.EmployeeNum as od_emp_id,
                employee.FName as first_name,
                employee.LName as last_name
            FROM procedurelog proclog
            JOIN employee ON proclog.EmployeeNum = employee.EmployeeNum
            WHERE YEAR(proclog.ADateTime) = %s
              AND MONTH(proclog.ADateTime) = %s
        """
        
        params = [year, month]
        
        if emp_id:
            # Map Excel-Db emp_id back to OD format if needed
            od_id = (emp_id % 1000)  # Extract sequence from YYYYNNN
            query += " AND employee.EmployeeNum = %s"
            params.append(od_id)
        
        od_cur.execute(query, params)
        od_logs = od_cur.fetchall()
        
        print(f"[+] Found {len(od_logs)} procedure log entries in OpenDental")
        
        # Insert into Excel-Db timesheets
        inserted = 0
        skipped = 0
        
        for log in od_logs:
            try:
                # Map to Excel-Db emp_id
                excel_emp_id = 2000000 + log['od_emp_id'] if log['od_emp_id'] else None
                
                if not excel_emp_id:
                    skipped += 1
                    continue
                
                # Parse work date
                work_date = log['work_date']
                if isinstance(work_date, str):
                    work_date = parse_date(work_date).date()
                elif hasattr(work_date, 'date'):
                    work_date = work_date.date()
                
                hours = float(log['hours']) if log['hours'] else 0
                
                if hours <= 0:
                    skipped += 1
                    continue
                
                # Determine hour type based on log notes
                hour_type = "WORK"
                if any(x in str(log.get('LogNote', '')).upper() for x in ['SICK', 'SICKNESS']):
                    hour_type = "SICK_LEAVE"
                elif any(x in str(log.get('LogNote', '')).upper() for x in ['VACATION', 'ANNUAL', 'PTO']):
                    hour_type = "VACATION_LEAVE"
                elif any(x in str(log.get('LogNote', '')).upper() for x in ['UNPAID']):
                    hour_type = "UNPAID_LEAVE"
                
                # Insert into timesheets
                pg_cur.execute("""
                    INSERT INTO timesheets
                    (emp_id, work_date, hours, hour_type, leave_status)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (emp_id, work_date, hour_type) 
                    DO UPDATE SET hours = EXCLUDED.hours
                """, (
                    excel_emp_id,
                    work_date,
                    hours,
                    hour_type,
                    "PAID" if hour_type == "WORK" else "UNPAID"
                ))
                
                inserted += 1
                
            except Exception as e:
                print(f"[!] Error processing log: {e}")
                skipped += 1
                continue
        
        pg_conn.commit()
        
        print(f"[+] Imported {inserted} timesheet entries")
        print(f"[~] Skipped {skipped} invalid entries")
        
        # Close connections
        od_cur.close()
        od_conn.close()
        pg_cur.close()
        pg_conn.close()
        
    except mysql.connector.Error as e:
        print(f"[!] OpenDental connection error: {e}")
        print("    Make sure OpenDental MySQL is accessible at", OD_CONFIG['host'])
    except psycopg2.Error as e:
        print(f"[!] PostgreSQL error: {e}")
    except Exception as e:
        print(f"[!] Error: {e}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Import timesheets from OpenDental")
    parser.add_argument("--emp-id", type=int, help="Employee ID (YYYYNNN format)")
    parser.add_argument("--year", type=int, default=2026, help="Year (default 2026)")
    parser.add_argument("--month", type=int, default=2, help="Month (default 2)")
    
    args = parser.parse_args()
    
    import_od_timesheets(
        emp_id=args.emp_id,
        year=args.year,
        month=args.month
    )
