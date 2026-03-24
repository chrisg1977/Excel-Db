import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTransferFormOptions, getRuntimeDepartmentId, getRuntimeUserId, setRuntimeContext, type TransferDepartmentOption } from '../lib/transferApi';
import { fetchStockByDepartment, type StockByDepartmentRow } from '../lib/inventoryApi';

export function StockByDepartmentPage() {
  const pageSize = 50;
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [query, setQuery] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>('department_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [rows, setRows] = useState<StockByDepartmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const totals = useMemo(() => {
    const totalQty = rows.reduce((sum, row) => sum + Number(row.on_hand_qty || 0), 0);
    const totalValue = rows.reduce((sum, row) => sum + Number(row.stock_value || 0), 0);
    return { totalQty, totalValue };
  }, [rows]);

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const [options, stock] = await Promise.all([
        fetchTransferFormOptions(),
        fetchStockByDepartment({
          userId,
          departmentId,
          query,
          limit: pageSize,
          offset: nextOffset,
          sortBy,
          sortDir,
        }),
      ]);
      setDepartments(options.departments);
      setRows(stock.rows || stock.data || []);
      setTotalCount(Number(stock.total_count || 0));
      setOffset(nextOffset);
      setStatus(`Loaded ${(stock.rows || stock.data || []).length} row(s) of ${Number(stock.total_count || 0)}`);
    } catch (err) {
      setStatus(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;

  return (
    <section>
      <h2>Stock by Department</h2>
      <p>Department-level stock position with product search and direct drill-down.</p>

      <section className="panel">
        <div className="grid-6">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value) || 0)} />
          </label>
          <label>
            Department
            <select value={departmentId || ''} onChange={(e) => setDepartmentId(Number(e.target.value) || 0)}>
              <option value="">All allowed departments</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              type="text"
              placeholder="SKU, product, department"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="department_name">Department</option>
              <option value="product_name">Product</option>
              <option value="sku">SKU</option>
              <option value="on_hand_qty">On Hand</option>
              <option value="stock_value">Stock Value</option>
            </select>
          </label>
          <label>
            Sort Dir
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value === 'desc' ? 'desc' : 'asc')}>
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={() => void refresh(0)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
      </section>

      <div className="metrics">
        <article><span>Rows</span><strong>{rows.length}</strong></article>
        <article><span>Total On Hand</span><strong>{totals.totalQty.toFixed(2)}</strong></article>
        <article><span>Total Stock Value</span><strong>{totals.totalValue.toFixed(2)}</strong></article>
      </div>

      <section className="panel">
        {!loading && rows.length === 0 ? <p>No rows found for the current filters.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>SKU</th>
              <th>Product</th>
              <th>On Hand</th>
              <th>Stock Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.department_id}-${row.product_id}`}>
                <td>{row.department_code} - {row.department_name}</td>
                <td>{row.sku}</td>
                <td>{row.product_name}</td>
                <td>{Number(row.on_hand_qty).toFixed(2)}</td>
                <td>{Number(row.stock_value).toFixed(2)}</td>
                <td>
                  <Link to={`/inventory/products/${row.product_id}?department_id=${row.department_id}`}>View Detail</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions">
          <button type="button" className="ghost" onClick={() => void refresh(Math.max(offset - pageSize, 0))} disabled={!canPrev || loading}>Previous</button>
          <span>Showing {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {totalCount}</span>
          <button type="button" className="ghost" onClick={() => void refresh(offset + pageSize)} disabled={!canNext || loading}>Next</button>
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
