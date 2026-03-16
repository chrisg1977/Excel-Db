import { FormEvent, useEffect, useState } from 'react';
import { createPhase2PurchaseOrder, fetchPhase2PurchaseOrders, fetchPhase2Suppliers, Phase2PurchaseOrderRow, Phase2SupplierRow } from '../lib/phase2Api';
import { getRuntimeDepartmentId, getRuntimeUserId } from '../lib/transferApi';

export function ProcurementPage() {
  const [userId] = useState<number>(getRuntimeUserId());
  const [departmentId] = useState<number>(getRuntimeDepartmentId());
  const [query, setQuery] = useState<string>('');
  const [rows, setRows] = useState<Phase2PurchaseOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<Phase2SupplierRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const [supplierId, setSupplierId] = useState<number>(0);
  const [expectedDate, setExpectedDate] = useState<string>('');
  const [lineDescription, setLineDescription] = useState<string>('');
  const [lineQty, setLineQty] = useState<string>('1');
  const [lineUnitCost, setLineUnitCost] = useState<string>('0');

  async function refresh() {
    setLoading(true);
    setStatus('');
    try {
      const [poResult, supplierResult] = await Promise.all([
        fetchPhase2PurchaseOrders({ userId, departmentId, query, limit: 100, offset: 0 }),
        fetchPhase2Suppliers({ userId, limit: 200, offset: 0, includeInactive: false }),
      ]);
      setRows(poResult.rows || poResult.data || []);
      setSuppliers(supplierResult.rows || supplierResult.data || []);
      setStatus(`Loaded ${poResult.total_count} PO(s)`);
    } catch (err) {
      setStatus(`Load procurement data failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreatePo(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!supplierId) {
        setStatus('Supplier is required');
        setSaving(false);
        return;
      }
      const qty = Number(lineQty);
      const unitCost = Number(lineUnitCost);
      if (!Number.isFinite(qty) || qty <= 0) {
        setStatus('Ordered quantity must be > 0');
        setSaving(false);
        return;
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        setStatus('Unit cost must be >= 0');
        setSaving(false);
        return;
      }

      await createPhase2PurchaseOrder({
        user_id: userId,
        supplier_id: supplierId,
        department_id: departmentId,
        expected_date: expectedDate || null,
        notes: 'Created from phase-2 procurement page',
        lines: [
          {
            item_type: 'misc',
            description: lineDescription || 'PO line',
            ordered_qty: qty,
            unit_cost: unitCost,
          },
        ],
      });

      setSupplierId(0);
      setExpectedDate('');
      setLineDescription('');
      setLineQty('1');
      setLineUnitCost('0');
      setStatus('Purchase order created');
      await refresh();
    } catch (err) {
      setStatus(`Create PO failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Procurement</h2>
        <form onSubmit={handleCreatePo}>
          <div className="grid-5">
            <label>
              Supplier
              <select value={supplierId || ''} onChange={(e) => setSupplierId(Number(e.target.value) || 0)}>
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.supplier_id} value={supplier.supplier_id}>
                    {supplier.supplier_code || '-'} - {supplier.supplier_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expected Date
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </label>
            <label>
              Line Description
              <input value={lineDescription} onChange={(e) => setLineDescription(e.target.value)} placeholder="Mouthwash case / AC service" />
            </label>
            <label>
              Qty
              <input type="number" min="0.0001" step="0.0001" value={lineQty} onChange={(e) => setLineQty(e.target.value)} />
            </label>
            <label>
              Unit Cost
              <input type="number" min="0" step="0.0001" value={lineUnitCost} onChange={(e) => setLineUnitCost(e.target.value)} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create PO'}</button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Purchase Order List</h3>
        <div className="toolbar-inline">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PO / supplier" />
          <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Supplier</th>
                <th>Department</th>
                <th>Status</th>
                <th>Order Date</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.po_id}>
                  <td>{row.po_number}</td>
                  <td>{row.supplier_name}</td>
                  <td>{row.department_name}</td>
                  <td>{row.status}</td>
                  <td>{row.order_date || '-'}</td>
                  <td>{row.expected_date || '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6}>No purchase orders</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="status">{status}</p>
      </section>
    </div>
  );
}
