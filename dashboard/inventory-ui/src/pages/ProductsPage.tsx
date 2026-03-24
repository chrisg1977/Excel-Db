import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createProduct, fetchProducts, ProductRow, updateProduct } from '../lib/productApi';
import { createSupplier, searchSuppliers, SupplierRow } from '../lib/supplierApi';
import { getRuntimeUserId } from '../lib/transferApi';

const pageSize = 50;

export function ProductsPage() {
  const [userId, setUserId] = useState<number>(getRuntimeUserId());
  const [query, setQuery] = useState<string>('');
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const [sku, setSku] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [defaultCost, setDefaultCost] = useState<string>('');
  const [isPurchasable, setIsPurchasable] = useState<boolean>(true);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [selectedProductId, setSelectedProductId] = useState<number>(0);

  const [supplierQuery, setSupplierQuery] = useState<string>('');
  const [supplierOptions, setSupplierOptions] = useState<SupplierRow[]>([]);
  const [supplierId, setSupplierId] = useState<number>(0);
  const [includeInactiveSuppliers, setIncludeInactiveSuppliers] = useState<boolean>(false);
  const [allowNullSupplier, setAllowNullSupplier] = useState<boolean>(false);
  const [supplierLoading, setSupplierLoading] = useState<boolean>(false);

  const [showCreateSupplier, setShowCreateSupplier] = useState<boolean>(false);
  const [createSupplierName, setCreateSupplierName] = useState<string>('');
  const [createSupplierCode, setCreateSupplierCode] = useState<string>('');
  const [createSupplierContactName, setCreateSupplierContactName] = useState<string>('');
  const [createSupplierPhone, setCreateSupplierPhone] = useState<string>('');
  const [createSupplierEmail, setCreateSupplierEmail] = useState<string>('');
  const [createSupplierLeadTimeDays, setCreateSupplierLeadTimeDays] = useState<string>('');
  const [createSupplierMinimumOrderValue, setCreateSupplierMinimumOrderValue] = useState<string>('');
  const [createSupplierCurrencyCode, setCreateSupplierCurrencyCode] = useState<string>('EUR');
  const [createSupplierNotes, setCreateSupplierNotes] = useState<string>('');

  const [editSku, setEditSku] = useState<string>('');
  const [editProductName, setEditProductName] = useState<string>('');
  const [editDefaultCost, setEditDefaultCost] = useState<string>('');
  const [editIsPurchasable, setEditIsPurchasable] = useState<boolean>(true);
  const [editIsActive, setEditIsActive] = useState<boolean>(true);

  const selectedProduct = useMemo(
    () => rows.find((row) => row.product_id === selectedProductId) || null,
    [rows, selectedProductId]
  );

  const canPrev = offset > 0;
  const canNext = offset + rows.length < totalCount;

  async function refresh(nextOffset = offset) {
    setLoading(true);
    setStatus('');
    try {
      const result = await fetchProducts({
        userId,
        query,
        limit: pageSize,
        offset: nextOffset,
        sortBy: 'product_name',
        sortDir: 'asc',
      });
      const list = result.rows || result.data || [];
      setRows(list);
      setOffset(nextOffset);
      setTotalCount(Number(result.total_count || 0));
      setStatus(`Loaded ${list.length} product(s)`);
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

  useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      setSupplierLoading(true);
      try {
        const result = await searchSuppliers({
          userId,
          query: supplierQuery,
          limit: 20,
          offset: 0,
          includeInactive: includeInactiveSuppliers,
        });
        if (!cancelled) {
          setSupplierOptions(result.rows || result.data || []);
        }
      } catch {
        if (!cancelled) {
          setSupplierOptions([]);
        }
      } finally {
        if (!cancelled) {
          setSupplierLoading(false);
        }
      }
    }

    void loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, [supplierQuery, userId, includeInactiveSuppliers]);

  useEffect(() => {
    if (!selectedProduct) {
      setEditSku('');
      setEditProductName('');
      setEditDefaultCost('');
      setEditIsPurchasable(true);
      setEditIsActive(true);
      return;
    }

    setEditSku(selectedProduct.sku);
    setEditProductName(selectedProduct.product_name);
    setEditDefaultCost(String(selectedProduct.default_cost ?? ''));
    setEditIsPurchasable(Boolean(selectedProduct.is_purchasable));
    setEditIsActive(Boolean(selectedProduct.is_active));
  }, [selectedProduct]);

  async function handleCreateSupplier() {
    setSaving(true);
    setStatus('');
    try {
      if (!createSupplierName.trim()) {
        setStatus('supplier_name is required');
        setSaving(false);
        return;
      }

      const created = await createSupplier({
        user_id: userId,
        supplier_name: createSupplierName.trim(),
        supplier_code: createSupplierCode.trim() || null,
        contact_name: createSupplierContactName.trim() || null,
        phone: createSupplierPhone.trim() || null,
        email: createSupplierEmail.trim() || null,
        lead_time_days: createSupplierLeadTimeDays ? Number(createSupplierLeadTimeDays) : null,
        minimum_order_value: createSupplierMinimumOrderValue ? Number(createSupplierMinimumOrderValue) : null,
        currency_code: createSupplierCurrencyCode.trim() || 'EUR',
        notes: createSupplierNotes.trim() || null,
        is_active: true,
      });

      setSupplierId(created.supplier_id);
      setSupplierQuery(created.supplier_name);
      setShowCreateSupplier(false);
      setCreateSupplierName('');
      setCreateSupplierCode('');
      setCreateSupplierContactName('');
      setCreateSupplierPhone('');
      setCreateSupplierEmail('');
      setCreateSupplierLeadTimeDays('');
      setCreateSupplierMinimumOrderValue('');
      setCreateSupplierCurrencyCode('EUR');
      setCreateSupplierNotes('');
      setStatus(`Supplier created: ${created.supplier_name}`);
    } catch (err) {
      setStatus(`Create supplier failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      if (!sku.trim() || !productName.trim()) {
        setStatus('sku and product_name are required');
        setSaving(false);
        return;
      }
      if (isPurchasable && !supplierId && !allowNullSupplier) {
        setStatus('Supplier is required for purchasable items unless "Allow No Supplier" is enabled');
        setSaving(false);
        return;
      }

      const created = await createProduct({
        user_id: userId,
        sku: sku.trim(),
        product_name: productName.trim(),
        supplier_id: supplierId || null,
        default_cost: defaultCost ? Number(defaultCost) : null,
        is_purchasable: isPurchasable,
        is_active: isActive,
      });

      setSku('');
      setProductName('');
      setDefaultCost('');
      setSupplierId(0);
      setSupplierQuery('');
      setIsPurchasable(true);
      setIsActive(true);
      setAllowNullSupplier(false);
      setSelectedProductId(created.product_id);
      setStatus(`Product created: ${created.sku}`);
      await refresh(0);
    } catch (err) {
      setStatus(`Create product failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateProduct() {
    if (!selectedProduct) {
      setStatus('Select a product to update');
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      if (editIsPurchasable && !supplierId && !allowNullSupplier) {
        setStatus('Supplier is required for purchasable items unless "Allow No Supplier" is enabled');
        setSaving(false);
        return;
      }

      const updated = await updateProduct({
        product_id: selectedProduct.product_id,
        user_id: userId,
        sku: editSku.trim(),
        product_name: editProductName.trim(),
        supplier_id: supplierId || null,
        default_cost: editDefaultCost ? Number(editDefaultCost) : null,
        is_purchasable: editIsPurchasable,
        is_active: editIsActive,
      });

      setStatus(`Product updated: ${updated.sku}`);
      await refresh(offset);
    } catch (err) {
      setStatus(`Update failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Products</h2>

      <section className="panel">
        <div className="grid-6">
          <label>
            User ID
            <input type="number" min={1} value={userId || ''} onChange={(e) => setUserId(Number(e.target.value) || 0)} />
          </label>
          <label>
            Search
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="sku, name, supplier" />
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={() => void refresh(0)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Create Product</h3>
        <form onSubmit={handleCreateProduct}>
          <div className="grid-6">
            <label>
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} required />
            </label>
            <label>
              Product Name
              <input value={productName} onChange={(e) => setProductName(e.target.value)} required />
            </label>
            <label>
              Supplier Search
              <input value={supplierQuery} onChange={(e) => setSupplierQuery(e.target.value)} placeholder="type supplier" />
            </label>
            <label>
              Include Inactive Suppliers
              <select value={includeInactiveSuppliers ? '1' : '0'} onChange={(e) => setIncludeInactiveSuppliers(e.target.value === '1')}>
                <option value="0">no</option>
                <option value="1">yes</option>
              </select>
            </label>
            <label>
              Supplier
              <select value={supplierId || ''} onChange={(e) => setSupplierId(Number(e.target.value) || 0)}>
                <option value="">No supplier</option>
                {supplierOptions.map((supplier) => (
                  <option key={supplier.supplier_id} value={supplier.supplier_id}>
                    {supplier.supplier_name}{supplier.supplier_code ? ` (${supplier.supplier_code})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="row-actions tight">
              <button type="button" className="ghost" onClick={() => setShowCreateSupplier(true)} disabled={saving}>
                {supplierQuery.trim() ? `Create new supplier "${supplierQuery.trim()}"` : 'Create Supplier'}
              </button>
            </div>
            <label>
              Allow No Supplier
              <select value={allowNullSupplier ? '1' : '0'} onChange={(e) => setAllowNullSupplier(e.target.value === '1')}>
                <option value="0">no</option>
                <option value="1">yes</option>
              </select>
            </label>
            <label>
              Default Cost
              <input type="number" min="0" step="0.01" value={defaultCost} onChange={(e) => setDefaultCost(e.target.value)} />
            </label>
            <label>
              Purchasable
              <select value={isPurchasable ? '1' : '0'} onChange={(e) => setIsPurchasable(e.target.value === '1')}>
                <option value="1">yes</option>
                <option value="0">no</option>
              </select>
            </label>
            <label>
              Active
              <select value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')}>
                <option value="1">yes</option>
                <option value="0">no</option>
              </select>
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Product'}</button>
            </div>
          </div>
          <p>{supplierLoading ? 'Loading supplier suggestions...' : 'Supplier suggestions ready'}</p>
        </form>

        {showCreateSupplier ? (
          <div className="panel">
            <h4>Create Supplier</h4>
            <div className="grid-6">
              <label>
                Supplier Name
                <input value={createSupplierName} onChange={(e) => setCreateSupplierName(e.target.value)} required />
              </label>
              <label>
                Supplier Code
                <input value={createSupplierCode} onChange={(e) => setCreateSupplierCode(e.target.value)} />
              </label>
              <label>
                Contact Name
                <input value={createSupplierContactName} onChange={(e) => setCreateSupplierContactName(e.target.value)} />
              </label>
              <label>
                Phone
                <input value={createSupplierPhone} onChange={(e) => setCreateSupplierPhone(e.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={createSupplierEmail} onChange={(e) => setCreateSupplierEmail(e.target.value)} />
              </label>
              <label>
                Lead Time Days
                <input type="number" min="0" value={createSupplierLeadTimeDays} onChange={(e) => setCreateSupplierLeadTimeDays(e.target.value)} />
              </label>
              <label>
                Minimum Order Value
                <input type="number" min="0" step="0.01" value={createSupplierMinimumOrderValue} onChange={(e) => setCreateSupplierMinimumOrderValue(e.target.value)} />
              </label>
              <label>
                Currency Code
                <input value={createSupplierCurrencyCode} onChange={(e) => setCreateSupplierCurrencyCode(e.target.value)} />
              </label>
              <label>
                Notes
                <input value={createSupplierNotes} onChange={(e) => setCreateSupplierNotes(e.target.value)} />
              </label>
              <div className="row-actions tight">
                <button type="button" onClick={() => void handleCreateSupplier()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Supplier'}
                </button>
                <button type="button" className="ghost" onClick={() => setShowCreateSupplier(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h3>Edit Selected Product</h3>
        <div className="grid-6">
          <label>
            Selected Product ID
            <input value={selectedProduct ? String(selectedProduct.product_id) : ''} readOnly placeholder="Select from list" />
          </label>
          <label>
            SKU
            <input value={editSku} onChange={(e) => setEditSku(e.target.value)} disabled={!selectedProduct} />
          </label>
          <label>
            Product Name
            <input value={editProductName} onChange={(e) => setEditProductName(e.target.value)} disabled={!selectedProduct} />
          </label>
          <label>
            Default Cost
            <input type="number" min="0" step="0.01" value={editDefaultCost} onChange={(e) => setEditDefaultCost(e.target.value)} disabled={!selectedProduct} />
          </label>
          <label>
            Purchasable
            <select value={editIsPurchasable ? '1' : '0'} onChange={(e) => setEditIsPurchasable(e.target.value === '1')} disabled={!selectedProduct}>
              <option value="1">yes</option>
              <option value="0">no</option>
            </select>
          </label>
          <label>
            Active
            <select value={editIsActive ? '1' : '0'} onChange={(e) => setEditIsActive(e.target.value === '1')} disabled={!selectedProduct}>
              <option value="1">yes</option>
              <option value="0">no</option>
            </select>
          </label>
          <div className="row-actions tight">
            <button type="button" onClick={() => void handleUpdateProduct()} disabled={!selectedProduct || saving}>
              {saving ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Product List</h3>
        {!loading && rows.length === 0 ? <p>No products found.</p> : null}
        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>SKU</th>
              <th>Name</th>
              <th>Supplier</th>
              <th>Default Cost</th>
              <th>Purchasable</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.product_id}>
                <td>
                  <label className="inline">
                    <input
                      type="radio"
                      checked={selectedProductId === product.product_id}
                      onChange={() => {
                        setSelectedProductId(product.product_id);
                        setSupplierId(product.supplier_id || 0);
                        setSupplierQuery(product.supplier_name || '');
                      }}
                    />
                    pick
                  </label>
                </td>
                <td>{product.sku}</td>
                <td>{product.product_name}</td>
                <td>{product.supplier_name || '-'}</td>
                <td>{Number(product.default_cost || 0).toFixed(2)}</td>
                <td>{product.is_purchasable ? 'yes' : 'no'}</td>
                <td>{product.is_active ? 'yes' : 'no'}</td>
                <td><Link to={`/inventory/products/${product.product_id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions">
          <button type="button" className="ghost" onClick={() => void refresh(Math.max(offset - pageSize, 0))} disabled={!canPrev || loading}>Previous</button>
          <span>Showing {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {totalCount}</span>
          <button type="button" className="ghost" onClick={() => void refresh(offset + pageSize)} disabled={!canNext || loading}>Next</button>
          <button type="button" onClick={() => void handleUpdateProduct()} disabled={!selectedProduct || saving}>Save Selected Product</button>
        </div>
      </section>

      {status ? <p className="status">{status}</p> : null}
    </section>
  );
}
