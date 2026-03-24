import os
import pandas as pd
import psycopg2
import hashlib
import json
from datetime import date, datetime
from dateutil.parser import parse as parse_date

# ---------------- CONFIG ----------------
DB_CONFIG = {
    "host": "localhost",
    "port": 55432,
    "dbname": "exceldb",
    "user": "excel",
    "password": "excelpass"
}

EXCEL_FILE = os.environ.get("EMPINFO_FILE") or r"C:\Users\User\Desktop\CURRENT BACKUP\EMPINFO.xlsm"
SHEET_NAME = "EmpIDs"

# ----------------------------------------

def sha256_of_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def safe_date(val):
    if pd.isna(val):
        return None
    try:
        return parse_date(str(val)).date()
    except Exception:
        return None

def parse_emp_id(val):
    """EMPID must be YYYY### like 2023008. Return int or None."""
    if pd.isna(val):
        return None

    # If Excel accidentally has a date here, ignore it (not a valid EMP ID)
    if isinstance(val, pd.Timestamp):
        return None

    # Numeric cell (float/int)
    if isinstance(val, (int, float)):
        try:
            v = int(val)
        except Exception:
            return None
    else:
        # String cell
        s = str(val).strip()
        # remove any .0 or spaces
        s = s.replace(".0", "")
        if not s.isdigit():
            return None
        v = int(s)

    # Validate format: YYYY### (7 digits)
    if v < 1900000 or v > 3000999:
        return None
    year = v // 1000
    seq = v % 1000
    if seq < 1 or seq > 999:
        return None
    return v

def clean_for_json(val):
    if isinstance(val, dict):
        return {k: clean_for_json(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [clean_for_json(v) for v in val]
    if isinstance(val, (pd.Timestamp, datetime, date)):
        if pd.isna(val):
            return None
        return val.isoformat()
    if pd.isna(val):
        return None
    return val

def normalize_status(val):
    if pd.isna(val):
        return ""
    return str(val).strip().upper()

def normalize_tax_employment_type(val):
    normalized = normalize_status(val)
    if normalized in {"FT", "FT_RED", "PT", "PT_CASUAL", "SELF_EMPLOYED"}:
        return normalized
    return None

def normalize_fs4_status(val):
    normalized = normalize_status(val)
    if not normalized:
        return None
    if normalized == "SIN":
        return "SING"
    if normalized in {"SING", "MAR", "MAR1", "MAR2", "PAR", "PAR1", "PAR2"}:
        return normalized
    return None

def derive_marital_status(fs4_status):
    normalized = normalize_fs4_status(fs4_status)
    if not normalized:
        return None
    if normalized in {"SING"}:
        return "Single"
    if normalized in {"MAR", "MAR1", "MAR2"}:
        return "Married"
    if normalized in {"PAR", "PAR1", "PAR2"}:
        return "Single"
    return None

def as_nullable_number(val):
    if pd.isna(val):
        return None
    try:
        return float(val)
    except Exception:
        return None

def is_placeholder_year_end_termination(value):
    parsed = safe_date(value)
    if not parsed:
        return False
    return parsed.month == 12 and parsed.day == 31 and parsed.year in {2025, 2026}

def pick_first_date(*values):
    for value in values:
        parsed = safe_date(value)
        if parsed:
            return parsed
    return None

conn = psycopg2.connect(**DB_CONFIG)
cur = conn.cursor()

# ----- Register file import -----
file_hash = sha256_of_file(EXCEL_FILE)

cur.execute("""
INSERT INTO import_files (source_filename, sha256)
VALUES (%s, %s)
ON CONFLICT (sha256) DO NOTHING
RETURNING file_id
""", (EXCEL_FILE, file_hash))

row = cur.fetchone()
if row:
    file_id = row[0]
else:
    cur.execute("SELECT file_id FROM import_files WHERE sha256=%s", (file_hash,))
    file_id = cur.fetchone()[0]

# ----- Load Excel -----
df = pd.read_excel(EXCEL_FILE, sheet_name=SHEET_NAME)
placeholder_termination_warnings = []

for idx, r in df.iterrows():
    emp_id = parse_emp_id(r.iloc[0])  # Column A always
    if emp_id is None:
        continue

    raw_json = clean_for_json(r.to_dict())
    start_date = pick_first_date(r.get("datae first employed"), r.get("Record datae"))
    termination_marker = normalize_status(r.get("Current/Terminated/Changed Designation"))
    raw_termination_date = safe_date(r.get("TERM dataE"))
    has_placeholder_year_end_termination = bool(raw_termination_date) and is_placeholder_year_end_termination(raw_termination_date)
    has_real_termination_date = bool(raw_termination_date) and not is_placeholder_year_end_termination(raw_termination_date)
    is_terminated = termination_marker in {"TERM", "TERMINATED"} or has_real_termination_date
    termination_date = raw_termination_date if is_terminated else None
    active_from = start_date
    terminated_on = termination_date if is_terminated else None
    is_active = not is_terminated
    tax_employment_type = normalize_tax_employment_type(r.get("FT/PT"))
    fs4_status = normalize_fs4_status(r.get("Status"))
    fixed_hours_week = as_nullable_number(r.get("Full time/Hours Per Week"))
    marital_status = derive_marital_status(fs4_status)

    cur.execute("SAVEPOINT row_import")
    try:
        # ---- RAW AUDIT ----
        cur.execute("""
        INSERT INTO import_rows_raw (file_id, sheet_name, row_number, raw_json)
        VALUES (%s, %s, %s, %s)
        """, (file_id, SHEET_NAME, idx + 2, json.dumps(raw_json, default=str)))

        if termination_marker in {"CURRENT", ""} and has_placeholder_year_end_termination:
            warning_message = f"Placeholder year-end TERM date kept as non-termination for emp_id {emp_id}"
            placeholder_termination_warnings.append({
                "emp_id": emp_id,
                "row_number": idx + 2,
                "term_date": raw_termination_date.isoformat(),
                "status_marker": termination_marker or "BLANK"
            })
            cur.execute("""
            UPDATE import_rows_raw
            SET parse_status = 'warning',
                error = %s
            WHERE file_id = %s
              AND sheet_name = %s
              AND row_number = %s
            """, (warning_message, file_id, SHEET_NAME, idx + 2))

        # ---- EMPLOYEE CORE ----
        cur.execute("""
        INSERT INTO employees (emp_id, national_id, social_security_no, tax_number,
                               nationality, spouse_national_id, dob, email,
                               phone_primary, phone_secondary, iban,
                               address1, address2, city, postcode,
                               active_from, terminated_on, is_active)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (emp_id) DO UPDATE SET
          national_id = EXCLUDED.national_id,
          social_security_no = EXCLUDED.social_security_no,
          tax_number = EXCLUDED.tax_number,
          nationality = EXCLUDED.nationality,
          spouse_national_id = EXCLUDED.spouse_national_id,
          dob = EXCLUDED.dob,
          email = EXCLUDED.email,
          phone_primary = EXCLUDED.phone_primary,
          phone_secondary = EXCLUDED.phone_secondary,
          iban = EXCLUDED.iban,
          address1 = EXCLUDED.address1,
          address2 = EXCLUDED.address2,
          city = EXCLUDED.city,
          postcode = EXCLUDED.postcode,
          active_from = COALESCE(EXCLUDED.active_from, employees.active_from),
          terminated_on = EXCLUDED.terminated_on,
          is_active = EXCLUDED.is_active,
          updated_at = now()
        """, (
            emp_id,
            r.get("ID"),
            r.get("SOC SEC No."),
            r.get("TAX Number for eU Citizens") or r.get("ID"),
            r.get("Nationality"),
            r.get("Spouse ID"),
            safe_date(r.get("DOB")),
            r.get("Email"),
            r.get("Telephone"),
            r.iloc[10] if len(r) > 10 else None,  # column K (other phone)
            r.get("Bank Details for direct bank transfer"),
            r.iloc[17] if len(r) > 17 else None,  # column R
            r.get("Address2"),
            r.get("City"),
            r.get("Postcode"),
            active_from,
            terminated_on,
            is_active
        ))

        # ---- EMPLOYEE FORM PROFILE DATES ----
        cur.execute("""
        INSERT INTO employee_form_profile
          (emp_id, start_date, mediatrix_start_date, termination_date,
           tax_employment_type, fs4_status, marital_status, fixed_hours_week, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (emp_id) DO UPDATE SET
          start_date = COALESCE(EXCLUDED.start_date, employee_form_profile.start_date),
          mediatrix_start_date = COALESCE(EXCLUDED.mediatrix_start_date, employee_form_profile.mediatrix_start_date),
          termination_date = EXCLUDED.termination_date,
          tax_employment_type = COALESCE(EXCLUDED.tax_employment_type, employee_form_profile.tax_employment_type),
          fs4_status = EXCLUDED.fs4_status,
          marital_status = COALESCE(EXCLUDED.marital_status, employee_form_profile.marital_status),
          fixed_hours_week = COALESCE(EXCLUDED.fixed_hours_week, employee_form_profile.fixed_hours_week),
          updated_at = now()
        """, (
            emp_id,
            start_date,
            start_date,
            terminated_on,
            tax_employment_type,
            fs4_status,
            marital_status,
            fixed_hours_week
        ))

        # ---- NAME HISTORY ----
        cur.execute("""
        UPDATE employee_name_history
        SET first_name=%s,
            surname=%s,
            short_name=%s
        WHERE emp_id=%s AND effective_to IS NULL
        RETURNING name_id
        """, (
            r.get("Name"),
            r.get("Surname"),
            r.iloc[15] if len(r) > 15 else None,              # short name (P)
            emp_id
        ))

        if not cur.fetchone():
            cur.execute("""
            INSERT INTO employee_name_history
            (emp_id, first_name, surname, short_name, effective_from)
            VALUES (%s,%s,%s,%s,%s)
            """, (
                emp_id,
                r.get("Name"),
                r.get("Surname"),
                r.iloc[15] if len(r) > 15 else None,          # short name (P)
                start_date or date.today()
            ))

        # ---- EMPLOYMENT TERMS ----
        cur.execute("""
        UPDATE employee_employment_terms
        SET position_held=%s,
            weekly_hours=%s,
            employment_type=%s,
            date_first_employed=%s
        WHERE emp_id=%s AND effective_to IS NULL
        RETURNING terms_id
        """, (
            r.get("Position held"),
            fixed_hours_week,
            tax_employment_type,
            start_date,
            emp_id
        ))

        if not cur.fetchone():
            cur.execute("""
            INSERT INTO employee_employment_terms
            (emp_id, position_held, weekly_hours, employment_type,
             date_first_employed, effective_from)
            VALUES (%s,%s,%s,%s,%s,%s)
            """, (
                emp_id,
                r.get("Position held"),
                fixed_hours_week,
                tax_employment_type,
                start_date,
                start_date or date.today()
            ))

        cur.execute("RELEASE SAVEPOINT row_import")
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT row_import")
        cur.execute("""
        INSERT INTO import_rows_raw (file_id, sheet_name, row_number, raw_json, parse_status, error)
        VALUES (%s,%s,%s,%s,'error',%s)
        """, (file_id, SHEET_NAME, idx + 2, json.dumps(raw_json, default=str), str(e)))
        cur.execute("RELEASE SAVEPOINT row_import")

conn.commit()

# ---- Initialize EMPID sequences from existing data ----
cur.execute("""
INSERT INTO emp_id_sequences(year, last_seq)
SELECT (emp_id/1000), MAX(emp_id % 1000)
FROM employees
GROUP BY (emp_id/1000)
ON CONFLICT (year)
DO UPDATE SET last_seq = GREATEST(emp_id_sequences.last_seq, EXCLUDED.last_seq),
              updated_at = now()
""")

conn.commit()
conn.close()

print("EMPINFO import completed successfully.")
if placeholder_termination_warnings:
    print("EMPINFO placeholder TERM warnings:")
    for item in placeholder_termination_warnings:
        print(
            f" - emp_id {item['emp_id']} row {item['row_number']} "
            f"status={item['status_marker']} term_date={item['term_date']}"
        )
