# EOS Flow

## Purpose

This note summarizes the intended developer-facing EOS implementation flow from workstation detection through report submission and later management retrieval.

## Operational Structure

Real physical locations:
- Zabbar: active reception
- Qormi: active reception
- Gzira: no active reception
- Valletta: no active reception

Location records should be treated as physical sites and should include a required `phone_number`.

Critical rule:
- EOS shifts are opened per reception location, not per department physical location.
- Departments keep their own physical location for reporting and accounting.
- A department may be serviced by a different reception location than its physical site.
- Departments therefore need both:
  - physical location
  - default reception location

Departments with no active reception:
- Gzira departments are normally handled by Qormi reception, and sometimes Zabbar.
- Valletta departments are normally handled by Qormi reception.

## Flow

```text
[User opens EOS]
        |
        v
[Detect workstation + user + reception location]
        |
        v
[Check active EOS for reception location]
        |
        +--> unresolved previous shift exists for location
        |       |
        |       +--> same owner
        |       |       |
        |       |       v
        |       |   [Resume previous shift normally]
        |       |
        |       +--> same-level different user
        |       |       |
        |       |       v
        |       |   [Block and show unresolved shift owner/details]
        |       |       |
        |       |       +--> if manager unavailable
        |       |               |
        |       |               v
        |       |           [Emergency Handover Mode]
        |       |               |
        |       |               +--> record found cash / EPOS / cheques / cash envelope
        |       |               +--> run retro Open Dental report for previous shift
        |       |               +--> record discrepancy notes
        |       |               +--> temporary close previous shift pending manager review
        |       |               +--> start new shift from found cash with counters at zero
        |       |
        |       +--> manager-or-higher
        |               |
        |               v
        |           [Show explicit resolution choices]
        |               |
        |               +--> resume previous shift with audited takeover
        |               +--> mark previous shift abandoned with reason + audit
        |               +--> supersede previous shift, link old/new shifts, and audit
        |
        +--> same user owns active EOS
        |       |
        |       v
        |   [Resume active EOS normally]
        |
        +--> same-level different user owns active EOS
        |       |
        |       v
        |   [Block editing and show EOS already open by original user]
        |
        +--> manager-or-higher opens another user's active EOS
        |       |
        |       v
        |   [Require explicit takeover reason]
        |       |
        |       +--> audit manager_takeover / amend_other_user_eos
        |       |
        |       +--> UI label: Amending EOS of [USER]
        |
        v
[Open Shift Form]
  - reception location
  - opening cash
  - match? yes/no
        |
        v
[Save Opening Details]
        |
        +--> creates eos_shift_session for the reception location
        |
        +--> if Emergency Handover Mode was used
        |       |
        |       +--> previous shift marked temporary_closed_pending_review
        |       +--> new shift marked temporary_handover_started
        |       +--> manager review required
        |
        v
[Load EOS Report]
  - report start
  - report end
  - audited if changed
        |
        v
[Extract Open Dental Visits]
        |
        +--> grouped patient visit rows
        |
        v
[Reconciliation]
  - payment channels
  - report totals
  - discrepancy
        |
        +--> if discrepancy or opening mismatch
        |       |
        |       +--> resolveDepartmentResponsibleManager(department_id, at_datetime)
        |       +--> notify department responsible manager first
        |       +--> if on approved leave, escalate to fallback peer or higher-level manager
        |       +--> include admin in discrepancy and review-outcome summary flow
        |
        v
[Exceptions]
  - carry forward rows
  - missing walkout rows
        |
        v
[Submit EOS]
        |
        +--> save eos_report_header
        +--> save eos_report_rows
        +--> save eos_report_summary
        +--> save eos_report_audit
        |
        v
[Management Retrieval Later]
        |
        +--> review emergency handover closures
```

## Assignment Rule

- `location_code` on the EOS shift/session side means reception location.
- Department reporting still uses the department's physical location.
- If a department has no active reception, EOS is opened under that department's default reception location and not under the department's physical site.
- Department manager responsibility belongs to department master data, not the EOS UI.
- EOS discrepancy routing should resolve the responsible manager from department data, then check shared HR-approved leave status before escalating.

## Walkout Enrichment Rule

Walkout and securitylog data are enrichment only. They may annotate existing grouped EOS visit rows, but they must never create new EOS rows.
