/* ─── employee-form.js ──────────────────────────────────────────────────────── *
 * Handles: load employee by ?id=, populate form fields, edit/save/cancel,
 *          PREV/NEXT navigation via sessionStorage list, print audit.
 * ─────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Parse URL params ─────────────────────────────────────────────────────── */
  const params     = new URLSearchParams(window.location.search);
  const employeeId = params.get('id');
  const isNew      = params.get('new') === 'true';

  /* ── DOM refs ─────────────────────────────────────────────────────────────── */
  const hdrEmpId    = document.getElementById('hdrEmpId');
  const hdrYear     = document.getElementById('hdrYear');
  const statusBadge = document.getElementById('statusBadge');
  const periodFrom  = document.getElementById('periodFrom');
  const periodTo    = document.getElementById('periodTo');

  const fields = {
    surname:     document.getElementById('fSurname'),
    first_name:  document.getElementById('fFirstName'),
    address:     document.getElementById('fAddress'),
    telephone:   document.getElementById('fTelephone'),
    id_card:     document.getElementById('fIdCard'),
    soc_sec:     document.getElementById('fSocSec'),
    spouse_id:   document.getElementById('fSpouseId'),
    iban:        document.getElementById('fIban'),
    email:       document.getElementById('fEmail'),
    dob:         document.getElementById('fDob'),
    first_emp:   document.getElementById('fFirstEmp'),
    designation: document.getElementById('fDesignation'),
    ft_pt:       document.getElementById('fFtPt'),
    fs4:         document.getElementById('fFs4'),
    hours:       document.getElementById('fHours'),
    term_date:   document.getElementById('fTermDate'),
  };

  const vlBalance = document.getElementById('vlBalance');
  const slBalance = document.getElementById('slBalance');

  const btnEditDetails = document.getElementById('btnEditDetails');
  const btnSave        = document.getElementById('btnSave');
  const btnCancel      = document.getElementById('btnCancel');
  const btnPrev        = document.getElementById('btnPrev');
  const btnNext        = document.getElementById('btnNext');
  const btnPayroll     = document.getElementById('btnPayroll');
  const btnWeeklyHours = document.getElementById('btnWeeklyHours');
  const btnTerminate   = document.getElementById('btnTerminate');
  const btnContract    = document.getElementById('btnContract');
  const toast          = document.getElementById('toast');
  const permInventoryEnabled = document.getElementById('permInventoryEnabled');
  const permSellEnabled = document.getElementById('permSellEnabled');
  const permApproveSensitive = document.getElementById('permApproveSensitive');
  const permOverrideDept = document.getElementById('permOverrideDept');
  const permEffectiveFrom = document.getElementById('permEffectiveFrom');
  const permInactiveFrom = document.getElementById('permInactiveFrom');
  const departmentScopeContainer = document.getElementById('departmentScopeContainer');
  const btnSaveInventoryAccess = document.getElementById('btnSaveInventoryAccess');

  /* ── State ────────────────────────────────────────────────────────────────── */
  let originalData   = null;
  let empList        = [];   // Array of IDs from sessionStorage
  let currentIndex   = -1;
  let inventoryAccessPayload = null;

  /* ── Initialise ───────────────────────────────────────────────────────────── */
  hdrYear.textContent = new Date().getFullYear();

  try {
    const stored = sessionStorage.getItem('empList');
    if (stored) empList = JSON.parse(stored);
  } catch { empList = []; }

  if (isNew) {
    initNewEmployee();
  } else if (employeeId) {
    loadEmployee(employeeId);
  } else {
    showToast('No employee ID provided.', 4000);
  }

  /* ── Load employee from API ───────────────────────────────────────────────── */
  async function loadEmployee(id) {
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(id)}`);
      if (res.status === 404) { showToast('Employee not found.', 5000); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      originalData = data;
      populateForm(data);
      updateNavButtons(id);
      await loadInventoryAccess(id);
    } catch (err) {
      showToast(`Failed to load employee: ${err.message}`, 6000);
    }
  }

  async function loadInventoryAccess(id) {
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(id)}/inventory-access`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      inventoryAccessPayload = payload;
      renderInventoryAccess(payload);
    } catch (err) {
      showToast(`Failed to load inventory access: ${err.message}`, 6000);
    }
  }

  function toDateInput(value) {
    if (!value) return '';
    return String(value).slice(0, 10);
  }

  function renderInventoryAccess(payload) {
    const access = payload.access || {};
    permInventoryEnabled.checked = access.inventory_access_enabled === true;
    permSellEnabled.checked = access.sell_access_enabled === true;
    permApproveSensitive.checked = access.can_approve_sensitive === true;
    permOverrideDept.checked = access.can_override_department_scope === true;
    permEffectiveFrom.value = toDateInput(access.effective_from);
    permInactiveFrom.value = toDateInput(access.inactive_from);

    const departments = Array.isArray(payload.department_scopes) ? payload.department_scopes : [];
    const locations = Array.isArray(payload.locations) ? payload.locations : [];

    const locationByDepartment = new Map();
    locations.forEach((location) => {
      const departmentId = Number(location.department_id || 0);
      if (!departmentId) return;
      if (!locationByDepartment.has(departmentId)) {
        locationByDepartment.set(departmentId, []);
      }
      locationByDepartment.get(departmentId).push(location);
    });

    const rowsHtml = departments.map((scope) => {
      const departmentId = Number(scope.department_id || 0);
      const selected = new Set((scope.selected_location_ids || []).map((id) => Number(id)));
      const options = (locationByDepartment.get(departmentId) || []).map((location) => {
        const id = Number(location.location_id || 0);
        const selectedAttr = selected.has(id) ? ' selected' : '';
        return `<option value="${id}"${selectedAttr}>${esc(location.location_code || '')} - ${esc(location.location_name || '')}</option>`;
      }).join('');
      const mode = String(scope.location_mode || 'all').toLowerCase() === 'selected' ? 'selected' : 'all';
      const disabledAttr = mode === 'selected' ? '' : ' disabled';
      return `
        <tr class="scope-row" data-department-id="${departmentId}">
          <td>${esc(scope.department_code || '')} - ${esc(scope.department_name || '')}</td>
          <td>
            <select class="scope-level">
              <option value="none"${scope.scope_level === 'none' ? ' selected' : ''}>none</option>
              <option value="view"${scope.scope_level === 'view' ? ' selected' : ''}>view</option>
              <option value="post"${scope.scope_level === 'post' ? ' selected' : ''}>post</option>
              <option value="approve"${scope.scope_level === 'approve' ? ' selected' : ''}>approve</option>
              <option value="full"${scope.scope_level === 'full' ? ' selected' : ''}>full</option>
            </select>
          </td>
          <td>
            <select class="scope-mode">
              <option value="all"${mode === 'all' ? ' selected' : ''}>all locations</option>
              <option value="selected"${mode === 'selected' ? ' selected' : ''}>selected only</option>
            </select>
          </td>
          <td>
            <select class="scope-locations" multiple${disabledAttr}>${options}</select>
          </td>
        </tr>`;
    }).join('');

    departmentScopeContainer.innerHTML = `
      <table class="scope-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Scope</th>
            <th>Location access</th>
            <th>Selected locations</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;

    departmentScopeContainer.querySelectorAll('.scope-mode').forEach((select) => {
      select.addEventListener('change', () => {
        const row = select.closest('.scope-row');
        if (!row) return;
        const locationsSelect = row.querySelector('.scope-locations');
        if (!locationsSelect) return;
        const isSelectedMode = select.value === 'selected';
        locationsSelect.disabled = !isSelectedMode;
      });
    });
  }

  async function saveInventoryAccess() {
    if (!employeeId || !inventoryAccessPayload) {
      showToast('Employee context not loaded.', 4000);
      return;
    }

    const departmentScopes = Array.from(departmentScopeContainer.querySelectorAll('.scope-row')).map((row) => {
      const departmentId = Number(row.dataset.departmentId || 0);
      const scopeLevelEl = row.querySelector('.scope-level');
      const scopeModeEl = row.querySelector('.scope-mode');
      const locationsEl = row.querySelector('.scope-locations');

      const selectedLocationIds = locationsEl
        ? Array.from(locationsEl.selectedOptions).map((option) => Number(option.value)).filter((id) => Number.isFinite(id) && id > 0)
        : [];

      return {
        department_id: departmentId,
        scope_level: scopeLevelEl ? scopeLevelEl.value : 'none',
        location_mode: scopeModeEl ? scopeModeEl.value : 'all',
        selected_location_ids: selectedLocationIds,
      };
    });

    const updatedByUserId = Number(window.localStorage.getItem('eos.inventory.userId') || '1') || 1;
    const payload = {
      updated_by_user_id: updatedByUserId,
      access: {
        inventory_access_enabled: permInventoryEnabled.checked,
        sell_access_enabled: permSellEnabled.checked,
        can_approve_sensitive: permApproveSensitive.checked,
        can_override_department_scope: permOverrideDept.checked,
        effective_from: permEffectiveFrom.value || null,
        inactive_from: permInactiveFrom.value || null,
      },
      department_scopes: departmentScopes,
    };

    const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/inventory-access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    await loadInventoryAccess(employeeId);
  }

  /* ── Populate form ────────────────────────────────────────────────────────── */
  function populateForm(data) {
    const id = data.id || data.employee_id || employeeId || '—';
    hdrEmpId.textContent = id;
    document.title = `EMPINFO – ${esc(data.surname || '')}, ${esc(data.first_name || '')}`;

    const status = (data.employment_status || 'CURRENT').toUpperCase();
    statusBadge.textContent = status === 'CURRENT' ? 'ACTIVE' : status;
    statusBadge.className   = 'status-badge ' + (status === 'CURRENT' ? 'badge-active' : 'badge-terminated');

    periodFrom.textContent = fmtDate(data.date_of_first_employment);
    periodTo.textContent   = fmtDate(data.date_of_termination) || 'Present';

    // Personal / employment fields
    setField('surname',     data.surname);
    setField('first_name',  data.first_name);
    setField('address',     data.address || data.address_line1);
    setField('telephone',   data.telephone || data.phone);
    setField('id_card',     data.id_card_no || data.id_card);
    setField('soc_sec',     data.social_security_no);
    setField('spouse_id',   data.spouse_id_card);
    setField('iban',        data.iban);
    setField('email',       data.email);
    setField('dob',         fmtDate(data.date_of_birth || data.dob));
    setField('first_emp',   fmtDate(data.date_of_first_employment));
    setField('designation', data.designation);
    setField('ft_pt',       data.employment_type);
    setField('fs4',         data.fs4_status);
    setField('hours',       data.contracted_hours != null ? String(data.contracted_hours) : '');
    setField('term_date',   fmtDate(data.date_of_termination));

    // Balances — if provided by API
    vlBalance.value = data.vl_balance != null ? String(data.vl_balance) : '—';
    slBalance.value = data.sl_balance != null ? String(data.sl_balance) : '—';
  }

  function setField(key, val) {
    if (fields[key]) fields[key].value = val != null ? String(val) : '';
  }

  /* ── New employee mode ────────────────────────────────────────────────────── */
  function initNewEmployee() {
    hdrEmpId.textContent = 'NEW';
    document.title = 'EMPINFO – New Employee';
    statusBadge.textContent = 'NEW';
    statusBadge.className   = 'status-badge badge-active';
    enableEdit();
    showToast('Fill in details for a new employee.', 4000);
  }

  /* ── Edit / Save / Cancel ─────────────────────────────────────────────────── */
  function enableEdit() {
    Object.values(fields).forEach(f => f.removeAttribute('readonly'));
    btnEditDetails.classList.add('hidden');
    btnSave.classList.remove('hidden');
    btnCancel.classList.remove('hidden');
  }

  function disableEdit() {
    Object.values(fields).forEach(f => f.setAttribute('readonly', ''));
    btnEditDetails.classList.remove('hidden');
    btnSave.classList.add('hidden');
    btnCancel.classList.add('hidden');
  }

  btnEditDetails.addEventListener('click', enableEdit);

  btnCancel.addEventListener('click', () => {
    if (originalData) populateForm(originalData);
    disableEdit();
  });

  btnSave.addEventListener('click', async () => {
    if (isNew) {
      showToast('Save feature coming soon — new employee creation not yet implemented.', 4000);
      return;
    }
    // Stub: real implementation would PUT /api/employees/:id
    showToast('Save feature coming soon.', 3000);
    disableEdit();
  });

  if (btnSaveInventoryAccess) {
    btnSaveInventoryAccess.addEventListener('click', async () => {
      try {
        await saveInventoryAccess();
        showToast('Inventory access wiring saved.', 3500);
      } catch (err) {
        showToast(`Save inventory access failed: ${err.message}`, 6000);
      }
    });
  }

  /* ── Action buttons ───────────────────────────────────────────────────────── */
  btnWeeklyHours.addEventListener('click', () => showToast('Weekly Hours feature coming soon.', 3000));
  btnPayroll.addEventListener('click',     () => showToast('Payroll feature coming soon.',     3000));
  btnTerminate.addEventListener('click',   () => showToast('Terminate / Change Status feature coming soon.', 3000));
  btnContract.addEventListener('click',    () => showToast('Contract feature coming soon.',   3000));

  document.getElementById('imgPlaceholder').addEventListener('click', () =>
    showToast('Image upload feature coming soon.', 3000)
  );

  /* ── PREV / NEXT navigation ───────────────────────────────────────────────── */
  function updateNavButtons(id) {
    const strId = String(id);
    currentIndex = empList.findIndex(e => String(e) === strId);
    btnPrev.disabled = currentIndex <= 0;
    btnNext.disabled = currentIndex === -1 || currentIndex >= empList.length - 1;
  }

  btnPrev.addEventListener('click', () => {
    if (currentIndex > 0) {
      const prevId = empList[currentIndex - 1];
      window.location.href = `/views/employee-detail.html?id=${encodeURIComponent(prevId)}`;
    }
  });

  btnNext.addEventListener('click', () => {
    if (currentIndex >= 0 && currentIndex < empList.length - 1) {
      const nextId = empList[currentIndex + 1];
      window.location.href = `/views/employee-detail.html?id=${encodeURIComponent(nextId)}`;
    }
  });

  /* ── Print audit ──────────────────────────────────────────────────────────── */
  window.addEventListener('beforeprint', async () => {
    try {
      await fetch('/api/print-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId || null,
          print_type:  'EMPLOYEE_DETAIL',
          printed_by:  'dashboard',
        }),
      });
    } catch { /* Non-fatal */ }
  });

  /* ── Helpers ──────────────────────────────────────────────────────────────── */
  function fmtDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-GB');
  }

  let toastTimer = null;
  function showToast(msg, duration) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), duration || 3000);
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

}());
