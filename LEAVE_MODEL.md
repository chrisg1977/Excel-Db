# Leave Model

## Purpose

This note defines the central leave / VL model shared by HR, payroll, and EOS.

It is a shared master-data / transaction model and is not owned by EOS.

## Leave Model

Suggested fields:
- `id`
- `employee_id`
- `leave_type`
- `start_at`
- `end_at`
- `status`
- `approved_by_employee_id`
- `note`
- `created_at`
- `updated_at`

## Rules

1. leave is centrally stored, not owned by EOS
   - EOS must read shared leave data instead of maintaining a separate leave list

2. HR approval is the source of truth
   - approved leave status from HR is the authoritative state used by other modules

3. payroll reuses the same leave data
   - payroll should consume the shared leave model rather than duplicate leave records

4. EOS discrepancy routing checks approved leave before notifying a manager
   - the future resolver should check approved leave at the relevant datetime before selecting the final recipient

5. this applies to any leave type, not only vacation leave
   - the model should support any approved leave category that affects routing, HR, or payroll
