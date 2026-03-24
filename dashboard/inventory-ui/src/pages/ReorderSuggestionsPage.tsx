import { useEffect, useMemo, useState } from 'react';
import { fetchTransferFormOptions, getRuntimeDepartmentId, getRuntimeUserId, setRuntimeContext, type TransferDepartmentOption } from '../lib/transferApi';
import {
  fetchReorderSuggestions,
  generateReorderSuggestions,
  type ReorderSuggestionRow,
} from '../lib/inventoryApi';

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReorderSuggestionsPage() {
  const pageSize = 50;
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [departmentId, setDepartmentId] = useState<number>(getRuntimeDepartmentId());
  const [suggestionDate, setSuggestionDate] = useState<string>(todayIsoDate());
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [query, setQuery] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>('suggested_order_qty');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [departments, setDepartments] = useState<TransferDepartmentOption[]>([]);
  const [rows, setRows] = useState<ReorderSuggestionRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.reorder_suggestion_id)), [rows, selectedIds]);

  const metrics = useMemo(() => {
    const totalSuggestedQty = rows.reduce((sum, row) => sum + Number(row.suggested_order_qty || 0), 0);
    const conversionReady = rows.filter((row) => row.po_conversion_ready).length;
    return {
      totalSuggestedQty,
      conversionReady,
      selectedCount: selectedRows.length,
      selectedSuggestedQty: selectedRows.reduce((sum, row) => sum + Number(row.suggested_order_qty || 0), 0),
    };
  }, [rows, selectedRows]);

  const poPreview = useMemo(() => {
    const groups = new Map<string, {
      department: string;
      supplier: string;
      lineCount: number;
      totalSuggestedQty: number;
      skus: string[];
      missingSupplier: boolean;
    }>();

    for (const row of selectedRows) {
      const supplierLabel = row.supplier_name || 'Missing preferred supplier';
      const key = `${row.department_id}::${row.supplier_id || 0}`;
      const existing = groups.get(key);
      if (existing) {
        existing.lineCount += 1;
        existing.totalSuggestedQty += Number(row.suggested_order_qty || 0);
        existing.skus.push(row.sku);
      } else {
        groups.set(key, {
          department: `${row.department_code} - ${row.department_name}`,
          supplier: supplierLabel,
          lineCount: 1,
          totalSuggestedQty: Number(row.suggested_order_qty || 0),
          skus: [row.sku],
          missingSupplier: !row.supplier_id,
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) => a.department.localeCompare(b.department) || a.supplier.localeCompare(b.supplier));
  }, [selectedRows]);

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const [options, suggestions] = await Promise.all([
        fetchTransferFormOptions({ userId, departmentId }),
        fetchReorderSuggestions({
          userId,
          departmentId,
          suggestionDate,
          status: statusFilter,
          query,
          limit: pageSize,
          offset: nextOffset,
          sortBy,
          sortDir,
        }),
      ]);
      const resultRows = suggestions.rows || suggestions.data || [];
      setDepartments(options.departments);
      setRows(resultRows);
      setTotalCount(Number(suggestions.total_count || 0));
      setOffset(nextOffset);
      setSelectedIds((prev) => new Set([...prev].filter((id) => resultRows.some((row) => row.reorder_suggestion_id === id))));
      setStatus(`Loaded ${resultRows.length} suggestion(s) of ${Number(suggestions.total_count || 0)}`);
    } catch (err) {
      setStatus(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function generateAndRefresh() {
    setLoading(true);
    setStatus('');
    try {
      setRuntimeContext(userId, departmentId);
      const generated = await generateReorderSuggestions({
        userId,
        departmentId,
        suggestionDate,
        regenerate: true,
      });
      setStatus(`Generated ${generated.generated_count} suggestion row(s).`);
      await refresh(0);
    } catch (err) {
      setStatus(`Generation failed: ${(err as Error).message}`);
      setLoading(false);
    }
  }

  function toggleSelection(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (checked) next.add(row.reorder_suggestion_id);
        else next.delete(row.reorder_suggestion_id);
      }
      return next;
    });
  }

  useEffect(() => {
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;
  const allRowsSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.reorder_suggestion_id));

  return (
    <section>
      <h2>Reorder Suggestions</h2>
      <p>Department-first replenishment suggestions from current stock balances (location-aware context included for review).</p>

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
            Suggestion Date
            <input type="date" value={suggestionDate} onChange={(e) => setSuggestionDate(e.target.value)} />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="new">new</option>
              <option value="reviewed">reviewed</option>
              <option value="converted">converted</option>
              <option value="ignored">ignored</option>
            </select>
          </label>
          <label>
            Search
            <input type="text" placeholder="SKU, product, supplier, department" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            Sort By
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="suggested_order_qty">Suggested Qty</option>
              <option value="available_qty">Available Qty</option>
              <option value="department_name">Department</option>
              <option value="product_name">Product</option>
              <option value="supplier_name">Supplier</option>
              <option value="location_count">Location Count</option>
            </select>
          </label>
        </div>
        <div className="row-actions">
          <label className="inline">
            Sort Dir
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value === 'asc' ? 'asc' : 'desc')}>
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <button type="button" className="ghost" onClick={() => void refresh(0)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          <button type="button" onClick={() => void generateAndRefresh()} disabled={loading}>{loading ? 'Working...' : 'Generate Suggestions'}</button>
        </div>
      </section>

      <div className="metrics">
        <article><span>Rows</span><strong>{rows.length}</strong></article>
        <article><span>Total Suggested Qty</span><strong>{metrics.totalSuggestedQty.toFixed(2)}</strong></article>
        <article><span>PO-Ready Rows</span><strong>{metrics.conversionReady}</strong></article>
        <article><span>Selected</span><strong>{metrics.selectedCount}</strong></article>
      </div>

      <section className="panel">
        {!loading && rows.length === 0 ? <p>No suggestions found for the current filters.</p> : null}
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all suggestions"
                  checked={allRowsSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
              </th>
              <th>Department</th>
              <th>SKU</th>
              <th>Product</th>
              <th>Preferred Supplier</th>
              <th>Available</th>
              <th>Min</th>
              <th>Max</th>
              <th>Reorder Qty</th>
              <th>Suggested</th>
              <th>Reason</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.reorder_suggestion_id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.reorder_suggestion_id)}
                    onChange={(e) => toggleSelection(row.reorder_suggestion_id, e.target.checked)}
                    aria-label={`Select suggestion ${row.reorder_suggestion_id}`}
                  />
                </td>
                <td>{row.department_code} - {row.department_name}</td>
                <td>{row.sku}</td>
                <td>{row.product_name}</td>
                <td>{row.supplier_name || 'Missing preferred supplier'}</td>
                <td>{Number(row.available_qty).toFixed(2)}</td>
                <td>{Number(row.min_qty).toFixed(2)}</td>
                <td>{Number(row.max_qty).toFixed(2)}</td>
                <td>{Number(row.reorder_qty).toFixed(2)}</td>
                <td>{Number(row.suggested_order_qty).toFixed(2)}</td>
                <td title={row.location_aware_hint}>{row.reason_text || '-'}</td>
                <td>{row.status}</td>
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

      <section className="panel">
        <h3>PO Conversion Preview (Preparation)</h3>
        <p>This preview groups selected suggestions into future purchase order draft buckets (department + preferred supplier).</p>
        {poPreview.length === 0 ? <p>No selected rows yet.</p> : null}
        {poPreview.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Supplier</th>
                <th>Lines</th>
                <th>Total Suggested Qty</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {poPreview.map((group, index) => (
                <tr key={`${group.department}-${group.supplier}-${index}`}>
                  <td>{group.department}</td>
                  <td>{group.supplier}</td>
                  <td>{group.lineCount}</td>
                  <td>{group.totalSuggestedQty.toFixed(2)}</td>
                  <td>{group.missingSupplier ? 'Cannot auto-convert until preferred supplier is set.' : 'Ready for future PO draft conversion.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
