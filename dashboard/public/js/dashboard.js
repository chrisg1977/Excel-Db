/* ─── dashboard.js ──────────────────────────────────────────────────────────── *
 * Handles: tab navigation, filter buttons, employee table rendering,
 *          pagination, print audit, and navigation to employee-detail.
 * ─────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ────────────────────────────────────────────────────────────────── */
  const state = {
    tab: 'current',
    status: 'CURRENT',
    type: '',
    nationality: '',
    page: 1,
    limit: 20,
    totalPages: 1,
    total: 0,
    employees: [],
  };

  /* ── DOM refs ─────────────────────────────────────────────────────────────── */
  const empBody     = document.getElementById('empBody');
  const pgControls  = document.getElementById('pgControls');
  const pgInfo      = document.getElementById('pgInfo');
  const headerDate  = document.getElementById('headerDate');

  /* ── Initialise ───────────────────────────────────────────────────────────── */
  headerDate.textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  /* ── Utility: build query string ──────────────────────────────────────────── */
  function buildQuery() {
    const p = new URLSearchParams();
    p.set('tab',   state.tab);
    p.set('page',  String(state.page));
    p.set('limit', String(state.limit));
    if (state.status)      p.set('status',      state.status);
    if (state.type)        p.set('type',         state.type);
    if (state.nationality) p.set('nat_cat', state.nationality);
    return p.toString();
  }

  /* ── Fetch employees ──────────────────────────────────────────────────────── */
  async function loadEmployees() {
    setLoading(true);
    try {
      const res = await fetch('/api/employees?' + buildQuery());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      state.employees   = json.data || [];
      state.total       = json.pagination.total;
      state.totalPages  = json.pagination.pages;
      state.page        = json.pagination.page;
      renderTable(state.employees);
      renderPagination();
      // Persist list for employee-detail PREV/NEXT
      sessionStorage.setItem('empList', JSON.stringify(state.employees.map(e => e.id || e.employee_id)));
    } catch (err) {
      showError(err.message);
    }
  }

  /* ── Render table rows ────────────────────────────────────────────────────── */
  function renderTable(rows) {
    if (!rows.length) {
      empBody.innerHTML = '<tr class="state-row"><td colspan="7">No employees found for the selected filters.</td></tr>';
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach(emp => {
      const tr = document.createElement('tr');

      // Background tint from DB hex color
      const hex = emp.row_color_hex;
      if (hex) {
        tr.style.backgroundColor = hexToRgba(hex, 0.12);
      }

      const id        = emp.id || emp.employee_id || '';
      const surname   = esc(emp.surname        || '');
      const firstName = esc(emp.first_name     || '');
      const position  = esc(emp.designation    || emp.position || '');
      const phone     = esc(emp.telephone      || emp.tax_id || '');
      const status    = emp.employment_status  || '';

      tr.innerHTML = `
        <td>${esc(String(id))}</td>
        <td><strong>${surname}</strong></td>
        <td>${firstName}</td>
        <td>${position}</td>
        <td>${phone}</td>
        <td><span class="pill ${status === 'CURRENT' ? 'pill-current' : 'pill-term'}">${esc(status)}</span></td>
        <td><button class="btn-edit" data-id="${esc(String(id))}">EDIT</button></td>
      `;

      // Row click → detail (excluding edit button itself)
      tr.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-edit')) return;
        goToDetail(id);
      });

      // Edit button
      tr.querySelector('.btn-edit').addEventListener('click', () => goToDetail(id));

      frag.appendChild(tr);
    });

    empBody.innerHTML = '';
    empBody.appendChild(frag);
  }

  function goToDetail(id) {
    window.location.href = `/views/employee-detail.html?id=${encodeURIComponent(id)}`;
  }

  /* ── Pagination ───────────────────────────────────────────────────────────── */
  function renderPagination() {
    const start = (state.page - 1) * state.limit + 1;
    const end   = Math.min(state.page * state.limit, state.total);
    pgInfo.textContent = state.total > 0
      ? `Showing ${start}–${end} of ${state.total} employees`
      : 'No employees';

    pgControls.innerHTML = '';

    const prevBtn = makePgBtn('‹', state.page <= 1, () => { state.page--; loadEmployees(); });
    pgControls.appendChild(prevBtn);

    // Window of up to 7 page buttons
    const winSize  = 7;
    let   winStart = Math.max(1, state.page - Math.floor(winSize / 2));
    const winEnd   = Math.min(state.totalPages, winStart + winSize - 1);
    if (winEnd - winStart < winSize - 1) winStart = Math.max(1, winEnd - winSize + 1);

    for (let p = winStart; p <= winEnd; p++) {
      const btn = makePgBtn(String(p), false, () => { state.page = p; loadEmployees(); });
      if (p === state.page) btn.classList.add('active');
      pgControls.appendChild(btn);
    }

    const nextBtn = makePgBtn('›', state.page >= state.totalPages, () => { state.page++; loadEmployees(); });
    pgControls.appendChild(nextBtn);
  }

  function makePgBtn(label, disabled, onClick) {
    const btn = document.createElement('button');
    btn.className  = 'pg-btn';
    btn.textContent = label;
    btn.disabled   = disabled;
    if (!disabled) btn.addEventListener('click', onClick);
    return btn;
  }

  /* ── Loading / error states ───────────────────────────────────────────────── */
  function setLoading(on) {
    if (on) {
      empBody.innerHTML = '<tr class="state-row"><td colspan="7"><span class="spinner"></span> Loading…</td></tr>';
      pgControls.innerHTML = '';
      pgInfo.textContent   = '';
    }
  }

  function showError(msg) {
    empBody.innerHTML = `<tr class="state-row"><td colspan="7">⚠️ Error: ${esc(msg)}</td></tr>`;
  }

  /* ── Tab handlers ─────────────────────────────────────────────────────────── */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      state.tab  = tab.dataset.tab;
      state.page = 1;

      // Sync status filter button to match tab defaults
      if (state.tab === 'current' || state.tab === 'ft') {
        setFilterActive('status', 'CURRENT');
        state.status = 'CURRENT';
      } else if (state.tab === 'dentists') {
        setFilterActive('status', 'CURRENT');
        state.status = 'CURRENT';
      }

      loadEmployees();
    });
  });

  /* ── Filter button handlers ───────────────────────────────────────────────── */
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      const val    = btn.dataset.val;

      // Deactivate siblings in same group
      btn.closest('.filter-group').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state[filter] = val;
      state.page    = 1;
      loadEmployees();
    });
  });

  function setFilterActive(filterName, val) {
    document.querySelectorAll(`.filter-btn[data-filter="${filterName}"]`).forEach(b => {
      b.classList.toggle('active', b.dataset.val === val);
    });
  }

  /* ── Print ────────────────────────────────────────────────────────────────── */
  document.getElementById('btnPrint').addEventListener('click', async () => {
    try {
      await fetch('/api/print-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ print_type: 'EMPLOYEE_LIST', printed_by: 'dashboard' }),
      });
    } catch {
      // Non-fatal
    }
    window.print();
  });

  /* ── NEW ──────────────────────────────────────────────────────────────────── */
  document.getElementById('btnNew').addEventListener('click', () => {
    window.location.href = '/views/employee-detail.html?new=true';
  });

  /* ── Helpers ──────────────────────────────────────────────────────────────── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hexToRgba(hex, alpha) {
    // Strict validation: only accept #RGB or #RRGGBB format
    if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) return '';
    let clean = hex.slice(1);
    if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ── Bootstrap ────────────────────────────────────────────────────────────── */
  loadEmployees();

}());
