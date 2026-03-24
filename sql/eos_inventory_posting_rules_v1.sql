-- EOS inventory posting rules (v1)
-- Purpose:
--   Codify exact ledger posting behavior by business event.
--   Seed movement reasons required by the posting policy.
--   Provide a deterministic reorder suggestion formula view by department.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_inventory_posting_rules_v1.sql

BEGIN;

-- =========================================================
-- 1. MOVEMENT REASONS REQUIRED BY POLICY
-- =========================================================

INSERT INTO inv_movement_reason (
  movement_reason_code,
  movement_reason_name,
  movement_class
)
VALUES
  ('OPENING_BALANCE', 'Opening Balance', 'receipt'),
  ('PURCHASE_RECEIPT_IN', 'Purchase Receipt In', 'receipt'),
  ('TRANSFER_OUT', 'Transfer Out', 'transfer_out'),
  ('TRANSFER_IN', 'Transfer In', 'transfer_in'),
  ('SALE', 'Sale', 'sale'),
  ('SALE_RETURN_IN', 'Sale Return In', 'return_in'),
  ('CONSUMPTION_USE', 'Clinical Consumption Use', 'consumption'),
  ('ADJUSTMENT_GAIN', 'Stock Count Adjustment Gain', 'adjustment_gain'),
  ('ADJUSTMENT_LOSS', 'Stock Count Adjustment Loss', 'adjustment_loss'),
  ('WRITE_OFF_DAMAGED', 'Write-Off Damaged', 'writeoff'),
  ('WRITE_OFF_EXPIRED', 'Write-Off Expired', 'writeoff'),
  ('RESERVATION_HOLD', 'Reservation Hold', 'reservation'),
  ('RESERVATION_RELEASE', 'Reservation Release', 'release')
ON CONFLICT (movement_reason_code) DO UPDATE
SET
  movement_reason_name = EXCLUDED.movement_reason_name,
  movement_class = EXCLUDED.movement_class;

-- =========================================================
-- 2. BUSINESS EVENT RULE CATALOG
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_business_event_rule (
  business_event_code      TEXT PRIMARY KEY,
  business_event_name      TEXT NOT NULL,
  posting_pattern          TEXT NOT NULL CHECK (
                            posting_pattern IN (
                              'single_in',
                              'single_out',
                              'dual_transfer',
                              'variance_based',
                              'none'
                            )
                          ),
  writes_ledger            BOOLEAN NOT NULL DEFAULT TRUE,
  document_type_code       TEXT REFERENCES inv_document_type(document_type_code),
  integration_domain       TEXT NOT NULL CHECK (
                            integration_domain IN (
                              'inventory',
                              'procurement',
                              'sell',
                              'clinic',
                              'system'
                            )
                          ),
  integration_notes        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inv_business_event_rule_leg (
  business_event_code      TEXT NOT NULL REFERENCES inv_business_event_rule(business_event_code) ON DELETE CASCADE,
  leg_no                   INTEGER NOT NULL,
  movement_reason_code     TEXT NOT NULL REFERENCES inv_movement_reason(movement_reason_code),
  department_role          TEXT NOT NULL CHECK (
                            department_role IN (
                              'receiving_department',
                              'source_department',
                              'target_department',
                              'selling_department',
                              'return_department',
                              'consuming_department',
                              'count_department',
                              'writeoff_department'
                            )
                          ),
  direction                TEXT NOT NULL CHECK (
                            direction IN (
                              'in',
                              'out',
                              'conditional_in',
                              'conditional_out'
                            )
                          ),
  formula_text             TEXT NOT NULL,
  PRIMARY KEY (business_event_code, leg_no)
);

-- =========================================================
-- 3. RULE SEEDS: EXACT POSTING RULES BY BUSINESS EVENT
-- =========================================================

INSERT INTO inv_business_event_rule (
  business_event_code,
  business_event_name,
  posting_pattern,
  writes_ledger,
  document_type_code,
  integration_domain,
  integration_notes
)
VALUES
  (
    'OPENING_BALANCE',
    'Opening balance migration',
    'single_in',
    TRUE,
    'OPENING',
    'system',
    'One ledger IN line per product plus department with positive quantity and value.'
  ),
  (
    'PURCHASE_RECEIPT',
    'Purchase receipt to receiving department',
    'single_in',
    TRUE,
    'PO_RECEIPT',
    'procurement',
    'Purchase order alone does not affect inventory; stock changes on receipt only.'
  ),
  (
    'DEPARTMENT_TRANSFER',
    'Department transfer source out and target in',
    'dual_transfer',
    TRUE,
    'TRANSFER',
    'inventory',
    'Two ledger postings per line: source OUT then target IN; global stock unchanged.'
  ),
  (
    'SALE_ISSUE_FROM_SELL',
    'Sale issue from SELL transaction',
    'single_out',
    TRUE,
    'SALE_ISSUE',
    'sell',
    'sell_transaction_line.linked_document_id points to generated inventory issue document; external_source=SELL and external_reference=txn_number.'
  ),
  (
    'SALE_RETURN',
    'Sale return accepted back into inventory',
    'single_in',
    TRUE,
    'SALE_RETURN',
    'sell',
    'Posts IN to return department when return is accepted into inventory.'
  ),
  (
    'CLINICAL_CONSUMPTION',
    'Clinical consumption usage',
    'single_out',
    TRUE,
    'CONSUMPTION',
    'clinic',
    'Link document back to inv_consumption_header with patient or treatment or provider references as needed.'
  ),
  (
    'STOCK_COUNT_ADJUSTMENT',
    'Stock count variance adjustment',
    'variance_based',
    TRUE,
    'ADJUSTMENT',
    'inventory',
    'If variance > 0 post adjustment gain IN; if variance < 0 post adjustment loss OUT.'
  ),
  (
    'WRITE_OFF',
    'Write-off damaged or expired stock',
    'single_out',
    TRUE,
    'WRITE_OFF',
    'inventory',
    'Use WRITE_OFF_DAMAGED or WRITE_OFF_EXPIRED reason based on cause.'
  ),
  (
    'RESERVATION',
    'Reservation hold without physical movement',
    'none',
    FALSE,
    'RESERVATION',
    'inventory',
    'Reservation does not write inventory ledger while physical stock has not moved.'
  ),
  (
    'RESERVATION_RELEASE',
    'Reservation release without physical movement',
    'none',
    FALSE,
    'RELEASE',
    'inventory',
    'Reservation release does not write inventory ledger while physical stock has not moved.'
  )
ON CONFLICT (business_event_code) DO UPDATE
SET
  business_event_name = EXCLUDED.business_event_name,
  posting_pattern = EXCLUDED.posting_pattern,
  writes_ledger = EXCLUDED.writes_ledger,
  document_type_code = EXCLUDED.document_type_code,
  integration_domain = EXCLUDED.integration_domain,
  integration_notes = EXCLUDED.integration_notes,
  updated_at = NOW();

INSERT INTO inv_business_event_rule_leg (
  business_event_code,
  leg_no,
  movement_reason_code,
  department_role,
  direction,
  formula_text
)
VALUES
  (
    'OPENING_BALANCE',
    1,
    'OPENING_BALANCE',
    'receiving_department',
    'in',
    'qty_in = line.qty; qty_delta = +line.qty; value_in = line.qty * line.unit_cost; value_delta = +(line.qty * line.unit_cost)'
  ),
  (
    'PURCHASE_RECEIPT',
    1,
    'PURCHASE_RECEIPT_IN',
    'receiving_department',
    'in',
    'qty_in = received_qty; qty_delta = +received_qty; value_in = received_qty * unit_cost; value_delta = +(received_qty * unit_cost)'
  ),
  (
    'DEPARTMENT_TRANSFER',
    1,
    'TRANSFER_OUT',
    'source_department',
    'out',
    'qty_out = qty; qty_delta = -qty; value_out = qty * source_cost; value_delta = -(qty * source_cost)'
  ),
  (
    'DEPARTMENT_TRANSFER',
    2,
    'TRANSFER_IN',
    'target_department',
    'in',
    'qty_in = qty; qty_delta = +qty; value_in = qty * transferred_cost; value_delta = +(qty * transferred_cost)'
  ),
  (
    'SALE_ISSUE_FROM_SELL',
    1,
    'SALE',
    'selling_department',
    'out',
    'qty_out = sold_qty; qty_delta = -sold_qty; inventory ledger records stock issue only; revenue remains on SELL side'
  ),
  (
    'SALE_RETURN',
    1,
    'SALE_RETURN_IN',
    'return_department',
    'in',
    'qty_in = return_qty; qty_delta = +return_qty'
  ),
  (
    'CLINICAL_CONSUMPTION',
    1,
    'CONSUMPTION_USE',
    'consuming_department',
    'out',
    'qty_out = consumed_qty; qty_delta = -consumed_qty'
  ),
  (
    'STOCK_COUNT_ADJUSTMENT',
    1,
    'ADJUSTMENT_GAIN',
    'count_department',
    'conditional_in',
    'if variance > 0: qty_in = variance; qty_delta = +variance'
  ),
  (
    'STOCK_COUNT_ADJUSTMENT',
    2,
    'ADJUSTMENT_LOSS',
    'count_department',
    'conditional_out',
    'if variance < 0: qty_out = abs(variance); qty_delta = -abs(variance)'
  ),
  (
    'WRITE_OFF',
    1,
    'WRITE_OFF_DAMAGED',
    'writeoff_department',
    'out',
    'qty_out = writeoff_qty; qty_delta = -writeoff_qty; reason may be WRITE_OFF_DAMAGED or WRITE_OFF_EXPIRED'
  )
ON CONFLICT (business_event_code, leg_no) DO UPDATE
SET
  movement_reason_code = EXCLUDED.movement_reason_code,
  department_role = EXCLUDED.department_role,
  direction = EXCLUDED.direction,
  formula_text = EXCLUDED.formula_text;

-- =========================================================
-- 4. REORDER FORMULA VIEW (BY DEPARTMENT)
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_reorder_formula_v1 AS
SELECT
  sb.department_id,
  sb.product_id,
  sb.on_hand_qty,
  sb.reserved_qty,
  sb.available_qty,
  pd.min_qty,
  pd.max_qty,
  pd.reorder_qty,
  pd.par_level_qty,
  pd.preferred_supplier_id,
  CASE
    WHEN sb.available_qty <= pd.min_qty
      THEN GREATEST(pd.max_qty - sb.available_qty, pd.reorder_qty)
    ELSE 0::NUMERIC
  END AS suggested_order_qty,
  CASE
    WHEN sb.available_qty <= pd.min_qty
      THEN 'below_or_at_min'
    ELSE 'above_min'
  END AS reorder_status
FROM inv_stock_balance sb
JOIN inv_product_department pd
  ON pd.product_id = sb.product_id
 AND pd.department_id = sb.department_id
WHERE pd.is_stocked = TRUE;

COMMIT;
