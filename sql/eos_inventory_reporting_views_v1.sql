-- EOS inventory reporting views (v1)
-- Purpose:
--   Management and operational reporting over ledger-driven inventory.

BEGIN;

CREATE OR REPLACE VIEW vw_inv_stock_by_department AS
SELECT
  d.department_id,
  d.department_code,
  d.department_name,
  p.product_id,
  p.sku,
  p.product_name,
  sb.on_hand_qty,
  sb.reserved_qty,
  sb.available_qty,
  sb.avg_cost,
  (sb.on_hand_qty * sb.avg_cost) AS stock_value
FROM inv_stock_balance sb
JOIN inv_department d ON d.department_id = sb.department_id
JOIN inv_product p ON p.product_id = sb.product_id;

CREATE OR REPLACE VIEW vw_inv_low_stock AS
SELECT
  d.department_code,
  p.sku,
  p.product_name,
  sb.available_qty,
  pd.min_qty,
  pd.reorder_qty,
  pd.max_qty
FROM inv_stock_balance sb
JOIN inv_product_department pd
  ON pd.product_id = sb.product_id
 AND pd.department_id = sb.department_id
JOIN inv_department d ON d.department_id = sb.department_id
JOIN inv_product p ON p.product_id = sb.product_id
WHERE pd.is_stocked = TRUE
  AND sb.available_qty <= pd.min_qty;

CREATE OR REPLACE VIEW vw_inv_in_transit AS
SELECT
  t.product_id,
  p.sku,
  p.product_name,
  src.department_code AS source_department_code,
  tgt.department_code AS target_department_code,
  t.in_transit_qty,
  t.updated_at
FROM inv_stock_in_transit t
JOIN inv_product p ON p.product_id = t.product_id
JOIN inv_department src ON src.department_id = t.source_department_id
JOIN inv_department tgt ON tgt.department_id = t.target_department_id;

CREATE OR REPLACE VIEW vw_inv_transfer_status AS
SELECT
  h.transfer_id,
  h.transfer_number,
  h.transfer_status,
  src.department_code AS source_department_code,
  tgt.department_code AS target_department_code,
  h.created_at,
  h.dispatched_at,
  h.received_at,
  h.expected_arrival_date,
  CASE
    WHEN h.transfer_status IN ('dispatched', 'partially_received')
      AND h.expected_arrival_date IS NOT NULL
      AND h.expected_arrival_date < CURRENT_DATE THEN TRUE
    ELSE FALSE
  END AS is_overdue
FROM inv_transfer_header h
JOIN inv_department src ON src.department_id = h.source_department_id
JOIN inv_department tgt ON tgt.department_id = h.target_department_id;

CREATE OR REPLACE VIEW vw_inv_movement_history AS
SELECT
  l.ledger_id,
  l.posting_ts,
  d.department_code,
  p.sku,
  p.product_name,
  l.document_type_code,
  l.movement_reason_code,
  l.qty_in,
  l.qty_out,
  l.qty_delta,
  l.value_delta,
  l.external_source,
  l.external_reference
FROM inv_ledger l
JOIN inv_department d ON d.department_id = l.department_id
JOIN inv_product p ON p.product_id = l.product_id;

CREATE OR REPLACE VIEW vw_inv_writeoff_shrinkage AS
SELECT
  d.department_code,
  p.sku,
  p.product_name,
  l.movement_reason_code,
  SUM(l.qty_out) AS total_qty_out,
  SUM(l.value_out) AS total_value_out
FROM inv_ledger l
JOIN inv_department d ON d.department_id = l.department_id
JOIN inv_product p ON p.product_id = l.product_id
WHERE l.movement_reason_code IN ('WRITE_OFF_DAMAGED', 'WRITE_OFF_EXPIRED', 'WRITE_OFF_LOST')
GROUP BY d.department_code, p.sku, p.product_name, l.movement_reason_code;

CREATE OR REPLACE VIEW vw_inv_stock_value_by_department AS
SELECT
  d.department_id,
  d.department_code,
  d.department_name,
  SUM(sb.on_hand_qty * sb.avg_cost) AS total_stock_value
FROM inv_stock_balance sb
JOIN inv_department d ON d.department_id = sb.department_id
GROUP BY d.department_id, d.department_code, d.department_name;

CREATE OR REPLACE VIEW vw_inv_slow_moving_items AS
SELECT
  d.department_code,
  p.sku,
  p.product_name,
  MAX(l.posting_ts) AS last_movement_ts,
  EXTRACT(DAY FROM (NOW() - MAX(l.posting_ts)))::INT AS days_since_last_movement
FROM inv_stock_balance sb
JOIN inv_department d ON d.department_id = sb.department_id
JOIN inv_product p ON p.product_id = sb.product_id
LEFT JOIN inv_ledger l
  ON l.product_id = sb.product_id
 AND l.department_id = sb.department_id
GROUP BY d.department_code, p.sku, p.product_name
HAVING MAX(l.posting_ts) IS NULL OR MAX(l.posting_ts) < NOW() - INTERVAL '60 days';

CREATE OR REPLACE VIEW vw_inv_expiring_items AS
SELECT
  d.department_code,
  p.sku,
  p.product_name,
  dl.expiry_date,
  SUM(dl.qty) AS document_qty
FROM inv_document_line dl
JOIN inv_document_header dh ON dh.document_id = dl.document_id
JOIN inv_department d ON d.department_id = COALESCE(dh.target_department_id, dh.source_department_id)
JOIN inv_product p ON p.product_id = dl.product_id
WHERE dl.expiry_date IS NOT NULL
  AND dl.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
GROUP BY d.department_code, p.sku, p.product_name, dl.expiry_date;

COMMIT;
