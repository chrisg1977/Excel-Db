import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Location, Product } from '../data/mockInventory';

type Props = {
  locations: Location[];
  products: Product[];
};

export function StocktakePage({ locations, products }: Props) {
  const { locationId } = useParams();
  const location = useMemo(() => locations.find((l) => l.id === locationId), [locations, locationId]);

  return (
    <section>
      <h2>Stocktake Session</h2>
      <p>
        Location: <strong>{location?.name ?? 'Unknown'}</strong>
        {' '}({location?.areaCode ?? 'n/a'})
      </p>

      <div className="metrics">
        <article><span>Session Status</span><strong>To Count</strong></article>
        <article><span>Lines to Count</span><strong>{products.length}</strong></article>
        <article><span>Variance Alerts</span><strong>1</strong></article>
      </div>

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Title</th>
            <th>Expected</th>
            <th>Counted (mock)</th>
            <th>Variance</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, idx) => {
            const counted = Math.max(0, product.onHand - (idx % 2 === 0 ? 0 : 1));
            const variance = counted - product.onHand;

            return (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.title}</td>
                <td>{product.onHand}</td>
                <td>{counted}</td>
                <td>{variance}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
