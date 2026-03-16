'use strict';

require('dotenv').config();

const express    = require('express');
const { Pool }   = require('pg');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const { registerInventoryPhase2Routes } = require('./routes/inventoryPhase2');

const app = express();
const PORT = process.env.PORT || 3000;
const inventoryDistDir = path.join(__dirname, 'inventory-ui', 'dist');

// ─── Database pool ────────────────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// ─── Basic Auth middleware ─────────────────────────────────────────────────────
function basicAuth(req, res, next) {
  // Skip auth for static assets
  if (req.path.startsWith('/css') || req.path.startsWith('/js')) {
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="HR Dashboard"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return res.status(400).json({ error: 'Invalid Authorization header' });
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    return res.status(400).json({ error: 'Invalid credentials format' });
  }

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPass = process.env.DASHBOARD_PASSWORD;
  if (!expectedUser || !expectedPass) {
    res.set('WWW-Authenticate', 'Basic realm="HR Dashboard"');
    return res.status(503).json({ error: 'Server not configured: credentials missing' });
  }

  if (username !== expectedUser || password !== expectedPass) {
    res.set('WWW-Authenticate', 'Basic realm="HR Dashboard"');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.authUsername = username;

  next();
}

function parseNumeric(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNumericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseNonNegativeInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const INVENTORY_LOCATION_TYPES = new Set([
  'store',
  'cupboard',
  'clinic',
  'office',
  'apartment',
  'cabinet',
  'warehouse',
  'room',
  'temporary',
  'external',
]);

const INVENTORY_LOCATION_AVAILABILITY = new Set([
  'active',
  'inactive',
  'rented_out',
  'under_maintenance',
  'unavailable',
  'archived',
]);

const EQUIPMENT_ASSET_STATUSES = new Set([
  'active',
  'inactive',
  'maintenance',
  'retired',
]);

const INVENTORY_PRODUCT_TYPES = new Set([
  'stock_item',
  'consumable',
  'service',
  'non_stock',
  'bundle',
]);

function parseListLimitOffsetAndSort(req, options) {
  const {
    defaultLimit = 50,
    maxLimit = 200,
    defaultSortBy,
    defaultSortDir = 'asc',
    sortByMap,
  } = options;

  const limitRaw = parseNonNegativeInteger(req.query.limit, defaultLimit);
  const offset = parseNonNegativeInteger(req.query.offset, 0);
  const limit = Math.max(1, Math.min(maxLimit, limitRaw || defaultLimit));

  const sortByKeyRaw = typeof req.query.sort_by === 'string' ? req.query.sort_by.trim() : '';
  const sortDirRaw = typeof req.query.sort_dir === 'string' ? req.query.sort_dir.trim().toLowerCase() : '';
  const safeSortByKey = sortByMap[sortByKeyRaw] ? sortByKeyRaw : defaultSortBy;
  const safeSortDir = sortDirRaw === 'desc' ? 'DESC' : (defaultSortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC');
  const safeSortExpression = sortByMap[safeSortByKey] || sortByMap[defaultSortBy];

  return {
    limit,
    offset,
    sortBy: safeSortByKey,
    sortDir: safeSortDir.toLowerCase(),
    orderBySql: `${safeSortExpression} ${safeSortDir}`,
  };
}

async function fetchUserById(client, userId) {
  const result = await client.query(
    `SELECT user_id, username, is_active
       FROM app_user
      WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function hasPermission(client, userId, permissionCode) {
  const result = await client.query(
    `SELECT 1
       FROM app_user_role ur
       JOIN app_role_permission rp ON rp.role_id = ur.role_id
       JOIN app_permission p ON p.permission_id = rp.permission_id
      WHERE ur.user_id = $1
        AND p.permission_code = $2
      LIMIT 1`,
    [userId, permissionCode]
  );
  return result.rows.length > 0;
}

async function hasDepartmentScope(client, userId, departmentId, allowedScopes) {
  const result = await client.query(
    `SELECT 1
       FROM app_user_department_scope s
      WHERE s.user_id = $1
        AND s.department_id = $2
        AND s.scope_level = ANY($3::text[])
      LIMIT 1`,
    [userId, departmentId, allowedScopes]
  );
  return result.rows.length > 0;
}

async function listScopedDepartmentIds(client, userId, allowedScopes) {
  const result = await client.query(
    `SELECT DISTINCT department_id
       FROM app_user_department_scope
      WHERE user_id = $1
        AND scope_level = ANY($2::text[])
      ORDER BY department_id`,
    [userId, allowedScopes]
  );
  return result.rows.map((row) => Number(row.department_id)).filter((id) => Number.isFinite(id) && id > 0);
}

function appendLocationScopeClause(params, options) {
  const {
    userId,
    allowedScopes,
    departmentExpr,
    locationExpr,
  } = options;

  params.push(userId);
  const userParam = params.length;
  params.push(allowedScopes);
  const scopeParam = params.length;

  return `(
    NOT EXISTS (
      SELECT 1
      FROM app_user_location_scope ls_cfg
      JOIN inv_location loc_cfg ON loc_cfg.location_id = ls_cfg.location_id
      WHERE ls_cfg.user_id = $${userParam}
        AND ls_cfg.scope_level = ANY($${scopeParam}::text[])
        AND loc_cfg.department_id = ${departmentExpr}
    )
    OR ${locationExpr} IS NULL
    OR EXISTS (
      SELECT 1
      FROM app_user_location_scope ls_ok
      WHERE ls_ok.user_id = $${userParam}
        AND ls_ok.scope_level = ANY($${scopeParam}::text[])
        AND ls_ok.location_id = ${locationExpr}
    )
  )`;
}

async function userHasConfiguredLocationScopeForDepartment(client, userId, departmentId, allowedScopes) {
  const result = await client.query(
    `SELECT 1
     FROM app_user_location_scope ls
     JOIN inv_location l ON l.location_id = ls.location_id
     WHERE ls.user_id = $1
       AND l.department_id = $2
       AND ls.scope_level = ANY($3::text[])
     LIMIT 1`,
    [userId, departmentId, allowedScopes]
  );
  return result.rows.length > 0;
}

async function userHasLocationScopeForLocation(client, userId, locationId, allowedScopes) {
  const result = await client.query(
    `SELECT 1
     FROM app_user_location_scope
     WHERE user_id = $1
       AND location_id = $2
       AND scope_level = ANY($3::text[])
     LIMIT 1`,
    [userId, locationId, allowedScopes]
  );
  return result.rows.length > 0;
}

async function assertUserLocationScopeWhenConfigured(client, userId, departmentId, locationId, allowedScopes, label) {
  if (!locationId || !departmentId) return;
  const hasConfig = await userHasConfiguredLocationScopeForDepartment(client, userId, departmentId, allowedScopes);
  if (!hasConfig) return;
  const allowed = await userHasLocationScopeForLocation(client, userId, locationId, allowedScopes);
  if (allowed) return;
  throw createHttpError(403, `${label} is not within user location scope`);
}

async function requirePermissionAndScope(client, userId, permissionCode, departmentId, allowedScopes) {
  const isAdmin = await hasPermission(client, userId, 'admin.global');
  if (isAdmin) {
    return { isAdmin: true };
  }

  const permitted = await hasPermission(client, userId, permissionCode);
  if (!permitted) {
    const err = new Error(`Permission required: ${permissionCode}`);
    err.statusCode = 403;
    throw err;
  }

  if (departmentId) {
    const scoped = await hasDepartmentScope(client, userId, departmentId, allowedScopes);
    if (!scoped) {
      const err = new Error('Department scope not allowed');
      err.statusCode = 403;
      throw err;
    }
  }

  return { isAdmin: false };
}

async function fetchLocationById(client, locationId) {
  const result = await client.query(
    `SELECT
       location_id,
       location_code,
       location_name,
       department_id,
       parent_location_id,
       location_type,
       can_hold_stock,
       can_receive_stock,
       can_issue_stock,
       can_store_equipment,
       is_active,
       availability_status,
       effective_from,
       effective_to,
       notes,
       created_at,
       updated_at
     FROM inv_location
     WHERE location_id = $1`,
    [locationId]
  );
  return result.rows[0] || null;
}

async function fetchEquipmentAssetById(client, equipmentId) {
  const result = await client.query(
    `SELECT
       e.equipment_id,
       e.asset_code,
       e.asset_name,
       e.asset_type,
       e.serial_number,
       e.supplier_id,
       s.supplier_code,
       s.supplier_name,
       e.purchase_date,
       e.purchase_cost,
       e.warranty_start_date,
       e.warranty_expiry_date,
      e.warranty_expiry_date AS warranty_end_date,
       e.invoice_reference,
       e.is_active,
       e.department_id,
       d.department_code,
       d.department_name,
       e.location_id,
       l.location_code,
       l.location_name,
       e.status,
       e.notes,
       e.created_at,
       e.updated_at
     FROM inv_equipment_asset e
     LEFT JOIN inv_supplier s ON s.supplier_id = e.supplier_id
     LEFT JOIN inv_department d ON d.department_id = e.department_id
     LEFT JOIN inv_location l ON l.location_id = e.location_id
     WHERE e.equipment_id = $1`,
    [equipmentId]
  );
  return result.rows[0] || null;
}

async function assertLocationCanStoreEquipment(client, locationId, departmentId, locationLabel) {
  if (!locationId) return;
  const location = await fetchLocationById(client, locationId);
  if (!location) {
    throw createHttpError(400, `${locationLabel} not found`);
  }
  if (departmentId && Number(location.department_id) !== Number(departmentId)) {
    throw createHttpError(400, `${locationLabel} must belong to department ${departmentId}`);
  }
  if (location.is_active !== true || location.availability_status !== 'active') {
    throw createHttpError(400, `${locationLabel} must be active and available`);
  }
  if (location.can_store_equipment !== true) {
    throw createHttpError(400, `${locationLabel} is not configured for equipment storage`);
  }
}

async function fetchSupplierById(client, supplierId) {
  const result = await client.query(
    `SELECT
       supplier_id,
       supplier_code,
       supplier_name,
       contact_name,
       phone,
       email,
       lead_time_days,
       minimum_order_value,
       currency_code,
       notes,
       is_active,
       created_at,
       updated_at
     FROM inv_supplier
     WHERE supplier_id = $1`,
    [supplierId]
  );
  return result.rows[0] || null;
}

async function assertLocationCanReceiveStock(client, locationId, departmentId, locationLabel) {
  if (!locationId) return;
  const location = await fetchLocationById(client, locationId);
  if (!location) {
    throw createHttpError(400, `${locationLabel} not found`);
  }
  if (departmentId && Number(location.department_id) !== Number(departmentId)) {
    throw createHttpError(400, `${locationLabel} must belong to department ${departmentId}`);
  }
  if (location.is_active !== true || location.availability_status !== 'active') {
    throw createHttpError(400, `Cannot newly receive stock into inactive or unavailable ${locationLabel.toLowerCase()}`);
  }
  if (location.can_receive_stock !== true) {
    throw createHttpError(400, `Cannot newly receive stock into non-receiving ${locationLabel.toLowerCase()}`);
  }
}

async function validateLocationDepartmentAndParent(client, departmentId, parentLocationId, currentLocationId = null) {
  const departmentResult = await client.query(
    `SELECT department_id FROM inv_department WHERE department_id = $1`,
    [departmentId]
  );
  if (departmentResult.rows.length === 0) {
    throw createHttpError(400, 'department_id does not exist');
  }

  if (!parentLocationId) return;

  if (currentLocationId && Number(parentLocationId) === Number(currentLocationId)) {
    throw createHttpError(400, 'parent_location_id cannot reference itself');
  }

  const parent = await fetchLocationById(client, parentLocationId);
  if (!parent) {
    throw createHttpError(400, 'parent_location_id not found');
  }
  if (Number(parent.department_id) !== Number(departmentId)) {
    throw createHttpError(400, 'parent_location_id must belong to the same department');
  }
}

async function validateLocationCodeUniqueness(client, locationCode, excludeLocationId = null) {
  const params = [String(locationCode).trim().toLowerCase()];
  let sql = `SELECT location_id FROM inv_location WHERE LOWER(location_code) = $1`;
  if (excludeLocationId) {
    params.push(excludeLocationId);
    sql += ` AND location_id <> $2`;
  }
  sql += ' LIMIT 1';
  const dupe = await client.query(sql, params);
  if (dupe.rows.length > 0) {
    throw createHttpError(409, 'location_code already exists');
  }
}

function transferSummaryQuery() {
  return `
    SELECT
      h.transfer_id,
      h.transfer_number,
      h.transfer_status,
      h.created_at,
      h.dispatched_at,
      h.received_at,
      h.cancelled_at,
      h.expected_arrival_date,
      h.source_department_id,
      src.department_code AS source_department_code,
      src.department_name AS source_department_name,
      h.source_location_id,
      src_loc.location_code AS source_location_code,
      src_loc.location_name AS source_location_name,
      h.target_department_id,
      tgt.department_code AS target_department_code,
      tgt.department_name AS target_department_name,
      h.target_location_id,
      tgt_loc.location_code AS target_location_code,
      tgt_loc.location_name AS target_location_name,
      h.notes_sender,
      h.notes_receiver,
      h.courier,
      h.transport_method,
      h.tracking_number,
      h.dispatch_reference,
      h.cancelled_by,
      CASE
        WHEN h.transfer_status = 'draft' THEN TRUE
        ELSE FALSE
      END AS is_pending_dispatch,
      CASE
        WHEN h.transfer_status IN ('dispatched', 'partially_received') THEN TRUE
        ELSE FALSE
      END AS is_awaiting_receipt,
      CASE
        WHEN h.transfer_status IN ('dispatched', 'partially_received')
         AND h.expected_arrival_date IS NOT NULL
         AND h.expected_arrival_date < CURRENT_DATE
          THEN TRUE
        ELSE FALSE
      END AS is_overdue,
      CASE
        WHEN h.transfer_status IN ('dispatched', 'partially_received')
         AND h.expected_arrival_date IS NOT NULL
         AND h.expected_arrival_date < CURRENT_DATE
          THEN CONCAT('Overdue by ', (CURRENT_DATE - h.expected_arrival_date)::text, ' day(s)')
        WHEN h.transfer_status IN ('dispatched', 'partially_received')
          THEN 'Awaiting receipt'
        ELSE NULL
      END AS pending_receipt_alert,
      COUNT(l.transfer_line_id) AS line_count,
      COALESCE(SUM(l.dispatched_qty), 0) AS dispatched_qty_total,
      COALESCE(SUM(l.received_qty), 0) AS received_qty_total,
      COALESCE(SUM(l.remaining_qty), 0) AS remaining_qty_total
    FROM inv_transfer_header h
    JOIN inv_department src ON src.department_id = h.source_department_id
    JOIN inv_department tgt ON tgt.department_id = h.target_department_id
    LEFT JOIN inv_location src_loc ON src_loc.location_id = h.source_location_id
    LEFT JOIN inv_location tgt_loc ON tgt_loc.location_id = h.target_location_id
    LEFT JOIN inv_transfer_line l ON l.transfer_id = h.transfer_id
  `;
}

// ─── Rate limiters ─────────────────────────────────────────────────────────────
// HTML views: 120 requests per minute per IP
const viewLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
// API endpoints: 200 requests per minute per IP
const apiLimiter  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(basicAuth);
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/preview', express.static(path.join(__dirname, 'preview')));
app.use('/inventory', express.static(inventoryDistDir, { index: false }));
app.use('/assets', express.static(path.join(inventoryDistDir, 'assets')));

// ─── HTML views ───────────────────────────────────────────────────────────────
app.get('/', viewLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/views/employee-detail.html', viewLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'employee-detail.html'));
});

// Inventory UI (React/TS build) served under /inventory/*
app.get(['/inventory', '/inventory/*'], viewLimiter, (_req, res) => {
  res.sendFile(path.join(inventoryDistDir, 'index.html'));
});

// ─── GET /api/employees ───────────────────────────────────────────────────────
app.get('/api/employees', apiLimiter, async (req, res) => {
  try {
    // Extract filter query params explicitly to avoid CodeQL sensitive-GET false positives
    const qp             = req.query;
    const employmentFilter  = typeof qp.status  === 'string' ? qp.status  : undefined;
    const typeFilter        = typeof qp.type    === 'string' ? qp.type    : undefined;
    const natFilter         = typeof qp.nat_cat === 'string' ? qp.nat_cat : undefined;
    const tab               = typeof qp.tab     === 'string' ? qp.tab     : undefined;
    const page              = typeof qp.page    === 'string' ? qp.page    : '1';
    const limit             = typeof qp.limit   === 'string' ? qp.limit   : '20';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    // Tab shortcuts
    if (tab === 'dentists') {
      conditions.push(`position_type = 'DENTIST'`);
    } else if (tab === 'ft') {
      conditions.push(`employment_type = 'FT'`);
      conditions.push(`employment_status = 'CURRENT'`);
    } else if (tab === 'current' || (!tab && !employmentFilter)) {
      conditions.push(`employment_status = 'CURRENT'`);
    }

    // Explicit filter overrides
    if (employmentFilter && tab !== 'current' && tab !== 'ft') {
      params.push(employmentFilter.toUpperCase());
      conditions.push(`employment_status = $${params.length}`);
    }

    if (typeFilter) {
      params.push(typeFilter.toUpperCase());
      conditions.push(`employment_type = $${params.length}`);
    }

    if (natFilter) {
      params.push(natFilter.toUpperCase());
      conditions.push(`nationality_group = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query (reuse same params)
    const countSql = `SELECT COUNT(*) AS total FROM vw_hr_employee_dashboard ${where}`;
    const countResult = await pool.query(countSql, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Data query with pagination params appended
    params.push(limitNum);
    params.push(offset);
    const dataSql = `
      SELECT *
      FROM vw_hr_employee_dashboard
      ${where}
      ORDER BY surname, first_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await pool.query(dataSql, params);

    res.json({
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('GET /api/employees error:', err.message);
    res.status(500).json({ error: 'Failed to fetch employees', detail: err.message });
  }
});

// ─── GET /api/employees/:id ───────────────────────────────────────────────────
app.get('/api/employees/:id', apiLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate: employee IDs are numeric
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }

    const sql = `
      SELECT
        e.*,
        ec.employment_status,
        ec.employment_type,
        ec.date_of_termination,
        ec.date_of_first_employment,
        ec.designation,
        ec.contracted_hours,
        ec.fs4_status,
        epp.iban,
        epp.social_security_no,
        epp.spouse_id_card,
        epp.tax_id,
        epp.email
      FROM employees e
      LEFT JOIN employee_current ec ON ec.employee_id = e.id
      LEFT JOIN employee_pay_private epp ON epp.employee_id = e.id
      WHERE e.id = $1
    `;

    const result = await pool.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/employees/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch employee', detail: err.message });
  }
});

// ─── Employee form inventory permission wiring ───────────────────────────────
app.get('/api/employees/:id/inventory-access', apiLimiter, async (req, res) => {
  const employeeId = parseNumeric(req.params.id);
  if (!employeeId) {
    return res.status(400).json({ error: 'Invalid employee ID' });
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      `SELECT user_id, employee_id
       FROM app_user
       WHERE employee_id = $1
       LIMIT 1`,
      [employeeId]
    );

    const appUserId = Number(userResult.rows[0]?.user_id || 0) || null;

    const [accessResult, departmentResult, locationResult, departmentsLookup, locationsLookup] = await Promise.all([
      client.query(
        `SELECT
           inventory_access_enabled,
           sell_access_enabled,
           can_approve_sensitive,
           can_override_department_scope,
           effective_from,
           inactive_from,
           updated_at
         FROM eos_employee_inventory_access
         WHERE employee_id = $1`,
        [employeeId]
      ),
      client.query(
        `SELECT department_id, scope_level
         FROM eos_employee_department_scope
         WHERE employee_id = $1`,
        [employeeId]
      ),
      appUserId
        ? client.query(
          `SELECT l.location_id, l.department_id, ls.scope_level
           FROM app_user_location_scope ls
           JOIN inv_location l ON l.location_id = ls.location_id
           WHERE ls.user_id = $1`,
          [appUserId]
        )
        : Promise.resolve({ rows: [] }),
      client.query(
        `SELECT department_id, department_code, department_name, is_active
         FROM inv_department
         WHERE is_active = TRUE
         ORDER BY department_name, department_code`
      ),
      client.query(
        `SELECT location_id, department_id, location_code, location_name, is_active, availability_status
         FROM inv_location
         ORDER BY department_id, location_name, location_code`
      ),
    ]);

    const access = accessResult.rows[0] || {
      inventory_access_enabled: false,
      sell_access_enabled: false,
      can_approve_sensitive: false,
      can_override_department_scope: false,
      effective_from: null,
      inactive_from: null,
      updated_at: null,
    };

    const scopeMap = new Map();
    departmentResult.rows.forEach((row) => {
      scopeMap.set(Number(row.department_id), row.scope_level);
    });

    const locationByDepartment = new Map();
    locationResult.rows.forEach((row) => {
      const deptId = Number(row.department_id);
      const current = locationByDepartment.get(deptId) || [];
      current.push(Number(row.location_id));
      locationByDepartment.set(deptId, current);
    });

    const departmentScopes = departmentsLookup.rows.map((department) => {
      const deptId = Number(department.department_id);
      const selectedLocations = locationByDepartment.get(deptId) || [];
      return {
        department_id: deptId,
        department_code: department.department_code,
        department_name: department.department_name,
        scope_level: scopeMap.get(deptId) || 'none',
        location_mode: selectedLocations.length > 0 ? 'selected' : 'all',
        selected_location_ids: selectedLocations,
      };
    });

    return res.json({
      employee_id: employeeId,
      app_user_id: appUserId,
      access,
      department_scopes: departmentScopes,
      departments: departmentsLookup.rows,
      locations: locationsLookup.rows,
    });
  } catch (err) {
    console.error('GET /api/employees/:id/inventory-access error:', err.message);
    return res.status(500).json({
      error: 'Failed to load inventory access wiring',
      detail: err.message,
    });
  } finally {
    client.release();
  }
});

app.put('/api/employees/:id/inventory-access', apiLimiter, async (req, res) => {
  const employeeId = parseNumeric(req.params.id);
  const updatedByUserId = parseNumeric(req.body?.updated_by_user_id) || null;
  if (!employeeId) {
    return res.status(400).json({ error: 'Invalid employee ID' });
  }

  const allowedScopeLevels = new Set(['view', 'post', 'approve', 'full', 'none']);
  const access = req.body?.access && typeof req.body.access === 'object' ? req.body.access : {};
  const departmentScopes = Array.isArray(req.body?.department_scopes) ? req.body.department_scopes : [];

  const inventoryAccessEnabled = access.inventory_access_enabled === true;
  const sellAccessEnabled = access.sell_access_enabled === true;
  const canApproveSensitive = access.can_approve_sensitive === true;
  const canOverrideDepartmentScope = access.can_override_department_scope === true;
  const effectiveFrom = parseDateOrNull(access.effective_from) || new Date().toISOString().slice(0, 10);
  const inactiveFrom = parseDateOrNull(access.inactive_from);

  if (inactiveFrom && effectiveFrom && inactiveFrom < effectiveFrom) {
    return res.status(400).json({ error: 'inactive_from cannot be before effective_from' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT user_id
       FROM app_user
       WHERE employee_id = $1
       LIMIT 1`,
      [employeeId]
    );
    const appUserId = Number(userResult.rows[0]?.user_id || 0) || null;

    await client.query(
      `INSERT INTO eos_employee_inventory_access (
         employee_id,
         inventory_access_enabled,
         sell_access_enabled,
         can_approve_sensitive,
         can_override_department_scope,
         effective_from,
         inactive_from,
         updated_by,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,NOW())
       ON CONFLICT (employee_id)
       DO UPDATE SET
         inventory_access_enabled = EXCLUDED.inventory_access_enabled,
         sell_access_enabled = EXCLUDED.sell_access_enabled,
         can_approve_sensitive = EXCLUDED.can_approve_sensitive,
         can_override_department_scope = EXCLUDED.can_override_department_scope,
         effective_from = EXCLUDED.effective_from,
         inactive_from = EXCLUDED.inactive_from,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        employeeId,
        inventoryAccessEnabled,
        sellAccessEnabled,
        canApproveSensitive,
        canOverrideDepartmentScope,
        effectiveFrom,
        inactiveFrom,
        updatedByUserId,
      ]
    );

    const parsedScopes = [];
    for (const row of departmentScopes) {
      const departmentId = parseNumeric(row?.department_id);
      const scopeLevelRaw = typeof row?.scope_level === 'string' ? row.scope_level.trim().toLowerCase() : 'none';
      const locationMode = typeof row?.location_mode === 'string' ? row.location_mode.trim().toLowerCase() : 'all';
      const selectedLocationIds = Array.isArray(row?.selected_location_ids)
        ? row.selected_location_ids.map((id) => parseNumeric(id)).filter(Boolean)
        : [];

      if (!departmentId) continue;
      if (!allowedScopeLevels.has(scopeLevelRaw)) {
        throw createHttpError(400, `Invalid scope_level for department ${departmentId}`);
      }
      if (!['all', 'selected'].includes(locationMode)) {
        throw createHttpError(400, `Invalid location_mode for department ${departmentId}`);
      }

      parsedScopes.push({
        departmentId,
        scopeLevel: scopeLevelRaw,
        locationMode,
        selectedLocationIds,
      });
    }

    await client.query(`DELETE FROM eos_employee_department_scope WHERE employee_id = $1`, [employeeId]);
    if (appUserId) {
      await client.query(`DELETE FROM app_user_department_scope WHERE user_id = $1`, [appUserId]);
    }

    const activeDepartmentScopes = parsedScopes.filter((row) => row.scopeLevel !== 'none');

    for (const scope of activeDepartmentScopes) {
      await client.query(
        `INSERT INTO eos_employee_department_scope (employee_id, department_id, scope_level, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,NOW())`,
        [employeeId, scope.departmentId, scope.scopeLevel, updatedByUserId]
      );

      if (appUserId) {
        await client.query(
          `INSERT INTO app_user_department_scope (user_id, department_id, scope_level)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_id, department_id)
           DO UPDATE SET scope_level = EXCLUDED.scope_level`,
          [appUserId, scope.departmentId, scope.scopeLevel]
        );
      }
    }

    if (appUserId) {
      for (const scope of parsedScopes) {
        await client.query(
          `DELETE FROM app_user_location_scope ls
           USING inv_location l
           WHERE ls.user_id = $1
             AND ls.location_id = l.location_id
             AND l.department_id = $2`,
          [appUserId, scope.departmentId]
        );

        if (scope.scopeLevel === 'none' || scope.locationMode !== 'selected') {
          continue;
        }

        if (scope.selectedLocationIds.length === 0) {
          throw createHttpError(400, `Selected location mode requires at least one location in department ${scope.departmentId}`);
        }

        const validateResult = await client.query(
          `SELECT location_id
           FROM inv_location
           WHERE department_id = $1
             AND location_id = ANY($2::bigint[])`,
          [scope.departmentId, scope.selectedLocationIds]
        );
        const validLocationIds = validateResult.rows.map((row) => Number(row.location_id));
        if (validLocationIds.length !== scope.selectedLocationIds.length) {
          throw createHttpError(400, `One or more selected locations are invalid for department ${scope.departmentId}`);
        }

        for (const locationId of validLocationIds) {
          await client.query(
            `INSERT INTO app_user_location_scope (user_id, location_id, scope_level)
             VALUES ($1,$2,$3)
             ON CONFLICT (user_id, location_id)
             DO UPDATE SET scope_level = EXCLUDED.scope_level`,
            [appUserId, locationId, scope.scopeLevel]
          );
        }
      }
    }

    await client.query('COMMIT');
    return res.json({ ok: true, employee_id: employeeId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/employees/:id/inventory-access error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── GET /api/filter-options ──────────────────────────────────────────────────
app.get('/api/filter-options', apiLimiter, async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vw_dashboard_filter_options ORDER BY label');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/filter-options error:', err.message);
    res.status(500).json({ error: 'Failed to fetch filter options', detail: err.message });
  }
});

// ─── POST /api/print-audit ────────────────────────────────────────────────────
app.post('/api/print-audit', apiLimiter, async (req, res) => {
  try {
    const {
      employee_id = null,
      print_type = 'EMPLOYEE_LIST',
      printed_by = 'dashboard',
      notes = null,
    } = req.body;

    // Validate print_type to a known set
    const allowed = ['EMPLOYEE_LIST', 'EMPLOYEE_DETAIL', 'PAYROLL', 'CONTRACT'];
    const safeType = allowed.includes(print_type) ? print_type : 'EMPLOYEE_LIST';

    await pool.query('SELECT log_print_activity($1, $2, $3, $4)', [
      employee_id,
      safeType,
      printed_by,
      notes,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/print-audit error:', err.message);
    // Non-fatal — audit failure should not block user action
    res.status(500).json({ error: 'Failed to log print activity', detail: err.message });
  }
});

app.get('/api/inventory/stock/by-department', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 500,
    defaultSortBy: 'department_name',
    defaultSortDir: 'asc',
    sortByMap: {
      department_code: 'd.department_code',
      department_name: 'd.department_name',
      sku: 'p.sku',
      product_name: 'p.product_name',
      on_hand_qty: 'on_hand_qty',
      stock_value: 'stock_value',
    },
  });
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const where = [];
    const params = [];

    if (departmentId) {
      params.push(departmentId);
      where.push(`l.department_id = $${params.length}`);
    }

    if (!access.isAdmin && !departmentId) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`l.department_id = ANY($${params.length}::bigint[])`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        p.sku ILIKE $${params.length}
        OR p.product_name ILIKE $${params.length}
        OR d.department_code ILIKE $${params.length}
        OR d.department_name ILIKE $${params.length}
      )`);
    }

    if (!access.isAdmin) {
      where.push(appendLocationScopeClause(params, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 'l.department_id',
        locationExpr: 'l.location_id',
      }));
    }

    const fromSql = `
      SELECT
        l.department_id,
        d.department_code,
        d.department_name,
        l.product_id,
        p.sku,
        p.product_name,
        SUM(l.qty_delta) AS on_hand_qty,
        SUM(l.value_delta) AS stock_value
      FROM inv_ledger l
      JOIN inv_department d ON d.department_id = l.department_id
      JOIN inv_product p ON p.product_id = l.product_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY l.department_id, d.department_code, d.department_name, l.product_id, p.sku, p.product_name`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count FROM (${fromSql}) base`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const sql = `
      ${fromSql}
      ORDER BY ${paging.orderBySql}, p.product_name ASC, p.sku ASC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}`;

    const result = await client.query(sql, dataParams);
    const totalCount = Number(countResult.rows[0]?.total_count || 0);
    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: totalCount,
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/stock/by-department error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/stock/by-location', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const locationId = parseNumeric(req.query.location_id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const includeInactive = parseBooleanLike(req.query.include_inactive, false);
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 500,
    defaultSortBy: 'department_name',
    defaultSortDir: 'asc',
    sortByMap: {
      department_code: 's.department_code',
      department_name: 's.department_name',
      location_code: 's.location_code',
      location_name: 's.location_name',
      sku: 's.sku',
      product_name: 's.product_name',
      on_hand_qty: 's.on_hand_qty',
      stock_value: 's.stock_value',
    },
  });
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const where = [];
    const params = [];

    if (departmentId) {
      params.push(departmentId);
      where.push(`s.department_id = $${params.length}`);
    }

    if (locationId) {
      params.push(locationId);
      where.push(`s.location_id = $${params.length}`);
    }

    if (!access.isAdmin && !departmentId) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`s.department_id = ANY($${params.length}::bigint[])`);
    }

    if (!access.isAdmin) {
      where.push(appendLocationScopeClause(params, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 's.department_id',
        locationExpr: 's.location_id',
      }));
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        s.sku ILIKE $${params.length}
        OR s.product_name ILIKE $${params.length}
        OR s.department_code ILIKE $${params.length}
        OR s.department_name ILIKE $${params.length}
        OR s.location_code ILIKE $${params.length}
        OR s.location_name ILIKE $${params.length}
      )`);
    }

    if (!includeInactive) {
      where.push(`EXISTS (
        SELECT 1
          FROM inv_location loc_active
         WHERE loc_active.location_id = s.location_id
           AND loc_active.is_active = TRUE
           AND loc_active.availability_status = 'active'
      )`);
    }

    const fromSql = `
      SELECT
        s.department_id,
        s.department_code,
        s.department_name,
        s.location_id,
        s.location_code,
        s.location_name,
        s.product_id,
        s.sku,
        s.product_name,
        s.on_hand_qty,
        s.stock_value
      FROM vw_inv_stock_position_expanded s
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count FROM (${fromSql}) base`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const sql = `
      ${fromSql}
      ORDER BY ${paging.orderBySql}, s.product_name ASC, s.sku ASC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}`;

    const result = await client.query(sql, dataParams);
    const totalCount = Number(countResult.rows[0]?.total_count || 0);
    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: totalCount,
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/stock/by-location error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/stock/product/:productId', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const productId = parseNumeric(req.params.productId);
  const departmentId = parseNumeric(req.query.department_id);
  const locationId = parseNumeric(req.query.location_id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const includeInactive = parseBooleanLike(req.query.include_inactive, false);
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 100,
    maxLimit: 1000,
    defaultSortBy: 'department_name',
    defaultSortDir: 'asc',
    sortByMap: {
      department_code: 'd.department_code',
      department_name: 'd.department_name',
      location_code: 'loc.location_code',
      location_name: 'loc.location_name',
      on_hand_qty: 'SUM(l.qty_delta)',
      stock_value: 'SUM(l.value_delta)',
    },
  });
  if (!userId || !productId) {
    return res.status(400).json({ error: 'user_id and productId are required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const productResult = await client.query(
      `SELECT product_id, sku, product_name
         FROM inv_product
        WHERE product_id = $1`,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const where = ['l.product_id = $1'];
    const params = [productId];

    if (departmentId) {
      params.push(departmentId);
      where.push(`l.department_id = $${params.length}`);
    }

    if (locationId) {
      params.push(locationId);
      where.push(`l.location_id = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        d.department_code ILIKE $${params.length}
        OR d.department_name ILIKE $${params.length}
        OR COALESCE(loc.location_code, '') ILIKE $${params.length}
        OR COALESCE(loc.location_name, '') ILIKE $${params.length}
      )`);
    }

    if (!access.isAdmin && !departmentId) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ product: productResult.rows[0], rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`l.department_id = ANY($${params.length}::bigint[])`);
    }

    if (!access.isAdmin) {
      where.push(appendLocationScopeClause(params, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 'l.department_id',
        locationExpr: 'l.location_id',
      }));
    }

    if (!includeInactive) {
      where.push(`(
        l.location_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM inv_location loc_active
           WHERE loc_active.location_id = l.location_id
             AND loc_active.is_active = TRUE
             AND loc_active.availability_status = 'active'
        )
      )`);
    }

    const groupedFromSql = `
       SELECT
         l.department_id,
         d.department_code,
         d.department_name,
         l.location_id,
         loc.location_code,
         loc.location_name,
         SUM(l.qty_delta) AS on_hand_qty,
         SUM(l.value_delta) AS stock_value
       FROM inv_ledger l
       JOIN inv_department d ON d.department_id = l.department_id
       LEFT JOIN inv_location loc ON loc.location_id = l.location_id
      WHERE ${where.join(' AND ')}
      GROUP BY
         l.department_id,
         d.department_code,
         d.department_name,
         l.location_id,
         loc.location_code,
         loc.location_name`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count FROM (${groupedFromSql}) base`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const rowsResult = await client.query(
      `${groupedFromSql}
       ORDER BY ${paging.orderBySql}, d.department_name ASC, loc.location_name NULLS FIRST
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    const totalCount = Number(countResult.rows[0]?.total_count || 0);

    return res.json({
      product: productResult.rows[0],
      rows: rowsResult.rows,
      data: rowsResult.rows,
      total_count: totalCount,
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/stock/product/:productId error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/reorder/suggestions', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const suggestionDate = parseDateOrNull(req.query.suggestion_date);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 500,
    defaultSortBy: 'suggested_order_qty',
    defaultSortDir: 'desc',
    sortByMap: {
      suggestion_date: 'rs.suggestion_date',
      department_name: 'd.department_name',
      department_code: 'd.department_code',
      sku: 'p.sku',
      product_name: 'p.product_name',
      available_qty: 'rs.available_qty',
      suggested_order_qty: 'rs.suggested_order_qty',
      supplier_name: `COALESCE(s.supplier_name, '')`,
      status: 'rs.status',
      location_count: 'COALESCE(lr.location_count, 0)',
    },
  });

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const allowedStatuses = new Set(['new', 'reviewed', 'converted', 'ignored']);

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.reorder.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const where = [];
    const params = [];

    if (departmentId) {
      params.push(departmentId);
      where.push(`rs.department_id = $${params.length}`);
    }

    if (!access.isAdmin && !departmentId) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`rs.department_id = ANY($${params.length}::bigint[])`);
    }

    if (suggestionDate) {
      params.push(suggestionDate);
      where.push(`rs.suggestion_date = $${params.length}::date`);
    }

    if (status && allowedStatuses.has(status)) {
      params.push(status);
      where.push(`rs.status = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        d.department_code ILIKE $${params.length}
        OR d.department_name ILIKE $${params.length}
        OR p.sku ILIKE $${params.length}
        OR p.product_name ILIKE $${params.length}
        OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
      )`);
    }

    const fromSql = `
      SELECT
        rs.reorder_suggestion_id,
        rs.suggestion_date,
        rs.department_id,
        d.department_code,
        d.department_name,
        rs.product_id,
        p.sku,
        p.product_name,
        rs.supplier_id,
        s.supplier_name,
        rs.on_hand_qty,
        rs.reserved_qty,
        rs.available_qty,
        rs.min_qty,
        rs.max_qty,
        rs.reorder_qty,
        rs.suggested_order_qty,
        rs.reason_text,
        rs.status,
        COALESCE(lr.location_count, 0) AS location_count,
        COALESCE(lr.zero_or_negative_location_count, 0) AS zero_or_negative_location_count,
        CASE
          WHEN COALESCE(lr.location_count, 0) > 1
            THEN CONCAT('Department aggregate with location spread: ', COALESCE(lr.zero_or_negative_location_count, 0), '/', COALESCE(lr.location_count, 0), ' locations at or below zero')
          ELSE 'Department aggregate stock balance'
        END AS location_aware_hint,
        (rs.supplier_id IS NOT NULL) AS po_conversion_ready
      FROM inv_reorder_suggestion rs
      JOIN inv_department d ON d.department_id = rs.department_id
      JOIN inv_product p ON p.product_id = rs.product_id
      LEFT JOIN inv_supplier s ON s.supplier_id = rs.supplier_id
      LEFT JOIN (
        SELECT
          department_id,
          product_id,
          COUNT(*)::int AS location_count,
          SUM(CASE WHEN on_hand_qty <= 0 THEN 1 ELSE 0 END)::int AS zero_or_negative_location_count
        FROM vw_inv_stock_position_by_location
        GROUP BY department_id, product_id
      ) lr
        ON lr.department_id = rs.department_id
       AND lr.product_id = rs.product_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count FROM (${fromSql}) base`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const result = await client.query(
      `${fromSql}
       ORDER BY ${paging.orderBySql}, rs.reorder_suggestion_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    const totalCount = Number(countResult.rows[0]?.total_count || 0);
    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: totalCount,
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/reorder/suggestions error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/reorder/suggestions/generate', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body.user_id ?? req.query.user_id);
  const departmentId = parseNumeric(req.body.department_id ?? req.query.department_id);
  const suggestionDate = parseDateOrNull(req.body.suggestion_date ?? req.query.suggestion_date);
  const regenerate = parseBooleanLike(req.body.regenerate ?? req.query.regenerate, true);

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.reorder.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const scopedDepartmentIds = !access.isAdmin && !departmentId
      ? await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full'])
      : [];

    if (!access.isAdmin && !departmentId && scopedDepartmentIds.length === 0) {
      return res.status(200).json({
        suggestion_date: suggestionDate || null,
        generated_count: 0,
        regenerated: regenerate,
      });
    }

    const params = [];
    params.push(suggestionDate || null);
    const suggestionDateParam = params.length;

    let departmentSql = '';
    if (departmentId) {
      params.push(departmentId);
      departmentSql = `AND sb.department_id = $${params.length}`;
    } else if (!access.isAdmin) {
      params.push(scopedDepartmentIds);
      departmentSql = `AND sb.department_id = ANY($${params.length}::bigint[])`;
    }

    if (regenerate) {
      const deleteParams = [suggestionDate || null];
      let deleteSql = `DELETE FROM inv_reorder_suggestion WHERE suggestion_date = COALESCE($1::date, CURRENT_DATE)`;
      if (departmentId) {
        deleteParams.push(departmentId);
        deleteSql += ` AND department_id = $2`;
      } else if (!access.isAdmin) {
        deleteParams.push(scopedDepartmentIds);
        deleteSql += ` AND department_id = ANY($2::bigint[])`;
      }
      await client.query(deleteSql, deleteParams);
    }

    const insertSql = `
      WITH location_rollup AS (
        SELECT
          department_id,
          product_id,
          COUNT(*)::int AS location_count,
          SUM(CASE WHEN on_hand_qty <= 0 THEN 1 ELSE 0 END)::int AS zero_or_negative_location_count
        FROM vw_inv_stock_position_by_location
        GROUP BY department_id, product_id
      ),
      calculated AS (
        SELECT
          sb.department_id,
          sb.product_id,
          pd.preferred_supplier_id AS supplier_id,
          COALESCE(sb.on_hand_qty, 0) AS on_hand_qty,
          COALESCE(sb.reserved_qty, 0) AS reserved_qty,
          COALESCE(sb.available_qty, 0) AS available_qty,
          COALESCE(pd.min_qty, 0) AS min_qty,
          COALESCE(pd.max_qty, 0) AS max_qty,
          COALESCE(pd.reorder_qty, 0) AS reorder_qty,
          GREATEST(
            COALESCE(pd.max_qty, 0) - COALESCE(sb.available_qty, 0),
            COALESCE(pd.reorder_qty, 0),
            0
          )::numeric(14,4) AS suggested_order_qty,
          COALESCE(lr.location_count, 0) AS location_count,
          COALESCE(lr.zero_or_negative_location_count, 0) AS zero_or_negative_location_count
        FROM inv_stock_balance sb
        JOIN inv_product_department pd
          ON pd.product_id = sb.product_id
         AND pd.department_id = sb.department_id
        LEFT JOIN location_rollup lr
          ON lr.department_id = sb.department_id
         AND lr.product_id = sb.product_id
        WHERE pd.is_stocked = TRUE
          ${departmentSql}
      ),
      filtered AS (
        SELECT
          c.*,
          CASE
            WHEN c.available_qty <= 0 THEN 'out_of_stock_below_or_at_min'
            WHEN c.available_qty <= c.min_qty THEN 'below_or_at_min'
            ELSE 'above_min'
          END
          || CASE
            WHEN c.location_count > 1 THEN CONCAT('; locations_at_or_below_zero=', c.zero_or_negative_location_count, '/', c.location_count)
            ELSE ''
          END
          || CASE
            WHEN c.supplier_id IS NULL THEN '; preferred_supplier_missing'
            ELSE ''
          END AS reason_text
        FROM calculated c
        WHERE c.available_qty <= c.min_qty
          AND c.suggested_order_qty > 0
      )
      INSERT INTO inv_reorder_suggestion (
        suggestion_date,
        department_id,
        product_id,
        supplier_id,
        on_hand_qty,
        reserved_qty,
        available_qty,
        min_qty,
        max_qty,
        reorder_qty,
        suggested_order_qty,
        reason_text,
        status,
        created_at
      )
      SELECT
        COALESCE($${suggestionDateParam}::date, CURRENT_DATE),
        f.department_id,
        f.product_id,
        f.supplier_id,
        f.on_hand_qty,
        f.reserved_qty,
        f.available_qty,
        f.min_qty,
        f.max_qty,
        f.reorder_qty,
        f.suggested_order_qty,
        f.reason_text,
        'new',
        NOW()
      FROM filtered f
      ON CONFLICT (suggestion_date, department_id, product_id)
      DO UPDATE
      SET
        supplier_id = EXCLUDED.supplier_id,
        on_hand_qty = EXCLUDED.on_hand_qty,
        reserved_qty = EXCLUDED.reserved_qty,
        available_qty = EXCLUDED.available_qty,
        min_qty = EXCLUDED.min_qty,
        max_qty = EXCLUDED.max_qty,
        reorder_qty = EXCLUDED.reorder_qty,
        suggested_order_qty = EXCLUDED.suggested_order_qty,
        reason_text = EXCLUDED.reason_text,
        status = 'new',
        created_at = NOW()
      RETURNING reorder_suggestion_id`;

    const inserted = await client.query(insertSql, params);

    return res.status(200).json({
      suggestion_date: suggestionDate || null,
      generated_count: inserted.rowCount || 0,
      regenerated: regenerate,
      scope_department_id: departmentId || null,
    });
  } catch (err) {
    console.error('POST /api/inventory/reorder/suggestions/generate error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const locationId = parseNumeric(req.query.location_id);
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 300,
    defaultSortBy: 'transfer_id',
    defaultSortDir: 'desc',
    sortByMap: {
      transfer_id: 'h.transfer_id',
      transfer_number: 'h.transfer_number',
      transfer_status: 'h.transfer_status',
      created_at: 'h.created_at',
      dispatched_at: 'h.dispatched_at',
      received_at: 'h.received_at',
      expected_arrival_date: 'h.expected_arrival_date',
      is_overdue: `CASE
        WHEN h.transfer_status IN ('dispatched', 'partially_received')
         AND h.expected_arrival_date IS NOT NULL
         AND h.expected_arrival_date < CURRENT_DATE
          THEN 1 ELSE 0 END`,
      source_department_code: 'src.department_code',
      target_department_code: 'tgt.department_code',
      line_count: 'COALESCE(lt.line_count, 0)',
    },
  });

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    const where = [];
    const params = [];

    if (departmentId) {
      params.push(departmentId);
      where.push(`(h.source_department_id = $${params.length} OR h.target_department_id = $${params.length})`);
    }

    if (locationId) {
      params.push(locationId);
      where.push(`(h.source_location_id = $${params.length} OR h.target_location_id = $${params.length})`);
    }

    if (status) {
      params.push(status);
      where.push(`h.transfer_status = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        h.transfer_number ILIKE $${params.length}
        OR COALESCE(h.tracking_number, '') ILIKE $${params.length}
        OR COALESCE(h.dispatch_reference, '') ILIKE $${params.length}
        OR COALESCE(h.courier, '') ILIKE $${params.length}
        OR src.department_code ILIKE $${params.length}
        OR src.department_name ILIKE $${params.length}
        OR tgt.department_code ILIKE $${params.length}
        OR tgt.department_name ILIKE $${params.length}
      )`);
    }

    if (!access.isAdmin && !departmentId) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`(
        h.source_department_id = ANY($${params.length}::bigint[])
        OR h.target_department_id = ANY($${params.length}::bigint[])
      )`);
    }

    if (!access.isAdmin) {
      const sourceLocationClause = appendLocationScopeClause(params, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 'h.source_department_id',
        locationExpr: 'h.source_location_id',
      });
      const targetLocationClause = appendLocationScopeClause(params, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 'h.target_department_id',
        locationExpr: 'h.target_location_id',
      });
      where.push(`(${sourceLocationClause} OR ${targetLocationClause})`);
    }

    const fromAndJoinSql = `
       FROM inv_transfer_header h
       JOIN inv_department src ON src.department_id = h.source_department_id
       JOIN inv_department tgt ON tgt.department_id = h.target_department_id
       LEFT JOIN inv_location src_loc ON src_loc.location_id = h.source_location_id
       LEFT JOIN inv_location tgt_loc ON tgt_loc.location_id = h.target_location_id
       LEFT JOIN app_user created_user ON created_user.user_id = h.created_by
       LEFT JOIN app_user dispatched_user ON dispatched_user.user_id = h.dispatched_by
       LEFT JOIN app_user received_user ON received_user.user_id = h.received_by
       LEFT JOIN line_totals lt ON lt.transfer_id = h.transfer_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count
         FROM inv_transfer_header h
         JOIN inv_department src ON src.department_id = h.source_department_id
         JOIN inv_department tgt ON tgt.department_id = h.target_department_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const result = await client.query(
      `WITH line_totals AS (
         SELECT
           transfer_id,
           COUNT(transfer_line_id) AS line_count,
           COALESCE(SUM(dispatched_qty), 0) AS dispatched_qty_total,
           COALESCE(SUM(received_qty), 0) AS received_qty_total,
           COALESCE(SUM(remaining_qty), 0) AS remaining_qty_total
         FROM inv_transfer_line
         GROUP BY transfer_id
       )
       SELECT
         h.transfer_id,
         h.transfer_number,
         h.transfer_status,
         h.created_at,
         h.dispatched_at,
         h.received_at,
         h.cancelled_at,
         h.expected_arrival_date,
         CASE
           WHEN h.transfer_status = 'draft' THEN TRUE
           ELSE FALSE
         END AS is_pending_dispatch,
         CASE
           WHEN h.transfer_status IN ('dispatched', 'partially_received') THEN TRUE
           ELSE FALSE
         END AS is_awaiting_receipt,
         CASE
           WHEN h.transfer_status IN ('dispatched', 'partially_received')
            AND h.expected_arrival_date IS NOT NULL
            AND h.expected_arrival_date < CURRENT_DATE
             THEN TRUE
           ELSE FALSE
         END AS is_overdue,
         CASE
           WHEN h.transfer_status IN ('dispatched', 'partially_received')
            AND h.expected_arrival_date IS NOT NULL
            AND h.expected_arrival_date < CURRENT_DATE
             THEN CONCAT('Overdue by ', (CURRENT_DATE - h.expected_arrival_date)::text, ' day(s)')
           WHEN h.transfer_status IN ('dispatched', 'partially_received')
             THEN 'Awaiting receipt'
           ELSE NULL
         END AS pending_receipt_alert,
         h.source_department_id,
         src.department_code AS source_department_code,
         src.department_name AS source_department_name,
         h.source_location_id,
         src_loc.location_code AS source_location_code,
         src_loc.location_name AS source_location_name,
         h.target_department_id,
         tgt.department_code AS target_department_code,
         tgt.department_name AS target_department_name,
         h.target_location_id,
         tgt_loc.location_code AS target_location_code,
         tgt_loc.location_name AS target_location_name,
         h.created_by,
         created_user.username AS created_by_username,
         h.dispatched_by,
         dispatched_user.username AS dispatched_by_username,
         h.received_by,
         received_user.username AS received_by_username,
         h.cancelled_by,
         h.notes_sender,
         h.notes_receiver,
         h.courier,
         h.transport_method,
         h.tracking_number,
         h.dispatch_reference,
         COALESCE(lt.line_count, 0) AS line_count,
         COALESCE(lt.dispatched_qty_total, 0) AS dispatched_qty_total,
         COALESCE(lt.received_qty_total, 0) AS received_qty_total,
         COALESCE(lt.remaining_qty_total, 0) AS remaining_qty_total
       ${fromAndJoinSql}
       ORDER BY ${paging.orderBySql}, h.transfer_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    const totalCount = Number(countResult.rows[0]?.total_count || 0);
    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: totalCount,
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/transfers error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Inventory transfer APIs ─────────────────────────────────────────────────
app.get('/api/inventory/locations', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const activeOnly = parseBooleanLike(req.query.active_only, true);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const availabilityStatus = typeof req.query.availability_status === 'string'
    ? req.query.availability_status.trim().toLowerCase()
    : '';
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 100,
    maxLimit: 500,
    defaultSortBy: 'location_name',
    defaultSortDir: 'asc',
    sortByMap: {
      location_code: 'l.location_code',
      location_name: 'l.location_name',
      department_code: 'd.department_code',
      department_name: 'd.department_name',
      location_type: 'l.location_type',
      availability_status: 'l.availability_status',
      effective_from: 'l.effective_from',
      updated_at: 'l.updated_at',
    },
  });

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    await requirePermissionAndScope(client, userId, 'admin.global', null, []);

    const where = [];
    const params = [];

    if (departmentId) {
      params.push(departmentId);
      where.push(`l.department_id = $${params.length}`);
    }

    if (activeOnly) {
      where.push(`l.is_active = TRUE`);
      where.push(`l.availability_status = 'active'`);
    }

    if (availabilityStatus) {
      if (!INVENTORY_LOCATION_AVAILABILITY.has(availabilityStatus)) {
        return res.status(400).json({ error: 'Invalid availability_status filter' });
      }
      params.push(availabilityStatus);
      where.push(`l.availability_status = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        l.location_code ILIKE $${params.length}
        OR l.location_name ILIKE $${params.length}
        OR d.department_code ILIKE $${params.length}
        OR d.department_name ILIKE $${params.length}
        OR COALESCE(l.notes, '') ILIKE $${params.length}
      )`);
    }

    const fromSql = `
      FROM inv_location l
      JOIN inv_department d ON d.department_id = l.department_id
      LEFT JOIN inv_location parent ON parent.location_id = l.parent_location_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count ${fromSql}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const result = await client.query(
      `SELECT
         l.location_id,
         l.location_code,
         l.location_name,
         l.department_id,
         d.department_code,
         d.department_name,
         l.parent_location_id,
         parent.location_code AS parent_location_code,
         parent.location_name AS parent_location_name,
         l.location_type,
         l.can_hold_stock,
         l.can_receive_stock,
         l.can_issue_stock,
         l.can_store_equipment,
         l.is_active,
         l.availability_status,
         l.effective_from,
         l.effective_to,
         l.notes,
         l.created_at,
         l.updated_at
       ${fromSql}
       ORDER BY ${paging.orderBySql}, l.location_id ASC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: Number(countResult.rows[0]?.total_count || 0),
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
      active_only: activeOnly,
    });
  } catch (err) {
    console.error('GET /api/inventory/locations error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/locations', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body?.user_id);
  const locationCode = typeof req.body?.location_code === 'string' ? req.body.location_code.trim() : '';
  const locationName = typeof req.body?.location_name === 'string' ? req.body.location_name.trim() : '';
  const departmentId = parseNumeric(req.body?.department_id);
  const parentLocationId = req.body?.parent_location_id == null ? null : parseNumeric(req.body?.parent_location_id);
  const locationType = typeof req.body?.location_type === 'string' ? req.body.location_type.trim().toLowerCase() : '';
  const canHoldStock = parseBooleanLike(req.body?.can_hold_stock, true);
  const canReceiveStock = parseBooleanLike(req.body?.can_receive_stock, true);
  const canIssueStock = parseBooleanLike(req.body?.can_issue_stock, true);
  const canStoreEquipment = parseBooleanLike(req.body?.can_store_equipment, false);
  const isActive = parseBooleanLike(req.body?.is_active, true);
  const availabilityStatus = typeof req.body?.availability_status === 'string'
    ? req.body.availability_status.trim().toLowerCase()
    : 'active';
  const effectiveFrom = parseDateOrNull(req.body?.effective_from);
  const effectiveTo = parseDateOrNull(req.body?.effective_to);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!locationCode) {
    return res.status(400).json({ error: 'location_code is required' });
  }
  if (!locationName) {
    return res.status(400).json({ error: 'location_name is required' });
  }
  if (!departmentId) {
    return res.status(400).json({ error: 'department_id is required' });
  }
  if (!locationType || !INVENTORY_LOCATION_TYPES.has(locationType)) {
    return res.status(400).json({ error: 'location_type is invalid' });
  }
  if (!INVENTORY_LOCATION_AVAILABILITY.has(availabilityStatus)) {
    return res.status(400).json({ error: 'availability_status is invalid' });
  }
  if (req.body?.parent_location_id != null && !parentLocationId) {
    return res.status(400).json({ error: 'parent_location_id must be a positive number when provided' });
  }
  if (req.body?.effective_from != null && !effectiveFrom) {
    return res.status(400).json({ error: 'effective_from must be YYYY-MM-DD when provided' });
  }
  if (req.body?.effective_to != null && !effectiveTo) {
    return res.status(400).json({ error: 'effective_to must be YYYY-MM-DD when provided' });
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    return res.status(400).json({ error: 'effective_to cannot be before effective_from' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'admin.global', null, []);

    await validateLocationCodeUniqueness(client, locationCode, null);
    await validateLocationDepartmentAndParent(client, departmentId, parentLocationId, null);

    const insertResult = await client.query(
      `INSERT INTO inv_location (
         location_code,
         location_name,
         department_id,
         parent_location_id,
         location_type,
         can_hold_stock,
         can_receive_stock,
         can_issue_stock,
         can_store_equipment,
         is_active,
         availability_status,
         effective_from,
         effective_to,
         notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
         COALESCE($12::date, CURRENT_DATE),
         $13::date,
         $14
       )
       RETURNING location_id`,
      [
        locationCode,
        locationName,
        departmentId,
        parentLocationId,
        locationType,
        canHoldStock,
        canReceiveStock,
        canIssueStock,
        canStoreEquipment,
        isActive,
        availabilityStatus,
        effectiveFrom,
        effectiveTo,
        notes,
      ]
    );

    const created = await fetchLocationById(client, Number(insertResult.rows[0].location_id));
    await client.query('COMMIT');
    return res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'location_code already exists' });
    }
    console.error('POST /api/inventory/locations error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/inventory/locations/:id', apiLimiter, async (req, res) => {
  const locationId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  if (!locationId || !userId) {
    return res.status(400).json({ error: 'location id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'admin.global', null, []);

    const existing = await fetchLocationById(client, locationId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Location not found' });
    }

    const locationCode = typeof req.body?.location_code === 'string' ? req.body.location_code.trim() : existing.location_code;
    const locationName = typeof req.body?.location_name === 'string' ? req.body.location_name.trim() : existing.location_name;
    const departmentId = req.body?.department_id == null ? Number(existing.department_id) : parseNumeric(req.body?.department_id);
    const parentLocationId = req.body?.parent_location_id === undefined
      ? (existing.parent_location_id == null ? null : Number(existing.parent_location_id))
      : (req.body?.parent_location_id == null ? null : parseNumeric(req.body?.parent_location_id));
    const locationType = typeof req.body?.location_type === 'string'
      ? req.body.location_type.trim().toLowerCase()
      : String(existing.location_type).trim().toLowerCase();
    const canHoldStock = req.body?.can_hold_stock === undefined ? existing.can_hold_stock : parseBooleanLike(req.body?.can_hold_stock, existing.can_hold_stock === true);
    const canReceiveStock = req.body?.can_receive_stock === undefined ? existing.can_receive_stock : parseBooleanLike(req.body?.can_receive_stock, existing.can_receive_stock === true);
    const canIssueStock = req.body?.can_issue_stock === undefined ? existing.can_issue_stock : parseBooleanLike(req.body?.can_issue_stock, existing.can_issue_stock === true);
    const canStoreEquipment = req.body?.can_store_equipment === undefined ? existing.can_store_equipment : parseBooleanLike(req.body?.can_store_equipment, existing.can_store_equipment === true);
    const isActive = req.body?.is_active === undefined ? existing.is_active : parseBooleanLike(req.body?.is_active, existing.is_active === true);
    const availabilityStatus = typeof req.body?.availability_status === 'string'
      ? req.body.availability_status.trim().toLowerCase()
      : String(existing.availability_status || 'active').trim().toLowerCase();
    const effectiveFrom = req.body?.effective_from === undefined
      ? (existing.effective_from ? String(existing.effective_from).slice(0, 10) : null)
      : parseDateOrNull(req.body?.effective_from);
    const effectiveTo = req.body?.effective_to === undefined
      ? (existing.effective_to ? String(existing.effective_to).slice(0, 10) : null)
      : parseDateOrNull(req.body?.effective_to);
    const notes = req.body?.notes === undefined
      ? (existing.notes ?? null)
      : (typeof req.body?.notes === 'string' ? req.body.notes.trim() : null);

    if (!locationCode) {
      throw createHttpError(400, 'location_code is required');
    }
    if (!locationName) {
      throw createHttpError(400, 'location_name is required');
    }
    if (!departmentId) {
      throw createHttpError(400, 'department_id is required');
    }
    if (!locationType || !INVENTORY_LOCATION_TYPES.has(locationType)) {
      throw createHttpError(400, 'location_type is invalid');
    }
    if (!INVENTORY_LOCATION_AVAILABILITY.has(availabilityStatus)) {
      throw createHttpError(400, 'availability_status is invalid');
    }
    if (req.body?.parent_location_id !== undefined && req.body?.parent_location_id != null && !parentLocationId) {
      throw createHttpError(400, 'parent_location_id must be a positive number when provided');
    }
    if (req.body?.effective_from !== undefined && req.body?.effective_from != null && !effectiveFrom) {
      throw createHttpError(400, 'effective_from must be YYYY-MM-DD when provided');
    }
    if (req.body?.effective_to !== undefined && req.body?.effective_to != null && !effectiveTo) {
      throw createHttpError(400, 'effective_to must be YYYY-MM-DD when provided');
    }
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
      throw createHttpError(400, 'effective_to cannot be before effective_from');
    }

    await validateLocationCodeUniqueness(client, locationCode, locationId);
    await validateLocationDepartmentAndParent(client, departmentId, parentLocationId, locationId);

    await client.query(
      `UPDATE inv_location
       SET
         location_code = $1,
         location_name = $2,
         department_id = $3,
         parent_location_id = $4,
         location_type = $5,
         can_hold_stock = $6,
         can_receive_stock = $7,
         can_issue_stock = $8,
         can_store_equipment = $9,
         is_active = $10,
         availability_status = $11,
         effective_from = COALESCE($12::date, effective_from),
         effective_to = $13::date,
         notes = $14,
         updated_at = NOW()
       WHERE location_id = $15`,
      [
        locationCode,
        locationName,
        departmentId,
        parentLocationId,
        locationType,
        canHoldStock,
        canReceiveStock,
        canIssueStock,
        canStoreEquipment,
        isActive,
        availabilityStatus,
        effectiveFrom,
        effectiveTo,
        notes,
        locationId,
      ]
    );

    const updated = await fetchLocationById(client, locationId);
    await client.query('COMMIT');
    return res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'location_code already exists' });
    }
    console.error('PATCH /api/inventory/locations/:id error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/locations/:id/deactivate', apiLimiter, async (req, res) => {
  const locationId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const availabilityStatus = typeof req.body?.availability_status === 'string'
    ? req.body.availability_status.trim().toLowerCase()
    : 'inactive';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
  const effectiveTo = parseDateOrNull(req.body?.effective_to) || new Date().toISOString().slice(0, 10);
  if (!locationId || !userId) {
    return res.status(400).json({ error: 'location id and user_id are required' });
  }
  if (!['inactive', 'rented_out', 'unavailable', 'under_maintenance', 'archived'].includes(availabilityStatus)) {
    return res.status(400).json({ error: 'availability_status must be one of inactive, rented_out, unavailable, under_maintenance, archived' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'admin.global', null, []);

    const existing = await fetchLocationById(client, locationId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Location not found' });
    }

    await client.query(
      `UPDATE inv_location
       SET
         is_active = FALSE,
         availability_status = $1,
         effective_to = COALESCE($2::date, effective_to),
         notes = CASE
           WHEN $3::text IS NULL OR $3::text = '' THEN notes
           WHEN notes IS NULL OR notes = '' THEN $3::text
           ELSE notes || E'\n' || $3::text
         END,
         updated_at = NOW()
       WHERE location_id = $4`,
      [availabilityStatus, effectiveTo, notes, locationId]
    );

    const updated = await fetchLocationById(client, locationId);
    await client.query('COMMIT');
    return res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/locations/:id/deactivate error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/suppliers', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const includeInactive = parseBooleanLike(req.query.include_inactive, false);
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 20,
    maxLimit: 100,
    defaultSortBy: 'supplier_name',
    defaultSortDir: 'asc',
    sortByMap: {
      supplier_name: 's.supplier_name',
      supplier_code: `COALESCE(s.supplier_code, '')`,
      updated_at: 's.updated_at',
    },
  });

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    await requirePermissionAndScope(client, userId, 'inv.stock.view', null, ['view', 'post', 'approve', 'full']);

    const where = [];
    const params = [];
    if (!includeInactive) {
      where.push('s.is_active = TRUE');
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        s.supplier_name ILIKE $${params.length}
        OR COALESCE(s.supplier_code, '') ILIKE $${params.length}
        OR COALESCE(s.phone, '') ILIKE $${params.length}
        OR COALESCE(s.email, '') ILIKE $${params.length}
      )`);
    }

    const fromSql = `
      FROM inv_supplier s
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count ${fromSql}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const rowsResult = await client.query(
      `SELECT
         s.supplier_id,
         s.supplier_code,
         s.supplier_name,
         s.contact_name,
         s.phone,
         s.email,
         s.lead_time_days,
         s.minimum_order_value,
         s.currency_code,
         s.is_active,
         s.created_at,
         s.updated_at
       ${fromSql}
       ORDER BY ${paging.orderBySql}, s.supplier_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      rows: rowsResult.rows,
      data: rowsResult.rows,
      total_count: Number(countResult.rows[0]?.total_count || 0),
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/suppliers error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/suppliers', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body?.user_id);
  const supplierName = typeof req.body?.supplier_name === 'string' ? req.body.supplier_name.trim() : '';
  const supplierCode = typeof req.body?.supplier_code === 'string' ? req.body.supplier_code.trim() : '';
  const contactName = typeof req.body?.contact_name === 'string' ? req.body.contact_name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const leadTimeDays = req.body?.lead_time_days == null ? null : parseNumericOrNull(req.body?.lead_time_days);
  const minimumOrderValue = req.body?.minimum_order_value == null ? null : parseNumericOrNull(req.body?.minimum_order_value);
  const currencyCode = typeof req.body?.currency_code === 'string' ? req.body.currency_code.trim().toUpperCase() : 'EUR';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  const isActive = parseBooleanLike(req.body?.is_active, true);

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!supplierName) {
    return res.status(400).json({ error: 'supplier_name is required' });
  }
  if (leadTimeDays !== null && leadTimeDays < 0) {
    return res.status(400).json({ error: 'lead_time_days must be >= 0 when provided' });
  }
  if (minimumOrderValue !== null && minimumOrderValue < 0) {
    return res.status(400).json({ error: 'minimum_order_value must be >= 0 when provided' });
  }
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    return res.status(400).json({ error: 'currency_code must be ISO-4217 format (e.g. EUR)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'inv.stock.post', null, ['post', 'approve', 'full']);

    const duplicateByName = await client.query(
      `SELECT supplier_id
       FROM inv_supplier
       WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM($1))
       LIMIT 1`,
      [supplierName]
    );
    if (duplicateByName.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'supplier_name already exists' });
    }

    const insertResult = await client.query(
      `INSERT INTO inv_supplier (
         supplier_code,
         supplier_name,
         contact_name,
         phone,
         email,
         lead_time_days,
         minimum_order_value,
         currency_code,
         notes,
         is_active,
         created_at,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
       RETURNING supplier_id`,
      [
        supplierCode || null,
        supplierName,
        contactName || null,
        phone || null,
        email || null,
        leadTimeDays,
        minimumOrderValue ?? 0,
        currencyCode || 'EUR',
        notes || null,
        isActive,
      ]
    );

    const created = await fetchSupplierById(client, Number(insertResult.rows[0].supplier_id));
    await client.query('COMMIT');
    return res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'supplier_code already exists' });
    }
    console.error('POST /api/inventory/suppliers error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/products', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const supplierId = parseNumeric(req.query.supplier_id);
  const includeInactive = parseBooleanLike(req.query.include_inactive, false);
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 300,
    defaultSortBy: 'product_name',
    defaultSortDir: 'asc',
    sortByMap: {
      sku: 'p.sku',
      product_name: 'p.product_name',
      supplier_name: `COALESCE(s.supplier_name, '')`,
      default_cost: 'p.default_cost',
      is_active: 'p.is_active',
      updated_at: 'p.updated_at',
    },
  });

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    await requirePermissionAndScope(client, userId, 'inv.stock.view', null, ['view', 'post', 'approve', 'full']);

    const where = [];
    const params = [];
    if (!includeInactive) {
      where.push('p.is_active = TRUE');
    }
    if (supplierId) {
      params.push(supplierId);
      where.push(`COALESCE(p.preferred_supplier_id, pref.supplier_id) = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        p.sku ILIKE $${params.length}
        OR p.product_name ILIKE $${params.length}
        OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
      )`);
    }

    const fromSql = `
      FROM inv_product p
      LEFT JOIN LATERAL (
        SELECT ps.supplier_id
        FROM inv_product_supplier ps
        WHERE ps.product_id = p.product_id
          AND ps.is_active = TRUE
        ORDER BY ps.is_preferred DESC, ps.preferred_rank ASC, ps.product_supplier_id ASC
        LIMIT 1
      ) pref ON TRUE
      LEFT JOIN inv_supplier s ON s.supplier_id = pref.supplier_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count ${fromSql}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const rowsResult = await client.query(
      `SELECT
         p.product_id,
         p.sku,
         p.product_name,
         p.product_type,
         p.default_cost,
         p.default_sell_price,
         p.is_purchasable,
         p.is_active,
         p.updated_at,
         COALESCE(p.preferred_supplier_id, pref.supplier_id) AS supplier_id,
         p.preferred_supplier_id,
         s.supplier_code,
         s.supplier_name
       ${fromSql}
       ORDER BY ${paging.orderBySql}, p.product_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      rows: rowsResult.rows,
      data: rowsResult.rows,
      total_count: Number(countResult.rows[0]?.total_count || 0),
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/products error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/products', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body?.user_id);
  const sku = typeof req.body?.sku === 'string' ? req.body.sku.trim() : '';
  const productName = typeof req.body?.product_name === 'string' ? req.body.product_name.trim() : '';
  const productTypeRaw = typeof req.body?.product_type === 'string' ? req.body.product_type.trim().toLowerCase() : 'stock_item';
  const supplierId = req.body?.supplier_id == null ? null : parseNumeric(req.body?.supplier_id);
  const defaultCost = parseNumericOrNull(req.body?.default_cost);
  const isPurchasable = parseBooleanLike(req.body?.is_purchasable, true);
  const isActive = parseBooleanLike(req.body?.is_active, true);

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!sku || !productName) {
    return res.status(400).json({ error: 'sku and product_name are required' });
  }
  if (!INVENTORY_PRODUCT_TYPES.has(productTypeRaw)) {
    return res.status(400).json({ error: 'product_type is invalid' });
  }
  if (req.body?.supplier_id != null && !supplierId) {
    return res.status(400).json({ error: 'supplier_id must be a positive number when provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'inv.stock.post', null, ['post', 'approve', 'full']);

    if (supplierId) {
      const supplier = await fetchSupplierById(client, supplierId);
      if (!supplier) {
        throw createHttpError(400, 'supplier_id not found');
      }
      if (supplier.is_active !== true) {
        throw createHttpError(400, 'supplier_id is inactive');
      }
    }

    const baseUomResult = await client.query(
      `SELECT uom_id
       FROM inv_unit_of_measure
       ORDER BY is_base_unit DESC, uom_id ASC
       LIMIT 1`
    );
    if (baseUomResult.rows.length === 0) {
      throw createHttpError(400, 'Cannot create product: inv_unit_of_measure is empty');
    }
    const baseUomId = Number(baseUomResult.rows[0].uom_id);

    const productInsertResult = await client.query(
      `INSERT INTO inv_product (
         sku,
         product_name,
         base_uom_id,
         product_type,
         preferred_supplier_id,
         is_purchasable,
         is_active,
         default_cost,
         created_at,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
       RETURNING product_id`,
      [
        sku,
        productName,
        baseUomId,
        productTypeRaw,
        supplierId,
        isPurchasable,
        isActive,
        defaultCost ?? 0,
      ]
    );

    const productId = Number(productInsertResult.rows[0].product_id);

    if (supplierId) {
      await client.query(
        `UPDATE inv_product_supplier
         SET is_preferred = FALSE
         WHERE product_id = $1`,
        [productId]
      );

      await client.query(
        `INSERT INTO inv_product_supplier (
           product_id,
           supplier_id,
           preferred_rank,
           supplier_cost,
           is_preferred,
           is_active
         ) VALUES ($1,$2,1,$3,TRUE,TRUE)
         ON CONFLICT (product_id, supplier_id)
         DO UPDATE
         SET
           preferred_rank = 1,
           supplier_cost = EXCLUDED.supplier_cost,
           is_preferred = TRUE,
           is_active = TRUE`,
        [productId, supplierId, defaultCost ?? 0]
      );
    }

    const result = await client.query(
      `SELECT
         p.product_id,
         p.sku,
         p.product_name,
         p.product_type,
         p.default_cost,
         p.is_purchasable,
         p.is_active,
         COALESCE(p.preferred_supplier_id, pref.supplier_id) AS supplier_id,
         p.preferred_supplier_id,
         s.supplier_code,
         s.supplier_name,
         p.created_at,
         p.updated_at
       FROM inv_product p
       LEFT JOIN LATERAL (
         SELECT ps.supplier_id
         FROM inv_product_supplier ps
         WHERE ps.product_id = p.product_id
           AND ps.is_active = TRUE
         ORDER BY ps.is_preferred DESC, ps.preferred_rank ASC, ps.product_supplier_id ASC
         LIMIT 1
       ) pref ON TRUE
       LEFT JOIN inv_supplier s ON s.supplier_id = pref.supplier_id
       WHERE p.product_id = $1`,
      [productId]
    );

    await client.query('COMMIT');
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'sku already exists' });
    }
    console.error('POST /api/inventory/products error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/inventory/products/:id', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body?.user_id);
  const productId = parseNumeric(req.params.id);
  const sku = typeof req.body?.sku === 'string' ? req.body.sku.trim() : null;
  const productName = typeof req.body?.product_name === 'string' ? req.body.product_name.trim() : null;
  const supplierId = req.body?.supplier_id === null
    ? null
    : (req.body?.supplier_id == null ? undefined : parseNumeric(req.body?.supplier_id));
  const defaultCost = req.body?.default_cost === undefined ? undefined : parseNumericOrNull(req.body?.default_cost);
  const isPurchasable = req.body?.is_purchasable === undefined ? undefined : parseBooleanLike(req.body?.is_purchasable, true);
  const isActive = req.body?.is_active === undefined ? undefined : parseBooleanLike(req.body?.is_active, true);

  if (!userId || !productId) {
    return res.status(400).json({ error: 'user_id and product id are required' });
  }
  if (req.body?.supplier_id !== undefined && req.body?.supplier_id !== null && !supplierId) {
    return res.status(400).json({ error: 'supplier_id must be a positive number when provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'inv.stock.post', null, ['post', 'approve', 'full']);

    const existing = await client.query(
      `SELECT product_id, sku, default_cost
       FROM inv_product
       WHERE product_id = $1`,
      [productId]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    if (supplierId !== undefined && supplierId !== null) {
      const supplier = await fetchSupplierById(client, supplierId);
      if (!supplier) {
        throw createHttpError(400, 'supplier_id not found');
      }
      if (supplier.is_active !== true) {
        throw createHttpError(400, 'supplier_id is inactive');
      }
    }

    await client.query(
      `UPDATE inv_product
       SET
         sku = COALESCE($1, sku),
         product_name = COALESCE($2, product_name),
         default_cost = COALESCE($3, default_cost),
         is_purchasable = COALESCE($4, is_purchasable),
         is_active = COALESCE($5, is_active),
         preferred_supplier_id = CASE
           WHEN $6::bigint IS NULL THEN NULL
           WHEN $6::bigint > 0 THEN $6::bigint
           ELSE preferred_supplier_id
         END,
         updated_at = NOW()
       WHERE product_id = $7`,
      [
        sku || null,
        productName || null,
        defaultCost,
        isPurchasable,
        isActive,
        supplierId === undefined ? -1 : supplierId,
        productId,
      ]
    );

    if (supplierId !== undefined) {
      if (supplierId === null) {
        await client.query(
          `DELETE FROM inv_product_supplier
           WHERE product_id = $1`,
          [productId]
        );
      } else {
        await client.query(
          `UPDATE inv_product_supplier
           SET is_preferred = FALSE
           WHERE product_id = $1`,
          [productId]
        );

        await client.query(
          `INSERT INTO inv_product_supplier (
             product_id,
             supplier_id,
             preferred_rank,
             supplier_cost,
             is_preferred,
             is_active
           ) VALUES ($1,$2,1,$3,TRUE,TRUE)
           ON CONFLICT (product_id, supplier_id)
           DO UPDATE
           SET
             preferred_rank = 1,
             supplier_cost = EXCLUDED.supplier_cost,
             is_preferred = TRUE,
             is_active = TRUE`,
          [
            productId,
            supplierId,
            defaultCost ?? Number(existing.rows[0].default_cost || 0),
          ]
        );
      }
    }

    const result = await client.query(
      `SELECT
         p.product_id,
         p.sku,
         p.product_name,
         p.product_type,
         p.default_cost,
         p.default_sell_price,
         p.is_purchasable,
         p.is_active,
         p.updated_at,
         COALESCE(p.preferred_supplier_id, pref.supplier_id) AS supplier_id,
         p.preferred_supplier_id,
         s.supplier_code,
         s.supplier_name
       FROM inv_product p
       LEFT JOIN LATERAL (
         SELECT ps.supplier_id
         FROM inv_product_supplier ps
         WHERE ps.product_id = p.product_id
           AND ps.is_active = TRUE
         ORDER BY ps.is_preferred DESC, ps.preferred_rank ASC, ps.product_supplier_id ASC
         LIMIT 1
       ) pref ON TRUE
       LEFT JOIN inv_supplier s ON s.supplier_id = pref.supplier_id
       WHERE p.product_id = $1`,
      [productId]
    );

    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'sku already exists' });
    }
    console.error('PATCH /api/inventory/products/:id error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/equipment/assets', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  const locationId = parseNumeric(req.query.location_id);
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 50,
    maxLimit: 300,
    defaultSortBy: 'updated_at',
    defaultSortDir: 'desc',
    sortByMap: {
      asset_code: 'e.asset_code',
      asset_name: 'e.asset_name',
      asset_type: `COALESCE(e.asset_type, '')`,
      supplier_name: `COALESCE(s.supplier_name, '')`,
      purchase_date: 'e.purchase_date',
      warranty_expiry_date: 'e.warranty_expiry_date',
      warranty_end_date: 'e.warranty_expiry_date',
      department_code: 'd.department_code',
      department_name: 'd.department_name',
      location_code: `COALESCE(l.location_code, '')`,
      location_name: `COALESCE(l.location_name, '')`,
      status: 'e.status',
      updated_at: 'e.updated_at',
    },
  });

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

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
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
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
      if (!EQUIPMENT_ASSET_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      params.push(status);
      where.push(`e.status = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        e.asset_code ILIKE $${params.length}
        OR e.asset_name ILIKE $${params.length}
        OR COALESCE(e.asset_type, '') ILIKE $${params.length}
        OR COALESCE(e.serial_number, '') ILIKE $${params.length}
        OR COALESCE(e.invoice_reference, '') ILIKE $${params.length}
        OR COALESCE(s.supplier_name, '') ILIKE $${params.length}
        OR d.department_code ILIKE $${params.length}
        OR d.department_name ILIKE $${params.length}
        OR COALESCE(l.location_code, '') ILIKE $${params.length}
        OR COALESCE(l.location_name, '') ILIKE $${params.length}
      )`);
    }

    const fromSql = `
      FROM inv_equipment_asset e
      LEFT JOIN inv_supplier s ON s.supplier_id = e.supplier_id
      LEFT JOIN inv_department d ON d.department_id = e.department_id
      LEFT JOIN inv_location l ON l.location_id = e.location_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count ${fromSql}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const result = await client.query(
      `SELECT
         e.equipment_id,
         e.asset_code,
         e.asset_name,
         e.asset_type,
         e.serial_number,
         e.supplier_id,
         s.supplier_code,
         s.supplier_name,
         e.purchase_date,
         e.purchase_cost,
         e.warranty_start_date,
         e.warranty_expiry_date,
         e.warranty_expiry_date AS warranty_end_date,
         e.invoice_reference,
         e.is_active,
         e.department_id,
         d.department_code,
         d.department_name,
         e.location_id,
         l.location_code,
         l.location_name,
         e.status,
         e.notes,
         e.created_at,
         e.updated_at
       ${fromSql}
       ORDER BY ${paging.orderBySql}, e.equipment_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      rows: result.rows,
      data: result.rows,
      total_count: Number(countResult.rows[0]?.total_count || 0),
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/equipment/assets error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/equipment/assets', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.body?.user_id);
  const assetCode = typeof req.body?.asset_code === 'string' ? req.body.asset_code.trim() : '';
  const assetName = typeof req.body?.asset_name === 'string' ? req.body.asset_name.trim() : '';
  const assetType = typeof req.body?.asset_type === 'string' ? req.body.asset_type.trim() : null;
  const serialNumber = typeof req.body?.serial_number === 'string' ? req.body.serial_number.trim() : null;
  const supplierId = req.body?.supplier_id == null ? null : parseNumeric(req.body?.supplier_id);
  const purchaseDate = parseDateOrNull(req.body?.purchase_date);
  const purchaseCost = parseNumericOrNull(req.body?.purchase_cost);
  const warrantyStartDate = parseDateOrNull(req.body?.warranty_start_date);
  const warrantyExpiryDate = parseDateOrNull(req.body?.warranty_end_date ?? req.body?.warranty_expiry_date);
  const invoiceReference = typeof req.body?.invoice_reference === 'string' ? req.body.invoice_reference.trim() : null;
  const isActive = parseBooleanLike(req.body?.is_active, true);
  const departmentId = parseNumeric(req.body?.department_id);
  const locationId = req.body?.location_id == null ? null : parseNumeric(req.body?.location_id);
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'active';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (!assetCode) {
    return res.status(400).json({ error: 'asset_code is required' });
  }
  if (!assetName) {
    return res.status(400).json({ error: 'asset_name is required' });
  }
  if (!departmentId) {
    return res.status(400).json({ error: 'department_id is required' });
  }
  if (req.body?.location_id != null && !locationId) {
    return res.status(400).json({ error: 'location_id must be a positive number when provided' });
  }
  if (req.body?.supplier_id != null && !supplierId) {
    return res.status(400).json({ error: 'supplier_id must be a positive number when provided' });
  }
  if (req.body?.purchase_date != null && !purchaseDate) {
    return res.status(400).json({ error: 'purchase_date must be YYYY-MM-DD when provided' });
  }
  if (req.body?.warranty_start_date != null && !warrantyStartDate) {
    return res.status(400).json({ error: 'warranty_start_date must be YYYY-MM-DD when provided' });
  }
  if ((req.body?.warranty_end_date != null || req.body?.warranty_expiry_date != null) && !warrantyExpiryDate) {
    return res.status(400).json({ error: 'warranty_end_date must be YYYY-MM-DD when provided' });
  }
  if (purchaseCost !== null && purchaseCost < 0) {
    return res.status(400).json({ error: 'purchase_cost must be >= 0 when provided' });
  }
  if (warrantyStartDate && warrantyExpiryDate && warrantyStartDate > warrantyExpiryDate) {
    return res.status(400).json({ error: 'warranty_end_date must be on or after warranty_start_date' });
  }
  if (!EQUIPMENT_ASSET_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status is invalid' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.post',
      departmentId,
      ['post', 'approve', 'full']
    );

    if (!access.isAdmin && locationId) {
      await assertUserLocationScopeWhenConfigured(
        client,
        userId,
        departmentId,
        locationId,
        ['post', 'approve', 'full'],
        'location_id'
      );
    }

    await assertLocationCanStoreEquipment(client, locationId, departmentId, 'location_id');

    if (supplierId) {
      const supplier = await fetchSupplierById(client, supplierId);
      if (!supplier) {
        throw createHttpError(400, 'supplier_id not found');
      }
      if (supplier.is_active !== true) {
        throw createHttpError(400, 'supplier_id is inactive');
      }
    }

    const insertResult = await client.query(
      `INSERT INTO inv_equipment_asset (
         asset_code,
         asset_name,
         asset_type,
         serial_number,
         supplier_id,
         purchase_date,
         purchase_cost,
         warranty_start_date,
         warranty_expiry_date,
         invoice_reference,
         is_active,
         department_id,
         location_id,
         status,
         notes,
         created_at,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
       RETURNING equipment_id`,
      [
        assetCode,
        assetName,
        assetType || null,
        serialNumber || null,
        supplierId,
        purchaseDate,
        purchaseCost,
        warrantyStartDate,
        warrantyExpiryDate,
        invoiceReference || null,
        isActive,
        departmentId,
        locationId,
        status,
        notes,
      ]
    );

    const equipmentId = Number(insertResult.rows[0]?.equipment_id || 0);
    const created = await fetchEquipmentAssetById(client, equipmentId);

    await client.query('COMMIT');
    return res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'asset_code already exists' });
    }
    console.error('POST /api/inventory/equipment/assets error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/equipment/assets/:id/move', apiLimiter, async (req, res) => {
  const equipmentId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const toDepartmentId = parseNumeric(req.body?.to_department_id);
  const toLocationId = parseNumeric(req.body?.to_location_id);
  const movedAtRaw = typeof req.body?.moved_at === 'string' ? req.body.moved_at.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;

  if (!equipmentId || !userId || !toDepartmentId || !toLocationId) {
    return res.status(400).json({ error: 'equipment id, user_id, to_department_id, and to_location_id are required' });
  }

  let movedAt = new Date();
  if (movedAtRaw) {
    const parsed = new Date(movedAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'moved_at must be a valid datetime when provided' });
    }
    movedAt = parsed;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await fetchEquipmentAssetById(client, equipmentId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Equipment asset not found' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.post',
      toDepartmentId,
      ['post', 'approve', 'full']
    );

    if (!access.isAdmin) {
      if (existing.location_id && existing.department_id) {
        await assertUserLocationScopeWhenConfigured(
          client,
          userId,
          Number(existing.department_id),
          Number(existing.location_id),
          ['post', 'approve', 'full'],
          'current location'
        );
      }
      await assertUserLocationScopeWhenConfigured(
        client,
        userId,
        toDepartmentId,
        toLocationId,
        ['post', 'approve', 'full'],
        'to_location_id'
      );
    }

    await assertLocationCanStoreEquipment(client, toLocationId, toDepartmentId, 'to_location_id');

    const movementResult = await client.query(
      `INSERT INTO inv_equipment_location_history (
         equipment_id,
         from_department_id,
         from_location_id,
         to_department_id,
         to_location_id,
         moved_by,
         moved_at,
         reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8)
       RETURNING history_id, moved_at`,
      [
        equipmentId,
        existing.department_id ? Number(existing.department_id) : null,
        existing.location_id ? Number(existing.location_id) : null,
        toDepartmentId,
        toLocationId,
        userId,
        movedAt.toISOString(),
        reason,
      ]
    );

    await client.query(
      `UPDATE inv_equipment_asset
       SET
         department_id = $1,
         location_id = $2,
         updated_at = NOW()
       WHERE equipment_id = $3`,
      [toDepartmentId, toLocationId, equipmentId]
    );

    const updated = await fetchEquipmentAssetById(client, equipmentId);

    await client.query('COMMIT');
    return res.json({
      equipment: updated,
      movement: {
        history_id: movementResult.rows[0]?.history_id || null,
        moved_by: userId,
        moved_at: movementResult.rows[0]?.moved_at || movedAt.toISOString(),
        from_department_id: existing.department_id,
        from_location_id: existing.location_id,
        to_department_id: toDepartmentId,
        to_location_id: toLocationId,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/equipment/assets/:id/move error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/inventory/equipment/assets/:id', apiLimiter, async (req, res) => {
  const equipmentId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const assetCode = req.body?.asset_code === undefined ? undefined : String(req.body.asset_code || '').trim();
  const assetName = req.body?.asset_name === undefined ? undefined : String(req.body.asset_name || '').trim();
  const assetType = req.body?.asset_type === undefined ? undefined : (String(req.body.asset_type || '').trim() || null);
  const serialNumber = req.body?.serial_number === undefined ? undefined : (String(req.body.serial_number || '').trim() || null);
  const supplierId = req.body?.supplier_id === undefined
    ? undefined
    : (req.body?.supplier_id === null ? null : parseNumeric(req.body?.supplier_id));
  const purchaseDate = req.body?.purchase_date === undefined ? undefined : parseDateOrNull(req.body?.purchase_date);
  const purchaseCost = req.body?.purchase_cost === undefined ? undefined : parseNumericOrNull(req.body?.purchase_cost);
  const warrantyStartDate = req.body?.warranty_start_date === undefined ? undefined : parseDateOrNull(req.body?.warranty_start_date);
  const warrantyEndDateInput = req.body?.warranty_end_date === undefined
    ? req.body?.warranty_expiry_date
    : req.body?.warranty_end_date;
  const warrantyEndDate = warrantyEndDateInput === undefined ? undefined : parseDateOrNull(warrantyEndDateInput);
  const invoiceReference = req.body?.invoice_reference === undefined ? undefined : (String(req.body.invoice_reference || '').trim() || null);
  const isActive = req.body?.is_active === undefined ? undefined : parseBooleanLike(req.body?.is_active, true);
  const departmentId = req.body?.department_id === undefined ? undefined : parseNumeric(req.body?.department_id);
  const locationId = req.body?.location_id === undefined
    ? undefined
    : (req.body?.location_id === null ? null : parseNumeric(req.body?.location_id));
  const status = req.body?.status === undefined ? undefined : String(req.body.status || '').trim().toLowerCase();
  const notes = req.body?.notes === undefined ? undefined : (String(req.body.notes || '').trim() || null);

  if (!equipmentId || !userId) {
    return res.status(400).json({ error: 'equipment id and user_id are required' });
  }
  if (assetCode !== undefined && !assetCode) {
    return res.status(400).json({ error: 'asset_code cannot be empty' });
  }
  if (assetName !== undefined && !assetName) {
    return res.status(400).json({ error: 'asset_name cannot be empty' });
  }
  if (req.body?.supplier_id !== undefined && req.body?.supplier_id !== null && !supplierId) {
    return res.status(400).json({ error: 'supplier_id must be a positive number when provided' });
  }
  if (purchaseDate === null && req.body?.purchase_date !== null && req.body?.purchase_date !== undefined) {
    return res.status(400).json({ error: 'purchase_date must be YYYY-MM-DD when provided' });
  }
  if (warrantyStartDate === null && req.body?.warranty_start_date !== null && req.body?.warranty_start_date !== undefined) {
    return res.status(400).json({ error: 'warranty_start_date must be YYYY-MM-DD when provided' });
  }
  if (warrantyEndDate === null && warrantyEndDateInput !== null && warrantyEndDateInput !== undefined) {
    return res.status(400).json({ error: 'warranty_end_date must be YYYY-MM-DD when provided' });
  }
  if (purchaseCost !== undefined && purchaseCost !== null && purchaseCost < 0) {
    return res.status(400).json({ error: 'purchase_cost must be >= 0 when provided' });
  }
  if (status !== undefined && !EQUIPMENT_ASSET_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status is invalid' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await fetchEquipmentAssetById(client, equipmentId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Equipment asset not found' });
    }

    const effectiveDepartmentId = departmentId === undefined
      ? (existing.department_id ? Number(existing.department_id) : null)
      : departmentId;

    if (effectiveDepartmentId) {
      await requirePermissionAndScope(client, userId, 'inv.stock.post', effectiveDepartmentId, ['post', 'approve', 'full']);
    } else {
      await requirePermissionAndScope(client, userId, 'inv.stock.post', null, ['post', 'approve', 'full']);
    }

    if (supplierId !== undefined && supplierId !== null) {
      const supplier = await fetchSupplierById(client, supplierId);
      if (!supplier) {
        throw createHttpError(400, 'supplier_id not found');
      }
      if (supplier.is_active !== true) {
        throw createHttpError(400, 'supplier_id is inactive');
      }
    }

    const effectiveLocationId = locationId === undefined
      ? (existing.location_id ? Number(existing.location_id) : null)
      : locationId;

    if (effectiveLocationId && effectiveDepartmentId) {
      await assertLocationCanStoreEquipment(client, effectiveLocationId, effectiveDepartmentId, 'location_id');
      await assertUserLocationScopeWhenConfigured(
        client,
        userId,
        effectiveDepartmentId,
        effectiveLocationId,
        ['post', 'approve', 'full'],
        'location_id'
      );
    }

    const effectiveWarrantyStart = warrantyStartDate === undefined
      ? (existing.warranty_start_date || null)
      : warrantyStartDate;
    const effectiveWarrantyEnd = warrantyEndDate === undefined
      ? (existing.warranty_expiry_date || null)
      : warrantyEndDate;
    if (effectiveWarrantyStart && effectiveWarrantyEnd && effectiveWarrantyStart > effectiveWarrantyEnd) {
      throw createHttpError(400, 'warranty_end_date must be on or after warranty_start_date');
    }

    await client.query(
      `UPDATE inv_equipment_asset
       SET
         asset_code = COALESCE($1, asset_code),
         asset_name = COALESCE($2, asset_name),
         asset_type = COALESCE($3, asset_type),
         serial_number = COALESCE($4, serial_number),
         supplier_id = COALESCE($5, supplier_id),
         purchase_date = COALESCE($6, purchase_date),
         purchase_cost = COALESCE($7, purchase_cost),
         warranty_start_date = COALESCE($8, warranty_start_date),
         warranty_expiry_date = COALESCE($9, warranty_expiry_date),
         invoice_reference = COALESCE($10, invoice_reference),
         is_active = COALESCE($11, is_active),
         department_id = COALESCE($12, department_id),
         location_id = COALESCE($13, location_id),
         status = COALESCE($14, status),
         notes = COALESCE($15, notes),
         updated_at = NOW()
       WHERE equipment_id = $16`,
      [
        assetCode === undefined ? null : assetCode,
        assetName === undefined ? null : assetName,
        assetType === undefined ? null : assetType,
        serialNumber === undefined ? null : serialNumber,
        supplierId === undefined ? null : supplierId,
        purchaseDate === undefined ? null : purchaseDate,
        purchaseCost === undefined ? null : purchaseCost,
        warrantyStartDate === undefined ? null : warrantyStartDate,
        warrantyEndDate === undefined ? null : warrantyEndDate,
        invoiceReference === undefined ? null : invoiceReference,
        isActive === undefined ? null : isActive,
        departmentId === undefined ? null : departmentId,
        locationId === undefined ? null : locationId,
        status === undefined ? null : status,
        notes === undefined ? null : notes,
        equipmentId,
      ]
    );

    const updated = await fetchEquipmentAssetById(client, equipmentId);
    await client.query('COMMIT');
    return res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'asset_code already exists' });
    }
    console.error('PATCH /api/inventory/equipment/assets/:id error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/equipment/assets/:id/movements', apiLimiter, async (req, res) => {
  const equipmentId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.query.user_id);
  const paging = parseListLimitOffsetAndSort(req, {
    defaultLimit: 100,
    maxLimit: 500,
    defaultSortBy: 'moved_at',
    defaultSortDir: 'desc',
    sortByMap: {
      moved_at: 'm.moved_at',
      moved_by: 'm.moved_by',
      from_department_code: `COALESCE(fd.department_code, '')`,
      to_department_code: `COALESCE(td.department_code, '')`,
      from_location_code: `COALESCE(fl.location_code, '')`,
      to_location_code: `COALESCE(tl.location_code, '')`,
    },
  });

  if (!equipmentId || !userId) {
    return res.status(400).json({ error: 'equipment id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const asset = await fetchEquipmentAssetById(client, equipmentId);
    if (!asset) {
      return res.status(404).json({ error: 'Equipment asset not found' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      null,
      ['view', 'post', 'approve', 'full']
    );

    const where = ['m.equipment_id = $1'];
    const params = [equipmentId];

    if (!access.isAdmin) {
      const scopedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (scopedDepartmentIds.length === 0) {
        return res.json({ equipment: asset, rows: [], data: [], total_count: 0, limit: paging.limit, offset: paging.offset });
      }
      params.push(scopedDepartmentIds);
      where.push(`(
        m.from_department_id = ANY($${params.length}::bigint[])
        OR m.to_department_id = ANY($${params.length}::bigint[])
      )`);
    }

    const fromSql = `
      FROM inv_equipment_location_history m
      LEFT JOIN inv_department fd ON fd.department_id = m.from_department_id
      LEFT JOIN inv_department td ON td.department_id = m.to_department_id
      LEFT JOIN inv_location fl ON fl.location_id = m.from_location_id
      LEFT JOIN inv_location tl ON tl.location_id = m.to_location_id
      LEFT JOIN app_user u ON u.user_id = m.moved_by
      WHERE ${where.join(' AND ')}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total_count ${fromSql}`,
      params
    );

    const dataParams = [...params, paging.limit, paging.offset];
    const result = await client.query(
      `SELECT
         m.history_id,
         m.equipment_id,
         m.from_department_id,
         fd.department_code AS from_department_code,
         fd.department_name AS from_department_name,
         m.from_location_id,
         fl.location_code AS from_location_code,
         fl.location_name AS from_location_name,
         m.to_department_id,
         td.department_code AS to_department_code,
         td.department_name AS to_department_name,
         m.to_location_id,
         tl.location_code AS to_location_code,
         tl.location_name AS to_location_name,
         m.moved_by,
         u.username AS moved_by_username,
         m.moved_at,
         m.reason
       ${fromSql}
       ORDER BY ${paging.orderBySql}, m.history_id DESC
       LIMIT $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      equipment: asset,
      rows: result.rows,
      data: result.rows,
      total_count: Number(countResult.rows[0]?.total_count || 0),
      limit: paging.limit,
      offset: paging.offset,
      sort_by: paging.sortBy,
      sort_dir: paging.sortDir,
    });
  } catch (err) {
    console.error('GET /api/inventory/equipment/assets/:id/movements error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfer-form-options', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const departmentId = parseNumeric(req.query.department_id);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    const access = await requirePermissionAndScope(
      client,
      userId,
      'inv.stock.view',
      departmentId,
      ['view', 'post', 'approve', 'full']
    );

    let allowedDepartmentIds = [];
    if (!access.isAdmin) {
      allowedDepartmentIds = await listScopedDepartmentIds(client, userId, ['view', 'post', 'approve', 'full']);
      if (allowedDepartmentIds.length === 0) {
        return res.json({ departments: [], locations: [] });
      }
    }

    const departmentParams = [];
    const departmentWhere = [`d.is_active = TRUE`];
    if (departmentId) {
      departmentParams.push(departmentId);
      departmentWhere.push(`d.department_id = $${departmentParams.length}`);
    }
    if (!access.isAdmin) {
      departmentParams.push(allowedDepartmentIds);
      departmentWhere.push(`d.department_id = ANY($${departmentParams.length}::bigint[])`);
    }

    const departmentResult = await client.query(
      `SELECT
         d.department_id,
         d.department_code,
         d.department_name,
         d.department_type,
         d.is_active
       FROM inv_department d
       WHERE ${departmentWhere.join(' AND ')}
       ORDER BY d.department_name, d.department_code`,
      departmentParams
    );

    const locationParams = [];
    const locationWhere = [
      `l.is_active = TRUE`,
      `l.availability_status = 'active'`,
      `d.is_active = TRUE`,
    ];
    if (departmentId) {
      locationParams.push(departmentId);
      locationWhere.push(`l.department_id = $${locationParams.length}`);
    }
    if (!access.isAdmin) {
      locationParams.push(allowedDepartmentIds);
      locationWhere.push(`l.department_id = ANY($${locationParams.length}::bigint[])`);
      locationWhere.push(appendLocationScopeClause(locationParams, {
        userId,
        allowedScopes: ['view', 'post', 'approve', 'full'],
        departmentExpr: 'l.department_id',
        locationExpr: 'l.location_id',
      }));
    }

    const locationResult = await client.query(
      `SELECT
         l.location_id,
         l.location_code,
         l.location_name,
         l.department_id,
         d.department_code,
         d.department_name,
         l.location_type,
         l.can_receive_stock,
         l.can_issue_stock,
         l.is_active,
         l.availability_status
       FROM inv_location l
       JOIN inv_department d ON d.department_id = l.department_id
       WHERE ${locationWhere.join(' AND ')}
       ORDER BY d.department_name, l.location_name, l.location_code`,
      locationParams
    );

    return res.json({
      departments: departmentResult.rows,
      locations: locationResult.rows,
    });
  } catch (err) {
    console.error('GET /api/inventory/transfer-form-options error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to load transfer form options' });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers/pending', apiLimiter, async (req, res) => {
  const departmentId = parseNumeric(req.query.department_id);
  const userId = parseNumeric(req.query.user_id);
  if (!departmentId) {
    return res.status(400).json({ error: 'department_id is required' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const client = await pool.connect();
  try {
    const user = await fetchUserById(client, userId);
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Invalid or inactive user' });
    }

    await requirePermissionAndScope(client, userId, 'inv.stock.view', departmentId, ['view', 'post', 'approve', 'full']);

    const pendingParams = [departmentId];
    const locationScopeWhere = appendLocationScopeClause(pendingParams, {
      userId,
      allowedScopes: ['view', 'post', 'approve', 'full'],
      departmentExpr: 'h.target_department_id',
      locationExpr: 'h.target_location_id',
    });

    const result = await client.query(
      `${transferSummaryQuery()}
       WHERE h.target_department_id = $1
         AND h.transfer_status IN ('dispatched', 'partially_received')
         AND ${locationScopeWhere}
       GROUP BY
         h.transfer_id,
         src.department_code,
         src.department_name,
         src_loc.location_code,
         src_loc.location_name,
         tgt.department_code,
         tgt.department_name,
         tgt_loc.location_code,
         tgt_loc.location_name
       ORDER BY
         CASE
           WHEN h.expected_arrival_date IS NOT NULL AND h.expected_arrival_date < CURRENT_DATE THEN 1
           ELSE 0
         END DESC,
         h.expected_arrival_date NULLS LAST,
         h.dispatched_at NULLS LAST,
         h.transfer_id DESC`,
      pendingParams
    );
    return res.json({ data: result.rows });
  } catch (err) {
    console.error('GET /api/inventory/transfers/pending error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers/dashboard/pending', apiLimiter, async (req, res) => {
  const departmentId = parseNumeric(req.query.department_id);
  const userId = parseNumeric(req.query.user_id);
  if (!departmentId || !userId) {
    return res.status(400).json({ error: 'department_id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    await requirePermissionAndScope(client, userId, 'inv.stock.view', departmentId, ['view', 'post', 'approve', 'full']);

    const params = [departmentId];
    const sourceLocationScopeClause = appendLocationScopeClause(params, {
      userId,
      allowedScopes: ['view', 'post', 'approve', 'full'],
      departmentExpr: 'h.source_department_id',
      locationExpr: 'h.source_location_id',
    });
    const targetLocationScopeClause = appendLocationScopeClause(params, {
      userId,
      allowedScopes: ['view', 'post', 'approve', 'full'],
      departmentExpr: 'h.target_department_id',
      locationExpr: 'h.target_location_id',
    });

    const result = await client.query(
      `SELECT
         $1::bigint AS department_id,
         COUNT(*) FILTER (
           WHERE h.transfer_status = 'draft'
             AND h.source_department_id = $1
             AND ${sourceLocationScopeClause}
         )::bigint AS pending_dispatch_count,
         COUNT(*) FILTER (
           WHERE h.transfer_status IN ('dispatched', 'partially_received')
             AND h.target_department_id = $1
             AND ${targetLocationScopeClause}
         )::bigint AS awaiting_receipt_count,
         COUNT(*) FILTER (
           WHERE h.transfer_status = 'partially_received'
             AND h.target_department_id = $1
             AND ${targetLocationScopeClause}
         )::bigint AS partially_received_count,
         COUNT(*) FILTER (
           WHERE h.transfer_status IN ('dispatched', 'partially_received')
             AND h.target_department_id = $1
             AND h.expected_arrival_date IS NOT NULL
             AND h.expected_arrival_date < CURRENT_DATE
             AND ${targetLocationScopeClause}
         )::bigint AS overdue_count,
         MAX(h.dispatched_at) FILTER (
           WHERE h.transfer_status IN ('dispatched', 'partially_received')
             AND h.target_department_id = $1
             AND ${targetLocationScopeClause}
         ) AS latest_dispatch_ts
       FROM inv_transfer_header h
       WHERE (
         (h.source_department_id = $1 AND ${sourceLocationScopeClause})
         OR
         (h.target_department_id = $1 AND ${targetLocationScopeClause})
       )`,
      params
    );

    const row = result.rows[0] || {};
    return res.json({
      department_id: departmentId,
      pending_dispatch_count: Number(row.pending_dispatch_count || 0),
      awaiting_receipt_count: Number(row.awaiting_receipt_count || 0),
      partially_received_count: Number(row.partially_received_count || 0),
      overdue_count: Number(row.overdue_count || 0),
      latest_dispatch_ts: row.latest_dispatch_ts || null,
    });
  } catch (err) {
    console.error('GET /api/inventory/transfers/dashboard/pending error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers/lookup/:transferNumber', apiLimiter, async (req, res) => {
  const userId = parseNumeric(req.query.user_id);
  const transferNumber = String(req.params.transferNumber || '').trim();
  if (!userId || !transferNumber) {
    return res.status(400).json({ error: 'user_id and transfer number are required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `${transferSummaryQuery()}
       WHERE h.transfer_number = $1
       GROUP BY
         h.transfer_id,
         src.department_code,
         src.department_name,
         src_loc.location_code,
         src_loc.location_name,
         tgt.department_code,
         tgt.department_name,
         tgt_loc.location_code,
         tgt_loc.location_name`,
      [transferNumber]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const transfer = result.rows[0];
    await requirePermissionAndScope(client, userId, 'inv.stock.view', Number(transfer.target_department_id), ['view', 'post', 'approve', 'full']);
    await assertUserLocationScopeWhenConfigured(
      client,
      userId,
      Number(transfer.target_department_id),
      transfer.target_location_id ? Number(transfer.target_location_id) : null,
      ['view', 'post', 'approve', 'full'],
      'Transfer target location'
    );
    return res.json(transfer);
  } catch (err) {
    console.error('GET /api/inventory/transfers/lookup/:transferNumber error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers/:id', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.query.user_id);
  if (!transferId || !userId) {
    return res.status(400).json({ error: 'id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const headerResult = await client.query(
      `${transferSummaryQuery()}
       WHERE h.transfer_id = $1
       GROUP BY
         h.transfer_id,
         src.department_code,
         src.department_name,
         src_loc.location_code,
         src_loc.location_name,
         tgt.department_code,
         tgt.department_name,
         tgt_loc.location_code,
         tgt_loc.location_name`,
      [transferId]
    );
    if (headerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const header = headerResult.rows[0];
    const deptId = Number(header.target_department_id);
    await requirePermissionAndScope(client, userId, 'inv.stock.view', deptId, ['view', 'post', 'approve', 'full']);
    await assertUserLocationScopeWhenConfigured(
      client,
      userId,
      deptId,
      header.target_location_id ? Number(header.target_location_id) : null,
      ['view', 'post', 'approve', 'full'],
      'Transfer target location'
    );

    const linesResult = await client.query(
      `SELECT
         l.transfer_line_id,
         l.line_no,
         l.product_id,
         p.sku,
         p.product_name,
         l.uom_id,
         l.requested_qty,
         l.dispatched_qty,
         l.received_qty,
         l.damaged_qty,
         l.lost_qty,
         l.remaining_qty,
         l.unit_cost,
         l.line_notes
       FROM inv_transfer_line l
       JOIN inv_product p ON p.product_id = l.product_id
      WHERE l.transfer_id = $1
      ORDER BY l.line_no`,
      [transferId]
    );

    return res.json({ ...header, lines: linesResult.rows });
  } catch (err) {
    console.error('GET /api/inventory/transfers/:id error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/transfers', apiLimiter, async (req, res) => {
  const {
    user_id,
    source_department_id,
    source_location_id = null,
    target_department_id,
    target_location_id = null,
    notes_sender = null,
    expected_arrival_date = null,
    courier = null,
    transport_method = null,
    tracking_number = null,
    dispatch_reference = null,
    lines = [],
  } = req.body || {};

  const userId = parseNumeric(user_id);
  const sourceDepartmentId = parseNumeric(source_department_id);
  const sourceLocationId = source_location_id === null ? null : parseNumeric(source_location_id);
  const targetDepartmentId = parseNumeric(target_department_id);
  const targetLocationId = target_location_id === null ? null : parseNumeric(target_location_id);
  if (!userId || !sourceDepartmentId || !targetDepartmentId) {
    return res.status(400).json({ error: 'user_id, source_department_id and target_department_id are required' });
  }
  if (source_location_id !== null && !sourceLocationId) {
    return res.status(400).json({ error: 'source_location_id must be a positive number when provided' });
  }
  if (target_location_id !== null && !targetLocationId) {
    return res.status(400).json({ error: 'target_location_id must be a positive number when provided' });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'lines must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'inv.transfer.create', sourceDepartmentId, ['post', 'approve', 'full']);
    await assertUserLocationScopeWhenConfigured(client, userId, sourceDepartmentId, sourceLocationId, ['post', 'approve', 'full'], 'Source location');
    await assertUserLocationScopeWhenConfigured(client, userId, targetDepartmentId, targetLocationId, ['post', 'approve', 'full'], 'Target location');
    await assertLocationCanReceiveStock(client, targetLocationId, targetDepartmentId, 'Target location');

    const createResult = await client.query(
      `SELECT fn_inv_transfer_create_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) AS transfer_id`,
      [
        sourceDepartmentId,
        sourceLocationId,
        targetDepartmentId,
        targetLocationId,
        userId,
        notes_sender,
        expected_arrival_date,
        courier,
        transport_method,
        tracking_number,
        dispatch_reference,
        JSON.stringify(lines),
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ transfer_id: Number(createResult.rows[0].transfer_id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/transfers error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/transfers/:id/dispatch', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const senderConfirmation = req.body?.sender_confirmation === true;
  const notesSender = typeof req.body?.notes_sender === 'string' ? req.body.notes_sender : null;
  if (!transferId || !userId) {
    return res.status(400).json({ error: 'transfer id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const header = await client.query(
      `SELECT source_department_id, source_location_id FROM inv_transfer_header WHERE transfer_id = $1`,
      [transferId]
    );
    if (header.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transfer not found' });
    }
    await requirePermissionAndScope(client, userId, 'inv.transfer.dispatch', Number(header.rows[0].source_department_id), ['post', 'approve', 'full']);
    await assertUserLocationScopeWhenConfigured(
      client,
      userId,
      Number(header.rows[0].source_department_id),
      header.rows[0].source_location_id ? Number(header.rows[0].source_location_id) : null,
      ['post', 'approve', 'full'],
      'Source location'
    );

    await client.query(
      `SELECT fn_inv_transfer_dispatch_v2($1,$2,$3,$4)`,
      [transferId, userId, senderConfirmation, notesSender]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, transfer_id: transferId, status: 'dispatched' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/transfers/:id/dispatch error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/transfers/:id/receive', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const receiverDepartmentId = parseNumeric(req.body?.receiver_department_id);
  const receiverLocationId = req.body?.receiver_location_id == null ? null : parseNumeric(req.body?.receiver_location_id);
  const receiverConfirmation = req.body?.receiver_confirmation === true;
  const notesReceiver = typeof req.body?.notes_receiver === 'string' ? req.body.notes_receiver : null;
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!transferId || !userId || !receiverDepartmentId) {
    return res.status(400).json({ error: 'transfer id, user_id and receiver_department_id are required' });
  }
  if (req.body?.receiver_location_id != null && !receiverLocationId) {
    return res.status(400).json({ error: 'receiver_location_id must be a positive number when provided' });
  }
  if (lines.length === 0) {
    return res.status(400).json({ error: 'lines must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const header = await client.query(
      `SELECT target_department_id, target_location_id FROM inv_transfer_header WHERE transfer_id = $1`,
      [transferId]
    );
    if (header.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const permissionCtx = await requirePermissionAndScope(client, userId, 'inv.transfer.receive', receiverDepartmentId, ['post', 'approve', 'full']);
    const allowOverride = permissionCtx.isAdmin;

    const effectiveReceiveLocationId = receiverLocationId || (header.rows[0].target_location_id ? Number(header.rows[0].target_location_id) : null);

    await assertLocationCanReceiveStock(client, effectiveReceiveLocationId, receiverDepartmentId, 'Receiver location');
    await assertUserLocationScopeWhenConfigured(client, userId, receiverDepartmentId, effectiveReceiveLocationId, ['post', 'approve', 'full'], 'Receiver location');

    const receiveResult = await client.query(
      `SELECT fn_inv_transfer_receive_v2($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS status`,
      [
        transferId,
        userId,
        receiverDepartmentId,
        receiverLocationId,
        allowOverride,
        receiverConfirmation,
        notesReceiver,
        JSON.stringify(lines),
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, transfer_id: transferId, status: receiveResult.rows[0].status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/transfers/:id/receive error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/transfers/:id/cancel', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const cancelReason = typeof req.body?.cancel_reason === 'string' ? req.body.cancel_reason : null;
  if (!transferId || !userId) {
    return res.status(400).json({ error: 'transfer id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const header = await client.query(
      `SELECT source_department_id FROM inv_transfer_header WHERE transfer_id = $1`,
      [transferId]
    );
    if (header.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transfer not found' });
    }
    await requirePermissionAndScope(client, userId, 'inv.transfer.cancel', Number(header.rows[0].source_department_id), ['approve', 'full']);

    await client.query(`SELECT fn_inv_transfer_cancel_v1($1,$2,$3)`, [transferId, userId, cancelReason]);
    await client.query('COMMIT');
    return res.json({ ok: true, transfer_id: transferId, status: 'cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/transfers/:id/cancel error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/inventory/transfers/:id/reverse', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.body?.user_id);
  const notesSender = typeof req.body?.notes_sender === 'string' ? req.body.notes_sender : null;
  if (!transferId || !userId) {
    return res.status(400).json({ error: 'transfer id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePermissionAndScope(client, userId, 'inv.transfer.reverse', null, []);

    const reverseResult = await client.query(
      `SELECT fn_inv_transfer_reverse_v1($1,$2,$3) AS reverse_transfer_id`,
      [transferId, userId, notesSender]
    );

    await client.query('COMMIT');
    return res.status(201).json({ reverse_transfer_id: Number(reverseResult.rows[0].reverse_transfer_id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/transfers/:id/reverse error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/inventory/transfers/:id/print', apiLimiter, async (req, res) => {
  const transferId = parseNumeric(req.params.id);
  const userId = parseNumeric(req.query.user_id);
  if (!transferId || !userId) {
    return res.status(400).json({ error: 'transfer id and user_id are required' });
  }

  const client = await pool.connect();
  try {
    const header = await client.query(
      `${transferSummaryQuery()}
       WHERE h.transfer_id = $1
       GROUP BY
         h.transfer_id,
         src.department_code,
         src.department_name,
         src_loc.location_code,
         src_loc.location_name,
         tgt.department_code,
         tgt.department_name,
         tgt_loc.location_code,
         tgt_loc.location_name`,
      [transferId]
    );
    if (header.rows.length === 0) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const h = header.rows[0];
    await requirePermissionAndScope(client, userId, 'inv.stock.view', Number(h.target_department_id), ['view', 'post', 'approve', 'full']);

    const actorInfo = await client.query(
      `SELECT
         created_user.username AS created_by_username,
         dispatched_user.username AS dispatched_by_username,
         received_user.username AS received_by_username
       FROM inv_transfer_header th
       LEFT JOIN app_user created_user ON created_user.user_id = th.created_by
       LEFT JOIN app_user dispatched_user ON dispatched_user.user_id = th.dispatched_by
       LEFT JOIN app_user received_user ON received_user.user_id = th.received_by
      WHERE th.transfer_id = $1`,
      [transferId]
    );

    const actorRow = actorInfo.rows[0] || {};

    const lines = await client.query(
      `SELECT l.line_no, p.sku, p.product_name, l.requested_qty, l.dispatched_qty, l.received_qty, l.remaining_qty
         FROM inv_transfer_line l
         JOIN inv_product p ON p.product_id = l.product_id
        WHERE l.transfer_id = $1
        ORDER BY l.line_no`,
      [transferId]
    );

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const formatLocationLabel = (code, name) => {
      const safeCode = String(code || '').trim();
      const safeName = String(name || '').trim();
      if (safeCode && safeName) return `${safeCode} - ${safeName}`;
      return safeCode || safeName || 'Department-level / Unspecified location';
    };

    const sourceLocationLabel = formatLocationLabel(h.source_location_code, h.source_location_name);
    const targetLocationLabel = formatLocationLabel(h.target_location_code, h.target_location_name);

    const lineHtml = lines.rows.map((line) => `
      <tr>
        <td>${escapeHtml(line.line_no)}</td>
        <td>${escapeHtml(line.sku)}</td>
        <td>${escapeHtml(line.product_name)}</td>
        <td>${escapeHtml(line.requested_qty)}</td>
        <td>${escapeHtml(line.dispatched_qty)}</td>
        <td>${escapeHtml(line.received_qty)}</td>
        <td>${escapeHtml(line.remaining_qty)}</td>
      </tr>`).join('');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Transfer Note ${h.transfer_number}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        color: #111;
        font-size: 11px;
        line-height: 1.25;
      }
      h1 {
        margin: 0 0 6px 0;
        font-size: 18px;
        line-height: 1.15;
      }
      .muted { color: #444; }
      .header-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 10px;
        margin-bottom: 8px;
      }
      .route-banner {
        border: 2px solid #222;
        padding: 6px 8px;
        margin-bottom: 8px;
        break-inside: avoid;
      }
      .route-title {
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 3px;
        letter-spacing: 0.2px;
      }
      .route-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px 14px;
      }
      .route-grid div { font-size: 11px; }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 2px 14px;
        margin-bottom: 8px;
      }
      .meta-grid div { font-size: 11px; }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th,
      td {
        border: 1px solid #808080;
        padding: 4px 5px;
        font-size: 10.5px;
        vertical-align: top;
      }
      th {
        background: #e9e9e9;
        color: #111;
        font-weight: 700;
      }
      .col-line { width: 6%; }
      .col-sku { width: 16%; }
      .col-product { width: 36%; }
      .col-qty { width: 10.5%; }
      tbody tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      td { word-break: break-word; }
      .sign {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        break-inside: avoid;
      }
      .box {
        border: 1px solid #777;
        min-height: 80px;
        padding: 6px 8px;
      }
      .sig-title { font-weight: 700; margin-bottom: 6px; font-size: 11px; }
      .sig-line {
        margin-top: 14px;
        border-top: 1px solid #222;
        padding-top: 3px;
        font-size: 10px;
      }
      @media print {
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        tr, td, th { page-break-inside: avoid; }
        .route-banner, .box, .sign { break-inside: avoid; page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="header-row">
      <h1>Transfer Note: ${escapeHtml(h.transfer_number)}</h1>
      <div class="muted"><strong>Status:</strong> ${escapeHtml(h.transfer_status)}</div>
    </div>
    <div class="route-banner">
      <div class="route-title">Source and Target</div>
      <div class="route-grid">
        <div><strong>Source Dept:</strong> ${escapeHtml(`${h.source_department_code} - ${h.source_department_name}`)}</div>
        <div><strong>Target Dept:</strong> ${escapeHtml(`${h.target_department_code} - ${h.target_department_name}`)}</div>
        <div><strong>Source Location:</strong> ${escapeHtml(sourceLocationLabel)}</div>
        <div><strong>Target Location:</strong> ${escapeHtml(targetLocationLabel)}</div>
      </div>
    </div>
    <div class="meta-grid">
      <div><strong>Transfer Number:</strong> ${escapeHtml(h.transfer_number)}</div>
      <div><strong>Expected Arrival:</strong> ${escapeHtml(h.expected_arrival_date || '-')}</div>

      <div><strong>Sender:</strong> ${escapeHtml(actorRow.dispatched_by_username || actorRow.created_by_username || '-')}</div>
      <div><strong>Dispatch Timestamp:</strong> ${escapeHtml(h.dispatched_at || '-')}</div>

      <div><strong>Receiver:</strong> ${escapeHtml(actorRow.received_by_username || '-')}</div>
      <div><strong>Receive Timestamp:</strong> ${escapeHtml(h.received_at || '-')}</div>

      <div><strong>Courier:</strong> ${escapeHtml(h.courier || '-')}</div>
      <div><strong>Transport:</strong> ${escapeHtml(h.transport_method || '-')}</div>

      <div><strong>Tracking:</strong> ${escapeHtml(h.tracking_number || '-')}</div>
      <div><strong>Dispatch Reference:</strong> ${escapeHtml(h.dispatch_reference || '-')}</div>
    </div>
    <table>
      <colgroup>
        <col class="col-line" />
        <col class="col-sku" />
        <col class="col-product" />
        <col class="col-qty" />
        <col class="col-qty" />
        <col class="col-qty" />
        <col class="col-qty" />
      </colgroup>
      <thead>
        <tr><th>#</th><th>SKU</th><th>Product</th><th>Requested</th><th>Dispatched</th><th>Received</th><th>Remaining</th></tr>
      </thead>
      <tbody>${lineHtml}</tbody>
    </table>
    <div class="sign">
      <div class="box">
        <div class="sig-title">Sender Sign-off</div>
        <div>Name: ${escapeHtml(actorRow.dispatched_by_username || actorRow.created_by_username || '')}</div>
        <div>Dispatch Time: ${escapeHtml(h.dispatched_at || '')}</div>
        <div class="sig-line">Signature</div>
      </div>
      <div class="box">
        <div class="sig-title">Receiver Sign-off</div>
        <div>Name: ${escapeHtml(actorRow.received_by_username || '')}</div>
        <div>Receive Time: ${escapeHtml(h.received_at || '')}</div>
        <div class="sig-line">Signature</div>
      </div>
    </div>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('GET /api/inventory/transfers/:id/print error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

registerInventoryPhase2Routes({
  app,
  pool,
  apiLimiter,
  helpers: {
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
  },
});

// ─── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  if (!process.env.DASHBOARD_USER || !process.env.DASHBOARD_PASSWORD) {
    console.error('FATAL: DASHBOARD_USER and DASHBOARD_PASSWORD must be set in .env before the dashboard will accept logins.');
  }
  console.log(`HR Dashboard running on http://localhost:${PORT}`);
});

module.exports = app;
