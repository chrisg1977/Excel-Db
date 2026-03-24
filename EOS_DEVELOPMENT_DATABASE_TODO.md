# EOS Development Database TODO

This is the canonical development database TODO list for EOS/database improvements in this repository.

Scope rules:
- Developer/database planning only.
- Not a UI task list.
- Do not store these items in Handover or To Do UI tables.

## Current Priority (Pending)

1. EOSQ FEE controlled refund-adjustment lane design (strict baseline preserved).
- Keep current 4 EOSQ FEE negative-gross rejects blocked in the v1 canonical income loader.
- Design a separate subtype-gated path for signed refund/adjustment rows.
- Require immutable source linkage, explicit reason codes, and full audit trail.
- Keep PAY/FEE accepted baseline logic unchanged.

2. Walkout exception persistence and management retrieval.
- Add saved walkout exception reporting for grouped EOS visits.
- Mark grouped rows with NO WALK OUT PRINTED only as enrichment of existing rows.
- Do not create new visit rows from walkout/securitylog data.
- Restrict saved report retrieval to management-or-higher.

3. EOS report retrieval hardening.
- Keep report retrieval separate from operational EOS screen.
- Ensure report persistence remains mandatory (no transient UI-only reporting).
- Confirm role-gated access control and retrieval audit coverage.

4. Reception-location master data hardening for EOS ownership model.
- Enforce department mapping to physical location plus default reception location.
- Ensure location records include phone number.
- Keep EOS shift concurrency controlled by reception location.

5. Department manager routing readiness.
- Ensure each department has manager_responsible mapping in master data.
- Keep resolver-ready structure for leave-aware escalation logic.
- Preserve admin inclusion in discrepancy summary/review escalation chain.

## Next Stream (Pending)

1. SELL to product master staged matching hardening.
- Keep unresolved matches reviewable/rejectable.
- Preserve raw SELL and PRODUCTLIST source fields.
- Avoid silent auto-match behavior.

2. Supplier and stock foundation schema rollout sequencing.
- Finalize supplier master and payable tracking flow.
- Finalize stock movement and transfer lifecycle enforcement.
- Keep all quantity/value movement ledger-driven and auditable.

3. Inventory location lifecycle governance.
- Preserve soft-lifecycle behavior (no hard delete of locations).
- Keep historical references and lifecycle audit history intact.
- Maintain back-compat for legacy rows without location tags.

## Deferred

1. YOUR INFO self-service scope remains deferred until EOS is stable and signed off.
2. Provider/commission model remains deferred pending external business rules.

## Source Notes Consolidated

This file consolidates still-relevant pending items previously spread across:
- EOSQ_FEE_REJECT_INVESTIGATION_20260312.md
- EOS_PERSISTENCE_API_PLAN.md
- EOS_PRODUCTION_API_BACKEND_NOTE.md
- EOS_TODO.md
- DEVELOPER_BACKLOG.md