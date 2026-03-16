import { FormEvent, useEffect, useState } from 'react';
import {
  fetchPhase2SupplierAddresses,
  fetchPhase2SupplierCategories,
  fetchPhase2SupplierCategoriesCatalog,
  fetchPhase2SupplierContacts,
  fetchPhase2SupplierContracts,
  fetchPhase2SupplierDetail,
  fetchPhase2Suppliers,
  Phase2SupplierAddress,
  Phase2SupplierCategory,
  Phase2SupplierCategoryLink,
  Phase2SupplierContact,
  Phase2SupplierContract,
  Phase2SupplierDetail,
  Phase2SupplierRow,
  updatePhase2Supplier,
} from '../lib/phase2Api';
import { getRuntimeUserId } from '../lib/transferApi';

export function SupplierMasterPage() {
  const [userId] = useState<number>(getRuntimeUserId());
  const [query, setQuery] = useState<string>('');
  const [rows, setRows] = useState<Phase2SupplierRow[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number>(0);
  const [selectedSupplier, setSelectedSupplier] = useState<Phase2SupplierDetail | null>(null);
  const [contacts, setContacts] = useState<Phase2SupplierContact[]>([]);
  const [addresses, setAddresses] = useState<Phase2SupplierAddress[]>([]);
  const [categories, setCategories] = useState<Phase2SupplierCategoryLink[]>([]);
  const [contracts, setContracts] = useState<Phase2SupplierContract[]>([]);
  const [categoryCatalog, setCategoryCatalog] = useState<Phase2SupplierCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  const [editStatus, setEditStatus] = useState<string>('active');
  const [editMainPhone, setEditMainPhone] = useState<string>('');
  const [editMainEmail, setEditMainEmail] = useState<string>('');
  const [editPaymentTerms, setEditPaymentTerms] = useState<string>('');
  const [editInternalNotes, setEditInternalNotes] = useState<string>('');

  async function refreshList() {
    setLoading(true);
    setStatus('');
    try {
      const result = await fetchPhase2Suppliers({ userId, query, limit: 100, offset: 0, includeInactive: true });
      setRows(result.rows || result.data || []);
      setStatus(`Loaded ${result.total_count} supplier(s)`);
    } catch (err) {
      setStatus(`Load suppliers failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSelected(supplierId: number) {
    if (!supplierId) return;
    setLoading(true);
    try {
      const [detail, c, a, cat, con, catCatalog] = await Promise.all([
        fetchPhase2SupplierDetail({ userId, supplierId }),
        fetchPhase2SupplierContacts({ userId, supplierId }),
        fetchPhase2SupplierAddresses({ userId, supplierId }),
        fetchPhase2SupplierCategories({ userId, supplierId }),
        fetchPhase2SupplierContracts({ userId, supplierId }),
        fetchPhase2SupplierCategoriesCatalog({ userId }),
      ]);
      setSelectedSupplier(detail);
      setContacts(c.rows || c.data || []);
      setAddresses(a.rows || a.data || []);
      setCategories(cat.rows || cat.data || []);
      setContracts(con.rows || con.data || []);
      setCategoryCatalog(catCatalog.rows || catCatalog.data || []);

      setEditStatus(detail.supplier_status || 'active');
      setEditMainPhone(detail.main_phone || '');
      setEditMainEmail(detail.main_email || '');
      setEditPaymentTerms(detail.payment_terms_days == null ? '' : String(detail.payment_terms_days));
      setEditInternalNotes(detail.notes_internal || '');
    } catch (err) {
      setStatus(`Load supplier detail failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedSupplierId > 0) {
      void refreshSelected(selectedSupplierId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplierId]);

  async function handleUpdateSupplier(e: FormEvent) {
    e.preventDefault();
    if (!selectedSupplierId) {
      setStatus('Select a supplier first');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      await updatePhase2Supplier({
        user_id: userId,
        supplier_id: selectedSupplierId,
        supplier_status: editStatus,
        main_phone: editMainPhone || null,
        main_email: editMainEmail || null,
        payment_terms_days: editPaymentTerms ? Number(editPaymentTerms) : null,
        notes_internal: editInternalNotes || null,
      });
      setStatus('Supplier updated');
      await refreshSelected(selectedSupplierId);
      await refreshList();
    } catch (err) {
      setStatus(`Update supplier failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <h2>Supplier Master</h2>
        <div className="toolbar-inline">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier name/code" />
          <button type="button" onClick={() => void refreshList()} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th>Currency</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.supplier_id}
                  onClick={() => setSelectedSupplierId(row.supplier_id)}
                  style={{ cursor: 'pointer', background: row.supplier_id === selectedSupplierId ? 'rgba(0,0,0,0.06)' : undefined }}
                >
                  <td>{row.supplier_code || '-'}</td>
                  <td>{row.supplier_name}</td>
                  <td>{row.supplier_status || '-'}</td>
                  <td>{row.currency_code || '-'}</td>
                  <td>{row.main_email || '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5}>No suppliers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="status">{status}</p>
      </section>

      <section className="panel">
        <h3>Supplier Detail</h3>
        <form onSubmit={handleUpdateSupplier}>
          <div className="grid-4">
            <label>
              Supplier
              <input value={selectedSupplier ? `${selectedSupplier.supplier_code || '-'} - ${selectedSupplier.supplier_name}` : ''} readOnly placeholder="Select supplier" />
            </label>
            <label>
              Status
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} disabled={!selectedSupplier}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="suspended">suspended</option>
                <option value="archived">archived</option>
                <option value="blacklisted">blacklisted</option>
              </select>
            </label>
            <label>
              Main Phone
              <input value={editMainPhone} onChange={(e) => setEditMainPhone(e.target.value)} disabled={!selectedSupplier} />
            </label>
            <label>
              Main Email
              <input type="email" value={editMainEmail} onChange={(e) => setEditMainEmail(e.target.value)} disabled={!selectedSupplier} />
            </label>
            <label>
              Payment Terms (days)
              <input type="number" min="0" value={editPaymentTerms} onChange={(e) => setEditPaymentTerms(e.target.value)} disabled={!selectedSupplier} />
            </label>
            <label>
              Internal Notes
              <input value={editInternalNotes} onChange={(e) => setEditInternalNotes(e.target.value)} disabled={!selectedSupplier} />
            </label>
            <div className="row-actions tight">
              <button type="submit" disabled={!selectedSupplier || saving}>{saving ? 'Saving...' : 'Save Detail'}</button>
            </div>
          </div>
        </form>

        <div className="grid-2">
          <div>
            <h4>Contacts</h4>
            <ul>
              {contacts.map((item) => (
                <li key={item.supplier_contact_id}>{item.contact_name} ({item.email || item.phone || '-'})</li>
              ))}
              {contacts.length === 0 && <li>-</li>}
            </ul>
          </div>
          <div>
            <h4>Addresses</h4>
            <ul>
              {addresses.map((item) => (
                <li key={item.supplier_address_id}>{item.address_type}: {item.line_1}</li>
              ))}
              {addresses.length === 0 && <li>-</li>}
            </ul>
          </div>
          <div>
            <h4>Categories</h4>
            <ul>
              {categories.map((item) => (
                <li key={item.supplier_category_link_id}>{item.category_name}</li>
              ))}
              {categories.length === 0 && <li>-</li>}
            </ul>
            <small>Catalog: {categoryCatalog.length}</small>
          </div>
          <div>
            <h4>Contracts</h4>
            <ul>
              {contracts.map((item) => (
                <li key={item.supplier_contract_id}>{item.contract_name || item.contract_type || 'contract'}</li>
              ))}
              {contracts.length === 0 && <li>-</li>}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
