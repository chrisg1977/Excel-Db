# EOS Transfer Workflow Test Scenarios (v1)

## Preconditions
- `sql/eos_transfer_workflow_v1.sql` applied.
- At least one active `app_user` with transfer permissions.
- At least two active departments with distinct IDs.
- Test product exists with `track_inventory = true` and stock in source department.

## Scenario 1: Draft Creation
1. Call `POST /api/inventory/transfers` with valid source, target, and positive line qty.
2. Expect HTTP `201` with `transfer_id`.
3. Verify DB:
- `inv_transfer_header.transfer_status = 'draft'`
- `inv_transfer_line.requested_qty > 0`
- no ledger rows yet for transfer line.

## Scenario 2: Dispatch (Sender Sign-off)
1. Call `POST /api/inventory/transfers/:id/dispatch` with `sender_confirmation = true`.
2. Expect HTTP `200`, status `dispatched`.
3. Verify DB:
- `dispatched_by`, `dispatched_at` set.
- transfer status `dispatched`.
- `TRANSFER_OUT` ledger postings created once per line.
- `inv_stock_in_transit` increased by dispatched qty.

## Scenario 3: Prevent Double Dispatch
1. Dispatch same transfer again.
2. Expect failure (cannot dispatch non-draft).

## Scenario 4: Receive Partial
1. Call `POST /api/inventory/transfers/:id/receive` with subset qty on one line.
2. Expect status `partially_received`.
3. Verify DB:
- `received_qty` incremented.
- line `remaining_qty > 0`.
- `TRANSFER_IN` ledger row created for received qty only.
- `inv_stock_in_transit` reduced by processed qty.

## Scenario 5: Receive with Damage/Loss
1. Call receive payload with `damaged_qty` and `lost_qty`.
2. Verify DB:
- `WRITE_OFF_DAMAGED` and/or `WRITE_OFF_LOST` ledger rows at target department.
- line totals satisfy: `received + damaged + lost <= dispatched`.

## Scenario 6: Full Receive Completion
1. Receive remaining qty for all lines.
2. Expect final status `received`.
3. Verify DB:
- `received_by`, `received_at` set.
- all lines `remaining_qty = 0`.

## Scenario 7: Cancellation Rules
1. Cancel draft transfer: should succeed.
2. Cancel dispatched-not-received transfer: should succeed with return-to-source posting.
3. Cancel received transfer: should fail and require reverse transfer.

## Scenario 8: Reverse Transfer
1. Run `POST /api/inventory/transfers/:id/reverse` for a `received` transfer.
2. Expect new transfer ID returned.
3. Verify new draft transfer source/target swapped.

## Scenario 9: Pending/Overdue Views
1. Query `vw_inv_pending_transfer_dashboard`.
2. Verify counts for dispatched, partially received, overdue.
3. Run `SELECT fn_inv_transfer_flag_overdue_v1();` and verify `inv_notification` inserts.

## Scenario 10: Printable Transfer Note
1. Open `GET /api/inventory/transfers/:id/print?user_id=<id>`.
2. Verify transfer metadata, line table, and sender/receiver signature placeholders.
