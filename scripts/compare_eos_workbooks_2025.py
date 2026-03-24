#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import openpyxl

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def detect_family(sheet_name: str) -> str:
    n = normalize_name(sheet_name)
    if "paysummary" in n:
        return "PAY SUMMARY"
    if n == "entry" or n.endswith("entry"):
        return "ENTRY"
    if "sell" in n:
        return "SELL"
    if "fee" in n:
        return "FEE"
    if "pay" in n:
        return "PAY"
    return "OTHER"


def detect_month(sheet_name: str) -> str | None:
    n = normalize_name(sheet_name)
    for m in MONTHS:
        if n.startswith(m) or m in n:
            return m.upper()
    return None


def has_data(values: list[Any]) -> bool:
    for v in values:
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return True
    return False


def is_date_like(v: Any) -> bool:
    if isinstance(v, (dt.date, dt.datetime)):
        return True
    if isinstance(v, str):
        t = v.strip()
        return bool(re.match(r"^\d{4}-\d{2}-\d{2}", t))
    return False


def is_numeric_like(v: Any) -> bool:
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        t = v.strip().replace(",", "")
        return bool(re.match(r"^[+-]?[0-9]+(\.[0-9]+)?$", t))
    return False


def is_header_like_a_to_o(a_to_o: list[Any]) -> bool:
    a = (str(a_to_o[0]).strip().lower() if a_to_o[0] is not None else "")
    b = (str(a_to_o[1]).strip().lower() if a_to_o[1] is not None else "")
    e = (str(a_to_o[4]).strip().lower() if a_to_o[4] is not None else "")
    f = (str(a_to_o[5]).strip().lower() if a_to_o[5] is not None else "")
    return (
        a in {"department", "dept"}
        or b in {"date", "paid date"}
        or e in {"what did you pay for"}
        or f in {"paid to"}
    )


def to_text(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


@dataclass
class SheetStats:
    sheet_name: str
    family: str
    month: str | None
    nonempty_rows: int
    tx_candidate_rows: int
    date_nonnull: int
    payment_nonnull: int
    receipt_nonnull: int
    ex_vat_nonnull: int
    vat_nonnull: int
    total_nonnull: int
    cost_nature_nonnull: int


def profile_sheet(ws, family: str) -> SheetStats:
    nonempty_rows = 0
    tx_candidate_rows = 0
    date_nonnull = 0
    payment_nonnull = 0
    receipt_nonnull = 0
    ex_vat_nonnull = 0
    vat_nonnull = 0
    total_nonnull = 0
    cost_nature_nonnull = 0

    for row in ws.iter_rows(values_only=True):
        a_to_o = list(row[:15])
        if len(a_to_o) < 15:
            a_to_o.extend([None] * (15 - len(a_to_o)))

        if not has_data(a_to_o):
            continue
        nonempty_rows += 1

        if is_header_like_a_to_o(a_to_o):
            continue

        date_v = a_to_o[1]
        cost_nature_v = a_to_o[5]
        payment_v = a_to_o[9]
        receipt_v = a_to_o[10]
        ex_vat_v = a_to_o[11]
        vat_v = a_to_o[12]
        total_v = a_to_o[13]

        is_tx = is_date_like(date_v) or is_numeric_like(ex_vat_v) or is_numeric_like(vat_v) or is_numeric_like(total_v)
        if not is_tx:
            continue

        tx_candidate_rows += 1
        if to_text(date_v):
            date_nonnull += 1
        if to_text(cost_nature_v):
            cost_nature_nonnull += 1
        if to_text(payment_v):
            payment_nonnull += 1
        if to_text(receipt_v):
            receipt_nonnull += 1
        if to_text(ex_vat_v):
            ex_vat_nonnull += 1
        if to_text(vat_v):
            vat_nonnull += 1
        if to_text(total_v):
            total_nonnull += 1

    return SheetStats(
        sheet_name=ws.title,
        family=family,
        month=detect_month(ws.title),
        nonempty_rows=nonempty_rows,
        tx_candidate_rows=tx_candidate_rows,
        date_nonnull=date_nonnull,
        payment_nonnull=payment_nonnull,
        receipt_nonnull=receipt_nonnull,
        ex_vat_nonnull=ex_vat_nonnull,
        vat_nonnull=vat_nonnull,
        total_nonnull=total_nonnull,
        cost_nature_nonnull=cost_nature_nonnull,
    )


def aggregate(stats: list[SheetStats]) -> dict[str, Any]:
    fam_counts: dict[str, int] = {}
    monthly: dict[str, dict[str, int]] = {"PAY": {}, "FEE": {}}
    totals = {
        "PAY": {
            "tx_candidate_rows": 0,
            "date_nonnull": 0,
            "payment_nonnull": 0,
            "receipt_nonnull": 0,
            "ex_vat_nonnull": 0,
            "vat_nonnull": 0,
            "total_nonnull": 0,
            "cost_nature_nonnull": 0,
        },
        "FEE": {
            "tx_candidate_rows": 0,
            "date_nonnull": 0,
            "payment_nonnull": 0,
            "receipt_nonnull": 0,
            "ex_vat_nonnull": 0,
            "vat_nonnull": 0,
            "total_nonnull": 0,
            "cost_nature_nonnull": 0,
        },
    }

    for s in stats:
        fam_counts[s.family] = fam_counts.get(s.family, 0) + 1
        if s.family in ("PAY", "FEE") and s.month is not None:
            monthly[s.family][s.month] = monthly[s.family].get(s.month, 0) + s.tx_candidate_rows
            t = totals[s.family]
            t["tx_candidate_rows"] += s.tx_candidate_rows
            t["date_nonnull"] += s.date_nonnull
            t["payment_nonnull"] += s.payment_nonnull
            t["receipt_nonnull"] += s.receipt_nonnull
            t["ex_vat_nonnull"] += s.ex_vat_nonnull
            t["vat_nonnull"] += s.vat_nonnull
            t["total_nonnull"] += s.total_nonnull
            t["cost_nature_nonnull"] += s.cost_nature_nonnull

    coverage: dict[str, dict[str, float]] = {}
    for fam in ("PAY", "FEE"):
        tx = max(totals[fam]["tx_candidate_rows"], 1)
        coverage[fam] = {
            "date_pct": round(100.0 * totals[fam]["date_nonnull"] / tx, 2),
            "payment_pct": round(100.0 * totals[fam]["payment_nonnull"] / tx, 2),
            "receipt_pct": round(100.0 * totals[fam]["receipt_nonnull"] / tx, 2),
            "ex_vat_pct": round(100.0 * totals[fam]["ex_vat_nonnull"] / tx, 2),
            "vat_pct": round(100.0 * totals[fam]["vat_nonnull"] / tx, 2),
            "total_pct": round(100.0 * totals[fam]["total_nonnull"] / tx, 2),
            "cost_nature_pct": round(100.0 * totals[fam]["cost_nature_nonnull"] / tx, 2),
        }

    return {
        "family_sheet_counts": fam_counts,
        "monthly_tx_rows": monthly,
        "family_totals": totals,
        "family_coverage_pct": coverage,
    }


def profile_workbook(path: Path) -> dict[str, Any]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    stats: list[SheetStats] = []
    for ws in wb.worksheets:
        fam = detect_family(ws.title)
        stats.append(profile_sheet(ws, fam))

    return {
        "path": str(path),
        "sheet_count": len(wb.worksheets),
        "summary": aggregate(stats),
        "sheets": [s.__dict__ for s in stats],
    }


def main() -> None:
    base = Path(r"C:\Users\User\Desktop\CURRENT BACKUP")
    targets = [
        base / "EOSZ - 2025.xlsx",
        base / "EOSQ - 2025.xlsx",
    ]
    optional = [
        base / "EOSZ.xlsx",
        base / "EOSQ.xlsx",
    ]

    result: dict[str, Any] = {"profiles": {}, "optional_profiles": {}}
    for t in targets:
        if t.exists():
            result["profiles"][t.name] = profile_workbook(t)
        else:
            result["profiles"][t.name] = {"missing": True, "path": str(t)}

    for o in optional:
        if o.exists():
            result["optional_profiles"][o.name] = profile_workbook(o)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
