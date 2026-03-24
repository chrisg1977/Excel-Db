/**
 * EOS shift session lifecycle states.
 */
export type EosShiftSessionStatus = 'open' | 'report_in_progress' | 'submitted' | 'locked';

/**
 * EOS report header lifecycle states.
 */
export type EosReportStatus = 'draft' | 'submitted' | 'locked';

/**
 * EOS report generation modes.
 */
export type EosReportType = 'standard' | 'management_exception';

/**
 * Walkout print state stored against a grouped EOS visit row.
 */
export type EosWalkoutStatus = 'printed' | 'not_printed' | 'unknown';

/**
 * Saved opening form for one EOS shift session.
 */
export interface EosShiftSession {
  id: string;
  workstation_id: string;
  reception_code: string;
  department_code: string;
  clinic_code: string;
  shift_date: string;
  opening_timestamp: string;
  last_shift_closing_cash: number;
  opening_cash_matches: boolean;
  actual_opening_cash: number | null;
  opening_override_reason: string | null;
  opening_override_note: string | null;
  created_at: string;
  created_by: string;
  status: EosShiftSessionStatus;
}

/**
 * One generated EOS report window linked to an opening shift session.
 */
export interface EosReportHeader {
  id: string;
  shift_session_id: string;
  department_code: string;
  clinic_code: string;
  report_start_at: string;
  report_end_at: string;
  generated_at: string;
  generated_by: string;
  report_type: EosReportType;
  status: EosReportStatus;
}

/**
 * One grouped patient visit row captured inside an EOS report snapshot.
 */
export interface EosReportRow {
  id: string;
  report_header_id: string;
  patient_visit_key: string;
  patient_number: string;
  surname: string;
  name: string;
  provider: string;
  treatments: string;
  fee_total: number;
  appointment_datetime: string;
  appointment_dismissed_at: string | null;
  walkout_issued_at: string | null;
  walkout_status: EosWalkoutStatus;
  included: boolean;
  carry_forward: boolean;
  display_order: number;
}

/**
 * Reconciliation totals and discrepancy results for one EOS report.
 */
export interface EosReportSummary {
  id: string;
  report_header_id: string;
  opening_cash: number;
  payment_total: number;
  cash_envelope_total: number;
  cashbox_expenses_total: number;
  sell_total: number;
  fee_total: number;
  expected_total: number;
  actual_total: number;
  discrepancy_total: number;
  manager_alert_created: boolean;
}

/**
 * Audit trail entry for EOS field amendments and lifecycle actions.
 */
export interface EosReportAudit {
  id: string;
  report_header_id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  acted_at: string;
  acted_by: string;
}
