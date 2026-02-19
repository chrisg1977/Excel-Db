-- Audit Log for Tax Rate Publishing
-- Tracks who changed what, when, and from where

CREATE TABLE IF NOT EXISTS tax_publish_audit_log (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'publish', 'validate', 'reject', etc.
  action_status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'validation_failed'
  user_id UUID NOT NULL,
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year INTEGER NOT NULL,
  source_url VARCHAR(1024),
  total_records INTEGER,
  validation_errors TEXT, -- JSON array of validation errors if applicable
  metadata JSONB, -- Additional context
  processing_time_ms INTEGER,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tax_audit_batch_id ON tax_publish_audit_log(batch_id);
CREATE INDEX idx_tax_audit_user_id ON tax_publish_audit_log(user_id);
CREATE INDEX idx_tax_audit_timestamp ON tax_publish_audit_log(timestamp DESC);
CREATE INDEX idx_tax_audit_year ON tax_publish_audit_log(year);
CREATE INDEX idx_tax_audit_action ON tax_publish_audit_log(action_type, action_status);

-- Similar audit log for Social Security rate publishing
CREATE TABLE IF NOT EXISTS ss_publish_audit_log (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  action_status VARCHAR(50) NOT NULL,
  user_id UUID NOT NULL,
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year INTEGER NOT NULL,
  source_url VARCHAR(1024),
  total_records INTEGER,
  validation_errors TEXT, -- JSON array of validation errors
  metadata JSONB,
  processing_time_ms INTEGER,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ss_audit_batch_id ON ss_publish_audit_log(batch_id);
CREATE INDEX idx_ss_audit_user_id ON ss_publish_audit_log(user_id);
CREATE INDEX idx_ss_audit_timestamp ON ss_publish_audit_log(timestamp DESC);
CREATE INDEX idx_ss_audit_year ON ss_publish_audit_log(year);
CREATE INDEX idx_ss_audit_action ON ss_publish_audit_log(action_type, action_status);

-- View for easy audit trail review
CREATE OR REPLACE VIEW vw_tax_publish_audit AS
SELECT 
  id,
  batch_id,
  action_type,
  action_status,
  user_email,
  user_name,
  timestamp,
  year,
  source_url,
  total_records,
  validation_errors,
  processing_time_ms,
  notes
FROM tax_publish_audit_log
ORDER BY timestamp DESC;

CREATE OR REPLACE VIEW vw_ss_publish_audit AS
SELECT 
  id,
  batch_id,
  action_type,
  action_status,
  user_email,
  user_name,
  timestamp,
  year,
  source_url,
  total_records,
  validation_errors,
  processing_time_ms,
  notes
FROM ss_publish_audit_log
ORDER BY timestamp DESC;
