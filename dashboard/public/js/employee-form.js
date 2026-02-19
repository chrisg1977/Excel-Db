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

  /* ── State ────────────────────────────────────────────────────────────────── */
  let originalData   = null;
  let empList        = [];   // Array of IDs from sessionStorage
  let currentIndex   = -1;

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
    } catch (err) {
      showToast(`Failed to load employee: ${err.message}`, 6000);
    }
  }

  /* ── Populate form ────────────────────────────────────────────────────────── */
  function populateForm(data) {
    const id = data.id || data.employee_id || employeeId || '—';
    hdrEmpId.textContent = id;
    document.title = `EMPINFO – ${data.surname || ''}, ${data.first_name || ''}`;

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

}());
