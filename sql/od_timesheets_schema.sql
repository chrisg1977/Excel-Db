-- OpenDental import support tables
-- Note: uses employees.emp_id as the employee key

CREATE TABLE IF NOT EXISTS od_user_map (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  od_user_num INTEGER NOT NULL,
  od_employee_num INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (od_user_num),
  UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_od_user_map_employee ON od_user_map(employee_id);
CREATE INDEX IF NOT EXISTS idx_od_user_map_od_employee_num ON od_user_map(od_employee_num);

CREATE TABLE IF NOT EXISTS timesheet_events (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  event_datetime TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN', 'OUT')),
  note TEXT,
  clinic_num INTEGER,
  source_system TEXT NOT NULL DEFAULT 'OpenDental',
  source_clockevent_num INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_clockevent_num)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_events_employee_date ON timesheet_events(employee_id, event_datetime);
CREATE INDEX IF NOT EXISTS idx_timesheet_events_source ON timesheet_events(source_system, source_clockevent_num);

CREATE TABLE IF NOT EXISTS import_log (
  id BIGSERIAL PRIMARY KEY,
  requested_by TEXT,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  employee_ids INTEGER[],
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'STARTED',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
