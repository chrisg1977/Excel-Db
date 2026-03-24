# Inventory UI Spike (React + TypeScript)

Minimal React/TS scaffold for EOS inventory and stocktake screens under `dashboard/`.

## Routes

- `/inventory/products`
- `/inventory/products/:productId`
- `/inventory/locations`
- `/inventory/locations/:locationId/stocktake`
- `/inventory/movements`

All pages currently use static mock data from `src/data/mockInventory.ts`.

## Run

```bash
cd dashboard/inventory-ui
npm install
npm run dev
```

Default Vite URL: `http://localhost:5173`.
