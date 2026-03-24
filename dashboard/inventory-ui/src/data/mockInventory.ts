export type Product = {
  id: string;
  sku: string;
  title: string;
  category: string;
  supplier: string;
  status: 'ok' | 'low' | 'out';
  onHand: number;
  reserved: number;
};

export type Location = {
  id: string;
  name: string;
  areaCode: string;
  totalSkus: number;
  lowStockSkus: number;
};

export type Movement = {
  id: string;
  productId: string;
  productTitle: string;
  locationId: string;
  reasonCode: 'ADJUSTMENT' | 'TRANSFER' | 'STOCKTAKE_VARIANCE';
  quantityDelta: number;
  createdAt: string;
};

export const products: Product[] = [
  {
    id: 'prod-001',
    sku: 'FLS-001',
    title: 'Floss Mint 50m',
    category: 'Consumables',
    supplier: 'MedSource',
    status: 'ok',
    onHand: 120,
    reserved: 8,
  },
  {
    id: 'prod-002',
    sku: 'GLV-NIT-M',
    title: 'Nitrile Gloves M (100)',
    category: 'PPE',
    supplier: 'ClinicPro',
    status: 'low',
    onHand: 18,
    reserved: 6,
  },
  {
    id: 'prod-003',
    sku: 'ANS-GEL',
    title: 'Topical Anesthetic Gel',
    category: 'Clinical',
    supplier: 'DentalPrime',
    status: 'out',
    onHand: 0,
    reserved: 0,
  },
];

export const locations: Location[] = [
  { id: 'loc-mla', name: 'Mosta Main Clinic', areaCode: 'MLA-01', totalSkus: 220, lowStockSkus: 14 },
  { id: 'loc-vlt', name: 'Valletta Branch', areaCode: 'VLT-02', totalSkus: 180, lowStockSkus: 9 },
  { id: 'loc-sli', name: 'Sliema Branch', areaCode: 'SLI-03', totalSkus: 160, lowStockSkus: 6 },
];

export const movements: Movement[] = [
  {
    id: 'mov-1001',
    productId: 'prod-002',
    productTitle: 'Nitrile Gloves M (100)',
    locationId: 'loc-mla',
    reasonCode: 'ADJUSTMENT',
    quantityDelta: -5,
    createdAt: '2026-03-14T08:12:00Z',
  },
  {
    id: 'mov-1002',
    productId: 'prod-001',
    productTitle: 'Floss Mint 50m',
    locationId: 'loc-vlt',
    reasonCode: 'TRANSFER',
    quantityDelta: 20,
    createdAt: '2026-03-14T09:40:00Z',
  },
  {
    id: 'mov-1003',
    productId: 'prod-003',
    productTitle: 'Topical Anesthetic Gel',
    locationId: 'loc-sli',
    reasonCode: 'STOCKTAKE_VARIANCE',
    quantityDelta: -2,
    createdAt: '2026-03-14T10:00:00Z',
  },
];
