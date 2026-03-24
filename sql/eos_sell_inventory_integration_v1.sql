-- EOS SELL -> Inventory integration (v1)
-- Purpose:
--   Make SELL transactions inventory-aware with deterministic posting behavior:
--   - Positive sell qty (stock-tracked) => SALE_ISSUE, ledger OUT
--   - Negative sell qty (stock return) => SALE_RETURN, ledger IN
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_sell_inventory_integration_v1.sql

BEGIN;

-- =========================================================
-- 1. BUNDLE STOCK COMPONENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_bundle_component (
  bundle_product_id       BIGINT NOT NULL REFERENCES inv_product(product_id) ON DELETE CASCADE,
  component_product_id    BIGINT NOT NULL REFERENCES inv_product(product_id) ON DELETE CASCADE,
  component_qty           NUMERIC(14,4) NOT NULL CHECK (component_qty > 0),
  is_stock_component      BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (bundle_product_id, component_product_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_bundle_component_component
  ON inv_bundle_component(component_product_id)
  WHERE is_active = TRUE;

-- =========================================================
-- 2. ELIGIBILITY VIEW FOR INVENTORY-RELEVANT SELL LINES
-- =========================================================

CREATE OR REPLACE VIEW vw_sell_inventory_eligible_line_v1 AS
SELECT
  h.sell_txn_id,
  h.txn_number,
  h.department_id,
  h.status AS sell_status,
  l.sell_txn_line_id,
  l.line_no,
  l.product_id,
  l.qty,
  l.unit_cost_snapshot,
  p.product_type,
  p.track_inventory,
  CASE
    WHEN p.track_inventory IS NOT TRUE THEN FALSE
    WHEN p.product_type IN ('stock_item', 'consumable') THEN TRUE
    WHEN p.product_type = 'bundle'
      AND EXISTS (
        SELECT 1
        FROM inv_bundle_component bc
        WHERE bc.bundle_product_id = p.product_id
          AND bc.is_stock_component = TRUE
          AND bc.is_active = TRUE
      ) THEN TRUE
    ELSE FALSE
  END AS inventory_relevant,
  CASE
    WHEN p.track_inventory IS NOT TRUE THEN 'track_inventory_false'
    WHEN p.product_type IN ('stock_item', 'consumable') THEN 'stock_type_direct'
    WHEN p.product_type = 'bundle'
      AND EXISTS (
        SELECT 1
        FROM inv_bundle_component bc
        WHERE bc.bundle_product_id = p.product_id
          AND bc.is_stock_component = TRUE
          AND bc.is_active = TRUE
      ) THEN 'bundle_stock_component'
    WHEN p.product_type = 'bundle' THEN 'bundle_without_stock_components'
    ELSE 'non_stock_type'
  END AS relevance_reason
FROM sell_transaction_header h
JOIN sell_transaction_line l
  ON l.sell_txn_id = h.sell_txn_id
JOIN inv_product p
  ON p.product_id = l.product_id;

-- =========================================================
-- 3. POSTING FUNCTION: SELL -> INVENTORY DOCUMENTS + LEDGER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_sell_sync_inventory_documents_v1(
  p_sell_txn_id BIGINT,
  p_posted_by BIGINT DEFAULT NULL
)
RETURNS TABLE (
  issue_document_id BIGINT,
  return_document_id BIGINT,
  issue_line_count INTEGER,
  return_line_count INTEGER,
  issue_ledger_count INTEGER,
  return_ledger_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_txn_number TEXT;
  v_department_id BIGINT;
  v_created_by BIGINT;
  v_effective_posted_by BIGINT;
  v_issue_doc_id BIGINT;
  v_return_doc_id BIGINT;
  v_issue_lines INTEGER := 0;
  v_return_lines INTEGER := 0;
  v_issue_ledgers INTEGER := 0;
  v_return_ledgers INTEGER := 0;
BEGIN
  SELECT h.txn_number, h.department_id, h.created_by
    INTO v_txn_number, v_department_id, v_created_by
  FROM sell_transaction_header h
  WHERE h.sell_txn_id = p_sell_txn_id;

  IF v_txn_number IS NULL THEN
    RAISE EXCEPTION 'SELL transaction % not found', p_sell_txn_id;
  END IF;

  v_effective_posted_by := COALESCE(p_posted_by, v_created_by);

  -- SALE_ISSUE header: create or reuse when there are eligible positive qty lines.
  IF EXISTS (
    SELECT 1
    FROM vw_sell_inventory_eligible_line_v1 e
    WHERE e.sell_txn_id = p_sell_txn_id
      AND e.inventory_relevant = TRUE
      AND e.qty > 0
  ) THEN
    SELECT d.document_id
      INTO v_issue_doc_id
    FROM inv_document_header d
    WHERE d.document_type_code = 'SALE_ISSUE'
      AND d.external_source = 'SELL'
      AND d.external_reference = v_txn_number
    ORDER BY d.document_id
    LIMIT 1;

    IF v_issue_doc_id IS NULL THEN
      INSERT INTO inv_document_header (
        document_type_code,
        document_number,
        status,
        source_department_id,
        target_department_id,
        external_source,
        external_reference,
        notes,
        created_by,
        approved_by,
        posted_by,
        document_date,
        approved_at,
        posted_at
      )
      VALUES (
        'SALE_ISSUE',
        'SALE_ISSUE-' || p_sell_txn_id::text,
        'posted',
        v_department_id,
        NULL,
        'SELL',
        v_txn_number,
        'Auto-generated from SELL transaction',
        v_effective_posted_by,
        v_effective_posted_by,
        v_effective_posted_by,
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      RETURNING document_id INTO v_issue_doc_id;
    END IF;

    INSERT INTO inv_document_line (
      document_id,
      line_no,
      product_id,
      uom_id,
      qty,
      unit_cost,
      line_notes
    )
    SELECT
      v_issue_doc_id,
      e.line_no,
      e.product_id,
      p.base_uom_id,
      e.qty,
      COALESCE(e.unit_cost_snapshot, 0),
      'Auto-generated from SELL line ' || e.sell_txn_line_id::text
    FROM vw_sell_inventory_eligible_line_v1 e
    JOIN inv_product p
      ON p.product_id = e.product_id
    WHERE e.sell_txn_id = p_sell_txn_id
      AND e.inventory_relevant = TRUE
      AND e.qty > 0
      AND NOT EXISTS (
        SELECT 1
        FROM inv_document_line dl
        WHERE dl.document_id = v_issue_doc_id
          AND dl.line_no = e.line_no
      );

    GET DIAGNOSTICS v_issue_lines = ROW_COUNT;

    UPDATE sell_transaction_line l
    SET linked_document_id = v_issue_doc_id
    WHERE l.sell_txn_id = p_sell_txn_id
      AND l.qty > 0
      AND EXISTS (
        SELECT 1
        FROM vw_sell_inventory_eligible_line_v1 e
        WHERE e.sell_txn_line_id = l.sell_txn_line_id
          AND e.inventory_relevant = TRUE
      )
      AND COALESCE(l.linked_document_id, 0) <> v_issue_doc_id;

    INSERT INTO inv_ledger (
      posting_ts,
      posting_date,
      product_id,
      department_id,
      document_id,
      document_line_id,
      document_type_code,
      movement_reason_code,
      qty_in,
      qty_out,
      qty_delta,
      unit_cost,
      value_in,
      value_out,
      value_delta,
      source_department_id,
      target_department_id,
      external_source,
      external_reference,
      posted_by,
      comments
    )
    SELECT
      NOW(),
      CURRENT_DATE,
      dl.product_id,
      v_department_id,
      v_issue_doc_id,
      dl.document_line_id,
      'SALE_ISSUE',
      'SALE',
      0,
      dl.qty,
      -dl.qty,
      COALESCE(dl.unit_cost, 0),
      0,
      COALESCE(dl.qty, 0) * COALESCE(dl.unit_cost, 0),
      -(COALESCE(dl.qty, 0) * COALESCE(dl.unit_cost, 0)),
      v_department_id,
      NULL,
      'SELL',
      v_txn_number,
      v_effective_posted_by,
      'Auto-posted SALE issue from SELL'
    FROM inv_document_line dl
    WHERE dl.document_id = v_issue_doc_id
      AND NOT EXISTS (
        SELECT 1
        FROM inv_ledger l
        WHERE l.document_line_id = dl.document_line_id
          AND l.document_type_code = 'SALE_ISSUE'
          AND l.movement_reason_code = 'SALE'
      );

    GET DIAGNOSTICS v_issue_ledgers = ROW_COUNT;
  END IF;

  -- SALE_RETURN header: create or reuse when there are eligible negative qty lines.
  IF EXISTS (
    SELECT 1
    FROM vw_sell_inventory_eligible_line_v1 e
    WHERE e.sell_txn_id = p_sell_txn_id
      AND e.inventory_relevant = TRUE
      AND e.qty < 0
  ) THEN
    SELECT d.document_id
      INTO v_return_doc_id
    FROM inv_document_header d
    WHERE d.document_type_code = 'SALE_RETURN'
      AND d.external_source = 'SELL'
      AND d.external_reference = v_txn_number
    ORDER BY d.document_id
    LIMIT 1;

    IF v_return_doc_id IS NULL THEN
      INSERT INTO inv_document_header (
        document_type_code,
        document_number,
        status,
        source_department_id,
        target_department_id,
        external_source,
        external_reference,
        notes,
        created_by,
        approved_by,
        posted_by,
        document_date,
        approved_at,
        posted_at
      )
      VALUES (
        'SALE_RETURN',
        'SALE_RETURN-' || p_sell_txn_id::text,
        'posted',
        NULL,
        v_department_id,
        'SELL',
        v_txn_number,
        'Auto-generated stock return from SELL transaction',
        v_effective_posted_by,
        v_effective_posted_by,
        v_effective_posted_by,
        CURRENT_DATE,
        NOW(),
        NOW()
      )
      RETURNING document_id INTO v_return_doc_id;
    END IF;

    INSERT INTO inv_document_line (
      document_id,
      line_no,
      product_id,
      uom_id,
      qty,
      unit_cost,
      line_notes
    )
    SELECT
      v_return_doc_id,
      e.line_no,
      e.product_id,
      p.base_uom_id,
      ABS(e.qty),
      COALESCE(e.unit_cost_snapshot, 0),
      'Auto-generated return from SELL line ' || e.sell_txn_line_id::text
    FROM vw_sell_inventory_eligible_line_v1 e
    JOIN inv_product p
      ON p.product_id = e.product_id
    WHERE e.sell_txn_id = p_sell_txn_id
      AND e.inventory_relevant = TRUE
      AND e.qty < 0
      AND NOT EXISTS (
        SELECT 1
        FROM inv_document_line dl
        WHERE dl.document_id = v_return_doc_id
          AND dl.line_no = e.line_no
      );

    GET DIAGNOSTICS v_return_lines = ROW_COUNT;

    UPDATE sell_transaction_line l
    SET linked_document_id = v_return_doc_id
    WHERE l.sell_txn_id = p_sell_txn_id
      AND l.qty < 0
      AND EXISTS (
        SELECT 1
        FROM vw_sell_inventory_eligible_line_v1 e
        WHERE e.sell_txn_line_id = l.sell_txn_line_id
          AND e.inventory_relevant = TRUE
      )
      AND COALESCE(l.linked_document_id, 0) <> v_return_doc_id;

    INSERT INTO inv_ledger (
      posting_ts,
      posting_date,
      product_id,
      department_id,
      document_id,
      document_line_id,
      document_type_code,
      movement_reason_code,
      qty_in,
      qty_out,
      qty_delta,
      unit_cost,
      value_in,
      value_out,
      value_delta,
      source_department_id,
      target_department_id,
      external_source,
      external_reference,
      posted_by,
      comments
    )
    SELECT
      NOW(),
      CURRENT_DATE,
      dl.product_id,
      v_department_id,
      v_return_doc_id,
      dl.document_line_id,
      'SALE_RETURN',
      'SALE_RETURN_IN',
      dl.qty,
      0,
      dl.qty,
      COALESCE(dl.unit_cost, 0),
      COALESCE(dl.qty, 0) * COALESCE(dl.unit_cost, 0),
      0,
      (COALESCE(dl.qty, 0) * COALESCE(dl.unit_cost, 0)),
      NULL,
      v_department_id,
      'SELL',
      v_txn_number,
      v_effective_posted_by,
      'Auto-posted SALE return from SELL'
    FROM inv_document_line dl
    WHERE dl.document_id = v_return_doc_id
      AND NOT EXISTS (
        SELECT 1
        FROM inv_ledger l
        WHERE l.document_line_id = dl.document_line_id
          AND l.document_type_code = 'SALE_RETURN'
          AND l.movement_reason_code = 'SALE_RETURN_IN'
      );

    GET DIAGNOSTICS v_return_ledgers = ROW_COUNT;
  END IF;

  RETURN QUERY
  SELECT
    v_issue_doc_id,
    v_return_doc_id,
    v_issue_lines,
    v_return_lines,
    v_issue_ledgers,
    v_return_ledgers;
END;
$$;

COMMIT;
