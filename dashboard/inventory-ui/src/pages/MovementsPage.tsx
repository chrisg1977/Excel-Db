import { movements } from '../data/mockInventory';

export function MovementsPage() {
  return (
    <section>
      <h2>Inventory Movements</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Product</th>
            <th>Location</th>
            <th>Reason</th>
            <th>Delta</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td>{movement.id}</td>
              <td>{movement.productTitle}</td>
              <td>{movement.locationId}</td>
              <td>{movement.reasonCode}</td>
              <td>{movement.quantityDelta}</td>
              <td>{new Date(movement.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
