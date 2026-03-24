
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // INITIALIZATION & STATE MANAGEMENT
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  let isEditMode = false;
  let isModified = false;
  let isExistingEmployee = false;
  let currentEmployeeId = null;
  let currentPayrollDetail = null;

  const PAYROLL_DETAIL_STORAGE_KEY = 'empinfo.payrollDetail.v1';
  const PAYROLL_ADMIN_ALLOWLIST = ['chrisg1977'];
  const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
  const pageParams = new URLSearchParams(window.location.search);
  const apiOriginFromQuery = pageParams.get('api_origin');
  const requestedOpenMode = String(pageParams.get('mode') || '').trim().toLowerCase();
  const openInEditMode = requestedOpenMode === 'edit';
  const DEFAULT_API_ORIGIN = window.location.port === '8055' ? window.location.origin : 'http://localhost:8055';
  const API_ORIGIN = (apiOriginFromQuery || DEFAULT_API_ORIGIN).replace(/\/$/, '');
  const EMPLOYEE_FORM_ENDPOINT_BASE = `${API_ORIGIN}/employee-form`;
  const EMPLOYEE_FORM_API_BASE = `${EMPLOYEE_FORM_ENDPOINT_BASE}/payroll/employee-form`;
  const EMPLOYEE_FORM_LOOKUPS_API = `${EMPLOYEE_FORM_ENDPOINT_BASE}/payroll/employee-form/lookups`;
  const PERMISSION_LEVELS = ['General User', 'Management', 'HR', 'Full'];
  const PERMISSION_LEVEL_RANK = {
    'General User': 1,
    'Management': 2,
    'HR': 3,
    'Full': 4
  };
  let useApiData = false;
  let apiEmployeeIndex = [];
  let userPermissionLevelCap = 'General User';
  let loadedEmployeePermissionLevel = 'General User';
  let pendingGeneralFiles = [];
  let pendingTerminationFiles = [];
  let pendingPhotoFile = null;
  const providerDesignationSet = new Set();

  const REQUIRED_DOC_DEFINITIONS = [
    { key: 'id_card_front', label: 'ID Card Front' },
    { key: 'id_card_back', label: 'ID Card Back' },
    { key: 'passport_other', label: 'Passport/ Other' },
    { key: 'driving_license_front', label: 'Driving License Front' },
    { key: 'driving_license_back', label: 'Driving License Back' },
    { key: 'warrant', label: 'Warrant' },
    { key: 'hep_vaccine_titre', label: 'Hep Vaccine Titre' },
    { key: 'malpractice_insurance', label: 'MAlpractice insurance' },
    { key: 'other', label: 'Other' }
  ];
  const REQUIRED_DOC_MAP = REQUIRED_DOC_DEFINITIONS.reduce((acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  }, {});

  // Redirect to login if not authenticated
  (function checkAuthentication() {
    const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
    const getAuthToken = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
        const expiresAt = stored?.expires_at ? new Date(stored.expires_at).getTime() : null;
        if (expiresAt && Date.now() > expiresAt) return null;
        return stored?.access_token || null;
      } catch {
        return null;
      }
    };

    const token = getAuthToken();
    if (!token) {
      const loginPageUrl = './login.html' + (apiOriginFromQuery ? '?api_origin=' + encodeURIComponent(apiOriginFromQuery) : '');
      window.location.href = loginPageUrl;
    }
  })();

  initDateInputs();

  const previewBannerEl = document.getElementById('previewBanner');
  const loginBannerEl = document.getElementById('loginBanner');
  const loginStatusEl = document.getElementById('loginStatus');
  const loginEmailEl = document.getElementById('loginEmail');
  const loginPasswordEl = document.getElementById('loginPassword');
  const btnLoginEl = document.getElementById('btnLogin');
  const btnLogoutEl = document.getElementById('btnLogout');
  const btnHeaderLogoutEl = document.getElementById('btnHeaderLogout');
  const btnBackToHub = document.getElementById('btnBackToHub');
  const btnNavBack = document.getElementById('btnNavBack');
  const btnNavForward = document.getElementById('btnNavForward');
  const btnPushOpenDental = document.getElementById('btnPushOpenDental');
  const btnMcodezTitleHome = document.getElementById('btnMcodezTitleHome');
  const saveStatusEl = document.getElementById('saveStatus');
  const saveStatusTextEl = document.getElementById('saveStatusText');
  const allowSamplePreview = new URLSearchParams(window.location.search).get('preview') === '1';

  function setSaveStatus(state, text) {
    if (!saveStatusEl || !saveStatusTextEl) return;
    saveStatusEl.classList.remove('state-saving', 'state-saved', 'state-error');
    if (state === 'saving') saveStatusEl.classList.add('state-saving');
    if (state === 'saved') saveStatusEl.classList.add('state-saved');
    if (state === 'error') saveStatusEl.classList.add('state-error');
    saveStatusTextEl.textContent = text || 'No DB save yet';
  }

  function saveStatusTimeLabel() {
    const now = new Date();
    return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  const sampleData = {
    '2018001': {
      emp_id: '2018001',
      title_prefix: 'Dr',
      surname: 'Borg',
      first_name: 'Maria',
      middle_name: 'Louise',
      gender: 'F',
      dob: '1988-04-10',
      nationality: 'MALTESE',
      designation: 'Dental Surgeon',
      tax_update: 'FT',
      fixed_hours_week: '40',
      fs4_status_update: 'SING',
      marital_update: 'Single',
      department: 'MDC',
      address_house: '12',
      address_street: 'Main Street',
      address_city: 'Birkirkara',
      address_postcode: 'BKR 1234',
      phone_1: '7900 1234',
      phone_2: '7900 5678',
      email: 'maria.borg@example.com',
      iban: 'MT84MALT011000012345MTLCAST001S',
      id_card: '1234567M',
      passport: '',
      ssn: 'SS1234567',
      papers_sent: '2018-01-05',
      approval_date: '2018-01-09',
      start_date: '2018-01-12',
      payroll_main_tax: true,
      payroll_provider_tax: false,
      payroll_three_tax: false
    },
    '2018002': {
      emp_id: '2018002',
      title_prefix: 'Mr',
      surname: 'Camilleri',
      first_name: 'Luke',
      middle_name: '',
      gender: 'M',
      dob: '1990-06-22',
      nationality: 'MALTESE',
      tax_update: 'PT',
      fixed_hours_week: '24',
      fs4_status_update: 'MAR',
      marital_update: 'Married',
      spouse_id_tax: '7654321M',
      department: 'MDC',
      designation: 'Manager',
      address_house: '7',
      address_street: 'Republic Street',
      address_city: 'Mosta',
      address_postcode: 'MST 2110',
      phone_1: '7911 2222',
      email: 'luke.camilleri@example.com',
      id_card: '7654321M',
      ssn: 'SS7654321',
      payroll_main_tax: false,
      payroll_provider_tax: true,
      payroll_three_tax: false
    },
    '2018003': {
      emp_id: '2018003',
      title_prefix: 'Ms',
      surname: 'Fenech',
      first_name: 'Anna',
      middle_name: '',
      gender: 'F',
      dob: '1995-02-15',
      nationality: 'EU',
      designation: 'Housekeeping Trainee',
      tax_update: 'FT_RED',
      fixed_hours_week: '35',
      fs4_status_update: 'PAR1',
      marital_update: 'Single',
      department: 'Admin',
      address_house: '22',
      address_street: 'Church Street',
      address_city: 'Sliema',
      address_postcode: 'SLM 1304',
      phone_1: '7922 3333',
      email: 'anna.fenech@example.com',
      id_card: 'PE123456',
      ssn: 'SS2345678',
      payroll_main_tax: false,
      payroll_provider_tax: false,
      payroll_three_tax: true
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // UTILITY FUNCTIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  function normalizeDepartmentValue(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    const key = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '');
    if (key === 'MDC' || key === 'MEDIATRIXDENTALCLINICSGEN' || key === 'MEDIATRIXDENTALCLINICS') {
      return 'MDC';
    }
    return raw;
  }

  const DATE_FIELD_IDS = new Set([
    'dob',
    'record_created',
    'start_date',
    'papers_sent',
    'approval_date',
    'termination_date',
    'base_wage_effective',
    'payroll_effective_date',
    'tax_effective_date',
    'bonus_effective'
  ]);

  function parseDateToIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const isoDatePrefix = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
    if (isoDatePrefix) return isoDatePrefix[1];
    const short = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (short) {
      const d = Number(short[1]);
      const m = Number(short[2]);
      const y = 2000 + Number(short[3]);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    const long = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (long) {
      const d = Number(long[1]);
      const m = Number(long[2]);
      const y = Number(long[3]);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }

  function formatDateDdMmYy(value) {
    const iso = parseDateToIso(value);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${String(y).slice(-2)}`;
  }

  function initDateInputs() {
    DATE_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'INPUT') {
        el.type = 'text';
        if (!el.placeholder) el.placeholder = 'dd/mm/yy';
        el.addEventListener('blur', () => {
          const formatted = formatDateDdMmYy(el.value);
          if (formatted) el.value = formatted;
        });
      }
    });
  }

  function normalizeNationalityForSelect(value) {
    const raw = String(value || '').trim();
    const key = raw.toUpperCase();
    if (!key) return '';
    if (key === 'MALTESE' || key === 'MALTA' || key === 'MT') return 'MALTESE';
    if (key === 'EU' || key.includes('EUROPE')) return 'EU';
    if (key === 'OTHER') return 'OTHER';
    return 'OTHER';
  }

  function applyNationalityToForm(value) {
    const nationalitySelect = document.getElementById('nationality');
    const otherNationality = document.getElementById('other_nationality');
    const raw = String(value || '').trim();
    if (!nationalitySelect) return;

    const normalized = normalizeNationalityForSelect(raw);
    nationalitySelect.value = normalized;

    if (normalized === 'OTHER' && otherNationality) {
      const otherValue = raw && raw.toUpperCase() !== 'OTHER' ? raw : '';
      if (otherValue) {
        const exists = Array.from(otherNationality.options).some((opt) => String(opt.value).toLowerCase() === otherValue.toLowerCase());
        if (!exists) {
          const option = document.createElement('option');
          option.value = otherValue;
          option.textContent = otherValue;
          otherNationality.appendChild(option);
        }
        otherNationality.value = otherValue;
      } else {
        otherNationality.value = '';
      }
    }
    updateNationalityDropdown();
  }

  function getNationalityForSave() {
    const selected = String(getValue('nationality') || '').trim().toUpperCase();
    if (selected !== 'OTHER') return selected;
    const other = String(getValue('other_nationality') || '').trim();
    return other || 'OTHER';
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else if (DATE_FIELD_IDS.has(id)) el.value = formatDateDdMmYy(value);
    else if (id === 'department') el.value = normalizeDepartmentValue(value);
    else el.value = value || '';
  }

  function getValue(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked;
    if (DATE_FIELD_IDS.has(id)) return parseDateToIso(el.value);
    return el.value;
  }

  function parseStoredJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }

  function getStoredAuth() {
    return parseStoredJson(AUTH_STORAGE_KEY);
  }

  function setStoredAuth(data) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data || {}));
  }

  function clearStoredAuth() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  function getAuthToken() {
    const stored = getStoredAuth();
    const expiresAt = stored?.expires_at ? new Date(stored.expires_at).getTime() : null;
    if (expiresAt && Date.now() > expiresAt) return null;
    return stored?.access_token || null;
  }

  function setAuthUi(loggedIn, message) {
    if (!loginBannerEl) return;
    loginBannerEl.style.display = 'none';
    if (loginStatusEl) loginStatusEl.textContent = message || (loggedIn ? 'Signed in' : 'Not signed in');
    if (btnLogoutEl) btnLogoutEl.style.display = loggedIn ? 'inline-block' : 'none';
    if (btnLoginEl) btnLoginEl.style.display = loggedIn ? 'none' : 'inline-block';
    if (loginEmailEl) loginEmailEl.disabled = loggedIn;
    if (loginPasswordEl) loginPasswordEl.disabled = loggedIn;
  }

  function writeStoredJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizePermissionLevel(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'full') return 'Full';
    if (raw === 'hr') return 'HR';
    if (raw === 'management' || raw === 'manager') return 'Management';
    return 'General User';
  }

  function permissionLevelRank(value) {
    const normalized = normalizePermissionLevel(value);
    return PERMISSION_LEVEL_RANK[normalized] || 1;
  }

  function getPermissionLevelCheckboxes() {
    return Array.from(document.querySelectorAll('input[data-permission-level]'));
  }

  function canEditLoadedEmployeePermission() {
    if (!isExistingEmployee) return true;
    return permissionLevelRank(userPermissionLevelCap) > permissionLevelRank(loadedEmployeePermissionLevel);
  }

  function getSelectedPermissionLevel() {
    const selected = getPermissionLevelCheckboxes().find((input) => input.checked);
    return normalizePermissionLevel(selected?.dataset?.permissionLevel || 'General User');
  }

  function setSelectedPermissionLevel(level, { fallbackToCap = true } = {}) {
    const target = normalizePermissionLevel(level);
    const cap = normalizePermissionLevel(userPermissionLevelCap);
    const targetRank = permissionLevelRank(target);
    const capRank = permissionLevelRank(cap);
    const effective = (fallbackToCap && targetRank > capRank) ? cap : target;

    const checkboxes = getPermissionLevelCheckboxes();
    let matched = false;
    checkboxes.forEach((input) => {
      const thisLevel = normalizePermissionLevel(input.dataset.permissionLevel);
      const checked = thisLevel === effective;
      input.checked = checked;
      if (checked) matched = true;
    });

    if (!matched && checkboxes.length) {
      const defaultLevel = fallbackToCap ? cap : 'General User';
      checkboxes.forEach((input) => {
        input.checked = normalizePermissionLevel(input.dataset.permissionLevel) === defaultLevel;
      });
    }
  }

  function applyPermissionLevelCap() {
    const cap = normalizePermissionLevel(userPermissionLevelCap);
    const capRank = permissionLevelRank(cap);
    const lockedByTargetLevel = !canEditLoadedEmployeePermission();
    const hint = document.getElementById('permissionLevelHint');
    if (hint) {
      hint.textContent = lockedByTargetLevel
        ? `Permission locked: target is same or higher level (${loadedEmployeePermissionLevel}).`
        : `User can assign up to own level (${cap}).`;
    }

    getPermissionLevelCheckboxes().forEach((input) => {
      const level = normalizePermissionLevel(input.dataset.permissionLevel);
      const levelRank = permissionLevelRank(level);
      const lockedByCap = levelRank > capRank;
      input.disabled = !isEditMode || lockedByCap || lockedByTargetLevel;
    });

    if (lockedByTargetLevel) {
      setSelectedPermissionLevel(loadedEmployeePermissionLevel, { fallbackToCap: false });
      return;
    }

    if (permissionLevelRank(getSelectedPermissionLevel()) > capRank) {
      setSelectedPermissionLevel(cap, { fallbackToCap: true });
    }
  }

  function detectSignedInUser() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('user') || params.get('email') || '';
    const fromStorage = localStorage.getItem('signedInUser') || localStorage.getItem('currentUser') || localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    return String(fromQuery || fromStorage || '').trim().toLowerCase();
  }

  function hasPayrollAdminAccess() {
    const signedIn = detectSignedInUser();
    if (!signedIn) return false;
    return PAYROLL_ADMIN_ALLOWLIST.some(user => signedIn.includes(user.toLowerCase()));
  }

  function getDefaultPayrollDetail() {
    return {
      base_wage_amount: '',
      base_wage_basis: 'month',
      base_wage_effective: '',
      wage_history: [],
      bonuses: []
    };
  }

  function getPayrollDetailStore() {
    return parseStoredJson(PAYROLL_DETAIL_STORAGE_KEY);
  }

  function savePayrollDetailStore(store) {
    writeStoredJson(PAYROLL_DETAIL_STORAGE_KEY, store);
  }

  function getCurrentPayrollCodes() {
    const codes = [];
    if (document.getElementById('payroll_main_tax')?.checked) codes.push('MAIN');
    if (document.getElementById('payroll_provider_tax')?.checked) codes.push('PROVIDER');
    if (document.getElementById('payroll_three_tax')?.checked) codes.push('O3P');
    return codes;
  }

  function setPreviewMode(enabled, detail = '') {
    if (!previewBannerEl) return;
    previewBannerEl.style.display = 'none';
  }

  function getPrimaryPayrollName() {
    const codes = getCurrentPayrollCodes();
    if (codes.length === 0) return 'Unassigned';
    if (codes.length === 1) return codes[0];
    return 'Multi Payroll';
  }

  function updateHeaderPayrollTitle() {
    const titleEl = document.querySelector('.app-title');
    if (!titleEl) return;
    titleEl.textContent = 'EMPINFO';
  }

  function applyPayrollAdminVisibility() {
    const btn = document.getElementById('tabPayrollAdminBtn');
    const panel = document.getElementById('tab-payroll-admin');
    const allowed = hasPayrollAdminAccess();
    if (!btn || !panel) return;
    if (!allowed) {
      btn.style.display = 'none';
      panel.style.display = 'none';
      const activeBtn = document.querySelector('.tab-btn.active');
      if (activeBtn && activeBtn.dataset.tab === 'payroll-admin') {
        document.querySelector('.tab-btn[data-tab="details"]')?.click();
      }
    } else {
      btn.style.display = 'inline-block';
      panel.style.display = '';
    }
  }

  function currency(value) {
    const num = Number(value) || 0;
    return `â‚¬${num.toFixed(2)}`;
  }

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function getHoursPerWeek() {
    const val = toNumber(getValue('fixed_hours_week'));
    return val > 0 ? val : 40;
  }

  function loadPayrollDetailForCurrentEmployee() {
    const base = getDefaultPayrollDetail();
    const store = getPayrollDetailStore();
    const key = String(currentEmployeeId || '');
    const saved = key ? (store[key] || {}) : {};
    currentPayrollDetail = {
      ...base,
      ...saved,
      bonuses: Array.isArray(saved.bonuses) ? saved.bonuses : []
    };
    setValue('base_wage_amount', currentPayrollDetail.base_wage_amount);
    setValue('base_wage_basis', currentPayrollDetail.base_wage_basis || 'month');
    setValue('base_wage_effective', currentPayrollDetail.base_wage_effective || '');
    renderBonusTable();
    updatePayrollMath();
    renderPayrollSubscriptionLinks();
  }

  function persistPayrollDetailForCurrentEmployee() {
    if (!currentEmployeeId || !currentPayrollDetail) return;
    const store = getPayrollDetailStore();
    store[String(currentEmployeeId)] = currentPayrollDetail;
    savePayrollDetailStore(store);
  }

  function normalizeMonthlyFromBase() {
    const amount = toNumber(getValue('base_wage_amount'));
    const basis = String(getValue('base_wage_basis') || 'month');
    const hoursPerWeek = getHoursPerWeek();
    if (!amount) return { monthly: 0, hourly: 0, yearly: 0 };
    if (basis === 'year') {
      const monthly = amount / 12;
      return { monthly, hourly: (monthly * 12) / (hoursPerWeek * 52), yearly: amount };
    }
    if (basis === 'hour') {
      const monthly = amount * hoursPerWeek * 52 / 12;
      return { monthly, hourly: amount, yearly: monthly * 12 };
    }
    const monthly = amount;
    return { monthly, hourly: (monthly * 12) / (hoursPerWeek * 52), yearly: monthly * 12 };
  }

  function getActiveBonuses() {
    if (!currentPayrollDetail || !Array.isArray(currentPayrollDetail.bonuses)) return [];
    return currentPayrollDetail.bonuses.filter(b => !b.ended_on);
  }

  function bonusToMonthlyValue(bonus, baseMonthly) {
    if (!bonus) return 0;
    const mode = bonus.mode;
    const value = toNumber(bonus.value);
    const frequency = bonus.frequency;
    if (mode === 'percent') {
      return baseMonthly * (value / 100);
    }
    if (frequency === 'weekly') return value * 52 / 12;
    if (frequency === 'yearly') return value / 12;
    if (frequency === 'monthly') return value;
    return 0;
  }

  function getTaxBracketLabel() {
    const fs4 = String(getValue('fs4_status_update') || '').toUpperCase();
    const taxType = String(getValue('tax_update') || '').toUpperCase();
    if (fs4) return fs4;
    if (taxType) return taxType;
    return 'N/A';
  }

  function getSocialSecurityCategory(monthlyWithBonus) {
    if (monthlyWithBonus <= 1200) return 'A';
    if (monthlyWithBonus <= 2000) return 'B';
    if (monthlyWithBonus <= 3000) return 'C';
    return 'D';
  }

  function highlightSocialSecurityBand(category) {
    document.querySelectorAll('#ssBandsDisplay .ss-band').forEach(el => {
      el.classList.toggle('active', el.dataset.cat === category);
    });
  }

  function updatePayrollMath() {
    const base = normalizeMonthlyFromBase();
    const bonuses = getActiveBonuses();
    const monthlyBonus = bonuses.reduce((sum, b) => sum + bonusToMonthlyValue(b, base.monthly), 0);
    const monthlyWithBonus = base.monthly + monthlyBonus;
    const hoursPerWeek = getHoursPerWeek();
    const hourlyWithBonus = hoursPerWeek > 0 ? (monthlyWithBonus * 12) / (hoursPerWeek * 52) : 0;

    document.getElementById('wageHourBase').textContent = currency(base.hourly);
    document.getElementById('wageHourWithBonus').textContent = currency(hourlyWithBonus);
    document.getElementById('wageMonth').textContent = currency(base.monthly);
    document.getElementById('wageYear').textContent = currency(base.yearly);
    document.getElementById('bonusMonthValue').textContent = currency(monthlyBonus);
    document.getElementById('taxBracketDisplay').textContent = getTaxBracketLabel();

    const ssCategory = getSocialSecurityCategory(monthlyWithBonus);
    highlightSocialSecurityBand(ssCategory);

    updateHeaderPayrollTitle();
    const titleBar = document.getElementById('payrollTitleBar');
    if (titleBar) titleBar.textContent = `Payroll ${getPrimaryPayrollName()} - Detail page`;
  }

  function renderPayrollSubscriptionLinks() {
    const container = document.getElementById('payrollSubscriptionLinks');
    if (!container) return;
    const codes = getCurrentPayrollCodes();
    if (!codes.length) {
      container.innerHTML = '<span class="payroll-note">No payroll subscriptions selected.</span>';
      return;
    }
    const empParam = encodeURIComponent(String(currentEmployeeId || ''));
    container.innerHTML = codes.map(code =>
      `<a href="/dashboard/${code.toLowerCase()}-payroll.html?id=${empParam}">${code} Payroll</a>`
    ).join('');
  }

  function renderBonusTable() {
    const tbody = document.getElementById('bonusTableBody');
    if (!tbody) return;
    const bonuses = currentPayrollDetail?.bonuses || [];
    if (!bonuses.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8a8f9e;">No bonuses set</td></tr>';
      return;
    }
    tbody.innerHTML = bonuses.map((b, index) => {
      const statusClass = b.ended_on ? 'ended' : 'active';
      const statusLabel = b.ended_on ? 'Ended' : 'Active';
      const valueLabel = b.mode === 'percent' ? `${toNumber(b.value).toFixed(2)}%` : currency(toNumber(b.value));
      const modeLabel = b.mode === 'percent' ? 'Percent' : 'Amount';
      const actionBtn = b.ended_on
        ? '<span style="color:#9aa0aa;">-</span>'
        : `<button class="btn btn-outline" type="button" style="padding:3px 8px;font-size:11px;" onclick="terminateBonus(${index})">Terminate</button>`;
      return `
        <tr>
          <td>${b.type || 'Bonus'}</td>
          <td>${modeLabel}</td>
          <td>${valueLabel}</td>
          <td>${b.frequency || '-'}</td>
          <td>${b.effective_from || '-'}</td>
          <td><span class="bonus-pill ${statusClass}">${statusLabel}</span></td>
          <td>${b.ended_on || '-'}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  }

  function terminateBonus(index) {
    if (!currentPayrollDetail?.bonuses?.[index]) return;
    currentPayrollDetail.bonuses[index].ended_on = dateISO;
    persistPayrollDetailForCurrentEmployee();
    renderBonusTable();
    updatePayrollMath();
    isModified = true;
  }
  window.terminateBonus = terminateBonus;

  function setFieldsDisabled(disabled) {
    const inputs = document.querySelectorAll('input:not([readonly]), select, textarea');
    inputs.forEach(el => {
      const browseControlIds = ['filterDepartment', 'filterPayroll', 'searchEmployee'];
      if (!el.id.includes('custom') && !browseControlIds.includes(el.id)) el.disabled = disabled;
    });
  }

  async function apiRequest(url, options = {}) {
    const authToken = getAuthToken();
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {})
      },
      ...options
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = payload?.error || payload?.message || `Request failed (${response.status})`;
      const error = new Error(message);
      (error).status = response.status;
      throw error;
    }

    return payload;
  }

  async function loadLookupOptionsFromApi() {
    if (!useApiData) return;
    try {
      const payload = await apiRequest(EMPLOYEE_FORM_LOOKUPS_API);
      const departments = Array.isArray(payload?.departments) ? payload.departments : [];
      const designations = Array.isArray(payload?.designations) ? payload.designations : [];
      const providerDesignations = Array.isArray(payload?.provider_designations) ? payload.provider_designations : [];

      departments.forEach((name) => addOptionIfMissing('department', normalizeDepartmentValue(name)));
      designations.forEach((name) => addOptionIfMissing('designation', name));
      providerDesignationSet.clear();
      providerDesignations.forEach((name) => providerDesignationSet.add(String(name).toLowerCase()));
      refreshDepartmentFilterOptions();
    } catch (err) {
      console.warn('Failed to load lookup options from API', err);
    }
  }

  async function loadEmployeeIndexFromApi() {
    if (!useApiData) {
      apiEmployeeIndex = [];
      return;
    }
    try {
      const payload = await apiRequest(EMPLOYEE_FORM_API_BASE);
      const rows = Array.isArray(payload?.employees) ? payload.employees : [];
      apiEmployeeIndex = rows
        .map((row) => ({
          emp_id: String(row?.emp_id || '').trim(),
          first_name: String(row?.first_name || ''),
          surname: String(row?.surname || ''),
          id_card: String(row?.id_card || ''),
          department: normalizeDepartmentValue(row?.department),
          tax_update: String(row?.tax_update || ''),
          marital_update: String(row?.marital_update || ''),
          payroll_main_tax: Boolean(row?.payroll_main_tax),
          payroll_provider_tax: Boolean(row?.payroll_provider_tax),
          payroll_three_tax: Boolean(row?.payroll_three_tax)
        }))
        .filter((row) => row.emp_id);
      refreshDepartmentFilterOptions();
      updateNavigationButtons();
    } catch (err) {
      console.warn('Failed to load employee index from API', err);
      apiEmployeeIndex = [];
    }
  }

  async function saveLookupOptionToApi(type, value, isProvider = false) {
    return apiRequest(EMPLOYEE_FORM_LOOKUPS_API, {
      method: 'POST',
      body: JSON.stringify({ type, value, is_provider: isProvider })
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadPendingDocuments(empId) {
    if (!useApiData || !empId) return [];
    const queued = [];
    pendingGeneralFiles.forEach((entry) => queued.push(entry));
    pendingTerminationFiles.forEach((file) => queued.push({ file, category: 'termination' }));
    if (pendingPhotoFile) queued.push({ file: pendingPhotoFile, category: 'photo' });
    if (!queued.length) return [];

    const documents = [];
    for (const entry of queued) {
      const file = entry.file;
      if (!file) continue;
      const content_base64 = await fileToBase64(file);
      documents.push({
        name: entry.uploadName || file.name,
        mime_type: file.type || 'application/octet-stream',
        category: entry.category || 'general',
        content_base64
      });
    }

    if (!documents.length) return [];

    const payload = await apiRequest(`${EMPLOYEE_FORM_API_BASE}/${encodeURIComponent(empId)}/documents`, {
      method: 'POST',
      body: JSON.stringify({ documents })
    });

    pendingGeneralFiles = [];
    pendingTerminationFiles = [];
    pendingPhotoFile = null;
    fileInput.value = '';
    terminateFileInput.value = '';
    fileList.textContent = 'No files added';
    terminateFileList.textContent = 'No termination files added';
    return Array.isArray(payload?.documents) ? payload.documents : [];
  }

  function renderDocumentsFromApi(documents) {
    const uploadedFilesList = document.getElementById('uploadedFilesList');
    if (!uploadedFilesList) return;
    if (!Array.isArray(documents) || !documents.length) {
      uploadedFilesList.textContent = 'No files uploaded yet.';
      return;
    }

    const parseReminderLabelFromFilename = (name = '') => {
      const match = String(name).match(/^(.*?)\s\(\d{8}_\d{6}\)/);
      return match?.[1] || name;
    };

    const groups = new Map();
    documents.forEach((doc) => {
      const category = String(doc.category || 'general');
      let key = category;
      let label = category.toUpperCase();
      if (category.startsWith('required:')) {
        const reminderKey = category.replace('required:', '');
        key = `required:${reminderKey}`;
        label = reminderKey === 'other'
          ? parseReminderLabelFromFilename(doc.original_name)
          : (REQUIRED_DOC_MAP[reminderKey]?.label || reminderKey);
      }
      if (!groups.has(key)) {
        groups.set(key, { key, label, docs: [] });
      }
      groups.get(key).docs.push(doc);
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
    uploadedFilesList.innerHTML = sortedGroups.map((group) => {
      const docsSorted = group.docs.slice().sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
      const latest = docsSorted[0];
      const latestUploaded = latest?.uploaded_at ? new Date(latest.uploaded_at).toLocaleString() : '';
      const latestHref = `${API_ORIGIN}${latest.download_url}`;
      const historyRows = docsSorted.slice(1).map((doc) => {
        const uploaded = doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : '';
        const href = `${API_ORIGIN}${doc.download_url}`;
        return `<div class="doc-history-item"><span class="doc-history-note">History:</span> <a href="${href}" target="_blank" rel="noopener">${doc.original_name}</a> <span style="color:#777;">${uploaded}</span></div>`;
      }).join('');

      return `
        <div class="doc-history">
          <div class="doc-history-title">${group.label}</div>
          <div class="doc-history-item"><span class="doc-history-note">Latest:</span> <a href="${latestHref}" target="_blank" rel="noopener">${latest.original_name}</a> <span style="color:#777;">${latestUploaded}</span></div>
          ${historyRows}
        </div>
      `;
    }).join('');
  }

  async function authenticateUser(email, password) {
    const response = await fetch(`${API_ORIGIN}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message || payload?.error || 'Login failed';
      throw new Error(message);
    }

    const data = payload?.data || {};
    const expiresMs = Number(data?.expires || 0);
    const expiresAt = expiresMs ? new Date(Date.now() + expiresMs).toISOString() : null;
    setStoredAuth({
      access_token: data?.access_token || null,
      refresh_token: data?.refresh_token || null,
      expires_at: expiresAt
    });
  }

  async function initApiAccess() {
    const token = getAuthToken();
    if (!token) {
      useApiData = false;
      setPreviewMode(false);
      setAuthUi(false, 'Not signed in');
      window.location.href = `./login.html?api_origin=${encodeURIComponent(API_ORIGIN)}`;
      return false;
    }

    try {
      const access = await apiRequest(`${EMPLOYEE_FORM_ENDPOINT_BASE}/payroll/employee-form-access`);
      useApiData = true;
      userPermissionLevelCap = normalizePermissionLevel(access?.permission_level_cap || 'General User');
      setPreviewMode(false);
      setAuthUi(true, 'Signed in');
      setSaveStatus('idle', 'Connected. No DB save yet');
      applyPayrollAdminVisibility();
      await loadLookupOptionsFromApi();
      await loadEmployeeIndexFromApi();
      return true;
    } catch (error) {
      useApiData = false;
      setPreviewMode(false);
      setAuthUi(false, 'Access denied');
      setSaveStatus('error', 'DB connection unavailable');
      const msg = (error && error.message) ? String(error.message) : 'Access denied';
      const normalized = msg.toLowerCase();
      if (normalized.includes('access denied') || normalized.includes('forbidden') || normalized.includes('403')) {
        alert('Access denied');
        window.location.href = `./app-hub.html?api_origin=${encodeURIComponent(API_ORIGIN)}`;
      } else {
        clearStoredAuth();
        window.location.href = `./login.html?api_origin=${encodeURIComponent(API_ORIGIN)}`;
      }
      return false;
    }
  }

  function collectEmployeePayload() {
    const sanitizeText = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'boolean') return value;
      const text = String(value).trim();
      if (!text) return null;
      const normalized = text.toLowerCase();
      const placeholders = new Set([
        'select',
        'select department',
        'select designation',
        'select city or type',
        'select street or type',
        'select country',
        'new employee',
        'auto',
        'n/a',
        '-'
      ]);
      if (placeholders.has(normalized) || normalized.startsWith('select ')) {
        return null;
      }
      return text;
    };

    const sanitizeNumber = (value) => {
      const text = sanitizeText(value);
      if (text === null) return null;
      const num = Number(text);
      return Number.isFinite(num) ? num : null;
    };

    const resolvedEmpId = sanitizeText(getValue('emp_id')) || sanitizeText(currentEmployeeId);

    return {
      employee: {
        emp_id: resolvedEmpId,
        title_prefix: sanitizeText(getValue('title_prefix')),
        surname: sanitizeText(getValue('surname')),
        first_name: sanitizeText(getValue('first_name')),
        middle_name: sanitizeText(getValue('middle_name')),
        gender: sanitizeText(getValue('gender')),
        dob: sanitizeText(getValue('dob')),
        nationality: sanitizeText(getNationalityForSave()),
        passport: sanitizeText(getValue('passport')),
        id_card: sanitizeText(getValue('id_card')),
        ssn: sanitizeText(getValue('ssn')),
        spouse_id_tax: sanitizeText(getValue('spouse_id_tax')),
        designation: sanitizeText(getValue('designation')),
        department: normalizeDepartmentValue(sanitizeText(getValue('department'))),
        address_house: sanitizeText(getValue('address_house')),
        address_street: sanitizeText(getValue('address_street')),
        address_city: sanitizeText(getValue('address_city')),
        address_postcode: sanitizeText(getValue('address_postcode')),
        phone_1: sanitizeText(getValue('phone_1')),
        phone_2: sanitizeText(getValue('phone_2')),
        email: sanitizeText(getValue('email')),
        iban: sanitizeText(getValue('iban')),
        papers_sent: sanitizeText(getValue('papers_sent')),
        approval_date: sanitizeText(getValue('approval_date')),
        start_date: sanitizeText(getValue('start_date')),
        tax_update: sanitizeText(getValue('tax_update')),
        fixed_hours_week: sanitizeNumber(getValue('fixed_hours_week')),
        fs4_status_update: sanitizeText(getValue('fs4_status_update')),
        marital_update: sanitizeText(getValue('marital_update')),
        payroll_main_tax: getValue('payroll_main_tax'),
        payroll_provider_tax: getValue('payroll_provider_tax'),
        payroll_three_tax: getValue('payroll_three_tax'),
        permission_level: canEditLoadedEmployeePermission()
          ? getSelectedPermissionLevel()
          : normalizePermissionLevel(loadedEmployeePermissionLevel),
        od_username_override: sanitizeText(getValue('od_username_override')),
        od_security_level: sanitizeText(getValue('od_security_level')) || 'Regular users',
        od_force_password_change: getValue('od_force_password_change'),
        termination_date: sanitizeText(getValue('termination_date')),
        termination_reason: sanitizeText(getValue('termination_reason')),
        termination_notes: sanitizeText(getValue('termination_notes'))
      },
      payroll_detail: {
        base_wage_amount: sanitizeNumber(getValue('base_wage_amount')),
        base_wage_basis: sanitizeText(getValue('base_wage_basis')) || 'month',
        base_wage_effective: sanitizeText(getValue('base_wage_effective')),
        wage_history: currentPayrollDetail?.wage_history || [],
        bonuses: currentPayrollDetail?.bonuses || []
      }
    };
  }

  function applyEmployeePayloadToForm(payload) {
    if (!payload) return;
    const employee = payload.employee || payload.data?.employee || payload.data || payload || {};
    const payrollDetail = payload.payroll_detail || payload.data?.payroll_detail || payload.payrollDetail || {};
    const documents = Array.isArray(payload.documents)
      ? payload.documents
      : (Array.isArray(payload.data?.documents) ? payload.data.documents : []);

    setValue('emp_id', employee.emp_id || '');

    [
      'title_prefix', 'surname', 'first_name', 'middle_name', 'gender', 'dob', 'passport',
      'id_card', 'ssn', 'spouse_id_tax', 'designation', 'department', 'address_house',
      'address_street', 'address_city', 'address_postcode', 'phone_1', 'phone_2', 'email',
      'iban', 'record_created', 'papers_sent', 'approval_date', 'start_date', 'tax_update', 'fixed_hours_week',
      'fs4_status_update', 'marital_update', 'termination_date', 'termination_reason', 'termination_notes',
      'od_username_override', 'od_security_level', 'od_force_password_change'
    ].forEach(field => {
      if (field in employee) setValue(field, employee[field]);
    });

    const dateFallbacks = {
      record_created: employee.record_created || employee.recordCreated || employee.created_at || employee.createdAt || '',
      dob: employee.dob || employee.date_of_birth || employee.dateOfBirth || '',
      start_date: employee.start_date || employee.startDate || employee.date_first_employed || employee.dateFirstEmployed || '',
      papers_sent: employee.papers_sent || employee.papersSent || '',
      approval_date: employee.approval_date || employee.approvalDate || '',
      termination_date: employee.termination_date || employee.terminationDate || ''
    };

    Object.entries(dateFallbacks).forEach(([field, value]) => {
      if (value) setValue(field, value);
    });

    applyNationalityToForm(employee.nationality);

    setValue('payroll_main_tax', Boolean(employee.payroll_main_tax));
    setValue('payroll_provider_tax', Boolean(employee.payroll_provider_tax));
    setValue('payroll_three_tax', Boolean(employee.payroll_three_tax));
    loadedEmployeePermissionLevel = normalizePermissionLevel(employee.permission_level || 'General User');
    setSelectedPermissionLevel(loadedEmployeePermissionLevel, { fallbackToCap: false });

    currentPayrollDetail = {
      ...getDefaultPayrollDetail(),
      ...payrollDetail,
      bonuses: Array.isArray(payrollDetail.bonuses) ? payrollDetail.bonuses : []
    };

    setValue('base_wage_amount', currentPayrollDetail.base_wage_amount || '');
    setValue('base_wage_basis', currentPayrollDetail.base_wage_basis || 'month');
    setValue('base_wage_effective', currentPayrollDetail.base_wage_effective || '');

    if (employee.emp_id) {
      isExistingEmployee = true;
      currentEmployeeId = String(employee.emp_id);
    }
    updatePushOpenDentalVisibility();

    updateEmployeeIdentityTitle();
    updateDesignationChooserColor();
    updatePayrollDisplay();
    updateTaxMaritalDisplay();
    toggleSpouseTax();
    renderBonusTable();
    updatePayrollMath();
    renderPayrollSubscriptionLinks();
    renderDocumentsFromApi(documents);
    applyPermissionLevelCap();
  }

  async function loadEmployeeByIdFromApi(empId, options = {}) {
    let payload = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        payload = await apiRequest(`${EMPLOYEE_FORM_API_BASE}/${encodeURIComponent(empId)}`);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
    if (!payload) throw lastError || new Error('Failed to load employee from API');
    applyEmployeePayloadToForm(payload);
    if (options.syncUrl !== false) {
      syncEmployeeUrl(empId, Boolean(options.usePushState));
    }
    const empMode = document.getElementById('empMode');
    if (empMode) empMode.textContent = 'Edit';
    if (String(options.openMode || '').toLowerCase() === 'edit') {
      enterEditMode();
    } else {
      exitEditMode();
    }
    isModified = false;
    updateNavigationButtons();
  }

  function clearFormFields() {
    const fields = document.querySelectorAll('.tab-panel input, .tab-panel select, .tab-panel textarea');
    fields.forEach(el => {
      if (el.id === 'emp_id' || el.id === 'record_created') return;
      if (el.type === 'checkbox') el.checked = false;
      else if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    setValue('record_created', new Date().toISOString().slice(0, 10));
    document.getElementById('spouseFieldTax').style.display = 'none';
    document.getElementById('otherNationalityField').style.display = 'none';
    document.getElementById('streetCustomField').style.display = 'none';
    document.getElementById('cityCustomField').style.display = 'none';
    pendingGeneralFiles = [];
    pendingTerminationFiles = [];
    pendingPhotoFile = null;
    document.getElementById('fileList').textContent = 'No files added';
    document.getElementById('terminateFileList').textContent = 'No termination files added';
    renderDocumentsFromApi([]);
    setValue('od_security_level', 'Regular users');
    setValue('od_force_password_change', true);
    loadedEmployeePermissionLevel = 'General User';
    setSelectedPermissionLevel('General User', { fallbackToCap: true });
    updateDesignationChooserColor();
    renderEmployeeSummaryBar();
    applyPermissionLevelCap();
    updatePushOpenDentalVisibility();
  }

  function getSortedEmployeeIds() {
    if (useApiData && Array.isArray(apiEmployeeIndex) && apiEmployeeIndex.length) {
      return apiEmployeeIndex
        .map((row) => String(row.emp_id || ''))
        .filter(Boolean)
        .sort((a, b) => Number(a) - Number(b));
    }
    if (!allowSamplePreview) return [];
    return Object.keys(sampleData).sort((a, b) => Number(a) - Number(b));
  }

  function getEmployeeBrowseRecord(id) {
    const key = String(id || '');
    if (useApiData) {
      return apiEmployeeIndex.find((row) => String(row.emp_id) === key) || null;
    }
    if (!allowSamplePreview) return null;
    return sampleData[key] || null;
  }

  function matchesPayrollFilter(data, payrollFilter) {
    if (!payrollFilter) return true;
    const hasMain = Boolean(data.payroll_main_tax);
    const hasProvider = Boolean(data.payroll_provider_tax);
    const hasO3p = Boolean(data.payroll_three_tax);
    if (payrollFilter === 'MAIN') return hasMain;
    if (payrollFilter === 'PROVIDER') return hasProvider;
    if (payrollFilter === 'O3P') return hasO3p;
    if (payrollFilter === 'NONE') return !hasMain && !hasProvider && !hasO3p;
    return true;
  }

  function getFilteredEmployeeIds() {
    const departmentFilter = document.getElementById('filterDepartment')?.value || '';
    const payrollFilter = document.getElementById('filterPayroll')?.value || '';
    const searchText = (document.getElementById('searchEmployee')?.value || '').trim().toLowerCase();

    return getSortedEmployeeIds().filter(id => {
      const data = getEmployeeBrowseRecord(id);
      if (!data) return false;
      if (departmentFilter && data.department !== departmentFilter) return false;
      if (!matchesPayrollFilter(data, payrollFilter)) return false;

      if (!searchText) return true;
      const searchFields = [
        data.emp_id,
        data.first_name,
        data.surname,
        data.id_card
      ].map(v => String(v || '').toLowerCase());

      return searchFields.some(v => v.includes(searchText));
    });
  }

  function updateNavigationButtons() {
    const empDisplay = document.getElementById('currentEmpIdDisplay');
    if (empDisplay) {
      empDisplay.textContent = `Emp ID: ${currentEmployeeId || 'AUTO'}`;
    }

    const canNavigateEmployees = isExistingEmployee && !isEditMode;
    if (btnNavBack) btnNavBack.style.display = canNavigateEmployees ? 'inline-block' : 'none';
    if (btnNavForward) btnNavForward.style.display = canNavigateEmployees ? 'inline-block' : 'none';

    if (!canNavigateEmployees) {
      if (btnNavBack) btnNavBack.disabled = true;
      if (btnNavForward) btnNavForward.disabled = true;
      return;
    }

    const ids = getFilteredEmployeeIds();
    const currentId = String(currentEmployeeId || '');
    const currentIndex = ids.indexOf(currentId);

    if (btnNavBack) btnNavBack.disabled = currentIndex <= 0;
    if (btnNavForward) btnNavForward.disabled = currentIndex < 0 || currentIndex >= ids.length - 1;
  }

  function updatePushOpenDentalVisibility() {
    if (!btnPushOpenDental) return;
    // To avoid duplicate OD users, push is only available for brand-new records.
    btnPushOpenDental.style.display = isExistingEmployee ? 'none' : 'inline-block';
  }

  function navigateEmployee(offset) {
    if (!isExistingEmployee || isEditMode) return;

    const ids = getFilteredEmployeeIds();
    if (!ids.length) return;

    const currentId = String(currentEmployeeId || '');
    const currentIndex = ids.indexOf(currentId);
    if (currentIndex < 0) {
      loadEmployeeById(ids[0], { usePushState: true });
      return;
    }

    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= ids.length) return;
    loadEmployeeById(ids[targetIndex], { usePushState: true });
  }

  function setStatusDisplay(status) {
    const statusEl = document.getElementById('statusDisplay');
    if (!statusEl) return;
    statusEl.textContent = status;
    statusEl.style.display = 'inline-block';
    statusEl.classList.remove('current', 'prospective', 'terminated');
    const statusClass = String(status || '').toLowerCase();
    if (statusClass === 'current' || statusClass === 'prospective' || statusClass === 'terminated') {
      statusEl.classList.add(statusClass);
    }
    renderEmployeeSummaryBar();
  }

  function getDesignationColor(designationValue) {
    const value = String(designationValue || '').trim().toLowerCase();
    if (!value) return '';
    if (value.includes('dental surgeon')) return '#3E73C5';
    if (value.includes('office manager')) return '#4E7F2E';
    if (value.includes('clinical manager')) return '#C7DDBA';
    if (value.includes('receptionist')) return value.includes('trainee') ? '#FF9AA2' : '#C011A5';
    if (value.includes('maintenance')) return '#C8A316';
    if (value.includes('sup') && value.includes('assistant')) return '#00838F';
    if (value.includes('dental assistant') && value.includes('trainee')) return '#EB9A45';
    if (value.includes('dental assistant')) return '#6D35B0';
    if (value.includes('hygienist')) return '#722F37';
    if (value.includes('principal')) return '#6D4C41';
    if (value.includes('housekeeping')) return '#2E5090';
    return 'var(--gray-400)';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDesignationTextHtml(value) {
    const safe = escapeHtml(value);
    if (!safe) return '';
    return safe
      .replace(/\b(sup\.?)\b/ig, '<span class="designation-sup">$1</span>')
      .replace(/\b(trainee)\b/ig, '<span class="designation-trainee">$1</span>');
  }

  function isRealDesignationValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'select designation') return false;
    if (normalized === 'choose designation') return false;
    if (normalized === 'none') return false;
    return true;
  }

  function updateDesignationChooserColor() {
    const designationEl = document.getElementById('designation');
    const squareEl = document.getElementById('designationColorSquare');
    if (!designationEl || !squareEl) return;
    const selected = String(designationEl.value || '').trim();
    if (!isRealDesignationValue(selected)) {
      squareEl.style.backgroundColor = 'transparent';
      squareEl.style.borderColor = 'transparent';
      designationEl.style.boxShadow = '';
      return;
    }
    const color = getDesignationColor(selected) || 'var(--gray-400)';
    squareEl.style.backgroundColor = color;
    squareEl.style.borderColor = color;
    designationEl.style.boxShadow = `inset 3px 0 0 ${color}`;
  }

  function normalizeEmploymentTypeForSummary(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    if (raw.startsWith('FT')) return 'FT';
    if (raw.startsWith('PT')) return 'PT';
    return 'OTHER';
  }

  function normalizeMaritalForSummary(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw === 'married' ? 'MARRIED' : 'OTHER';
  }

  function getPayrollSubscriptionsForSummary() {
    const subscribed = [];
    if (document.getElementById('payroll_main_tax')?.checked) subscribed.push('MAIN');
    if (document.getElementById('payroll_provider_tax')?.checked) subscribed.push('PROVIDER');
    if (document.getElementById('payroll_three_tax')?.checked) subscribed.push('O3P');
    return subscribed;
  }

  function appendSummaryPill(bar, label, value, options = {}) {
    if (!value) return;
    const pill = document.createElement('span');
    pill.className = 'summary-pill';

    if (options.color) {
      const square = document.createElement('span');
      square.className = 'designation-color-square';
      square.style.backgroundColor = options.color;
      square.style.borderColor = options.color;
      pill.appendChild(square);
    }

    const text = document.createElement('span');
    if (options.htmlValue) {
      text.innerHTML = label ? `${escapeHtml(label)}: ${options.htmlValue}` : String(options.htmlValue);
    } else {
      text.textContent = label ? `${label}: ${value}` : String(value);
    }
    pill.appendChild(text);
    bar.appendChild(pill);
  }

  function renderEmployeeSummaryBar() {
    const bar = document.getElementById('employeeSummaryBar');
    if (!bar) return;
    bar.innerHTML = '';

    const rawDesignation = String(getValue('designation') || '').trim();
    const designation = isRealDesignationValue(rawDesignation) ? rawDesignation : '';
    const employmentType = normalizeEmploymentTypeForSummary(getValue('tax_update'));
    const fs4Status = String(getValue('fs4_status_update') || '').trim().toUpperCase();
    const nationality = String(getValue('nationality') || '').trim().toUpperCase();
    const marital = normalizeMaritalForSummary(getValue('marital_update'));

    appendSummaryPill(bar, '', designation, {
      color: getDesignationColor(designation),
      htmlValue: formatDesignationTextHtml(designation)
    });
    appendSummaryPill(bar, '', employmentType);
    appendSummaryPill(bar, '', fs4Status);
    appendSummaryPill(bar, '', nationality);
    appendSummaryPill(bar, '', marital);

    bar.style.display = bar.childElementCount ? 'flex' : 'none';
  }

  function syncEmployeeUrl(empId, usePushState = false) {
    const nextUrl = new URL(window.location.href);
    if (empId) {
      nextUrl.searchParams.set('id', String(empId));
    } else {
      nextUrl.searchParams.delete('id');
    }
    const historyFn = usePushState ? window.history.pushState : window.history.replaceState;
    historyFn.call(window.history, { employeeId: empId ? String(empId) : null }, '', nextUrl.toString());
  }

  function loadEmployeeById(empId, options = {}) {
    const { syncUrl = true, usePushState = false, openMode = '' } = options;
    if (useApiData) {
      loadEmployeeByIdFromApi(empId, options).catch(err => {
        console.warn('API load failed', err);
        if (allowSamplePreview) {
          useApiData = false;
          setPreviewMode(true, 'API load failed');
          loadEmployeeById(empId, options);
          return;
        }
        const identity = document.getElementById('empIdentity');
        if (identity) identity.textContent = `Failed to load employee ${empId}`;
        const idPill = document.getElementById('currentEmpIdDisplay');
        if (idPill) idPill.textContent = `Emp ID: ${empId}`;
        setSaveStatus('error', 'Failed to load employee data');
        alert(err?.message || 'Cannot load employee from API.');
      });
      return;
    }

    const employee = sampleData[empId];
    if (!employee) return;

    clearFormFields();
    isExistingEmployee = true;
    currentEmployeeId = String(empId);
    const empMode = document.getElementById('empMode');
    if (empMode) empMode.textContent = 'Edit';
    document.getElementById('empIdentity').textContent = 'New Employee';
    setStatusDisplay('Prospective');

    setValue('emp_id', empId);
    Object.keys(employee).forEach(k => setValue(k, employee[k]));
    updateEmployeeIdentityTitle();
    updateDesignationChooserColor();

    updatePayrollDisplay();
    updateTaxMaritalDisplay();
    loadPayrollDetailForCurrentEmployee();
    toggleSpouseTax();
    if (syncUrl) {
      syncEmployeeUrl(empId, usePushState);
    }
    if (String(openMode || '').toLowerCase() === 'edit') {
      enterEditMode();
    } else {
      exitEditMode();
    }
    isModified = false;
    updateNavigationButtons();
  }

  function refreshDepartmentFilterOptions() {
    const filter = document.getElementById('filterDepartment');
    if (!filter) return;
    const current = filter.value;
    const departments = Array.from(new Set(
      getSortedEmployeeIds()
        .map(id => normalizeDepartmentValue(getEmployeeBrowseRecord(id)?.department))
        .filter(Boolean)
    )).sort();
    filter.innerHTML = '<option value="">All Departments</option>';
    departments.forEach(dep => {
      const opt = document.createElement('option');
      opt.value = dep;
      opt.textContent = dep;
      filter.appendChild(opt);
    });
    if (Array.from(filter.options).some(o => o.value === current)) {
      filter.value = current;
    }
  }

  function applyEmployeeFilters() {
    if (!isExistingEmployee || isEditMode) {
      updateNavigationButtons();
      return;
    }
    const filteredIds = getFilteredEmployeeIds();
    if (filteredIds.length === 0) {
      updateNavigationButtons();
      return;
    }
    if (!filteredIds.includes(String(currentEmployeeId || ''))) {
      loadEmployeeById(filteredIds[0]);
      return;
    }
    updateNavigationButtons();
  }

  function updateFieldsDisplay() {
    const nameFields = ['surname', 'first_name', 'middle_name'];
    const addressFields = ['address_house'];
    
    nameFields.concat(addressFields).forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value) {
        el.value = capitalizeFirst(el.value);
      }
    });
  }

  function updateEmployeeIdentityTitle() {
    const firstName = String(getValue('first_name') || '').trim();
    const surname = String(getValue('surname') || '').trim();
    const fullName = `${firstName} ${surname}`.trim();
    document.getElementById('empIdentity').textContent = fullName || 'New Employee';
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // TAB SWITCHING (FIXED)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const tabName = this.dataset.tab;
      
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      
      this.classList.add('active');
      const panel = document.getElementById('tab-' + tabName);
      if (panel) {
        panel.classList.add('active');
      }
    });
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EMPLOYMENT STATUS & PAYROLL DISPLAY
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function updatePayrollDisplay() {
    const main = document.getElementById('payroll_main_tax')?.checked || false;
    const provider = document.getElementById('payroll_provider_tax')?.checked || false;
    const three = document.getElementById('payroll_three_tax')?.checked || false;
    
    const display = document.getElementById('payrollDisplay');
    let html = '';
    
    if (main) html += '<span class="payroll-badge main">MAIN</span>';
    if (provider) html += '<span class="payroll-badge provider">PROVIDER</span>';
    if (three) html += '<span class="payroll-badge o3p">O3P</span>';
    
    if (!main && !provider && !three) {
      html = '<span class="payroll-badge none">NONE</span>';
    }

    if (display) {
      display.innerHTML = html;
    }
    
    const startDate = parseDateToIso(getValue('start_date'));
    const terminationDate = parseDateToIso(getValue('termination_date'));
    const todayIso = new Date().toISOString().slice(0, 10);
    const status = terminationDate
      ? (terminationDate <= todayIso ? 'Terminated' : (startDate && startDate <= todayIso ? 'Current' : 'Prospective'))
      : (startDate && startDate <= todayIso ? 'Current' : 'Prospective');
    setStatusDisplay(status);
    renderEmployeeSummaryBar();
    updateHeaderPayrollTitle();
    renderPayrollSubscriptionLinks();
    updatePayrollMath();
  }

  function updateTaxMaritalDisplay() {
    const tax = document.getElementById('tax_update')?.value || 'NONE';
    const fs4 = document.getElementById('fs4_status_update')?.value || 'NONE';
    const marital = document.getElementById('marital_update')?.value || 'NONE';
    const display = document.getElementById('taxMaritalDisplay');
    if (!display) return;
    display.innerHTML = `
      <span class="payroll-badge info">TAX: ${tax.toUpperCase()}</span>
      <span class="payroll-badge info">FS4: ${fs4.toUpperCase()}</span>
      <span class="payroll-badge info">MARITAL: ${marital.toUpperCase()}</span>
    `;
    renderEmployeeSummaryBar();
  }

  ['payroll_main_tax', 'payroll_provider_tax', 'payroll_three_tax'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.addEventListener('change', updatePayrollDisplay);
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PAYROLL UPDATE FROM TAX TAB
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  document.getElementById('btnUpdatePayroll')?.addEventListener('click', function() {
    const effectiveDate = document.getElementById('payroll_effective_date').value;
    if (!effectiveDate) {
      alert('Please select an effective date for payroll changes');
      return;
    }
    
    // Store payroll changes with effective date
    const payrollData = {
      main: document.getElementById('payroll_main_tax').checked,
      provider: document.getElementById('payroll_provider_tax').checked,
      o3p: document.getElementById('payroll_three_tax').checked,
      effective_date: effectiveDate,
      timestamp: new Date().toISOString()
    };
    
    console.log('Payroll update:', payrollData);
    updatePayrollDisplay();
    isModified = true;
    alert('Payroll changes recorded. Click Save to confirm.');
  });

  document.getElementById('btnUpdateTax')?.addEventListener('click', function() {
    const effectiveDate = document.getElementById('tax_effective_date').value;
    if (!effectiveDate) {
      alert('Please select an effective date for tax/marital changes');
      return;
    }
    updateTaxMaritalDisplay();
    isModified = true;
    alert('Tax/Marital changes recorded. Click Save to confirm.');
  });

  ['tax_update', 'fs4_status_update', 'marital_update'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.addEventListener('change', updateTaxMaritalDisplay);
  });

  document.getElementById('designation')?.addEventListener('change', () => {
    updateDesignationChooserColor();
    renderEmployeeSummaryBar();
  });

  ['tax_update', 'fs4_status_update', 'fixed_hours_week', 'base_wage_amount', 'base_wage_basis'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.addEventListener('change', updatePayrollMath);
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // SPOUSE FIELD TOGGLE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function toggleSpouseTax() {
    document.getElementById('spouseFieldTax').style.display = 
      document.getElementById('marital_update').value === 'Married' ? 'block' : 'none';
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // NATIONALITY & ADDRESS DROPDOWNS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function updateNationalityDropdown() {
    const val = document.getElementById('nationality').value;
    document.getElementById('otherNationalityField').style.display = val === 'OTHER' ? 'block' : 'none';
  }

  function handleStreetChange() {
    const sel = document.getElementById('address_street');
    const field = document.getElementById('streetCustomField');
    const customInput = document.getElementById('address_street_custom');
    if (sel.value === 'Custom') {
      field.style.display = 'block';
      customInput.value = '';
      customInput.focus();
    } else {
      field.style.display = 'none';
      customInput.value = '';
    }
  }

  function handleCityChange() {
    const sel = document.getElementById('address_city');
    const field = document.getElementById('cityCustomField');
    const customInput = document.getElementById('address_city_custom');
    if (sel.value === 'Custom') {
      field.style.display = 'block';
      customInput.value = '';
      customInput.focus();
    } else {
      field.style.display = 'none';
      customInput.value = '';
    }
  }

  let geoDebounceLocality = null;
  let geoDebounceStreet = null;
  const geoLocalityCache = new Map();
  const geoStreetCache = new Map();

  function renderDataList(listId, values) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    (values || []).forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
  }

  async function fetchLocalitySuggestions(query) {
    const key = String(query || '').trim().toLowerCase();
    if (geoLocalityCache.has(key)) return geoLocalityCache.get(key);
    const payload = await apiRequest(`${EMPLOYEE_FORM_ENDPOINT_BASE}/payroll/geo/localities?q=${encodeURIComponent(query || '')}`);
    const localities = Array.isArray(payload?.localities) ? payload.localities : [];
    geoLocalityCache.set(key, localities);
    return localities;
  }

  async function fetchStreetSuggestions(locality, query) {
    const key = `${String(locality || '').trim().toLowerCase()}|${String(query || '').trim().toLowerCase()}`;
    if (geoStreetCache.has(key)) return geoStreetCache.get(key);
    const payload = await apiRequest(
      `${EMPLOYEE_FORM_ENDPOINT_BASE}/payroll/geo/streets?locality=${encodeURIComponent(locality || '')}&q=${encodeURIComponent(query || '')}`
    );
    const streets = Array.isArray(payload?.streets) ? payload.streets : [];
    geoStreetCache.set(key, streets);
    return streets;
  }

  function initGeoAutocomplete() {
    const localityInput = document.getElementById('address_city');
    const streetInput = document.getElementById('address_street');
    if (!localityInput || !streetInput) return;

    const updateStreetState = () => {
      const locality = String(localityInput.value || '').trim();
      streetInput.disabled = !locality;
      if (!locality) {
        streetInput.value = '';
        renderDataList('streetList', []);
      }
    };

    localityInput.addEventListener('input', () => {
      updateStreetState();
      clearTimeout(geoDebounceLocality);
      geoDebounceLocality = setTimeout(async () => {
        try {
          const items = await fetchLocalitySuggestions(localityInput.value);
          renderDataList('localityList', items);
        } catch {
          renderDataList('localityList', []);
        }
      }, 220);
    });

    localityInput.addEventListener('change', () => {
      updateStreetState();
    });

    streetInput.addEventListener('input', () => {
      clearTimeout(geoDebounceStreet);
      geoDebounceStreet = setTimeout(async () => {
        try {
          const locality = String(localityInput.value || '').trim();
          if (!locality) return;
          const items = await fetchStreetSuggestions(locality, streetInput.value);
          renderDataList('streetList', items);
        } catch {
          renderDataList('streetList', []);
        }
      }, 220);
    });

    updateStreetState();
    fetchLocalitySuggestions('').then((items) => renderDataList('localityList', items)).catch(() => {});
  }

  document.getElementById('address_street_custom')?.addEventListener('blur', function() {
    if (this.value) {
      document.getElementById('address_street').value = capitalizeFirst(this.value);
      document.getElementById('streetCustomField').style.display = 'none';
      this.value = '';
      isModified = true;
    }
  });

  document.getElementById('address_city_custom')?.addEventListener('blur', function() {
    if (this.value) {
      document.getElementById('address_city').value = capitalizeFirst(this.value);
      document.getElementById('cityCustomField').style.display = 'none';
      this.value = '';
      isModified = true;
    }
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ADD DESIGNATION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  document.getElementById('btnAddDesignation')?.addEventListener('click', function() {
    document.getElementById('addDesignationPanel').classList.toggle('show');
  });

  function addOptionIfMissing(selectId, value) {
    const select = document.getElementById(selectId);
    if (!select || !value) return false;
    const normalizedValue = selectId === 'department' ? normalizeDepartmentValue(value) : value;
    if (!normalizedValue) return false;
    const exists = Array.from(select.options).some(opt => opt.value.toLowerCase() === normalizedValue.toLowerCase());
    if (exists) return false;
    const option = document.createElement('option');
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    select.appendChild(option);
    return true;
  }

  document.getElementById('btnSaveNewItem')?.addEventListener('click', async function() {
    const type = document.getElementById('new_item_type').value;
    const input = document.getElementById('new_item_name');
    const rawValue = (input.value || '').trim();
    const value = type === 'department' ? normalizeDepartmentValue(rawValue) : capitalizeFirst(rawValue);
    const shouldSubscribeProvider = type === 'designation'
      ? window.confirm('Should this new designation be subscribed to the provider list?')
      : false;
    if (!value) {
      alert('Please enter a department or designation name');
      return;
    }

    try {
      if (useApiData) {
        await saveLookupOptionToApi(type, value, shouldSubscribeProvider);
      }
    } catch (err) {
      console.warn('Failed to save lookup option via API', err);
      alert('Failed to save in backend');
      return;
    }

    if (type === 'department') {
      const added = addOptionIfMissing('department', value);
      document.getElementById('department').value = normalizeDepartmentValue(value);
      if (added) refreshDepartmentFilterOptions();
      alert(added ? 'Department added and selected.' : 'Department already exists.');
    } else {
      const added = addOptionIfMissing('designation', value);
      document.getElementById('designation').value = value;
      updateDesignationChooserColor();
      renderEmployeeSummaryBar();
      if (shouldSubscribeProvider) {
        providerDesignationSet.add(String(value).toLowerCase());
      }
      if (added) {
        alert(`Designation added and selected.${shouldSubscribeProvider ? ' Subscribed to provider list.' : ''}`);
      } else {
        alert(`Designation already exists.${shouldSubscribeProvider ? ' Marked as provider designation.' : ''}`);
      }
    }

    input.value = '';
    isModified = true;
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FILE UPLOAD
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const fileDrop = document.getElementById('fileDrop');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const terminateFileDrop = document.getElementById('terminateFileDrop');
  const terminateFileInput = document.getElementById('terminateFileInput');
  const terminateFileList = document.getElementById('terminateFileList');
  const dropPurposeModal = document.getElementById('dropPurposeModal');
  const dropPurposeFileName = document.getElementById('dropPurposeFileName');
  const dropPurposeSelect = document.getElementById('dropPurposeSelect');
  const dropPurposeCancelBtn = document.getElementById('dropPurposeCancelBtn');
  const dropPurposeConfirmBtn = document.getElementById('dropPurposeConfirmBtn');
  let dropPurposeResolve = null;
  let dropPurposeOptions = [];

  function getReminderLabel(reminderKey) {
    if (reminderKey === 'other') {
      const custom = String(document.getElementById('req_other_text')?.value || '').trim();
      return custom || 'Other';
    }
    return REQUIRED_DOC_MAP[reminderKey]?.label || reminderKey;
  }

  function getCheckedRequiredReminders() {
    return REQUIRED_DOC_DEFINITIONS
      .map((entry) => {
        const checkbox = document.querySelector(`[data-reminder-key="${entry.key}"]`);
        if (!checkbox || !checkbox.checked) return null;
        return {
          key: entry.key,
          label: getReminderLabel(entry.key),
          category: `required:${entry.key}`
        };
      })
      .filter(Boolean);
  }

  function buildTimestampTag() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
  }

  function sanitizeReminderFileName(label) {
    return String(label || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildReminderUploadName(label, originalName) {
    const safeLabel = sanitizeReminderFileName(label) || 'Document';
    const original = String(originalName || 'file');
    const idx = original.lastIndexOf('.');
    const ext = idx > 0 ? original.slice(idx) : '';
    return `${safeLabel} (${buildTimestampTag()})${ext}`;
  }

  function untickReminder(reminderKey) {
    const checkbox = document.querySelector(`[data-reminder-key="${reminderKey}"]`);
    if (checkbox) checkbox.checked = false;
  }

  function closeDropPurposeModal(selectedOption) {
    if (!dropPurposeResolve) return;
    const resolver = dropPurposeResolve;
    dropPurposeResolve = null;
    dropPurposeModal.classList.remove('open');
    dropPurposeModal.setAttribute('aria-hidden', 'true');
    resolver(selectedOption || null);
  }

  function askDropPurpose(reminders, fileName) {
    const options = [...reminders, { key: 'general', label: 'General Document', category: 'general' }];
    dropPurposeOptions = options;
    dropPurposeFileName.textContent = `File: ${fileName}`;
    dropPurposeSelect.innerHTML = options
      .map((opt, index) => `<option value="${index}">${opt.label}</option>`)
      .join('');
    dropPurposeSelect.value = '0';
    dropPurposeModal.classList.add('open');
    dropPurposeModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => dropPurposeSelect.focus(), 0);

    return new Promise((resolve) => {
      dropPurposeResolve = resolve;
    });
  }

  async function buildPendingGeneralEntries(fileCollection, askPurpose) {
    const files = Array.from(fileCollection || []);
    if (!files.length) return [];

    const reminders = getCheckedRequiredReminders();
    const entries = [];
    let reminderCursor = 0;

    for (const file of files) {
      let purpose = null;
      if (askPurpose) {
        purpose = await askDropPurpose(reminders, file.name);
      } else if (reminders.length === 1) {
        purpose = reminders[0];
      } else if (reminders.length > 1) {
        purpose = reminders[Math.min(reminderCursor, reminders.length - 1)];
        reminderCursor += 1;
      }

      if (!purpose) {
        purpose = { key: 'general', label: 'General Document', category: 'general' };
      }

      const uploadName = buildReminderUploadName(purpose.label, file.name);
      entries.push({
        file,
        category: purpose.category,
        uploadName,
        reminderLabel: purpose.label,
        reminderKey: purpose.key
      });

      if (purpose.category.startsWith('required:')) {
        untickReminder(purpose.key);
      }
    }

    return entries;
  }

  function updateFileList(entries) {
    if (!entries || entries.length === 0) {
      fileList.textContent = 'No files added';
      pendingGeneralFiles = [];
      return;
    }
    pendingGeneralFiles = entries;
    fileList.textContent = entries.map((entry, i) => `${i+1}. ${entry.uploadName} [${entry.reminderLabel}]`).join('\n');
  }

  function updateTerminateFileList(files) {
    if (!files || files.length === 0) {
      terminateFileList.textContent = 'No termination files added';
      pendingTerminationFiles = [];
      return;
    }
    pendingTerminationFiles = Array.from(files);
    terminateFileList.textContent = Array.from(files).map((f, i) => `${i+1}. ${f.name}`).join('\n');
  }

  function appendUploadedFiles(entries, prefixLabel) {
    const uploadedFilesList = document.getElementById('uploadedFilesList');
    if (!entries || entries.length === 0 || !uploadedFilesList) return;
    if (uploadedFilesList.textContent === 'No files uploaded yet.') {
      uploadedFilesList.innerHTML = '';
    }
    const employeeTag = String(currentEmployeeId || getValue('emp_id') || 'AUTO');
    const timestampTag = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const rows = Array.from(entries).map(entry =>
      `<div style="margin-bottom:6px;">${prefixLabel}: ${entry.uploadName || entry.file?.name || 'file'} <span style="color:#777;">[Pending upload | ${entry.reminderLabel || 'General'} | EmpID: ${employeeTag} | ${timestampTag}]</span></div>`
    ).join('');
    uploadedFilesList.innerHTML = rows + uploadedFilesList.innerHTML;
  }

  fileDrop?.addEventListener('dragover', (e) => { 
    e.preventDefault(); 
    fileDrop.classList.add('drag'); 
  });
  fileDrop?.addEventListener('dragleave', () => fileDrop.classList.remove('drag'));
  fileDrop?.addEventListener('drop', async (e) => {
    e.preventDefault();
    fileDrop.classList.remove('drag');
    const entries = await buildPendingGeneralEntries(e.dataTransfer.files, true);
    if (!entries.length) return;
    const merged = pendingGeneralFiles.concat(entries);
    updateFileList(merged);
    appendUploadedFiles(entries, 'File');
    isModified = true;
  });
  fileInput?.addEventListener('change', async (e) => {
    const entries = await buildPendingGeneralEntries(e.target.files, false);
    if (!entries.length) return;
    const merged = pendingGeneralFiles.concat(entries);
    updateFileList(merged);
    appendUploadedFiles(entries, 'File');
    isModified = true;
  });

  terminateFileDrop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    terminateFileDrop.classList.add('drag');
  });
  terminateFileDrop?.addEventListener('dragleave', () => terminateFileDrop.classList.remove('drag'));
  terminateFileDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    terminateFileDrop.classList.remove('drag');
    updateTerminateFileList(e.dataTransfer.files);
    appendUploadedFiles(Array.from(e.dataTransfer.files).map((file) => ({ file, uploadName: file.name, reminderLabel: 'Termination Document' })), 'Termination Doc');
    isModified = true;
  });
  terminateFileInput?.addEventListener('change', (e) => {
    updateTerminateFileList(e.target.files);
    appendUploadedFiles(Array.from(e.target.files).map((file) => ({ file, uploadName: file.name, reminderLabel: 'Termination Document' })), 'Termination Doc');
    isModified = true;
  });

  if (dropPurposeCancelBtn) {
    dropPurposeCancelBtn.addEventListener('click', () => closeDropPurposeModal(null));
  }
  if (dropPurposeConfirmBtn) {
    dropPurposeConfirmBtn.addEventListener('click', () => {
      const index = Number(dropPurposeSelect?.value || '0');
      const selected = Number.isFinite(index) ? dropPurposeOptions[index] : null;
      closeDropPurposeModal(selected || null);
    });
  }
  if (dropPurposeModal) {
    dropPurposeModal.addEventListener('click', (e) => {
      if (e.target === dropPurposeModal) {
        closeDropPurposeModal(null);
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (!dropPurposeModal || !dropPurposeModal.classList.contains('open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropPurposeModal(null);
      return;
    }
    if (e.key === 'Enter' && (e.target === dropPurposeSelect || e.target === dropPurposeConfirmBtn)) {
      e.preventDefault();
      const index = Number(dropPurposeSelect?.value || '0');
      const selected = Number.isFinite(index) ? dropPurposeOptions[index] : null;
      closeDropPurposeModal(selected || null);
    }
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PHOTO UPLOAD
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const photoDropZone = document.getElementById('photoDropZone');
  const photoFileInput = document.getElementById('photoFileInput');
  const photoPreview = document.getElementById('photoPreview');
  const photoImage = document.getElementById('photoImage');
  const btnRemovePhoto = document.getElementById('btnRemovePhoto');

  function displayPhoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    pendingPhotoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      photoImage.src = e.target.result;
      photoPreview.style.display = 'block';
      photoDropZone.style.display = 'none';
      document.portfolio_photo_data = e.target.result;
      
      // Add photo to uploaded files list
      appendUploadedFiles([{ file, uploadName: file.name, reminderLabel: 'Portrait Photo' }], 'Portrait Photo');
      isModified = true;
    };
    reader.readAsDataURL(file);
  }

  photoDropZone?.addEventListener('click', () => photoFileInput.click());
  photoDropZone?.addEventListener('dragover', (e) => { 
    e.preventDefault(); 
    photoDropZone.classList.add('drag'); 
  });
  photoDropZone?.addEventListener('dragleave', () => photoDropZone.classList.remove('drag'));
  photoDropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    photoDropZone.classList.remove('drag');
    if (e.dataTransfer.files.length > 0) displayPhoto(e.dataTransfer.files[0]);
  });

  photoFileInput?.addEventListener('change', (e) => {
    if (e.target.files.length > 0) displayPhoto(e.target.files[0]);
  });

  btnRemovePhoto?.addEventListener('click', () => {
    photoImage.src = '';
    photoPreview.style.display = 'none';
    photoDropZone.style.display = 'block';
    photoFileInput.value = '';
    document.portfolio_photo_data = null;
    pendingPhotoFile = null;
    
    // Remove photo from uploaded files list
    const uploadedFilesList = document.getElementById('uploadedFilesList');
    const photoItem = uploadedFilesList.querySelector('div:first-child');
    if (photoItem && photoItem.textContent.includes('Portrait Photo')) {
      photoItem.remove();
      if (uploadedFilesList.innerHTML.trim() === '') {
        uploadedFilesList.textContent = 'No files uploaded yet.';
      }
    }
    isModified = true;
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EDIT MODE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function enterEditMode() {
    isEditMode = true;
    setFieldsDisabled(false);
    const editBtn = document.getElementById('btnEdit');
    if (editBtn) {
      editBtn.style.display = 'inline-block';
      editBtn.textContent = 'Save';
    }
    document.getElementById('btnCancel').style.display = 'inline-block';
    applyPermissionLevelCap();
    updateNavigationButtons();
  }

  function exitEditMode() {
    isEditMode = false;
    setFieldsDisabled(true);
    const editBtn = document.getElementById('btnEdit');
    if (isExistingEmployee) {
      if (editBtn) editBtn.style.display = 'inline-block';
    } else {
      if (editBtn) editBtn.style.display = 'none';
    }
    if (editBtn) editBtn.textContent = 'Edit';
    document.getElementById('btnCancel').style.display = 'none';
    applyPermissionLevelCap();
    updateNavigationButtons();
  }

  getPermissionLevelCheckboxes().forEach((input) => {
    input.addEventListener('change', () => {
      if (!canEditLoadedEmployeePermission()) {
        setSelectedPermissionLevel(loadedEmployeePermissionLevel, { fallbackToCap: false });
        alert('You cannot change permission status for a user with the same or higher permission level.');
        return;
      }
      if (!input.checked) {
        input.checked = true;
      }
      setSelectedPermissionLevel(input.dataset.permissionLevel || 'General User', { fallbackToCap: true });
      isModified = true;
      applyPermissionLevelCap();
    });
  });

  window.addEventListener('popstate', () => {
    const currentParams = new URLSearchParams(window.location.search);
    const currentId = currentParams.get('id');
    const currentMode = String(currentParams.get('mode') || '').trim().toLowerCase();
    if (currentId) {
      loadEmployeeById(currentId, { syncUrl: false, openMode: currentMode });
    }
  });

  ['first_name', 'surname'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) {
      elem.addEventListener('input', updateEmployeeIdentityTitle);
      elem.addEventListener('change', updateEmployeeIdentityTitle);
    }
  });

  document.getElementById('btnCancel')?.addEventListener('click', function() {
    if (isModified && !confirm('Discard unsaved changes?')) return;
    if (isExistingEmployee) {
      exitEditMode();
    } else {
      location.href = location.pathname;
    }
  });

  async function saveCurrentForm({ showSuccessMessage = true } = {}) {
    updateFieldsDisplay();
    const payload = collectEmployeePayload();

    const saveDemo = () => {
      if (!currentPayrollDetail) {
        currentPayrollDetail = getDefaultPayrollDetail();
      }
      currentPayrollDetail.base_wage_amount = getValue('base_wage_amount');
      currentPayrollDetail.base_wage_basis = getValue('base_wage_basis') || 'month';
      currentPayrollDetail.base_wage_effective = getValue('base_wage_effective') || '';
      persistPayrollDetailForCurrentEmployee();
      isModified = false;
      if (showSuccessMessage) alert('Form saved');
      if (isExistingEmployee) {
        exitEditMode();
      }
      return true;
    };

    if (!useApiData) {
      return saveDemo();
    }

    const targetUrl = isExistingEmployee && currentEmployeeId
      ? `${EMPLOYEE_FORM_API_BASE}/${encodeURIComponent(currentEmployeeId)}`
      : EMPLOYEE_FORM_API_BASE;

    try {
      setSaveStatus('saving', 'Saving...');
      const result = await apiRequest(targetUrl, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (result?.emp_id) {
        currentEmployeeId = String(result.emp_id);
        setValue('emp_id', currentEmployeeId);
        isExistingEmployee = true;
        updatePushOpenDentalVisibility();
        syncEmployeeUrl(currentEmployeeId, false);
        await loadEmployeeIndexFromApi();
      }

      let uploaded = [];
      try {
        uploaded = await uploadPendingDocuments(currentEmployeeId);
        if (uploaded.length) {
          const docsPayload = await apiRequest(`${EMPLOYEE_FORM_API_BASE}/${encodeURIComponent(currentEmployeeId)}/documents`);
          renderDocumentsFromApi(Array.isArray(docsPayload?.documents) ? docsPayload.documents : []);
        }
      } catch (uploadErr) {
        console.warn('Document upload failed after employee save', uploadErr);
        alert('Form saved, but document upload failed. Please retry Save for documents.');
      }

      isModified = false;
      exitEditMode();
      updatePushOpenDentalVisibility();
      updateNavigationButtons();
      setSaveStatus('saved', `Saved at ${saveStatusTimeLabel()}`);

      if (showSuccessMessage) {
        alert('Form saved');
      }
      return true;
    } catch (err) {
      console.warn('Save API failed', err);
      setSaveStatus('error', 'Save failed');
      alert(err?.message || 'Failed to save form');
      return false;
    }
  }

  async function confirmSaveOrDiscardBeforeLeave() {
    if (!(isModified && isEditMode)) return true;
    const shouldSave = confirm('You have unsaved changes. Press OK to save, or Cancel to discard.');
    if (!shouldSave) {
      isModified = false;
      return true;
    }
    return saveCurrentForm({ showSuccessMessage: true });
  }

  const btnEdit = document.getElementById('btnEdit');
  if (btnEdit) {
    btnEdit.addEventListener('click', async () => {
      if (!isEditMode) {
        enterEditMode();
        return;
      }
      await saveCurrentForm({ showSuccessMessage: true });
    });
  }

  if (btnPushOpenDental) {
    btnPushOpenDental.addEventListener('click', async function() {
      if (!useApiData) {
        alert('OpenDental push is available only when connected to API mode.');
        return;
      }
      const saved = await saveCurrentForm({ showSuccessMessage: false });
      if (!saved || !isExistingEmployee || !currentEmployeeId) return;

      try {
        setSaveStatus('saving', 'Saving and syncing OpenDental...');
        await apiRequest(`${EMPLOYEE_FORM_API_BASE}/${encodeURIComponent(currentEmployeeId)}/opendental-sync`, {
          method: 'POST',
          body: JSON.stringify({ dry_run: false })
        });
        setSaveStatus('saved', `Saved at ${saveStatusTimeLabel()}`);
        alert('form has been saved and Opendental updated');
      } catch (error) {
        setSaveStatus('error', 'OpenDental sync failed after save');
        const message = error?.message || 'Failed to queue OpenDental sync';
        alert(message);
      }
    });
  }

  document.getElementById('btnPrint')?.addEventListener('click', () => window.print());

  document.getElementById('btnTerminate')?.addEventListener('click', function() {
    const terminationDate = String(getValue('termination_date') || '').trim();
    if (!terminationDate) {
      alert('Please set a termination date first.');
      return;
    }
    const termAt = new Date(`${terminationDate}T00:00:00`);
    if (Number.isNaN(termAt.getTime())) {
      alert('Please enter a valid termination date.');
      return;
    }
    const activationAt = new Date(termAt.getTime());
    activationAt.setDate(activationAt.getDate() + 1);
    const activationLabel = activationAt.toISOString().slice(0, 10);
    alert(`Termination scheduled. Access will be removed automatically on ${activationLabel}.`);
    isModified = true;
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // LOAD EMPLOYEE OR NEW FORM
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const params = new URLSearchParams(window.location.search);
  const empId = params.get('id');

  if (empId) {
    const idPill = document.getElementById('currentEmpIdDisplay');
    if (idPill) idPill.textContent = `Emp ID: ${empId}`;
    const identity = document.getElementById('empIdentity');
    if (identity) identity.textContent = `Loading employee ${empId}...`;
  }

  refreshDepartmentFilterOptions();

  initApiAccess().then((ok) => {
    if (!ok) return;
    if (empId) {
      loadEmployeeById(empId, { openMode: openInEditMode ? 'edit' : 'view' });
      return;
    }
    const ids = getFilteredEmployeeIds();
    if (ids.length) {
      loadEmployeeById(ids[0]);
    }
  });

  if (btnLoginEl) {
    btnLoginEl.style.display = 'none';
  }

  if (btnLogoutEl) {
    btnLogoutEl.addEventListener('click', () => {
      clearStoredAuth();
      useApiData = false;
      setPreviewMode(true, 'Signed out');
      setAuthUi(false, 'Signed out');
    });
  }

  if (btnHeaderLogoutEl) {
    btnHeaderLogoutEl.addEventListener('click', async () => {
      const canLeave = await confirmSaveOrDiscardBeforeLeave();
      if (!canLeave) return;
      clearStoredAuth();
      useApiData = false;
      setPreviewMode(true, 'Signed out');
      setAuthUi(false, 'Signed out');
      window.location.href = `./login.html?api_origin=${encodeURIComponent(API_ORIGIN)}`;
    });
  }

  if (btnBackToHub) {
    btnBackToHub.addEventListener('click', async () => {
      const canLeave = await confirmSaveOrDiscardBeforeLeave();
      if (!canLeave) return;
      window.location.href = './empinfo-dashboard.html?api_origin=' + encodeURIComponent(API_ORIGIN);
    });
  }
  if (btnMcodezTitleHome) {
    btnMcodezTitleHome.addEventListener('click', async () => {
      const canLeave = await confirmSaveOrDiscardBeforeLeave();
      if (!canLeave) return;
      window.location.href = `./app-hub.html?api_origin=${encodeURIComponent(API_ORIGIN)}`;
    });
  }

  if (btnNavBack) {
    btnNavBack.addEventListener('click', async () => {
      navigateEmployee(-1);
    });
  }

  if (btnNavForward) {
    btnNavForward.addEventListener('click', async () => {
      navigateEmployee(1);
    });
  }

  // Do not reset a record page after API load; only initialize blank form when no id is requested.
  if (!empId && !(allowSamplePreview && sampleData[empId])) {
    clearFormFields();
    isExistingEmployee = false;
    currentEmployeeId = null;
    const empMode = document.getElementById('empMode');
    if (empMode) empMode.textContent = 'New';
    document.getElementById('empIdentity').textContent = 'New Employee';
    document.getElementById('currentEmpIdDisplay').textContent = 'Emp ID: AUTO';
    setStatusDisplay('Prospective');
    enterEditMode();
    currentPayrollDetail = getDefaultPayrollDetail();
    setValue('base_wage_basis', 'month');
    renderBonusTable();
    updatePayrollMath();
    renderPayrollSubscriptionLinks();
  }
  initGeoAutocomplete();

  document.addEventListener('input', () => {
    if (!useApiData || !isEditMode) return;
    if (!isModified) return;
    setSaveStatus('idle', 'Unsaved changes');
  }, true);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // UNSAVED CHANGES WARNING
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  document.addEventListener('change', function() {
    if (isEditMode) isModified = true;
  });

  // Call updatePayrollDisplay on page load
  applyPayrollAdminVisibility();

  document.getElementById('btnApplyWage')?.addEventListener('click', function() {
    const amount = toNumber(getValue('base_wage_amount'));
    const effective = String(getValue('base_wage_effective') || '');
    if (!amount || !effective) {
      alert('Please set base wage amount and effective date');
      return;
    }
    if (!currentPayrollDetail) currentPayrollDetail = getDefaultPayrollDetail();
    currentPayrollDetail.base_wage_amount = amount;
    currentPayrollDetail.base_wage_basis = String(getValue('base_wage_basis') || 'month');
    currentPayrollDetail.base_wage_effective = effective;
    currentPayrollDetail.wage_history = currentPayrollDetail.wage_history || [];
    currentPayrollDetail.wage_history.unshift({
      amount,
      basis: currentPayrollDetail.base_wage_basis,
      effective_from: effective,
      changed_at: new Date().toISOString()
    });
    persistPayrollDetailForCurrentEmployee();
    updatePayrollMath();
    isModified = true;
    alert('Base wage recorded. Click Save to confirm employee changes.');
  });

  document.getElementById('btnAddBonus')?.addEventListener('click', function() {
    const type = String(getValue('bonus_type') || '').trim();
    const mode = String(getValue('bonus_mode') || 'amount');
    const value = toNumber(getValue('bonus_value'));
    const frequency = String(getValue('bonus_frequency') || 'monthly');
    const effective_from = String(getValue('bonus_effective') || '');
    if (!type || !value || !effective_from) {
      alert('Please enter bonus type, value and effective date');
      return;
    }
    if (!currentPayrollDetail) currentPayrollDetail = getDefaultPayrollDetail();
    currentPayrollDetail.bonuses = currentPayrollDetail.bonuses || [];
    currentPayrollDetail.bonuses.push({
      type,
      mode,
      value,
      frequency,
      effective_from,
      created_at: new Date().toISOString(),
      ended_on: ''
    });
    persistPayrollDetailForCurrentEmployee();
    setValue('bonus_type', '');
    setValue('bonus_value', '');
    setValue('bonus_effective', '');
    renderBonusTable();
    updatePayrollMath();
    isModified = true;
  });

  updatePayrollDisplay();
  updateTaxMaritalDisplay();
  updateDesignationChooserColor();
  toggleSpouseTax();
  updateEmployeeIdentityTitle();
  renderEmployeeSummaryBar();
  updateNavigationButtons();

  window.addEventListener('beforeunload', function(e) {
    if (isModified && isEditMode) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Continue?';
      return 'You have unsaved changes. Continue?';
    }
  });
  
