'use strict';

require('dotenv').config();

const express    = require('express');
const { Pool }   = require('pg');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

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

  next();
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

// ─── HTML views ───────────────────────────────────────────────────────────────
app.get('/', viewLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/views/employee-detail.html', viewLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'employee-detail.html'));
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
