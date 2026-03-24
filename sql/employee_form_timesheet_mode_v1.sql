ALTER TABLE public.employee_form_profile
  ADD COLUMN IF NOT EXISTS timesheet_mode text;

UPDATE public.employee_form_profile
SET timesheet_mode = CASE
  WHEN COALESCE(timesheet_required, true) = false THEN 'NONE'
  ELSE 'OPENDENTAL'
END
WHERE timesheet_mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_form_profile_timesheet_mode_chk'
  ) THEN
    ALTER TABLE public.employee_form_profile
      ADD CONSTRAINT employee_form_profile_timesheet_mode_chk
      CHECK (timesheet_mode IS NULL OR timesheet_mode IN ('OPENDENTAL', 'CSV', 'MANUAL', 'NONE'));
  END IF;
END $$;