-- EOS location compatibility guards (v1)
-- Purpose:
--   Keep location columns optional for backward compatibility and preserve
--   department-level aggregate contract from inv_ledger.

BEGIN;

ALTER TABLE inv_ledger ALTER COLUMN location_id DROP NOT NULL;
ALTER TABLE inv_ledger ALTER COLUMN source_location_id DROP NOT NULL;
ALTER TABLE inv_ledger ALTER COLUMN target_location_id DROP NOT NULL;

-- Department-level aggregate must include both location-tagged and legacy rows.
CREATE OR REPLACE VIEW vw_inv_stock_position_by_department AS
SELECT
    l.product_id,
    l.department_id,
    SUM(l.qty_delta) AS on_hand_qty,
    SUM(l.value_delta) AS stock_value
FROM inv_ledger l
GROUP BY
    l.product_id,
    l.department_id;

COMMIT;
