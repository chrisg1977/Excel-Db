# SELL Pilot Progress - 2026-03-12

Scope:
- EOSZ + EOSQ 2025 SELL sheets
- Provenance-first, strict reject-first compatible pipeline prep
- No PAY/FEE baseline changes

## 1) Structure Profile

Staging table availability:
- EOSQ SELL tables present for Jan-Dec (`stg.eosq_*sell`)
- EOSZ SELL tables present for Jan-Dec (`stg.eosz_*sell`)

Payload reality in current staging:
- EOSQ SELL: populated
- EOSZ SELL: no non-empty payload in current staged tables

Profile evidence (current run):
- EOSQ populated rows with payload across months: yes
- EOSZ rows with payload across months: 0

## 2) Transaction Rows vs Summaries

Current transaction row filter in `v_eos_sell_lines_raw_v1`:
- keep rows with non-empty product signal and at least one numeric amount signal
- exclude header/prompt rows such as `Product Name`, scanner prompts, and obvious template labels

Observed summary/header contamination still exists in raw sheets and is filtered in parser.

## 3) Raw Parser Implemented

Created:
- `sql/v_eos_sell_lines_raw_v1.sql`

Design:
- unions EOSZ/EOSQ Jan-Dec SELL staging tables
- preserves raw payload via `raw_payload_json`
- extracts and parses conservative fields only (date/shift/product/type/amounts/payment/signer)
- keeps unresolved fields as `NULL`

## 4) Candidate View Implemented

Created:
- `sql/v_eos_sell_candidates_v1.sql`

Design:
- source family fixed to `SELL`
- exposes raw + parsed + candidate + unresolved signals
- no forced defaults
- strict unresolved notes emitted

## 5) Readiness Assessment (Current)

From `v_eos_sell_candidates_v1`:
- Branch present: `EOSQ` only (EOSZ currently empty in staged SELL payload)
- Candidates: `816`
- `business_date_candidate` non-null: `687`
- `source_stage_candidate` non-null: `687`
- `payment_channel_candidate` non-null: `686`
- `receipt_state_candidate` non-null: `0`
- `total_amount_candidate` non-null: `739`
- Strict-ready count (A-E style strict dimensions): `0`

Interpretation:
- SELL is parseable enough for exploratory modeling.
- Strict loader readiness is blocked by missing reliable receipt-state signal in the current SELL contract.

## 6) Proposed Canonical SELL Model

Recommendation:
- Do not force SELL into PAY/FEE canonical tables.
- Introduce parallel SELL income canonical path:
  - `eos_shift_sell_income_lines` (canonical)
  - `eos_shift_sell_income_source_details` (sidecar)

Suggested canonical fields (v1):
- `shift_header_id` (shared header reuse)
- `source_candidate_id`
- `product_label_raw`
- `product_type_raw`
- `unit_size_raw`
- `payment_channel`
- `source_stage`
- `gross_amount`
- `ex_vat_amount` (nullable)
- `vat_amount` (nullable)
- `receipt_state` (nullable until contract clarified)
- `tax_code` (nullable)

Sidecar fields:
- raw extracted fields + full provenance metadata + optional raw payload snapshot reference

## 7) Current Blockers

1. EOSZ SELL staging payload is currently empty.
2. SELL receipt-state signal is not deterministically available in current source contract.
3. Column semantics drift month-to-month; robust mapping requires either:
   - stable upstream export contract, or
   - approved month-family mapping matrix.

## 8) Safe Next Step (SELL)

- Build a SELL strict loader in dry-run mode only (reject-table only, no canonical inserts) to quantify exact unresolved reasons at row level.
- Keep canonical inserts disabled until receipt-state policy and EOSZ SELL payload availability are confirmed.
