import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Location, Product } from '../data/mockInventory';
import { fetchProductStockBreakdown, formatLocationFallback, type ProductStockBreakdownResponse } from '../lib/inventoryApi';
import { getRuntimeDepartmentId, getRuntimeUserId } from '../lib/transferApi';

type Props = {
  products: Product[];
  locations: Location[];
};

export function ProductDetailPage({ products, locations }: Props) {
  const { productId } = useParams();
  const [liveDetail, setLiveDetail] = useState<ProductStockBreakdownResponse | null>(null);
  const [status, setStatus] = useState<string>('');
  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const numericProductId = useMemo(() => {
    const parsed = Number(productId);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [productId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveDetail(targetProductId: number) {
      setStatus('Loading stock breakdown...');
      try {
        const detail = await fetchProductStockBreakdown({
          productId: targetProductId,
          userId: getRuntimeUserId(),
          departmentId: getRuntimeDepartmentId(),
        });
        if (!cancelled) {
          setLiveDetail(detail);
          setStatus(`Loaded ${detail.data.length} row(s)`);
        }
      } catch (err) {
        if (!cancelled) {
          setLiveDetail(null);
          setStatus(`Failed to load stock breakdown: ${(err as Error).message}`);
        }
      }
    }

    if (numericProductId) {
      void loadLiveDetail(numericProductId);
    } else {
      setLiveDetail(null);
      setStatus('');
    }

    return () => {
      cancelled = true;
    };
  }, [numericProductId]);

  if (!product && !numericProductId) {
    return (
      <section>
        <h2>Product not found</h2>
        <Link to="/inventory/products">Back to products</Link>
      </section>
    );
  }

  if (liveDetail) {
    return (
      <section>
        <h2>{liveDetail.product.product_name}</h2>
        <p>SKU: {liveDetail.product.sku} | Product ID: {liveDetail.product.product_id}</p>

        <h3>Department and location breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Location</th>
              <th>On Hand</th>
              <th>Stock Value</th>
            </tr>
          </thead>
          <tbody>
            {liveDetail.data.map((row) => (
              <tr key={`${row.department_id}-${row.location_id ?? 'none'}`}>
                <td>{row.department_code} - {row.department_name}</td>
                <td>{formatLocationFallback(row.location_code, row.location_name)}</td>
                <td>{Number(row.on_hand_qty).toFixed(2)}</td>
                <td>{Number(row.stock_value).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {status ? <p className="status">{status}</p> : null}
      </section>
    );
  }

  if (!product) {
    return (
      <section>
        <h2>Product not found</h2>
        <Link to="/inventory/products">Back to products</Link>
        {status ? <p className="status">{status}</p> : null}
      </section>
    );
  }

  return (
    <section>
      <h2>{product.title}</h2>
      <p>SKU: {product.sku} | Supplier: {product.supplier} | Reserved: {product.reserved}</p>

      <h3>Per-location stock (mock)</h3>
      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Area</th>
            <th>On Hand</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location, idx) => (
            <tr key={location.id}>
              <td>{location.name}</td>
              <td>{location.areaCode}</td>
              <td>{Math.max(0, product.onHand - idx * 7)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
