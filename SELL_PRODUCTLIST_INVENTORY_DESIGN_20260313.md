# SELL to PRODUCTLIST Inventory Foundation Design (2026-03-13)

Scope of this note:
- Design only (no full inventory implementation yet)
- Keep strict reject-first behavior
- Preserve raw source fields and provenance
- Keep PAY/FEE accepted baselines unchanged
- Keep commission model deferred

## A) SELL-to-PRODUCTLIST Design Recommendation

Current SELL pipeline status:
- SELL dry-run rejects: 1
- Candidates: 560
- Strict-ready: 559
- Remaining unresolved: payment_channel_unresolved (1 row)

Current technical state:
- SELL parsing is implemented in:
  - sql/v_eos_sell_lines_raw_v1.sql
  - sql/v_eos_sell_candidates_v1.sql
  - sql/eos_stg_to_shift_sell_lines_dry_run_v1.sql
- Parser already extracts barcode/product/size/type/amount signals from formula-like keys with drift handling.

Recommended product-link pattern (safe v1):
1. Do not directly write SELL canonical rows to product_id on first pass.
2. Create staged product matching layer per SELL candidate.
3. Matching priority:
   - barcode exact match to active product identity
   - barcode historical alias match
   - deterministic composite match (name+size+type with strict normalization)
4. Name-only fallback is allowed only as unresolved suggestion candidate, not auto-accept.
5. If no deterministic single match, keep unresolved and reject for canonical product-linked insertion.

EcoTax handling in matching:
- Keep special ecoTax barcode (e.g. 123) as explicit product identity rule in product identity/alias layer.
- Never infer ecoTax by amount-only.

## B) Proposed Canonical Schema List (Table Names + Purpose)

Product core:
- eos_product_master:
  - Central product master identity (canonical product record).
- eos_product_identity:
  - Barcode and alternate identity tokens linked to product; supports historical validity windows.
- eos_product_attributes_history:
  - Historical versioned product attributes (name, size, type, expires flag, destination).
- eos_product_pricing_history:
  - Historical cost/retail/VAT pricing with effective dates (no silent overwrite).

Supplier core:
- eos_supplier_master:
  - Supplier profile and lifecycle status.
- eos_supplier_product_link:
  - Supplier-to-product relationship and preferred supplier flags.

Supplier invoice/payables:
- eos_supplier_invoice_header:
  - Supplier invoice receipt ledger (invoice-level metadata/status).
- eos_supplier_invoice_line:
  - Invoice lines with product reference and received quantities/cost.
- eos_supplier_payment_ledger:
  - Payments made against supplier invoices and balance effects.

Inventory locations and stock:
- eos_inventory_location:
  - Physical locations/departments where stock is held (Zabbar, Qormi, guesthouse, etc.).
- eos_stock_movement_ledger:
  - Immutable movement ledger for all stock changes (receipt, sale, adjustment, transfer-in/out).
- eos_stock_transfer_header:
  - Inter-location transfer transaction metadata.
- eos_stock_transfer_line:
  - Product quantities moved between locations with sender/receiver accountability.

SELL linking and reconciliation:
- eos_sell_product_match_candidates:
  - Candidate-level staged product match attempts with confidence and reason.
- eos_sell_product_match_review:
  - Human review decisions for unresolved/ambiguous matches.
- eos_sell_product_match_rule_audit:
  - Rule lineage and diagnostics for each match decision.

## C) Tables/Views/Scripts to Build Next

Phase 1 (design-safe foundation):
- SQL schema scripts:
  - sql/eos_product_master_schema_v1.sql
  - sql/eos_product_identity_schema_v1.sql
  - sql/eos_product_attributes_history_schema_v1.sql
  - sql/eos_product_pricing_history_schema_v1.sql
  - sql/eos_inventory_location_schema_v1.sql
  - sql/eos_supplier_master_schema_v1.sql
  - sql/eos_supplier_invoice_schema_v1.sql
  - sql/eos_stock_movement_ledger_schema_v1.sql
  - sql/eos_stock_transfer_schema_v1.sql
  - sql/eos_sell_product_match_schema_v1.sql

Phase 2 (staged parsing + match prep):
- Views/scripts:
  - sql/v_eos_productlist_raw_v1.sql
  - sql/v_eos_productlist_candidates_v1.sql
  - sql/eos_stg_to_product_master_dry_run_v1.sql
  - sql/v_eos_sell_product_match_candidates_v1.sql
  - sql/eos_stg_to_sell_product_match_dry_run_v1.sql

Phase 3 (controlled integration):
- SELL linkage update:
  - Extend SELL candidate/dry-run flow to require deterministic product match for product-linked canonical insertion.

## D) Build Now vs Later

Build now:
- Product master + identity + attribute/pricing history schemas.
- Location schema.
- Supplier master + supplier invoice receipt/payable schemas.
- Stock movement and stock transfer schemas (ledger-first).
- PRODUCTLIST staged raw/candidate parsing.
- SELL staged product match candidate/review workflow.

Defer later:
- Full valuation engine (weighted average/FIFO accounting details).
- Automatic invoice-to-payment reconciliation engine.
- Advanced availability/reservation/forecast/reorder logic.
- Commission-linked profitability dimensions.

## E) Updated To-Do List (Summary)

Added to canonical backlog in DEVELOPER_BACKLOG.md:
- EOS Product / Supplier / Stock Foundation stream.
- Build-now and defer-later breakdown.
- Strict staged SELL-to-product match rules and unresolved-review requirement.
- Explicit preservation of PAY/FEE baseline and deferred commission scope.

## F) Single Recommended Next Implementation Step

Implement and run `sql/eos_product_master_schema_v1.sql` first (with identity + historical pricing/attributes tables in the same migration batch) before adding any PRODUCTLIST or SELL match loaders.

Why this step first:
- Establishes canonical anchors (`product_id`) and historical invariants.
- Prevents ad-hoc mapping logic from hardcoding unstable fields.
- Enables strict unresolved handling without inventing product links.
