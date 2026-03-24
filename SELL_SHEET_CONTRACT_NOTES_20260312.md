# SELL Sheet Contract Notes (2026-03-12)

## Confirmed Intent
- `A..R` are operational input fields for sales/ecotax.
- `S..AQ` delivery/logistics section was never implemented and can be redesigned fresh.
- `AT+` are summaries/visuals and are out of scope for raw ingestion.
- Department default for SELL operations is `MHB`.

## A..R Functional Meaning (per business clarification)
- `A` date
- `B` shift/time (moving toward time capture)
- `C` barcode
- `D` description
- `E` size
- `F` type/category
- `G` total nights (ecotax path)
- `H` max payable nights billed (ecotax path)
- `I` retail ex VAT per item/night
- `J` VAT percent
- `K` VAT amount per item/night
- `L` total price per item/night
- `M` quantity/adults
- `N` total VAT
- `O` total row bill
- `P` pay type
- `Q` user
- `R` total ex VAT

## Current Data-Pipeline Impact
- SELL parser/candidates were aligned to prioritize `A..R` operational semantics.
- Delivery/logistics and summary ranges are intentionally ignored by parser logic.
- Dry-run SELL reject loader remains reject-only; no canonical inserts.

## Back-Burner Feature
- Cash-register style UI (scan multiple products + quantity + auto bill) is logged as a future stream.
- Receipt printing through existing external cash register remains unknown and deferred.
