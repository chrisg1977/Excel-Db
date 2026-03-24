-- EOS transfer location refinement (v1)
-- Purpose:
--   Keep department as first-class scope and location as optional refinement.

BEGIN;

ALTER TABLE inv_transfer_header
  ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES inv_location(location_id),
  ADD COLUMN IF NOT EXISTS target_location_id BIGINT REFERENCES inv_location(location_id);

CREATE INDEX IF NOT EXISTS ix_inv_transfer_header_source_target_location
  ON inv_transfer_header(source_department_id, source_location_id, target_department_id, target_location_id);

CREATE OR REPLACE FUNCTION fn_inv_transfer_header_validate_locations_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_dept BIGINT;
  v_target_dept BIGINT;
BEGIN
  -- Department remains mandatory and first-class.
  IF NEW.source_department_id IS NULL OR NEW.target_department_id IS NULL THEN
    RAISE EXCEPTION 'source_department_id and target_department_id are required';
  END IF;

  -- Location refines department when supplied.
  IF NEW.source_location_id IS NOT NULL THEN
    SELECT department_id INTO v_source_dept
    FROM inv_location
    WHERE location_id = NEW.source_location_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_location_id % not found', NEW.source_location_id;
    END IF;

    IF v_source_dept <> NEW.source_department_id THEN
      RAISE EXCEPTION 'source_location_id % does not belong to source_department_id %', NEW.source_location_id, NEW.source_department_id;
    END IF;
  END IF;

  IF NEW.target_location_id IS NOT NULL THEN
    SELECT department_id INTO v_target_dept
    FROM inv_location
    WHERE location_id = NEW.target_location_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'target_location_id % not found', NEW.target_location_id;
    END IF;

    IF v_target_dept <> NEW.target_department_id THEN
      RAISE EXCEPTION 'target_location_id % does not belong to target_department_id %', NEW.target_location_id, NEW.target_department_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_transfer_header_validate_locations ON inv_transfer_header;
CREATE TRIGGER trg_inv_transfer_header_validate_locations
BEFORE INSERT OR UPDATE ON inv_transfer_header
FOR EACH ROW EXECUTE FUNCTION fn_inv_transfer_header_validate_locations_v1();

COMMIT;
