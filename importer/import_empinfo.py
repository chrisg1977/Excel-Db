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

EXCEL_FILE = r"\\MDTRX-EXTRA\Users\User\excels\EMPINFO.xlsm"   # <-- CHANGE THIS
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

for idx, r in df.iterrows():
    emp_id = parse_emp_id(r.iloc[0])  # Column A always
    if emp_id is None:
        continue

    raw_json = clean_for_json(r.to_dict())

    cur.execute("SAVEPOINT row_import")
    try:
        # ---- RAW AUDIT ----
        cur.execute("""
        INSERT INTO import_rows_raw (file_id, sheet_name, row_number, raw_json)
        VALUES (%s, %s, %s, %s)
        """, (file_id, SHEET_NAME, idx + 2, json.dumps(raw_json, default=str)))

        # ---- EMPLOYEE CORE ----
        cur.execute("""
        INSERT INTO employees (emp_id, national_id, social_security_no, tax_number,
                               nationality, spouse_national_id, dob, email,
                               phone_primary, phone_secondary, iban,
                               address1, address2, city, postcode)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (emp_id) DO NOTHING
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
            r.get("Postcode")
        ))

        # ---- NAME HISTORY ----
        cur.execute("""
        SELECT 1 FROM employee_name_history
        WHERE emp_id=%s AND effective_to IS NULL
        """, (emp_id,))

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
                safe_date(r.get("datae first employed")) or date.today()
            ))

        # ---- EMPLOYMENT TERMS ----
        cur.execute("""
        SELECT 1 FROM employee_employment_terms
        WHERE emp_id=%s AND effective_to IS NULL
        """, (emp_id,))

        if not cur.fetchone():
            cur.execute("""
            INSERT INTO employee_employment_terms
            (emp_id, position_held, weekly_hours, employment_type,
             date_first_employed, effective_from)
            VALUES (%s,%s,%s,%s,%s,%s)
            """, (
                emp_id,
                r.get("Position held"),
                r.get("Full time/Hours Per Week"),
                r.get("FT/PT"),
                safe_date(r.get("datae first employed")),
                safe_date(r.get("datae first employed")) or date.today()
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
