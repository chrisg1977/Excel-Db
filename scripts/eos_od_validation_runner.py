from __future__ import annotations

import json
import traceback
from pathlib import Path

import pymysql


ENV_CANDIDATES = [
    Path(r"M:\.env"),
    Path(".env"),
]


def parse_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        env[key] = value
    return env


def load_env() -> dict[str, str]:
    for candidate in ENV_CANDIDATES:
        if candidate.exists():
            return parse_env_file(candidate)
    raise FileNotFoundError("No env file found for Open Dental validation")


def connect():
    env = load_env()
    return pymysql.connect(
        host=env.get("OD_DB_HOST") or env.get("OD_MYSQL_HOST"),
        port=int(env.get("OD_DB_PORT") or env.get("OD_MYSQL_PORT") or 3306),
        user=env.get("OD_DB_USER") or env.get("OD_MYSQL_USER"),
        password=env.get("OD_DB_PASSWORD") or env.get("OD_DB_PASS") or env.get("OD_MYSQL_PASSWORD") or "",
        database=env.get("OD_DB_NAME") or env.get("OD_MYSQL_DATABASE"),
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_all(cursor, sql: str) -> list[dict]:
    cursor.execute(sql)
    return cursor.fetchall()


def run_validation() -> dict:
    conn = connect()
    cursor = conn.cursor()
    try:
        results: dict[str, object] = {}

        queries = {
            "db_info": """
                SELECT DATABASE() AS db_name, VERSION() AS version
            """,
            "clinic_tables": """
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME LIKE '%clinic%'
                ORDER BY TABLE_NAME
            """,
            "clinic_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND (TABLE_NAME LIKE '%clinic%' OR COLUMN_NAME LIKE '%clinic%')
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            """,
            "datetime_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND (TABLE_NAME IN ('procedurelog', 'appointment') OR TABLE_NAME LIKE '%appoint%')
                  AND (COLUMN_NAME LIKE '%date%' OR COLUMN_NAME LIKE '%time%' OR COLUMN_NAME LIKE '%apt%')
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            """,
            "procdate_column": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'procedurelog'
                  AND COLUMN_NAME = 'ProcDate'
            """,
            "procedurelog_fields": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'procedurelog'
                  AND (COLUMN_NAME LIKE 'Proc%'
                       OR COLUMN_NAME IN ('ClinicNum', 'PatNum', 'ProvNum', 'CodeNum', 'AptNum'))
                ORDER BY ORDINAL_POSITION
            """,
            "patient_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND (TABLE_NAME IN ('patient', 'pat') OR TABLE_NAME LIKE '%patient%')
                  AND COLUMN_NAME IN ('PatNum', 'ChartNumber', 'LName', 'FName', 'MiddleI', 'Preferred')
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            """,
            "provider_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'provider'
                  AND (COLUMN_NAME IN ('ProvNum', 'Abbr', 'LName', 'FName', 'MI', 'Suffix')
                       OR COLUMN_NAME LIKE '%name%')
                ORDER BY ORDINAL_POSITION
            """,
            "procedurecode_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND (TABLE_NAME = 'procedurecode'
                       OR TABLE_NAME LIKE '%procedurecode%'
                       OR TABLE_NAME LIKE '%code%')
                  AND (COLUMN_NAME IN ('CodeNum', 'ProcCode', 'Descript', 'AbbrDesc')
                       OR COLUMN_NAME LIKE '%descript%')
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            """,
            "grouping_columns": """
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME IN ('procedurelog', 'appointment')
                  AND (COLUMN_NAME IN ('ProcNum', 'PatNum', 'AptNum', 'ClinicNum', 'ProcDate')
                       OR COLUMN_NAME LIKE '%visit%'
                       OR COLUMN_NAME LIKE '%apt%'
                       OR COLUMN_NAME LIKE '%date%'
                       OR COLUMN_NAME LIKE '%time%')
                ORDER BY TABLE_NAME, ORDINAL_POSITION
            """,
        }

        for key, sql in queries.items():
            results[key] = fetch_all(cursor, sql)

        results["samples"] = {}

        clinic_tables = {row["TABLE_NAME"] for row in results["clinic_tables"]}
        if "clinic" in clinic_tables:
            results["samples"]["clinic"] = fetch_all(
                cursor, "SELECT * FROM clinic ORDER BY ClinicNum LIMIT 20"
            )

        results["samples"]["procedurelog_procdate"] = fetch_all(
            cursor,
            """
            SELECT ProcNum, ProcDate
            FROM procedurelog
            ORDER BY ProcDate DESC, ProcNum DESC
            LIMIT 25
            """,
        )

        results["samples"]["procstatus_summary"] = fetch_all(
            cursor,
            """
            SELECT ProcStatus, COUNT(*) AS row_count,
                   ROUND(SUM(COALESCE(ProcFee, 0)), 2) AS summed_proc_fee
            FROM procedurelog
            GROUP BY ProcStatus
            ORDER BY ProcStatus
            """,
        )

        patient_tables = {row["TABLE_NAME"] for row in results["patient_columns"]}
        if "patient" in patient_tables:
            results["samples"]["patient"] = fetch_all(
                cursor,
                """
                SELECT PatNum, ChartNumber, LName, FName
                FROM patient
                ORDER BY PatNum DESC
                LIMIT 25
                """,
            )

        if results["provider_columns"]:
            results["samples"]["provider"] = fetch_all(
                cursor,
                """
                SELECT ProvNum, Abbr, PreferredName, LName, FName
                FROM provider
                ORDER BY ProvNum
                LIMIT 25
                """,
            )

        procedurecode_tables = {row["TABLE_NAME"] for row in results["procedurecode_columns"]}
        if "procedurecode" in procedurecode_tables:
            results["samples"]["procedurecode"] = fetch_all(
                cursor,
                """
                SELECT CodeNum, ProcCode, Descript
                FROM procedurecode
                ORDER BY CodeNum DESC
                LIMIT 25
                """,
            )

        grouping_tables = {row["TABLE_NAME"] for row in results["grouping_columns"]}
        results["samples"]["procedurelog_grouping"] = fetch_all(
            cursor,
            """
            SELECT ProcNum, PatNum, AptNum, ClinicNum, ProcDate
            FROM procedurelog
            ORDER BY ProcNum DESC
            LIMIT 25
            """,
        )
        if "appointment" in grouping_tables:
            results["samples"]["appointment_grouping"] = fetch_all(
                cursor,
                """
                SELECT AptNum, PatNum, ClinicNum, AptDateTime
                FROM appointment
                ORDER BY AptNum DESC
                LIMIT 25
                """,
            )

        results["validation_checks"] = {}

        results["validation_checks"]["chartnumber_usage"] = fetch_all(
            cursor,
            """
            SELECT
              COUNT(*) AS total_patients,
              SUM(CASE WHEN COALESCE(ChartNumber, '') <> '' THEN 1 ELSE 0 END) AS patients_with_chartnumber,
              SUM(CASE WHEN COALESCE(ChartNumber, '') = '' THEN 1 ELSE 0 END) AS patients_without_chartnumber
            FROM patient
            """,
        )

        results["validation_checks"]["appointment_link_coverage"] = fetch_all(
            cursor,
            """
            SELECT
              COUNT(*) AS completed_rows,
              SUM(CASE WHEN pl.AptNum > 0 THEN 1 ELSE 0 END) AS completed_rows_with_aptnum,
              SUM(CASE WHEN pl.AptNum = 0 THEN 1 ELSE 0 END) AS completed_rows_without_aptnum,
              SUM(CASE WHEN pl.AptNum > 0 AND a.AptNum IS NOT NULL THEN 1 ELSE 0 END) AS completed_rows_joining_appointment
            FROM procedurelog pl
            LEFT JOIN appointment a ON a.AptNum = pl.AptNum
            WHERE pl.ProcStatus = 2
            """,
        )

        results["validation_checks"]["clinic_alignment_with_appointment"] = fetch_all(
            cursor,
            """
            SELECT
              COUNT(*) AS completed_rows_with_aptnum,
              SUM(CASE WHEN pl.ClinicNum = a.ClinicNum THEN 1 ELSE 0 END) AS same_clinicnum,
              SUM(CASE WHEN pl.ClinicNum <> a.ClinicNum THEN 1 ELSE 0 END) AS different_clinicnum,
              SUM(CASE WHEN pl.ClinicNum = 0 THEN 1 ELSE 0 END) AS procedurelog_clinic_zero,
              SUM(CASE WHEN a.ClinicNum = 0 THEN 1 ELSE 0 END) AS appointment_clinic_zero
            FROM procedurelog pl
            INNER JOIN appointment a ON a.AptNum = pl.AptNum
            WHERE pl.ProcStatus = 2
              AND pl.AptNum > 0
            """,
        )

        results["validation_checks"]["clinic_alignment_samples"] = fetch_all(
            cursor,
            """
            SELECT
              pl.ProcNum,
              pl.AptNum,
              pl.PatNum,
              pl.ClinicNum AS procedurelog_clinicnum,
              a.ClinicNum AS appointment_clinicnum,
              a.AptDateTime
            FROM procedurelog pl
            INNER JOIN appointment a ON a.AptNum = pl.AptNum
            WHERE pl.ProcStatus = 2
              AND pl.AptNum > 0
              AND pl.ClinicNum <> a.ClinicNum
            ORDER BY pl.ProcNum DESC
            LIMIT 25
            """,
        )

        results["validation_checks"]["grouped_visit_candidates"] = fetch_all(
            cursor,
            """
            SELECT
              pl.AptNum,
              pl.PatNum,
              pl.ClinicNum,
              COUNT(*) AS source_proc_count,
              ROUND(SUM(COALESCE(pl.ProcFee, 0)), 2) AS summed_proc_fee
            FROM procedurelog pl
            WHERE pl.ProcStatus = 2
              AND pl.AptNum > 0
            GROUP BY pl.AptNum, pl.PatNum, pl.ClinicNum
            ORDER BY source_proc_count DESC, pl.AptNum DESC
            LIMIT 25
            """,
        )

        results["validation_checks"]["appointment_group_consistency"] = fetch_all(
            cursor,
            """
            SELECT
              COUNT(*) AS appointment_groups,
              SUM(CASE WHEN patient_count > 1 THEN 1 ELSE 0 END) AS groups_with_multiple_patients,
              SUM(CASE WHEN provider_count > 1 THEN 1 ELSE 0 END) AS groups_with_multiple_providers
            FROM (
              SELECT
                pl.AptNum,
                COUNT(DISTINCT pl.PatNum) AS patient_count,
                COUNT(DISTINCT pl.ProvNum) AS provider_count
              FROM procedurelog pl
              WHERE pl.ProcStatus = 2
                AND pl.AptNum > 0
              GROUP BY pl.AptNum
            ) grouped
            """,
        )

        results["validation_checks"]["appointment_multi_provider_samples"] = fetch_all(
            cursor,
            """
            SELECT
              pl.AptNum,
              COUNT(DISTINCT pl.PatNum) AS patient_count,
              COUNT(DISTINCT pl.ProvNum) AS provider_count,
              GROUP_CONCAT(DISTINCT CONCAT(pr.FName, ' ', pr.LName) ORDER BY pr.FName, pr.LName SEPARATOR ' | ') AS provider_names
            FROM procedurelog pl
            LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum
            WHERE pl.ProcStatus = 2
              AND pl.AptNum > 0
            GROUP BY pl.AptNum
            HAVING COUNT(DISTINCT pl.ProvNum) > 1
            ORDER BY pl.AptNum DESC
            LIMIT 25
            """,
        )

        results["validation_checks"]["provider_display_samples"] = fetch_all(
            cursor,
            """
            SELECT
              pl.ProcNum,
              pl.ProvNum,
              pr.Abbr,
              pr.PreferredName,
              pr.FName,
              pr.LName
            FROM procedurelog pl
            LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum
            WHERE pl.ProcStatus = 2
            ORDER BY pl.ProcNum DESC
            LIMIT 25
            """,
        )

        results["validation_checks"]["completed_join_sample"] = fetch_all(
            cursor,
            """
            SELECT
              pl.ProcNum,
              pl.PatNum,
              p.ChartNumber,
              p.LName AS patient_lname,
              p.FName AS patient_fname,
              pl.AptNum,
              a.AptDateTime,
              pl.ClinicNum,
              pl.ProvNum,
              pr.Abbr AS provider_abbr,
              pr.PreferredName AS provider_preferred_name,
              pr.FName AS provider_fname,
              pr.LName AS provider_lname,
              pl.CodeNum,
              pc.ProcCode,
              pc.Descript,
              pl.ProcStatus,
              pl.ProcFee
            FROM procedurelog pl
            LEFT JOIN patient p ON p.PatNum = pl.PatNum
            LEFT JOIN appointment a ON a.AptNum = pl.AptNum
            LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum
            LEFT JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum
            WHERE pl.ProcStatus = 2
            ORDER BY pl.ProcNum DESC
            LIMIT 25
            """,
        )

        results["validation_checks"]["procedurecode_schema_full"] = fetch_all(
            cursor,
            """
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'procedurecode'
            ORDER BY ORDINAL_POSITION
            """,
        )

        results["validation_checks"]["procedurecode_financial_samples"] = fetch_all(
            cursor,
            """
            SELECT *
            FROM procedurecode
            WHERE ProcCode IN ('PAY', 'owe', 'Deprct', 'cg02', 'cg17', 'otherp')
            ORDER BY ProcCode
            """,
        )

        return results
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    try:
        print(json.dumps(run_validation(), indent=2, default=str))
    except Exception as exc:
        print(str(exc))
        traceback.print_exc()
        raise
