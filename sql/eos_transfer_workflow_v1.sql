-- EOS two-step transfer workflow foundation (v1)
-- Purpose:
--   Implement dispatch-then-receive inventory transfers with in-transit visibility,
--   partial receipt, damage/loss handling, cancellation/return logic, audit trail,
--   notifications, and compatibility with existing inv_* ledger design.

BEGIN;

-- =========================================================
-- 1) REFERENCE CODES
-- =========================================================

INSERT INTO inv_movement_reason (movement_reason_code, movement_reason_name, movement_class)
VALUES
  ('TRANSFER_CANCEL_RETURN', 'Transfer Cancel Return To Source', 'transfer_in'),
  ('WRITE_OFF_LOST', 'Write-Off Lost In Transit', 'writeoff')
ON CONFLICT (movement_reason_code) DO UPDATE
SET
  movement_reason_name = EXCLUDED.movement_reason_name,
  movement_class = EXCLUDED.movement_class;

INSERT INTO app_permission (permission_code, permission_name)
VALUES
  ('inv.transfer.dispatch', 'Dispatch transfers'),
  ('inv.transfer.receive', 'Receive transfers'),
  ('inv.transfer.cancel', 'Cancel transfers'),
  ('inv.transfer.reverse', 'Create reverse transfers')
ON CONFLICT (permission_code) DO NOTHING;

-- =========================================================
-- 2) TRANSFER CORE TABLES
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_transfer_header (
  transfer_id                 BIGSERIAL PRIMARY KEY,
  document_id                 BIGINT NOT NULL UNIQUE REFERENCES inv_document_header(document_id) ON DELETE CASCADE,
  transfer_number             TEXT NOT NULL UNIQUE,

  transfer_status             TEXT NOT NULL DEFAULT 'draft' CHECK (
                                transfer_status IN (
                                  'draft',
                                  'dispatched',
                                  'partially_received',
                                  'received',
                                  'cancelled'
                                )
                              ),

  created_by                  BIGINT NOT NULL REFERENCES app_user(user_id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  dispatched_by               BIGINT REFERENCES app_user(user_id),
  dispatched_at               TIMESTAMPTZ,

  received_by                 BIGINT REFERENCES app_user(user_id),
  received_at                 TIMESTAMPTZ,

  cancelled_by                BIGINT REFERENCES app_user(user_id),
  cancelled_at                TIMESTAMPTZ,

  source_department_id        BIGINT NOT NULL REFERENCES inv_department(department_id),
  target_department_id        BIGINT NOT NULL REFERENCES inv_department(department_id),

  notes_sender                TEXT,
  notes_receiver              TEXT,

  courier                     TEXT,
  transport_method            TEXT,
  tracking_number             TEXT,
  dispatch_reference          TEXT,
  expected_arrival_date       DATE,

  CONSTRAINT inv_transfer_header_source_target_chk
    CHECK (source_department_id <> target_department_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_transfer_header_status_target
  ON inv_transfer_header(transfer_status, target_department_id, expected_arrival_date);

CREATE TABLE IF NOT EXISTS inv_transfer_line (
  transfer_line_id             BIGSERIAL PRIMARY KEY,
  transfer_id                  BIGINT NOT NULL REFERENCES inv_transfer_header(transfer_id) ON DELETE CASCADE,
  line_no                      INTEGER NOT NULL,
  document_line_id             BIGINT UNIQUE REFERENCES inv_document_line(document_line_id) ON DELETE SET NULL,

  product_id                   BIGINT NOT NULL REFERENCES inv_product(product_id),
  uom_id                       BIGINT NOT NULL REFERENCES inv_unit_of_measure(uom_id),

  requested_qty                NUMERIC(14,4) NOT NULL CHECK (requested_qty > 0),
  dispatched_qty               NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  received_qty                 NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  damaged_qty                  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  lost_qty                     NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (lost_qty >= 0),
  remaining_qty                NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (remaining_qty >= 0),

  unit_cost                    NUMERIC(14,4) NOT NULL DEFAULT 0,
  line_notes                   TEXT,

  CONSTRAINT inv_transfer_line_dispatch_le_requested_chk
    CHECK (dispatched_qty <= requested_qty),

  CONSTRAINT inv_transfer_line_receipt_totals_chk
    CHECK ((received_qty + damaged_qty + lost_qty) <= dispatched_qty),

  CONSTRAINT inv_transfer_line_remaining_formula_chk
    CHECK (remaining_qty = (dispatched_qty - received_qty - damaged_qty - lost_qty)),

  UNIQUE (transfer_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_inv_transfer_line_transfer
  ON inv_transfer_line(transfer_id, product_id);

-- In-transit state by product + source/target pair
CREATE TABLE IF NOT EXISTS inv_stock_in_transit (
  product_id                   BIGINT NOT NULL REFERENCES inv_product(product_id),
  source_department_id         BIGINT NOT NULL REFERENCES inv_department(department_id),
  target_department_id         BIGINT NOT NULL REFERENCES inv_department(department_id),
  in_transit_qty               NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (in_transit_qty >= 0),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, source_department_id, target_department_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_stock_in_transit_target
  ON inv_stock_in_transit(target_department_id, product_id);

-- =========================================================
-- 3) TRANSFER NOTIFICATIONS / TASKS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_notification (
  notification_id              BIGSERIAL PRIMARY KEY,
  transfer_id                  BIGINT REFERENCES inv_transfer_header(transfer_id) ON DELETE CASCADE,
  department_id                BIGINT NOT NULL REFERENCES inv_department(department_id),
  user_id                      BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
  notification_type            TEXT NOT NULL CHECK (
                                notification_type IN (
                                  'transfer_dispatched',
                                  'transfer_overdue',
                                  'transfer_received',
                                  'transfer_cancelled'
                                )
                              ),
  status                       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done')),
  message                      TEXT NOT NULL,
  due_at                       TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at                      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_inv_notification_department_status
  ON inv_notification(department_id, status, created_at DESC);

-- =========================================================
-- 4) IMMUTABLE AUDIT TRAIL
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_transfer_audit (
  audit_id                     BIGSERIAL PRIMARY KEY,
  transfer_id                  BIGINT NOT NULL REFERENCES inv_transfer_header(transfer_id) ON DELETE CASCADE,
  action_type                  TEXT NOT NULL,
  user_id                      BIGINT REFERENCES app_user(user_id),
  action_ts                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_values                   JSONB,
  new_values                   JSONB
);

CREATE INDEX IF NOT EXISTS ix_inv_transfer_audit_transfer_ts
  ON inv_transfer_audit(transfer_id, action_ts DESC);

CREATE OR REPLACE FUNCTION fn_inv_transfer_audit_immutable_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inv_transfer_audit is immutable (operation: %)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_transfer_audit_no_update ON inv_transfer_audit;
CREATE TRIGGER trg_inv_transfer_audit_no_update
BEFORE UPDATE OR DELETE ON inv_transfer_audit
FOR EACH ROW EXECUTE FUNCTION fn_inv_transfer_audit_immutable_v1();

-- =========================================================
-- 5) STOCK POSITION VIEW (preserve existing contract)
-- =========================================================

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

-- =========================================================
-- 6) PENDING TRANSFERS DASHBOARD VIEW
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_pending_transfer_dashboard AS
SELECT
  h.target_department_id AS department_id,
  d.department_code,
  d.department_name,
  COUNT(*) FILTER (WHERE h.transfer_status = 'dispatched') AS dispatched_count,
  COUNT(*) FILTER (WHERE h.transfer_status = 'partially_received') AS partially_received_count,
  COUNT(*) FILTER (
    WHERE h.transfer_status IN ('dispatched', 'partially_received')
      AND h.expected_arrival_date IS NOT NULL
      AND h.expected_arrival_date < CURRENT_DATE
  ) AS overdue_count,
  MAX(h.dispatched_at) AS latest_dispatch_ts
FROM inv_transfer_header h
JOIN inv_department d
  ON d.department_id = h.target_department_id
GROUP BY h.target_department_id, d.department_code, d.department_name;

-- =========================================================
-- 7) CREATE TRANSFER (DRAFT)
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_create_v1(
  p_source_department_id BIGINT,
  p_target_department_id BIGINT,
  p_created_by BIGINT,
  p_notes_sender TEXT,
  p_expected_arrival_date DATE,
  p_courier TEXT,
  p_transport_method TEXT,
  p_tracking_number TEXT,
  p_dispatch_reference TEXT,
  p_lines JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_document_id BIGINT;
  v_transfer_id BIGINT;
  v_transfer_number TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Transfer requires at least one line';
  END IF;

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
    document_date
  )
  VALUES (
    'TRANSFER',
    'TRDOC-' || to_char(v_now, 'YYYYMMDDHH24MISSMS'),
    'draft',
    p_source_department_id,
    p_target_department_id,
    'TRANSFER_WORKFLOW',
    NULL,
    p_notes_sender,
    p_created_by,
    CURRENT_DATE
  )
  RETURNING document_id INTO v_document_id;

  v_transfer_number := 'TR-' || to_char(v_now, 'YYYYMMDD') || '-' || lpad(v_document_id::text, 6, '0');

  INSERT INTO inv_transfer_header (
    document_id,
    transfer_number,
    transfer_status,
    created_by,
    source_department_id,
    target_department_id,
    notes_sender,
    courier,
    transport_method,
    tracking_number,
    dispatch_reference,
    expected_arrival_date
  )
  VALUES (
    v_document_id,
    v_transfer_number,
    'draft',
    p_created_by,
    p_source_department_id,
    p_target_department_id,
    p_notes_sender,
    p_courier,
    p_transport_method,
    p_tracking_number,
    p_dispatch_reference,
    p_expected_arrival_date
  )
  RETURNING transfer_id INTO v_transfer_id;

  INSERT INTO inv_transfer_line (
    transfer_id,
    line_no,
    product_id,
    uom_id,
    requested_qty,
    dispatched_qty,
    received_qty,
    damaged_qty,
    lost_qty,
    remaining_qty,
    unit_cost,
    line_notes
  )
  SELECT
    v_transfer_id,
    row_number() OVER (),
    (x.value ->> 'product_id')::BIGINT,
    COALESCE((x.value ->> 'uom_id')::BIGINT, p.base_uom_id),
    (x.value ->> 'qty')::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    0::NUMERIC,
    COALESCE((x.value ->> 'unit_cost')::NUMERIC, COALESCE(sb.avg_cost, p.default_cost, 0)),
    x.value ->> 'line_notes'
  FROM jsonb_array_elements(p_lines) x
  JOIN inv_product p
    ON p.product_id = (x.value ->> 'product_id')::BIGINT
  LEFT JOIN inv_stock_balance sb
    ON sb.product_id = p.product_id
   AND sb.department_id = p_source_department_id;

  IF EXISTS (
    SELECT 1
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = v_transfer_id
      AND tl.requested_qty <= 0
  ) THEN
    RAISE EXCEPTION 'Transfer line quantities must be positive';
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
    v_document_id,
    tl.line_no,
    tl.product_id,
    tl.uom_id,
    tl.requested_qty,
    tl.unit_cost,
    tl.line_notes
  FROM inv_transfer_line tl
  WHERE tl.transfer_id = v_transfer_id;

  UPDATE inv_transfer_line tl
  SET document_line_id = dl.document_line_id
  FROM inv_document_line dl
  WHERE dl.document_id = v_document_id
    AND dl.line_no = tl.line_no
    AND tl.transfer_id = v_transfer_id;

  INSERT INTO inv_transfer_audit (transfer_id, action_type, user_id, old_values, new_values)
  VALUES (
    v_transfer_id,
    'create_draft',
    p_created_by,
    NULL,
    jsonb_build_object(
      'transfer_status', 'draft',
      'source_department_id', p_source_department_id,
      'target_department_id', p_target_department_id,
      'line_count', (SELECT COUNT(*) FROM inv_transfer_line WHERE transfer_id = v_transfer_id)
    )
  );

  RETURN v_transfer_id;
END;
$$;

-- =========================================================
-- 8) DISPATCH TRANSFER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_dispatch_v1(
  p_transfer_id BIGINT,
  p_dispatched_by BIGINT,
  p_sender_confirmation BOOLEAN,
  p_notes_sender TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
BEGIN
  IF p_sender_confirmation IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Dispatch requires explicit sender confirmation';
  END IF;

  SELECT *
    INTO v_h
  FROM inv_transfer_header
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF v_h.transfer_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot dispatch transfer in status %', v_h.transfer_status;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM inv_transfer_line tl
    LEFT JOIN inv_stock_balance sb
      ON sb.product_id = tl.product_id
     AND sb.department_id = v_h.source_department_id
    WHERE tl.transfer_id = p_transfer_id
      AND COALESCE(sb.available_qty, 0) < tl.requested_qty
  ) THEN
    RAISE EXCEPTION 'Insufficient available stock for one or more transfer lines';
  END IF;

  UPDATE inv_transfer_line
  SET
    dispatched_qty = requested_qty,
    remaining_qty = requested_qty
  WHERE transfer_id = p_transfer_id;

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
    tl.product_id,
    v_h.source_department_id,
    v_h.document_id,
    tl.document_line_id,
    'TRANSFER',
    'TRANSFER_OUT',
    0,
    tl.dispatched_qty,
    -tl.dispatched_qty,
    tl.unit_cost,
    0,
    (tl.dispatched_qty * tl.unit_cost),
    -(tl.dispatched_qty * tl.unit_cost),
    v_h.source_department_id,
    v_h.target_department_id,
    'TRANSFER_WORKFLOW',
    v_h.transfer_number,
    p_dispatched_by,
    'Sent from source to target'
  FROM inv_transfer_line tl
  WHERE tl.transfer_id = p_transfer_id
    AND NOT EXISTS (
      SELECT 1
      FROM inv_ledger l
      WHERE l.document_line_id = tl.document_line_id
        AND l.movement_reason_code = 'TRANSFER_OUT'
    );

  INSERT INTO inv_stock_in_transit (
    product_id,
    source_department_id,
    target_department_id,
    in_transit_qty,
    updated_at
  )
  SELECT
    tl.product_id,
    v_h.source_department_id,
    v_h.target_department_id,
    tl.dispatched_qty,
    NOW()
  FROM inv_transfer_line tl
  WHERE tl.transfer_id = p_transfer_id
  ON CONFLICT (product_id, source_department_id, target_department_id)
  DO UPDATE
  SET
    in_transit_qty = inv_stock_in_transit.in_transit_qty + EXCLUDED.in_transit_qty,
    updated_at = NOW();

  UPDATE inv_transfer_header
  SET
    transfer_status = 'dispatched',
    dispatched_by = p_dispatched_by,
    dispatched_at = NOW(),
    notes_sender = COALESCE(p_notes_sender, notes_sender)
  WHERE transfer_id = p_transfer_id;

  UPDATE inv_document_header
  SET
    status = 'posted',
    posted_by = p_dispatched_by,
    posted_at = NOW(),
    notes = COALESCE(p_notes_sender, notes)
  WHERE document_id = v_h.document_id;

  INSERT INTO inv_notification (
    transfer_id,
    department_id,
    user_id,
    notification_type,
    status,
    message,
    due_at
  )
  SELECT
    v_h.transfer_id,
    v_h.target_department_id,
    s.user_id,
    'transfer_dispatched',
    'new',
    'Transfer ' || v_h.transfer_number || ' dispatched from ' || src.department_code || ' to ' || tgt.department_code,
    CASE
      WHEN v_h.expected_arrival_date IS NULL THEN NULL
      ELSE (v_h.expected_arrival_date::timestamp + interval '23:59:59')
    END
  FROM (
    SELECT DISTINCT uds.user_id
    FROM app_user_department_scope uds
    WHERE uds.department_id = v_h.target_department_id
      AND uds.scope_level IN ('view', 'post', 'approve', 'full')
  ) s
  JOIN inv_department src ON src.department_id = v_h.source_department_id
  JOIN inv_department tgt ON tgt.department_id = v_h.target_department_id;

  INSERT INTO inv_transfer_audit (transfer_id, action_type, user_id, old_values, new_values)
  VALUES (
    p_transfer_id,
    'dispatch',
    p_dispatched_by,
    jsonb_build_object('transfer_status', 'draft'),
    jsonb_build_object(
      'transfer_status', 'dispatched',
      'dispatched_at', NOW(),
      'notes_sender', COALESCE(p_notes_sender, v_h.notes_sender)
    )
  );
END;
$$;

-- =========================================================
-- 9) RECEIVE TRANSFER (PARTIAL + DAMAGE/LOSS)
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_receive_v1(
  p_transfer_id BIGINT,
  p_received_by BIGINT,
  p_receiver_department_id BIGINT,
  p_allow_department_override BOOLEAN,
  p_receiver_confirmation BOOLEAN,
  p_notes_receiver TEXT,
  p_lines JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
  v_all_completed BOOLEAN;
  v_line JSONB;
  v_line_no INTEGER;
  v_received NUMERIC;
  v_damaged NUMERIC;
  v_lost NUMERIC;
  v_processed NUMERIC;
BEGIN
  IF p_receiver_confirmation IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Receive requires explicit receiver confirmation';
  END IF;

  SELECT *
    INTO v_h
  FROM inv_transfer_header
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF v_h.transfer_status NOT IN ('dispatched', 'partially_received') THEN
    RAISE EXCEPTION 'Cannot receive transfer in status %', v_h.transfer_status;
  END IF;

  IF p_allow_department_override IS DISTINCT FROM TRUE
     AND p_receiver_department_id <> v_h.target_department_id THEN
    RAISE EXCEPTION 'Cannot receive into wrong department';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Receive requires at least one line payload';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_no := (v_line ->> 'line_no')::INTEGER;
    v_received := COALESCE((v_line ->> 'received_qty')::NUMERIC, 0);
    v_damaged := COALESCE((v_line ->> 'damaged_qty')::NUMERIC, 0);
    v_lost := COALESCE((v_line ->> 'lost_qty')::NUMERIC, 0);

    IF v_received < 0 OR v_damaged < 0 OR v_lost < 0 THEN
      RAISE EXCEPTION 'Receive quantities cannot be negative (line %)', v_line_no;
    END IF;

    v_processed := v_received + v_damaged + v_lost;

    IF v_processed <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE inv_transfer_line tl
    SET
      received_qty = tl.received_qty + v_received,
      damaged_qty = tl.damaged_qty + v_damaged,
      lost_qty = tl.lost_qty + v_lost,
      remaining_qty = tl.dispatched_qty - (tl.received_qty + v_received) - (tl.damaged_qty + v_damaged) - (tl.lost_qty + v_lost)
    WHERE tl.transfer_id = p_transfer_id
      AND tl.line_no = v_line_no
      AND (tl.received_qty + tl.damaged_qty + tl.lost_qty + v_processed) <= tl.dispatched_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid receive totals for line %', v_line_no;
    END IF;

    -- TRANSFER_IN for received quantity
    IF v_received > 0 THEN
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
        tl.product_id,
        v_h.target_department_id,
        v_h.document_id,
        tl.document_line_id,
        'TRANSFER',
        'TRANSFER_IN',
        v_received,
        0,
        v_received,
        tl.unit_cost,
        (v_received * tl.unit_cost),
        0,
        (v_received * tl.unit_cost),
        v_h.source_department_id,
        v_h.target_department_id,
        'TRANSFER_WORKFLOW',
        v_h.transfer_number,
        p_received_by,
        'Received into target department'
      FROM inv_transfer_line tl
      WHERE tl.transfer_id = p_transfer_id
        AND tl.line_no = v_line_no;
    END IF;

    -- WRITE-OFF for damaged quantity
    IF v_damaged > 0 THEN
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
        tl.product_id,
        v_h.target_department_id,
        v_h.document_id,
        tl.document_line_id,
        'TRANSFER',
        'WRITE_OFF_DAMAGED',
        0,
        v_damaged,
        -v_damaged,
        tl.unit_cost,
        0,
        (v_damaged * tl.unit_cost),
        -(v_damaged * tl.unit_cost),
        v_h.target_department_id,
        NULL,
        'TRANSFER_WORKFLOW',
        v_h.transfer_number,
        p_received_by,
        'Damaged in transfer receipt'
      FROM inv_transfer_line tl
      WHERE tl.transfer_id = p_transfer_id
        AND tl.line_no = v_line_no;
    END IF;

    -- WRITE-OFF for lost quantity
    IF v_lost > 0 THEN
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
        tl.product_id,
        v_h.target_department_id,
        v_h.document_id,
        tl.document_line_id,
        'TRANSFER',
        'WRITE_OFF_LOST',
        0,
        v_lost,
        -v_lost,
        tl.unit_cost,
        0,
        (v_lost * tl.unit_cost),
        -(v_lost * tl.unit_cost),
        v_h.target_department_id,
        NULL,
        'TRANSFER_WORKFLOW',
        v_h.transfer_number,
        p_received_by,
        'Lost in transfer receipt'
      FROM inv_transfer_line tl
      WHERE tl.transfer_id = p_transfer_id
        AND tl.line_no = v_line_no;
    END IF;

    -- decrease in-transit by processed qty
    UPDATE inv_stock_in_transit t
    SET
      in_transit_qty = GREATEST(t.in_transit_qty - v_processed, 0),
      updated_at = NOW()
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id
      AND tl.line_no = v_line_no
      AND t.product_id = tl.product_id
      AND t.source_department_id = v_h.source_department_id
      AND t.target_department_id = v_h.target_department_id;
  END LOOP;

  SELECT bool_and(remaining_qty = 0)
    INTO v_all_completed
  FROM inv_transfer_line
  WHERE transfer_id = p_transfer_id;

  IF v_all_completed THEN
    UPDATE inv_transfer_header
    SET
      transfer_status = 'received',
      received_by = p_received_by,
      received_at = NOW(),
      notes_receiver = COALESCE(p_notes_receiver, notes_receiver)
    WHERE transfer_id = p_transfer_id;

    UPDATE inv_document_header
    SET status = 'closed'
    WHERE document_id = v_h.document_id;

    INSERT INTO inv_notification (
      transfer_id,
      department_id,
      notification_type,
      status,
      message
    )
    VALUES (
      p_transfer_id,
      v_h.source_department_id,
      'transfer_received',
      'new',
      'Transfer ' || v_h.transfer_number || ' fully received by target department'
    );
  ELSE
    UPDATE inv_transfer_header
    SET
      transfer_status = 'partially_received',
      notes_receiver = COALESCE(p_notes_receiver, notes_receiver)
    WHERE transfer_id = p_transfer_id;
  END IF;

  INSERT INTO inv_transfer_audit (transfer_id, action_type, user_id, old_values, new_values)
  VALUES (
    p_transfer_id,
    'receive',
    p_received_by,
    jsonb_build_object('transfer_status', v_h.transfer_status),
    jsonb_build_object(
      'transfer_status', (SELECT transfer_status FROM inv_transfer_header WHERE transfer_id = p_transfer_id),
      'notes_receiver', p_notes_receiver,
      'line_updates', p_lines
    )
  );

  RETURN (SELECT transfer_status FROM inv_transfer_header WHERE transfer_id = p_transfer_id);
END;
$$;

-- =========================================================
-- 10) CANCEL TRANSFER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_cancel_v1(
  p_transfer_id BIGINT,
  p_cancelled_by BIGINT,
  p_cancel_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
BEGIN
  SELECT *
    INTO v_h
  FROM inv_transfer_header
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF v_h.transfer_status = 'received' THEN
    RAISE EXCEPTION 'Received transfer cannot be cancelled; use reverse transfer';
  END IF;

  IF v_h.transfer_status = 'cancelled' THEN
    RAISE EXCEPTION 'Transfer already cancelled';
  END IF;

  IF v_h.transfer_status = 'dispatched' THEN
    IF EXISTS (
      SELECT 1
      FROM inv_transfer_line
      WHERE transfer_id = p_transfer_id
        AND (received_qty > 0 OR damaged_qty > 0 OR lost_qty > 0)
    ) THEN
      RAISE EXCEPTION 'Dispatched transfer with receipt activity cannot be cancelled';
    END IF;

    -- Return-to-source posting for full dispatched qty
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
      tl.product_id,
      v_h.source_department_id,
      v_h.document_id,
      tl.document_line_id,
      'TRANSFER',
      'TRANSFER_CANCEL_RETURN',
      tl.dispatched_qty,
      0,
      tl.dispatched_qty,
      tl.unit_cost,
      (tl.dispatched_qty * tl.unit_cost),
      0,
      (tl.dispatched_qty * tl.unit_cost),
      v_h.target_department_id,
      v_h.source_department_id,
      'TRANSFER_WORKFLOW',
      v_h.transfer_number,
      p_cancelled_by,
      'Dispatched transfer cancelled and returned to source'
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id;

    UPDATE inv_stock_in_transit t
    SET
      in_transit_qty = GREATEST(t.in_transit_qty - tl.dispatched_qty, 0),
      updated_at = NOW()
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id
      AND tl.product_id = t.product_id
      AND t.source_department_id = v_h.source_department_id
      AND t.target_department_id = v_h.target_department_id;
  END IF;

  UPDATE inv_transfer_header
  SET
    transfer_status = 'cancelled',
    cancelled_by = p_cancelled_by,
    cancelled_at = NOW(),
    notes_receiver = COALESCE(notes_receiver, p_cancel_reason)
  WHERE transfer_id = p_transfer_id;

  UPDATE inv_document_header
  SET
    status = 'cancelled',
    posted_by = COALESCE(posted_by, p_cancelled_by),
    posted_at = COALESCE(posted_at, NOW())
  WHERE document_id = v_h.document_id;

  INSERT INTO inv_notification (
    transfer_id,
    department_id,
    notification_type,
    status,
    message
  )
  VALUES
    (p_transfer_id, v_h.source_department_id, 'transfer_cancelled', 'new', 'Transfer ' || v_h.transfer_number || ' cancelled'),
    (p_transfer_id, v_h.target_department_id, 'transfer_cancelled', 'new', 'Transfer ' || v_h.transfer_number || ' cancelled');

  INSERT INTO inv_transfer_audit (transfer_id, action_type, user_id, old_values, new_values)
  VALUES (
    p_transfer_id,
    'cancel',
    p_cancelled_by,
    jsonb_build_object('transfer_status', v_h.transfer_status),
    jsonb_build_object('transfer_status', 'cancelled', 'cancel_reason', p_cancel_reason)
  );
END;
$$;

-- =========================================================
-- 11) REVERSE TRANSFER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_reverse_v1(
  p_transfer_id BIGINT,
  p_created_by BIGINT,
  p_notes_sender TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
  v_new_transfer_id BIGINT;
  v_lines JSONB;
BEGIN
  SELECT * INTO v_h
  FROM inv_transfer_header
  WHERE transfer_id = p_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF v_h.transfer_status <> 'received' THEN
    RAISE EXCEPTION 'Only received transfers can be reversed';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', tl.product_id,
      'uom_id', tl.uom_id,
      'qty', tl.received_qty,
      'unit_cost', tl.unit_cost,
      'line_notes', 'Reverse of ' || v_h.transfer_number
    )
  )
  INTO v_lines
  FROM inv_transfer_line tl
  WHERE tl.transfer_id = p_transfer_id
    AND tl.received_qty > 0;

  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'No receipted quantities available to reverse';
  END IF;

  v_new_transfer_id := fn_inv_transfer_create_v1(
    v_h.target_department_id,
    v_h.source_department_id,
    p_created_by,
    COALESCE(p_notes_sender, 'Reverse transfer of ' || v_h.transfer_number),
    NULL,
    NULL,
    NULL,
    NULL,
    'REV-' || v_h.transfer_number,
    v_lines
  );

  INSERT INTO inv_transfer_audit (transfer_id, action_type, user_id, old_values, new_values)
  VALUES (
    p_transfer_id,
    'reverse_created',
    p_created_by,
    NULL,
    jsonb_build_object('reverse_transfer_id', v_new_transfer_id)
  );

  RETURN v_new_transfer_id;
END;
$$;

-- =========================================================
-- 12) OVERDUE NOTIFICATION HELPER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_flag_overdue_v1()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO inv_notification (
    transfer_id,
    department_id,
    notification_type,
    status,
    message,
    due_at
  )
  SELECT
    h.transfer_id,
    h.target_department_id,
    'transfer_overdue',
    'new',
    'Transfer ' || h.transfer_number || ' is overdue for receipt',
    (h.expected_arrival_date::timestamp + interval '23:59:59')
  FROM inv_transfer_header h
  WHERE h.transfer_status IN ('dispatched', 'partially_received')
    AND h.expected_arrival_date IS NOT NULL
    AND h.expected_arrival_date < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1
      FROM inv_notification n
      WHERE n.transfer_id = h.transfer_id
        AND n.notification_type = 'transfer_overdue'
        AND n.status IN ('new', 'read')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMIT;
