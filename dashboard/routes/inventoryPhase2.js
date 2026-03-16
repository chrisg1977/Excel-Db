'use strict';

function sanitizeText(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function sanitizeStatus(value, allowed, fallback) {
  const v = sanitizeText(value);
  if (!v) return fallback;
  const lowered = v.toLowerCase();
  return allowed.has(lowered) ? lowered : null;
}

function nextRef(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function registerInventoryPhase2Routes({ app, pool, apiLimiter, helpers }) {
  const {
    parseNumeric,
    parseNumericOrNull,
    parseBooleanLike,
    parseDateOrNull,
    parseListLimitOffsetAndSort,
    requirePermissionAndScope,
    appendLocationScopeClause,
    listScopedDepartmentIds,
    assertUserLocationScopeWhenConfigured,
    assertLocationCanStoreEquipment,
    fetchSupplierById,
    fetchEquipmentAssetById,
  } = helpers;

  const supplierStatusValues = new Set(['active', 'inactive', 'suspended', 'archived', 'blacklisted']);
  const preferredOrderMethods = new Set(['email', 'phone', 'portal', 'whatsapp', 'in_person', 'api']);
  const poStatuses = new Set(['draft', 'submitted', 'approved', 'ordered', 'part_received', 'received', 'cancelled', 'closed']);
  const poRequestStatuses = new Set(['draft', 'submitted', 'approved', 'rejected', 'converted', 'cancelled']);
  const receiptStatuses = new Set(['draft', 'posted', 'cancelled']);
  const invoiceStatuses = new Set(['entered', 'matched', 'disputed', 'approved', 'paid', 'cancelled']);
  const itemTypes = new Set(['product', 'asset', 'service', 'misc']);
  const maintenanceTypes = new Set(['preventive', 'corrective', 'inspection', 'calibration', 'cleaning', 'emergency_repair']);
  const maintenanceStatuses = new Set(['scheduled', 'in_progress', 'completed', 'cancelled']);
  const incidentSeverities = new Set(['low', 'medium', 'high', 'critical']);
  const incidentStatuses = new Set(['open', 'in_progress', 'resolved', 'closed']);
  const disposalReasons = new Set(['obsolete', 'broken_beyond_repair', 'sold', 'donated', 'scrapped', 'lost_stolen']);
  const assetStatuses = new Set(['active', 'in_use', 'in_storage', 'under_repair', 'under_maintenance', 'inactive', 'disposed', 'lost', 'written_off', 'maintenance', 'retired']);

  app.get('/api/inventory/phase2/suppliers', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const q = sanitizeText(req.query.q || req.query.query) || '';
    const status = sanitizeText(req.query.supplier_status);
    const includeInactive = parseBooleanLike(req.query.include_inactive, false);
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 50,
      maxLimit: 200,
      defaultSortBy: 'supplier_name',
      defaultSortDir: 'asc',
      sortByMap: {
        supplier_name: 's.supplier_name',
        supplier_code: `COALESCE(s.supplier_code, '')`,
        supplier_status: 's.supplier_status',
        updated_at: 's.updated_at',
      },
    });

    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const where = [];
      const params = [];
      if (!includeInactive) where.push('s.is_active = TRUE');
      if (status) {
        params.push(status);
        where.push(`s.supplier_status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          s.supplier_name ILIKE $${params.length}
          OR COALESCE(s.supplier_code, '') ILIKE $${params.length}
          OR COALESCE(s.legal_name, '') ILIKE $${params.length}
          OR COALESCE(s.trade_name, '') ILIKE $${params.length}
          OR COALESCE(s.main_email, s.email, '') ILIKE $${params.length}
        )`);
      }

      const fromSql = `
        FROM inv_supplier s
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count ${fromSql}`, params);
      const dataParams = [...params, paging.limit, paging.offset];
      const rows = await client.query(
        `SELECT
           s.supplier_id,
           s.supplier_code,
           s.supplier_name,
           s.legal_name,
           s.trade_name,
           s.vat_number,
           s.registration_number,
           s.is_active,
           s.supplier_status,
           COALESCE(s.main_phone, s.phone) AS main_phone,
           COALESCE(s.main_email, s.email) AS main_email,
           s.website,
           s.currency_code,
           s.payment_terms_days,
           s.lead_time_days,
           s.minimum_order_value,
           s.minimum_order_qty,
           s.preferred_order_method,
           s.delivery_notes,
           s.default_tax_code,
           s.notes_internal,
           s.notes,
           s.created_at,
           s.updated_at
         ${fromSql}
         ORDER BY ${paging.orderBySql}, s.supplier_id DESC
         LIMIT $${dataParams.length - 1}
         OFFSET $${dataParams.length}`,
        dataParams
      );

      return res.json({
        rows: rows.rows,
        data: rows.rows,
        total_count: Number(count.rows[0]?.total_count || 0),
        limit: paging.limit,
        offset: paging.offset,
      });
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/suppliers/:id', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });

    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const result = await client.query(
        `SELECT
           s.*,
           COALESCE(s.main_phone, s.phone) AS resolved_main_phone,
           COALESCE(s.main_email, s.email) AS resolved_main_email
         FROM inv_supplier s
         WHERE s.supplier_id = $1`,
        [supplierId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
      return res.json(result.rows[0]);
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers/:id error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/inventory/phase2/suppliers/:id', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.params.id);
    const supplierName = req.body?.supplier_name === undefined ? undefined : sanitizeText(req.body.supplier_name);
    const supplierCode = req.body?.supplier_code === undefined ? undefined : sanitizeText(req.body.supplier_code);
    const supplierStatus = req.body?.supplier_status === undefined ? undefined : sanitizeStatus(req.body.supplier_status, supplierStatusValues, null);
    const preferredOrderMethod = req.body?.preferred_order_method === undefined ? undefined : sanitizeStatus(req.body.preferred_order_method, preferredOrderMethods, null);

    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });
    if (req.body?.supplier_name !== undefined && !supplierName) return res.status(400).json({ error: 'supplier_name cannot be empty' });
    if (req.body?.supplier_status !== undefined && !supplierStatus) return res.status(400).json({ error: 'supplier_status is invalid' });
    if (req.body?.preferred_order_method !== undefined && !preferredOrderMethod) return res.status(400).json({ error: 'preferred_order_method is invalid' });

    const paymentTermsDays = req.body?.payment_terms_days === undefined ? undefined : parseNumericOrNull(req.body.payment_terms_days);
    const leadTimeDays = req.body?.lead_time_days === undefined ? undefined : parseNumericOrNull(req.body.lead_time_days);
    const minimumOrderValue = req.body?.minimum_order_value === undefined ? undefined : parseNumericOrNull(req.body.minimum_order_value);
    const minimumOrderQty = req.body?.minimum_order_qty === undefined ? undefined : parseNumericOrNull(req.body.minimum_order_qty);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'supplier.edit', null, ['post', 'approve', 'full']);

      if (supplierName) {
        const dup = await client.query(
          `SELECT supplier_id FROM inv_supplier
           WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM($1))
             AND supplier_id <> $2
             AND is_active = TRUE
           LIMIT 1`,
          [supplierName, supplierId]
        );
        if (dup.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'supplier_name already exists for active supplier' });
        }
      }

      const updated = await client.query(
        `UPDATE inv_supplier
         SET
           supplier_code = COALESCE($1, supplier_code),
           supplier_name = COALESCE($2, supplier_name),
           legal_name = COALESCE($3, legal_name),
           trade_name = COALESCE($4, trade_name),
           vat_number = COALESCE($5, vat_number),
           registration_number = COALESCE($6, registration_number),
           supplier_status = COALESCE($7, supplier_status),
           main_phone = COALESCE($8, main_phone),
           main_email = COALESCE($9, main_email),
           website = COALESCE($10, website),
           currency_code = COALESCE($11, currency_code),
           payment_terms_days = COALESCE($12, payment_terms_days),
           lead_time_days = COALESCE($13, lead_time_days),
           minimum_order_value = COALESCE($14, minimum_order_value),
           minimum_order_qty = COALESCE($15, minimum_order_qty),
           preferred_order_method = COALESCE($16, preferred_order_method),
           delivery_notes = COALESCE($17, delivery_notes),
           default_tax_code = COALESCE($18, default_tax_code),
           notes_internal = COALESCE($19, notes_internal),
           is_active = COALESCE($20, is_active),
           updated_at = NOW()
         WHERE supplier_id = $21
         RETURNING *`,
        [
          supplierCode === undefined ? null : supplierCode,
          supplierName === undefined ? null : supplierName,
          req.body?.legal_name === undefined ? null : sanitizeText(req.body.legal_name),
          req.body?.trade_name === undefined ? null : sanitizeText(req.body.trade_name),
          req.body?.vat_number === undefined ? null : sanitizeText(req.body.vat_number),
          req.body?.registration_number === undefined ? null : sanitizeText(req.body.registration_number),
          supplierStatus === undefined ? null : supplierStatus,
          req.body?.main_phone === undefined ? null : sanitizeText(req.body.main_phone),
          req.body?.main_email === undefined ? null : sanitizeText(req.body.main_email),
          req.body?.website === undefined ? null : sanitizeText(req.body.website),
          req.body?.currency_code === undefined ? null : sanitizeText(req.body.currency_code)?.toUpperCase(),
          paymentTermsDays === undefined ? null : paymentTermsDays,
          leadTimeDays === undefined ? null : leadTimeDays,
          minimumOrderValue === undefined ? null : minimumOrderValue,
          minimumOrderQty === undefined ? null : minimumOrderQty,
          preferredOrderMethod === undefined ? null : preferredOrderMethod,
          req.body?.delivery_notes === undefined ? null : sanitizeText(req.body.delivery_notes),
          req.body?.default_tax_code === undefined ? null : sanitizeText(req.body.default_tax_code),
          req.body?.notes_internal === undefined ? null : sanitizeText(req.body.notes_internal),
          req.body?.is_active === undefined ? null : parseBooleanLike(req.body.is_active, true),
          supplierId,
        ]
      );

      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Supplier not found' });
      }
      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PATCH /api/inventory/phase2/suppliers/:id error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/supplier-categories', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT supplier_category_id, category_code, category_name, category_group, is_active
         FROM inv_supplier_category
         ORDER BY category_group NULLS LAST, category_name ASC`
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/supplier-categories error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/suppliers/:id/categories', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT
           l.supplier_category_link_id,
           l.supplier_id,
           l.supplier_category_id,
           l.is_primary,
           l.is_active,
           l.notes,
           c.category_code,
           c.category_name,
           c.category_group
         FROM inv_supplier_category_link l
         JOIN inv_supplier_category c ON c.supplier_category_id = l.supplier_category_id
         WHERE l.supplier_id = $1
         ORDER BY l.is_primary DESC, c.category_name ASC`,
        [supplierId]
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers/:id/categories error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/suppliers/:id/categories', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.params.id);
    const supplierCategoryId = parseNumeric(req.body?.supplier_category_id);
    if (!userId || !supplierId || !supplierCategoryId) {
      return res.status(400).json({ error: 'user_id, supplier id and supplier_category_id are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'supplier.edit', null, ['post', 'approve', 'full']);

      const inserted = await client.query(
        `INSERT INTO inv_supplier_category_link (supplier_id, supplier_category_id, is_primary, is_active, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (supplier_id, supplier_category_id)
         DO UPDATE SET is_active = EXCLUDED.is_active,
                       is_primary = EXCLUDED.is_primary,
                       notes = EXCLUDED.notes
         RETURNING *`,
        [
          supplierId,
          supplierCategoryId,
          parseBooleanLike(req.body?.is_primary, false),
          parseBooleanLike(req.body?.is_active, true),
          sanitizeText(req.body?.notes),
        ]
      );

      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/suppliers/:id/categories error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/suppliers/:id/contacts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT * FROM inv_supplier_contact WHERE supplier_id = $1 ORDER BY is_primary DESC, contact_name ASC`,
        [supplierId]
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers/:id/contacts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/suppliers/:id/contacts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.params.id);
    const contactName = sanitizeText(req.body?.contact_name);
    if (!userId || !supplierId || !contactName) return res.status(400).json({ error: 'user_id, supplier id and contact_name are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'supplier.edit', null, ['post', 'approve', 'full']);
      const inserted = await client.query(
        `INSERT INTO inv_supplier_contact (supplier_id, contact_name, job_title, phone, mobile, email, is_primary, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          supplierId,
          contactName,
          sanitizeText(req.body?.job_title),
          sanitizeText(req.body?.phone),
          sanitizeText(req.body?.mobile),
          sanitizeText(req.body?.email),
          parseBooleanLike(req.body?.is_primary, false),
          sanitizeText(req.body?.notes),
          parseBooleanLike(req.body?.is_active, true),
        ]
      );
      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/suppliers/:id/contacts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/suppliers/:id/addresses', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT * FROM inv_supplier_address WHERE supplier_id = $1 ORDER BY address_type ASC, supplier_address_id DESC`,
        [supplierId]
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers/:id/addresses error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/suppliers/:id/addresses', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.params.id);
    const addressType = sanitizeText(req.body?.address_type);
    const line1 = sanitizeText(req.body?.line_1);
    if (!userId || !supplierId || !addressType || !line1) return res.status(400).json({ error: 'user_id, supplier id, address_type and line_1 are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'supplier.edit', null, ['post', 'approve', 'full']);
      const inserted = await client.query(
        `INSERT INTO inv_supplier_address (supplier_id, address_type, line_1, line_2, locality, city, postcode, country, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          supplierId,
          addressType,
          line1,
          sanitizeText(req.body?.line_2),
          sanitizeText(req.body?.locality),
          sanitizeText(req.body?.city),
          sanitizeText(req.body?.postcode),
          sanitizeText(req.body?.country),
          sanitizeText(req.body?.notes),
          parseBooleanLike(req.body?.is_active, true),
        ]
      );
      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/suppliers/:id/addresses error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/suppliers/:id/contracts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT * FROM inv_supplier_contract WHERE supplier_id = $1 ORDER BY contract_end_date NULLS LAST, supplier_contract_id DESC`,
        [supplierId]
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/suppliers/:id/contracts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/suppliers/:id/contracts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.params.id);
    if (!userId || !supplierId) return res.status(400).json({ error: 'user_id and supplier id are required' });

    const contractStart = parseDateOrNull(req.body?.contract_start_date);
    const contractEnd = parseDateOrNull(req.body?.contract_end_date);
    if (contractStart && contractEnd && contractEnd < contractStart) {
      return res.status(400).json({ error: 'contract_end_date must be on or after contract_start_date' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'supplier.edit', null, ['post', 'approve', 'full']);
      const inserted = await client.query(
        `INSERT INTO inv_supplier_contract (
           supplier_id, contract_type, contract_name, contract_start_date, contract_end_date,
           pricing_agreement_notes, sla_notes, warranty_terms_notes, service_contract_flag,
           account_manager_name, account_manager_contact, credit_account_number, notes, is_active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          supplierId,
          sanitizeText(req.body?.contract_type),
          sanitizeText(req.body?.contract_name),
          contractStart,
          contractEnd,
          sanitizeText(req.body?.pricing_agreement_notes),
          sanitizeText(req.body?.sla_notes),
          sanitizeText(req.body?.warranty_terms_notes),
          parseBooleanLike(req.body?.service_contract_flag, false),
          sanitizeText(req.body?.account_manager_name),
          sanitizeText(req.body?.account_manager_contact),
          sanitizeText(req.body?.credit_account_number),
          sanitizeText(req.body?.notes),
          parseBooleanLike(req.body?.is_active, true),
        ]
      );
      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/suppliers/:id/contracts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/purchase-orders', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const departmentId = parseNumeric(req.query.department_id);
    const q = sanitizeText(req.query.q) || '';
    const status = sanitizeStatus(req.query.status, poStatuses, null);
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 50,
      maxLimit: 300,
      defaultSortBy: 'order_date',
      defaultSortDir: 'desc',
      sortByMap: {
        po_number: 'poh.po_number',
        order_date: 'poh.order_date',
        expected_date: 'poh.expected_date',
        status: 'poh.status',
        supplier_name: `COALESCE(s.supplier_name, '')`,
      },
    });

    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const client = await pool.connect();
    try {
      const access = await requirePermissionAndScope(client, userId, 'procurement.po.create', departmentId, ['view', 'post', 'approve', 'full']);

      const where = [];
      const params = [];
      if (departmentId) {
        params.push(departmentId);
        where.push(`poh.department_id = $${params.length}`);
      }
      if (!access.isAdmin && !departmentId) {
        const scoped = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
        if (scoped.length === 0) {
          return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
        }
        params.push(scoped);
        where.push(`poh.department_id = ANY($${params.length}::bigint[])`);
      }
      if (status) {
        params.push(status);
        where.push(`poh.status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          poh.po_number ILIKE $${params.length}
          OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
          OR COALESCE(d.department_name, '') ILIKE $${params.length}
        )`);
      }

      const fromSql = `
        FROM inv_purchase_order_header poh
        JOIN inv_supplier s ON s.supplier_id = poh.supplier_id
        JOIN inv_department d ON d.department_id = poh.department_id
        LEFT JOIN inv_location l ON l.location_id = poh.location_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count ${fromSql}`, params);
      const dataParams = [...params, paging.limit, paging.offset];
      const rows = await client.query(
        `SELECT
           poh.*,
           s.supplier_code,
           s.supplier_name,
           d.department_code,
           d.department_name,
           l.location_code,
           l.location_name
         ${fromSql}
         ORDER BY ${paging.orderBySql}, poh.po_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );

      return res.json({ rows: rows.rows, data: rows.rows, total_count: Number(count.rows[0]?.total_count || 0), limit: paging.limit, offset: paging.offset });
    } catch (err) {
      console.error('GET /api/inventory/phase2/purchase-orders error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/purchase-orders', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.body?.supplier_id);
    const departmentId = parseNumeric(req.body?.department_id);
    const locationId = req.body?.location_id == null ? null : parseNumeric(req.body?.location_id);
    const lines = ensureArray(req.body?.lines);
    const orderDate = parseDateOrNull(req.body?.order_date) || new Date().toISOString().slice(0, 10);
    const expectedDate = parseDateOrNull(req.body?.expected_date);
    const status = sanitizeStatus(req.body?.status, poStatuses, 'draft');

    if (!userId || !supplierId || !departmentId) return res.status(400).json({ error: 'user_id, supplier_id and department_id are required' });
    if (!status) return res.status(400).json({ error: 'status is invalid' });
    if (lines.length === 0) return res.status(400).json({ error: 'at least one line is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'procurement.po.create', departmentId, ['post', 'approve', 'full']);

      const supplier = await fetchSupplierById(client, supplierId);
      if (!supplier || supplier.is_active !== true) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'supplier_id not found or inactive' });
      }

      const poNumber = sanitizeText(req.body?.po_number) || nextRef('PO');
      const headerInsert = await client.query(
        `INSERT INTO inv_purchase_order_header (
           po_number, supplier_id, department_id, location_id, status,
           order_date, expected_date, currency_code, payment_terms_days,
           notes, created_by, approved_by, created_at, approved_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,NOW())
         RETURNING *`,
        [
          poNumber,
          supplierId,
          departmentId,
          locationId,
          status,
          orderDate,
          expectedDate,
          sanitizeText(req.body?.currency_code)?.toUpperCase() || supplier.currency_code || 'EUR',
          req.body?.payment_terms_days == null ? supplier.payment_terms_days ?? null : parseNumericOrNull(req.body?.payment_terms_days),
          sanitizeText(req.body?.notes),
          userId,
          status === 'approved' ? userId : null,
          status === 'approved' ? new Date().toISOString() : null,
        ]
      );
      const header = headerInsert.rows[0];

      const createdLines = [];
      for (const [idx, line] of lines.entries()) {
        const itemType = sanitizeStatus(line.item_type, itemTypes, 'product');
        const qty = parseNumericOrNull(line.ordered_qty);
        const unitCost = parseNumericOrNull(line.unit_cost);
        if (!qty || qty <= 0) throw new Error(`line ${idx + 1}: ordered_qty must be > 0`);
        if (unitCost !== null && unitCost < 0) throw new Error(`line ${idx + 1}: unit_cost cannot be negative`);
        const productId = line.product_id == null ? null : parseNumeric(line.product_id);

        const lineInsert = await client.query(
          `INSERT INTO inv_purchase_order_line (
             po_id, line_no, product_id, uom_id,
             ordered_qty, received_qty, unit_cost, tax_code_id,
             item_type, asset_template_type, description, expected_date, line_notes
           ) VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            header.po_id,
            idx + 1,
            productId,
            line.uom_id == null ? 1 : parseNumeric(line.uom_id),
            qty,
            unitCost ?? 0,
            line.tax_code_id == null ? null : parseNumeric(line.tax_code_id),
            itemType,
            sanitizeText(line.asset_template_type),
            sanitizeText(line.description),
            parseDateOrNull(line.expected_date),
            sanitizeText(line.line_notes),
          ]
        );
        createdLines.push(lineInsert.rows[0]);
      }

      await client.query('COMMIT');
      return res.status(201).json({ ...header, lines: createdLines });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'po_number already exists' });
      console.error('POST /api/inventory/phase2/purchase-orders error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/inventory/phase2/purchase-orders/:id', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const poId = parseNumeric(req.params.id);
    if (!userId || !poId) return res.status(400).json({ error: 'user_id and po id are required' });
    const status = req.body?.status === undefined ? undefined : sanitizeStatus(req.body?.status, poStatuses, null);
    if (req.body?.status !== undefined && !status) return res.status(400).json({ error: 'status is invalid' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT * FROM inv_purchase_order_header WHERE po_id = $1`, [poId]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Purchase order not found' });
      }
      const po = existing.rows[0];

      await requirePermissionAndScope(client, userId, status === 'approved' ? 'procurement.po.approve' : 'procurement.po.create', po.department_id, ['post', 'approve', 'full']);

      const updated = await client.query(
        `UPDATE inv_purchase_order_header
         SET
           status = COALESCE($1, status),
           expected_date = COALESCE($2, expected_date),
           notes = COALESCE($3, notes),
           approved_by = CASE WHEN $1 = 'approved' THEN $4 ELSE approved_by END,
           approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
           updated_at = NOW()
         WHERE po_id = $5
         RETURNING *`,
        [status === undefined ? null : status, parseDateOrNull(req.body?.expected_date), sanitizeText(req.body?.notes), userId, poId]
      );

      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PATCH /api/inventory/phase2/purchase-orders/:id error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/goods-receipts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const q = sanitizeText(req.query.q) || '';
    const departmentId = parseNumeric(req.query.department_id);
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 50,
      maxLimit: 200,
      defaultSortBy: 'receipt_date',
      defaultSortDir: 'desc',
      sortByMap: {
        receipt_number: 'grh.receipt_number',
        receipt_date: 'grh.receipt_date',
        supplier_name: `COALESCE(s.supplier_name, '')`,
        status: 'grh.status',
      },
    });

    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const client = await pool.connect();
    try {
      const access = await requirePermissionAndScope(client, userId, 'procurement.receipt.post', departmentId, ['view', 'post', 'approve', 'full']);
      const where = [];
      const params = [];

      if (departmentId) {
        params.push(departmentId);
        where.push(`grh.department_id = $${params.length}`);
      }
      if (!access.isAdmin && !departmentId) {
        const scoped = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
        if (scoped.length === 0) {
          return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
        }
        params.push(scoped);
        where.push(`grh.department_id = ANY($${params.length}::bigint[])`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          grh.receipt_number ILIKE $${params.length}
          OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
          OR COALESCE(poh.po_number, '') ILIKE $${params.length}
        )`);
      }

      const fromSql = `
        FROM inv_goods_receipt_header grh
        JOIN inv_supplier s ON s.supplier_id = grh.supplier_id
        JOIN inv_department d ON d.department_id = grh.department_id
        LEFT JOIN inv_location l ON l.location_id = grh.location_id
        LEFT JOIN inv_purchase_order_header poh ON poh.po_id = grh.po_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count ${fromSql}`, params);
      const dataParams = [...params, paging.limit, paging.offset];
      const rows = await client.query(
        `SELECT
           grh.*,
           s.supplier_name,
           d.department_code,
           d.department_name,
           l.location_code,
           l.location_name,
           poh.po_number
         ${fromSql}
         ORDER BY ${paging.orderBySql}, grh.receipt_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );

      return res.json({ rows: rows.rows, data: rows.rows, total_count: Number(count.rows[0]?.total_count || 0), limit: paging.limit, offset: paging.offset });
    } catch (err) {
      console.error('GET /api/inventory/phase2/goods-receipts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/goods-receipts', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const poId = req.body?.po_id == null ? null : parseNumeric(req.body?.po_id);
    const supplierId = parseNumeric(req.body?.supplier_id);
    const departmentId = parseNumeric(req.body?.department_id);
    const locationId = req.body?.location_id == null ? null : parseNumeric(req.body?.location_id);
    const receiptDate = parseDateOrNull(req.body?.receipt_date) || new Date().toISOString().slice(0, 10);
    const status = sanitizeStatus(req.body?.status, receiptStatuses, 'posted');
    const lines = ensureArray(req.body?.lines);

    if (!userId || !supplierId || !departmentId) return res.status(400).json({ error: 'user_id, supplier_id and department_id are required' });
    if (!status) return res.status(400).json({ error: 'status is invalid' });
    if (lines.length === 0) return res.status(400).json({ error: 'at least one line is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'procurement.receipt.post', departmentId, ['post', 'approve', 'full']);

      if (locationId) {
        await assertLocationCanStoreEquipment(client, locationId, departmentId, 'location_id');
        await assertUserLocationScopeWhenConfigured(client, userId, departmentId, locationId, ['post', 'approve', 'full'], 'location_id');
      }

      let po = null;
      if (poId) {
        const poResult = await client.query(`SELECT * FROM inv_purchase_order_header WHERE po_id = $1`, [poId]);
        if (poResult.rows.length === 0) throw new Error('po_id not found');
        po = poResult.rows[0];
        if (po.status === 'cancelled') throw new Error('cannot receive against cancelled PO');
      }

      const receiptNumber = sanitizeText(req.body?.receipt_number) || nextRef('GRN');
      const header = await client.query(
        `INSERT INTO inv_goods_receipt_header (
           receipt_number, po_id, supplier_id, department_id, location_id,
           receipt_date, received_by, status, notes, created_at, posted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),CASE WHEN $8='posted' THEN NOW() ELSE NULL END)
         RETURNING *`,
        [receiptNumber, poId, supplierId, departmentId, locationId, receiptDate, userId, status, sanitizeText(req.body?.notes)]
      );
      const receipt = header.rows[0];

      const createdLines = [];
      for (const [idx, line] of lines.entries()) {
        const itemType = sanitizeStatus(line.item_type, itemTypes, 'product');
        const productId = line.product_id == null ? null : parseNumeric(line.product_id);
        const poLineId = line.po_line_id == null ? null : parseNumeric(line.po_line_id);
        const qtyReceived = parseNumericOrNull(line.qty_received) ?? 0;
        const qtyDamaged = parseNumericOrNull(line.qty_damaged) ?? 0;
        const qtyRejected = parseNumericOrNull(line.qty_rejected) ?? 0;
        const unitCost = parseNumericOrNull(line.unit_cost) ?? 0;

        if (qtyReceived < 0 || qtyDamaged < 0 || qtyRejected < 0) {
          throw new Error(`line ${idx + 1}: quantities cannot be negative`);
        }
        if (unitCost < 0) throw new Error(`line ${idx + 1}: unit_cost cannot be negative`);

        let poLine = null;
        if (poLineId) {
          const poLineRes = await client.query(
            `SELECT * FROM inv_purchase_order_line WHERE po_line_id = $1 AND po_id = $2`,
            [poLineId, poId]
          );
          if (poLineRes.rows.length === 0) throw new Error(`line ${idx + 1}: po_line_id not found for po_id`);
          poLine = poLineRes.rows[0];
          const remaining = Number(poLine.ordered_qty || 0) - Number(poLine.received_qty || 0);
          if (qtyReceived > remaining) {
            throw new Error(`line ${idx + 1}: qty_received exceeds PO remaining qty`);
          }
        }

        const lineInsert = await client.query(
          `INSERT INTO inv_goods_receipt_line (
             receipt_id, po_line_id, product_id, item_type, description,
             qty_received, qty_damaged, qty_rejected, unit_cost, line_notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            receipt.receipt_id,
            poLineId,
            productId,
            itemType,
            sanitizeText(line.description),
            qtyReceived,
            qtyDamaged,
            qtyRejected,
            unitCost,
            sanitizeText(line.line_notes),
          ]
        );
        const receiptLine = lineInsert.rows[0];
        createdLines.push(receiptLine);

        if (poLineId) {
          await client.query(
            `UPDATE inv_purchase_order_line
             SET received_qty = COALESCE(received_qty, 0) + $1
             WHERE po_line_id = $2`,
            [qtyReceived, poLineId]
          );
        }

        if (status === 'posted' && itemType === 'product' && productId && qtyReceived > 0) {
          await client.query(
            `INSERT INTO inv_ledger (
               posting_ts, posting_date, product_id, department_id,
               document_id, document_line_id, document_type_code, movement_reason_code,
               qty_in, qty_out, qty_delta,
               unit_cost, value_in, value_out, value_delta,
               source_department_id, target_department_id,
               external_source, external_reference, posted_by,
               comments, location_id, source_location_id, target_location_id
             ) VALUES (
               NOW(), $1::date, $2, $3,
               $4, $5, 'PO_RECEIPT', 'PURCHASE_RECEIPT_IN',
               $6, 0, $6,
               $7, $8, 0, $8,
               NULL, $3,
               'procurement.phase2', $9, $10,
               $11, $12, NULL, $12
             )`,
            [
              receiptDate,
              productId,
              departmentId,
              receipt.receipt_id,
              receiptLine.receipt_line_id,
              qtyReceived,
              unitCost,
              Number(qtyReceived) * Number(unitCost),
              receipt.receipt_number,
              userId,
              sanitizeText(line.line_notes) || 'phase2 goods receipt posted',
              locationId,
            ]
          );
        }
      }

      if (poId) {
        const poAgg = await client.query(
          `SELECT
             SUM(ordered_qty)::numeric AS ordered_qty,
             SUM(received_qty)::numeric AS received_qty
           FROM inv_purchase_order_line
           WHERE po_id = $1`,
          [poId]
        );
        const ordered = Number(poAgg.rows[0]?.ordered_qty || 0);
        const received = Number(poAgg.rows[0]?.received_qty || 0);
        const nextStatus = received <= 0 ? 'ordered' : (received >= ordered ? 'received' : 'part_received');
        await client.query(
          `UPDATE inv_purchase_order_header
           SET status = $1, updated_at = NOW()
           WHERE po_id = $2 AND status <> 'cancelled'`,
          [nextStatus, poId]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ ...receipt, lines: createdLines });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'receipt_number already exists' });
      console.error('POST /api/inventory/phase2/goods-receipts error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/supplier-invoices', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const q = sanitizeText(req.query.q) || '';
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 50,
      maxLimit: 200,
      defaultSortBy: 'invoice_date',
      defaultSortDir: 'desc',
      sortByMap: {
        invoice_number: 'sih.invoice_number',
        invoice_date: 'sih.invoice_date',
        status: 'sih.status',
        supplier_name: `COALESCE(s.supplier_name, '')`,
      },
    });
    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'procurement.invoice.manage', null, ['view', 'post', 'approve', 'full']);

      const where = [];
      const params = [];
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          sih.invoice_number ILIKE $${params.length}
          OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
        )`);
      }
      const fromSql = `
        FROM inv_supplier_invoice_header sih
        JOIN inv_supplier s ON s.supplier_id = sih.supplier_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count ${fromSql}`, params);
      const dataParams = [...params, paging.limit, paging.offset];
      const rows = await client.query(
        `SELECT sih.*, s.supplier_name, s.supplier_code
         ${fromSql}
         ORDER BY ${paging.orderBySql}, sih.supplier_invoice_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );

      return res.json({ rows: rows.rows, data: rows.rows, total_count: Number(count.rows[0]?.total_count || 0), limit: paging.limit, offset: paging.offset });
    } catch (err) {
      console.error('GET /api/inventory/phase2/supplier-invoices error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/supplier-invoices', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierId = parseNumeric(req.body?.supplier_id);
    const invoiceNumber = sanitizeText(req.body?.invoice_number);
    const invoiceDate = parseDateOrNull(req.body?.invoice_date);
    const status = sanitizeStatus(req.body?.status, invoiceStatuses, 'entered');
    const lines = ensureArray(req.body?.lines);

    if (!userId || !supplierId || !invoiceNumber || !invoiceDate) {
      return res.status(400).json({ error: 'user_id, supplier_id, invoice_number, invoice_date are required' });
    }
    if (!status) return res.status(400).json({ error: 'status is invalid' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'procurement.invoice.manage', null, ['post', 'approve', 'full']);

      const header = await client.query(
        `INSERT INTO inv_supplier_invoice_header (
           supplier_id, invoice_number, invoice_date, currency_code,
           subtotal, tax_total, total_amount, po_id, receipt_id,
           status, entered_by, approved_by, entered_at, approved_at, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,$14)
         RETURNING *`,
        [
          supplierId,
          invoiceNumber,
          invoiceDate,
          sanitizeText(req.body?.currency_code)?.toUpperCase() || 'EUR',
          parseNumericOrNull(req.body?.subtotal) ?? 0,
          parseNumericOrNull(req.body?.tax_total) ?? 0,
          parseNumericOrNull(req.body?.total_amount) ?? 0,
          req.body?.po_id == null ? null : parseNumeric(req.body?.po_id),
          req.body?.receipt_id == null ? null : parseNumeric(req.body?.receipt_id),
          status,
          userId,
          status === 'approved' ? userId : null,
          status === 'approved' ? new Date().toISOString() : null,
          sanitizeText(req.body?.notes),
        ]
      );
      const invoice = header.rows[0];

      const createdLines = [];
      for (const line of lines) {
        const qty = parseNumericOrNull(line.qty) ?? 0;
        const unitCost = parseNumericOrNull(line.unit_cost) ?? 0;
        const taxAmount = parseNumericOrNull(line.tax_amount) ?? 0;
        const lineTotal = parseNumericOrNull(line.line_total) ?? Number(qty) * Number(unitCost) + Number(taxAmount);
        if (qty < 0 || unitCost < 0 || taxAmount < 0 || lineTotal < 0) throw new Error('invoice line amounts cannot be negative');

        const inserted = await client.query(
          `INSERT INTO inv_supplier_invoice_line (
             supplier_invoice_id, po_line_id, receipt_line_id, product_id, description,
             qty, unit_cost, tax_amount, line_total, line_notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            invoice.supplier_invoice_id,
            line.po_line_id == null ? null : parseNumeric(line.po_line_id),
            line.receipt_line_id == null ? null : parseNumeric(line.receipt_line_id),
            line.product_id == null ? null : parseNumeric(line.product_id),
            sanitizeText(line.description),
            qty,
            unitCost,
            taxAmount,
            lineTotal,
            sanitizeText(line.line_notes),
          ]
        );
        createdLines.push(inserted.rows[0]);
      }

      await client.query('COMMIT');
      return res.status(201).json({ ...invoice, lines: createdLines });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'invoice_number already exists for supplier' });
      console.error('POST /api/inventory/phase2/supplier-invoices error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/inventory/phase2/supplier-invoices/:id', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const supplierInvoiceId = parseNumeric(req.params.id);
    const status = req.body?.status === undefined ? undefined : sanitizeStatus(req.body.status, invoiceStatuses, null);

    if (!userId || !supplierInvoiceId) return res.status(400).json({ error: 'user_id and supplier_invoice_id are required' });
    if (req.body?.status !== undefined && !status) return res.status(400).json({ error: 'status is invalid' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePermissionAndScope(client, userId, 'procurement.invoice.manage', null, ['post', 'approve', 'full']);

      const updated = await client.query(
        `UPDATE inv_supplier_invoice_header
         SET
           status = COALESCE($1, status),
           approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END,
           approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
           notes = COALESCE($3, notes)
         WHERE supplier_invoice_id = $4
         RETURNING *`,
        [status === undefined ? null : status, userId, sanitizeText(req.body?.notes), supplierInvoiceId]
      );

      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Supplier invoice not found' });
      }

      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PATCH /api/inventory/phase2/supplier-invoices/:id error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/assets', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const departmentId = parseNumeric(req.query.department_id);
    const locationId = parseNumeric(req.query.location_id);
    const q = sanitizeText(req.query.q) || '';
    const status = sanitizeStatus(req.query.status, assetStatuses, null);
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 50,
      maxLimit: 300,
      defaultSortBy: 'updated_at',
      defaultSortDir: 'desc',
      sortByMap: {
        asset_code: 'e.asset_code',
        asset_name: 'e.asset_name',
        supplier_name: `COALESCE(s.supplier_name, '')`,
        warranty_expiry_date: 'e.warranty_expiry_date',
        status: 'e.status',
        updated_at: 'e.updated_at',
      },
    });

    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    const client = await pool.connect();
    try {
      const access = await requirePermissionAndScope(client, userId, 'asset.view', departmentId, ['view', 'post', 'approve', 'full']);
      const where = [];
      const params = [];

      if (departmentId) {
        params.push(departmentId);
        where.push(`e.department_id = $${params.length}`);
      }
      if (locationId) {
        params.push(locationId);
        where.push(`e.location_id = $${params.length}`);
      }

      if (!access.isAdmin && !departmentId) {
        const scoped = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
        if (scoped.length === 0) {
          return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
        }
        params.push(scoped);
        where.push(`e.department_id = ANY($${params.length}::bigint[])`);
      }

      if (!access.isAdmin) {
        where.push(appendLocationScopeClause(params, {
          userId,
          allowedScopes: ['view', 'post', 'approve', 'full'],
          departmentExpr: 'e.department_id',
          locationExpr: 'e.location_id',
        }));
      }

      if (status) {
        params.push(status);
        where.push(`e.status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(
          e.asset_code ILIKE $${params.length}
          OR e.asset_name ILIKE $${params.length}
          OR COALESCE(e.serial_number, '') ILIKE $${params.length}
          OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
        )`);
      }

      const fromSql = `
        FROM inv_equipment_asset e
        LEFT JOIN inv_supplier s ON s.supplier_id = e.supplier_id
        LEFT JOIN inv_department d ON d.department_id = e.department_id
        LEFT JOIN inv_location l ON l.location_id = e.location_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count ${fromSql}`, params);
      const dataParams = [...params, paging.limit, paging.offset];
      const rows = await client.query(
        `SELECT
           e.*,
           s.supplier_name,
           s.supplier_code,
           d.department_code,
           d.department_name,
           l.location_code,
           l.location_name,
           CASE
             WHEN e.warranty_start_date IS NULL OR e.warranty_expiry_date IS NULL THEN 'unknown'
             WHEN CURRENT_DATE > e.warranty_expiry_date THEN 'expired'
             WHEN e.warranty_expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
             ELSE 'under_warranty'
           END AS warranty_status
         ${fromSql}
         ORDER BY ${paging.orderBySql}, e.equipment_id DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: Number(count.rows[0]?.total_count || 0), limit: paging.limit, offset: paging.offset });
    } catch (err) {
      console.error('GET /api/inventory/phase2/assets error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/inventory/phase2/assets/:id', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const equipmentId = parseNumeric(req.params.id);
    if (!userId || !equipmentId) return res.status(400).json({ error: 'user_id and asset id are required' });

    const warrantyStart = req.body?.warranty_start_date === undefined ? undefined : parseDateOrNull(req.body?.warranty_start_date);
    const warrantyExpiry = req.body?.warranty_expiry_date === undefined ? undefined : parseDateOrNull(req.body?.warranty_expiry_date);
    if (warrantyStart && warrantyExpiry && warrantyExpiry < warrantyStart) {
      return res.status(400).json({ error: 'warranty_expiry_date must be on or after warranty_start_date' });
    }

    const purchaseCost = req.body?.purchase_cost === undefined ? undefined : parseNumericOrNull(req.body?.purchase_cost);
    if (purchaseCost !== undefined && purchaseCost !== null && purchaseCost < 0) {
      return res.status(400).json({ error: 'purchase_cost must be >= 0' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await fetchEquipmentAssetById(client, equipmentId);
      if (!existing) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Asset not found' });
      }

      await requirePermissionAndScope(client, userId, 'asset.edit', Number(existing.department_id || 0) || null, ['post', 'approve', 'full']);

      const updated = await client.query(
        `UPDATE inv_equipment_asset
         SET
           asset_category = COALESCE($1, asset_category),
           manufacturer = COALESCE($2, manufacturer),
           model_number = COALESCE($3, model_number),
           barcode_tag = COALESCE($4, barcode_tag),
           internal_tag = COALESCE($5, internal_tag),
           custodian_employee_id = COALESCE($6, custodian_employee_id),
           supplier_id = COALESCE($7, supplier_id),
           purchase_date = COALESCE($8, purchase_date),
           purchase_cost = COALESCE($9, purchase_cost),
           invoice_reference = COALESCE($10, invoice_reference),
           po_id = COALESCE($11, po_id),
           receipt_id = COALESCE($12, receipt_id),
           supplier_invoice_id = COALESCE($13, supplier_invoice_id),
           warranty_start_date = COALESCE($14, warranty_start_date),
           warranty_expiry_date = COALESCE($15, warranty_expiry_date),
           warranty_terms_notes = COALESCE($16, warranty_terms_notes),
           service_contract_flag = COALESCE($17, service_contract_flag),
           installation_date = COALESCE($18, installation_date),
           commissioned_date = COALESCE($19, commissioned_date),
           last_service_date = COALESCE($20, last_service_date),
           next_service_due_date = COALESCE($21, next_service_due_date),
           maintenance_notes = COALESCE($22, maintenance_notes),
           status = COALESCE($23, status),
           notes = COALESCE($24, notes),
           updated_at = NOW()
         WHERE equipment_id = $25
         RETURNING *`,
        [
          req.body?.asset_category === undefined ? null : sanitizeText(req.body?.asset_category),
          req.body?.manufacturer === undefined ? null : sanitizeText(req.body?.manufacturer),
          req.body?.model_number === undefined ? null : sanitizeText(req.body?.model_number),
          req.body?.barcode_tag === undefined ? null : sanitizeText(req.body?.barcode_tag),
          req.body?.internal_tag === undefined ? null : sanitizeText(req.body?.internal_tag),
          req.body?.custodian_employee_id === undefined ? null : (req.body?.custodian_employee_id === null ? null : parseNumeric(req.body?.custodian_employee_id)),
          req.body?.supplier_id === undefined ? null : (req.body?.supplier_id === null ? null : parseNumeric(req.body?.supplier_id)),
          req.body?.purchase_date === undefined ? null : parseDateOrNull(req.body?.purchase_date),
          purchaseCost === undefined ? null : purchaseCost,
          req.body?.invoice_reference === undefined ? null : sanitizeText(req.body?.invoice_reference),
          req.body?.po_id === undefined ? null : (req.body?.po_id === null ? null : parseNumeric(req.body?.po_id)),
          req.body?.receipt_id === undefined ? null : (req.body?.receipt_id === null ? null : parseNumeric(req.body?.receipt_id)),
          req.body?.supplier_invoice_id === undefined ? null : (req.body?.supplier_invoice_id === null ? null : parseNumeric(req.body?.supplier_invoice_id)),
          warrantyStart === undefined ? null : warrantyStart,
          warrantyExpiry === undefined ? null : warrantyExpiry,
          req.body?.warranty_terms_notes === undefined ? null : sanitizeText(req.body?.warranty_terms_notes),
          req.body?.service_contract_flag === undefined ? null : parseBooleanLike(req.body?.service_contract_flag, false),
          req.body?.installation_date === undefined ? null : parseDateOrNull(req.body?.installation_date),
          req.body?.commissioned_date === undefined ? null : parseDateOrNull(req.body?.commissioned_date),
          req.body?.last_service_date === undefined ? null : parseDateOrNull(req.body?.last_service_date),
          req.body?.next_service_due_date === undefined ? null : parseDateOrNull(req.body?.next_service_due_date),
          req.body?.maintenance_notes === undefined ? null : sanitizeText(req.body?.maintenance_notes),
          req.body?.status === undefined ? null : sanitizeStatus(req.body?.status, assetStatuses, null),
          req.body?.notes === undefined ? null : sanitizeText(req.body?.notes),
          equipmentId,
        ]
      );

      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('PATCH /api/inventory/phase2/assets/:id error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/assets/:id/move', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const equipmentId = parseNumeric(req.params.id);
    const toDepartmentId = parseNumeric(req.body?.to_department_id);
    const toLocationId = parseNumeric(req.body?.to_location_id);

    if (!userId || !equipmentId || !toDepartmentId || !toLocationId) {
      return res.status(400).json({ error: 'user_id, asset id, to_department_id and to_location_id are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await fetchEquipmentAssetById(client, equipmentId);
      if (!existing) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (existing.status === 'disposed') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Disposed assets cannot be moved' });
      }

      await requirePermissionAndScope(client, userId, 'asset.move', toDepartmentId, ['post', 'approve', 'full']);
      await assertLocationCanStoreEquipment(client, toLocationId, toDepartmentId, 'to_location_id');
      await assertUserLocationScopeWhenConfigured(client, userId, toDepartmentId, toLocationId, ['post', 'approve', 'full'], 'to_location_id');

      const history = await client.query(
        `INSERT INTO inv_equipment_location_history (
           equipment_id, from_department_id, from_location_id, to_department_id, to_location_id,
           moved_by, moved_at, reason, movement_reason, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)
         RETURNING *`,
        [
          equipmentId,
          existing.department_id ? Number(existing.department_id) : null,
          existing.location_id ? Number(existing.location_id) : null,
          toDepartmentId,
          toLocationId,
          userId,
          sanitizeText(req.body?.reason) || sanitizeText(req.body?.movement_reason),
          sanitizeText(req.body?.movement_reason),
          sanitizeText(req.body?.notes),
        ]
      );

      await client.query(
        `UPDATE inv_equipment_asset
         SET department_id = $1, location_id = $2, updated_at = NOW()
         WHERE equipment_id = $3`,
        [toDepartmentId, toLocationId, equipmentId]
      );

      const updated = await fetchEquipmentAssetById(client, equipmentId);
      await client.query('COMMIT');
      return res.json({ equipment: updated, movement: history.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/assets/:id/move error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/assets/:id/movements', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const equipmentId = parseNumeric(req.params.id);
    const paging = parseListLimitOffsetAndSort(req, {
      defaultLimit: 100,
      maxLimit: 300,
      defaultSortBy: 'moved_at',
      defaultSortDir: 'desc',
      sortByMap: {
        moved_at: 'h.moved_at',
      },
    });

    if (!userId || !equipmentId) return res.status(400).json({ error: 'user_id and asset id are required' });
    const client = await pool.connect();
    try {
      const asset = await fetchEquipmentAssetById(client, equipmentId);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      await requirePermissionAndScope(client, userId, 'asset.view', Number(asset.department_id || 0) || null, ['view', 'post', 'approve', 'full']);

      const count = await client.query(`SELECT COUNT(*)::bigint AS total_count FROM inv_equipment_location_history WHERE equipment_id = $1`, [equipmentId]);
      const rows = await client.query(
        `SELECT
           h.*,
           COALESCE(fd.department_code, '') AS from_department_code,
           COALESCE(td.department_code, '') AS to_department_code,
           COALESCE(fl.location_code, '') AS from_location_code,
           COALESCE(tl.location_code, '') AS to_location_code,
           COALESCE(u.username, '') AS moved_by_username
         FROM inv_equipment_location_history h
         LEFT JOIN inv_department fd ON fd.department_id = h.from_department_id
         LEFT JOIN inv_department td ON td.department_id = h.to_department_id
         LEFT JOIN inv_location fl ON fl.location_id = h.from_location_id
         LEFT JOIN inv_location tl ON tl.location_id = h.to_location_id
         LEFT JOIN app_user u ON u.user_id = h.moved_by
         WHERE h.equipment_id = $1
         ORDER BY ${paging.orderBySql}, h.history_id DESC
         LIMIT $2 OFFSET $3`,
        [equipmentId, paging.limit, paging.offset]
      );

      return res.json({ rows: rows.rows, data: rows.rows, total_count: Number(count.rows[0]?.total_count || 0), limit: paging.limit, offset: paging.offset });
    } catch (err) {
      console.error('GET /api/inventory/phase2/assets/:id/movements error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/assets/:id/maintenance-events', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    const equipmentId = parseNumeric(req.params.id);
    if (!userId || !equipmentId) return res.status(400).json({ error: 'user_id and asset id are required' });

    const client = await pool.connect();
    try {
      const asset = await fetchEquipmentAssetById(client, equipmentId);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      await requirePermissionAndScope(client, userId, 'asset.view', Number(asset.department_id || 0) || null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(
        `SELECT * FROM inv_asset_maintenance_event
         WHERE equipment_id = $1
         ORDER BY opened_date DESC, maintenance_event_id DESC`,
        [equipmentId]
      );
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/assets/:id/maintenance-events error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/assets/:id/maintenance-events', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const equipmentId = parseNumeric(req.params.id);
    const maintenanceType = sanitizeStatus(req.body?.maintenance_type, maintenanceTypes, null);
    const openedDate = parseDateOrNull(req.body?.opened_date);
    const completedDate = parseDateOrNull(req.body?.completed_date);
    const status = sanitizeStatus(req.body?.status, maintenanceStatuses, 'scheduled');
    const cost = parseNumericOrNull(req.body?.cost) ?? 0;

    if (!userId || !equipmentId || !maintenanceType || !openedDate) {
      return res.status(400).json({ error: 'user_id, asset id, maintenance_type, opened_date are required' });
    }
    if (completedDate && completedDate < openedDate) {
      return res.status(400).json({ error: 'completed_date cannot be before opened_date' });
    }
    if (cost < 0) return res.status(400).json({ error: 'cost must be >= 0' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const asset = await fetchEquipmentAssetById(client, equipmentId);
      if (!asset) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Asset not found' });
      }
      await requirePermissionAndScope(client, userId, 'asset.maintenance.manage', Number(asset.department_id || 0) || null, ['post', 'approve', 'full']);

      const inserted = await client.query(
        `INSERT INTO inv_asset_maintenance_event (
           equipment_id, maintenance_type, opened_date, scheduled_date, completed_date,
           supplier_id, performed_by_text, cost, status, issue_summary, work_done, notes,
           created_by, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
         RETURNING *`,
        [
          equipmentId,
          maintenanceType,
          openedDate,
          parseDateOrNull(req.body?.scheduled_date),
          completedDate,
          req.body?.supplier_id == null ? null : parseNumeric(req.body?.supplier_id),
          sanitizeText(req.body?.performed_by_text),
          cost,
          status,
          sanitizeText(req.body?.issue_summary),
          sanitizeText(req.body?.work_done),
          sanitizeText(req.body?.notes),
          userId,
        ]
      );

      if (status === 'completed' && completedDate) {
        await client.query(
          `UPDATE inv_equipment_asset
           SET
             last_service_date = GREATEST(COALESCE(last_service_date, $1::date), $1::date),
             next_service_due_date = COALESCE($2::date, next_service_due_date),
             updated_at = NOW()
           WHERE equipment_id = $3`,
          [completedDate, parseDateOrNull(req.body?.next_service_due_date), equipmentId]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/assets/:id/maintenance-events error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/assets/:id/disposal', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const equipmentId = parseNumeric(req.params.id);
    const disposalDate = parseDateOrNull(req.body?.disposal_date) || new Date().toISOString().slice(0, 10);
    const disposalReason = sanitizeStatus(req.body?.disposal_reason, disposalReasons, null);

    if (!userId || !equipmentId || !disposalReason) {
      return res.status(400).json({ error: 'user_id, asset id, disposal_reason are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const asset = await fetchEquipmentAssetById(client, equipmentId);
      if (!asset) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Asset not found' });
      }
      await requirePermissionAndScope(client, userId, 'asset.dispose', Number(asset.department_id || 0) || null, ['approve', 'full']);

      const updated = await client.query(
        `UPDATE inv_equipment_asset
         SET
           status = 'disposed',
           is_active = FALSE,
           disposal_date = $1,
           disposal_reason = $2,
           disposal_approved_by = $3,
           disposal_method = COALESCE($4, disposal_method),
           residual_value = COALESCE($5, residual_value),
           notes = CASE WHEN $6::text IS NULL THEN notes
                        WHEN notes IS NULL OR notes = '' THEN $6::text
                        ELSE notes || E'\n' || $6::text END,
           updated_at = NOW()
         WHERE equipment_id = $7
         RETURNING *`,
        [
          disposalDate,
          disposalReason,
          userId,
          sanitizeText(req.body?.disposal_method),
          parseNumericOrNull(req.body?.residual_value),
          sanitizeText(req.body?.notes),
          equipmentId,
        ]
      );

      await client.query('COMMIT');
      return res.json(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/assets/:id/disposal error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/inventory/phase2/assets/:id/incidents', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.body?.user_id);
    const equipmentId = parseNumeric(req.params.id);
    const severity = sanitizeStatus(req.body?.severity, incidentSeverities, null);
    const status = sanitizeStatus(req.body?.status, incidentStatuses, 'open');
    if (!userId || !equipmentId || !severity) {
      return res.status(400).json({ error: 'user_id, asset id, severity are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const asset = await fetchEquipmentAssetById(client, equipmentId);
      if (!asset) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Asset not found' });
      }
      await requirePermissionAndScope(client, userId, 'asset.maintenance.manage', Number(asset.department_id || 0) || null, ['post', 'approve', 'full']);

      const inserted = await client.query(
        `INSERT INTO inv_asset_incident (
           equipment_id, reported_by, reported_at, severity, downtime_start, downtime_end,
           summary, related_maintenance_event_id, resolution_notes, status, created_at, updated_at
         ) VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
         RETURNING *`,
        [
          equipmentId,
          userId,
          severity,
          req.body?.downtime_start ? new Date(req.body.downtime_start).toISOString() : null,
          req.body?.downtime_end ? new Date(req.body.downtime_end).toISOString() : null,
          sanitizeText(req.body?.summary),
          req.body?.related_maintenance_event_id == null ? null : parseNumeric(req.body?.related_maintenance_event_id),
          sanitizeText(req.body?.resolution_notes),
          status,
        ]
      );
      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /api/inventory/phase2/assets/:id/incidents error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/reporting/supplier-overview', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'supplier.view', null, ['view', 'post', 'approve', 'full']);
      const rows = await client.query(`SELECT * FROM vw_inv_supplier_overview ORDER BY supplier_name ASC`);
      return res.json({ rows: rows.rows, data: rows.rows, total_count: rows.rows.length });
    } catch (err) {
      console.error('GET /api/inventory/phase2/reporting/supplier-overview error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/reporting/procurement-overview', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'procurement.po.create', null, ['view', 'post', 'approve', 'full']);
      const row = await client.query(`SELECT * FROM vw_inv_procurement_overview`);
      const spend = await client.query(`SELECT * FROM vw_inv_procurement_spend_by_supplier ORDER BY total_amount DESC NULLS LAST`);
      return res.json({ overview: row.rows[0] || null, spend_by_supplier: spend.rows });
    } catch (err) {
      console.error('GET /api/inventory/phase2/reporting/procurement-overview error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/inventory/phase2/reporting/asset-overview', apiLimiter, async (req, res) => {
    const userId = parseNumeric(req.query.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const client = await pool.connect();
    try {
      await requirePermissionAndScope(client, userId, 'asset.view', null, ['view', 'post', 'approve', 'full']);
      const assets = await client.query(`SELECT * FROM vw_inv_asset_overview ORDER BY asset_name ASC`);
      const alerts = await client.query(`SELECT * FROM vw_inv_asset_warranty_alerts ORDER BY warranty_expiry_date ASC NULLS LAST`);
      const maintenance = await client.query(`SELECT * FROM vw_inv_asset_maintenance_cost ORDER BY total_maintenance_cost DESC NULLS LAST`);
      return res.json({ assets: assets.rows, warranty_alerts: alerts.rows, maintenance_cost: maintenance.rows });
    } catch (err) {
      console.error('GET /api/inventory/phase2/reporting/asset-overview error:', err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
}

module.exports = {
  registerInventoryPhase2Routes,
};
