# EOS Shopify-like UX to Backend Mapping (2026-03-14)

## Purpose
This document defines the canonical mapping between Shopify-like inventory UX screens and the EOS inventory backend foundation.

## A. Product Grid / Catalog
Frontend fields:
- image
- product name
- sku/barcode
- category
- sell price
- on hand
- low stock badge
- supplier
- active/inactive

Backend source:
- `vw_inv_product_listing`
- `inv_stock_balance`
- `inv_product_department`

## B. Product Details Page
Frontend tabs:
- Overview
- Stock by department
- Suppliers
- Purchase history
- Movement history

Backend source:
- `inv_product`
- `inv_product_department`
- `inv_product_supplier`
- `inv_ledger`

## C. Stock Transfer Screen
Frontend workflow:
- choose source department
- choose target department
- search items
- qty
- submit

Backend mapping:
- create `inv_document_header` with `document_type_code='TRANSFER'`
- create `inv_document_line`
- posting engine writes two ledger entries per line

## D. Receive Stock Screen
Frontend workflow:
- supplier
- PO or manual receipt
- items
- qty received
- cost

Backend mapping:
- `PO_RECEIPT` document
- ledger IN postings

## E. Sale / POS / Shopify-like Checkout
Frontend workflow:
- add items to cart
- total
- payment
- complete sale

Backend mapping:
- create `sell_transaction_header`
- create `sell_transaction_line`
- generate inventory issue document `SALE_ISSUE`
- write ledger OUT postings

## F. Consumption Screen
Frontend workflow:
- department
- patient/provider/treatment optional
- add item + qty
- post

Backend mapping:
- `inv_consumption_header`
- `inv_consumption_line`
- inventory document `CONSUMPTION`
- ledger OUT postings

## G. Stocktake Screen
Frontend workflow:
- list department products
- system qty
- counted qty
- variance

Backend mapping:
- `inv_stock_count_header`
- `inv_stock_count_line`
- approval/posting creates `ADJUSTMENT` ledger entries

## Notes
- This mapping must remain consistent with `sql/eos_madexls_inventory_ledger_foundation_v1.sql` and `sql/eos_inventory_posting_rules_v1.sql`.
- Reservation/release flows affect availability semantics and do not post inventory movement until physical stock moves.
