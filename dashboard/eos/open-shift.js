(function () {
  'use strict';

  const API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';
  const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
  const WORKSTATION_CONFIGS_STORAGE_KEY = 'eos.workstation.configs.v1';
  const GENERATED_WORKSTATION_ID_STORAGE_KEY = 'eos.workstation.generated_id.v1';
  const NAMED_WORKSTATION_ALIAS_STORAGE_KEY = 'eos.workstation.named_alias.v1';
  const ACTIVE_SHIFT_SESSION_STORAGE_KEY = 'eos.active_shift_session.v1';
  const OPEN_SHIFT_NOTICE_STORAGE_KEY = 'eos.open_shift.notice.v1';
  const DEFAULT_API_ORIGIN = window.location.port === '8055'
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:8055`;
  const REDIRECT_DELAY_MS = 1700;
  const DEPARTMENT_OPTIONS = ['MDCZ', 'MDCQ', 'MPLUS', 'BLUMV'];
  const ACTIVE_LOCATION_OPTIONS = ['ZABBAR', 'QORMI'];
  const LOCATION_DIRECTORY = {
    ZABBAR: { code: 'ZABBAR', label: 'Zabbar Reception' },
    QORMI: { code: 'QORMI', label: 'Qormi Reception' },
    GZIRA: { code: 'GZIRA', label: 'Gzira' },
    VALLETTA: { code: 'VALLETTA', label: 'Valletta' },
    UNKNOWN: { code: 'UNKNOWN', label: 'Unknown Reception' }
  };
  const LOCATION_SHIFT_DEFAULTS = {
    ZABBAR: { location_code: 'ZABBAR', department_code: 'MDCZ', clinic_code: 'MDCZ', display_name: 'Zabbar' },
    QORMI: { location_code: 'QORMI', department_code: 'MDCQ', clinic_code: 'MDCQ', display_name: 'Qormi' }
  };
  const NAMED_WORKSTATION_OPTIONS = {
    CHRIS_LAPTOP: {
      option_value: 'CHRIS_LAPTOP',
      workstation_id: 'named:chris_laptop',
      workstation_alias: 'chris_laptop',
      display_name: 'Chris laptop',
      default_location_code: 'QORMI'
    }
  };

  const state = {
    busy: false,
    currentUser: 'Reception User',
    currentRole: 'operational',
    workstation: null,
    workstationConfig: null,
    detectedLocation: { ...LOCATION_DIRECTORY.UNKNOWN, detection_rule: 'unmapped' },
    selectedLocationCode: '',
    registeredDepartment: '',
    pendingRegistrationLocation: '',
    isRegistrationPending: false,
    availableLocations: [],
    openingShift: createDefaultOpeningShift(),
    openingSavePending: false,
    shiftSessionUi: createEmptyShiftSessionUiState(),
    managerResolutionPreview: createEmptyManagerResolutionPreviewState(),
    discrepancyEventDraft: null,
    liveNow: new Date(),
    completionRedirectPending: false,
    completionMessage: '',
    completionTitle: 'Opening values saved',
    redirectTimerId: 0
  };

  const refs = {
    errorBanner: document.getElementById('errorBanner'),
    infoBanner: document.getElementById('infoBanner'),
    topDateLabel: document.getElementById('topDateLabel'),
    topTimeLabel: document.getElementById('topTimeLabel'),
    btnAppHub: document.getElementById('btnAppHub'),
    btnCashboxHandover: document.getElementById('btnCashboxHandover'),
    loginUserCompact: document.getElementById('loginUserCompact'),
    loginLocationCompact: document.getElementById('loginLocationCompact'),
    loginWorkstationCompact: document.getElementById('loginWorkstationCompact'),
    openingLocationSelect: document.getElementById('openingLocationSelect'),
    selectedLocationDisplay: document.getElementById('selectedLocationDisplay'),
    selectedLocationHint: document.getElementById('selectedLocationHint'),
    openingMetaNote: document.getElementById('openingMetaNote'),
    lastShiftClosingCash: document.getElementById('lastShiftClosingCash'),
    lastCloseAmountDisplay: document.getElementById('lastCloseAmountDisplay'),
    openingCashMatchesToggle: document.getElementById('openingCashMatchesToggle'),
    openingCashMatchesLabel: document.getElementById('openingCashMatchesLabel'),
    openingOverrideFields: document.getElementById('openingOverrideFields'),
    actualOpeningCash: document.getElementById('actualOpeningCash'),
    overrideReasonSelect: document.getElementById('overrideReasonSelect'),
    openingNote: document.getElementById('openingNote'),
    managerPreviewPanel: document.getElementById('managerPreviewPanel'),
    openingErrorBanner: document.getElementById('openingErrorBanner'),
    openingResponsePanel: document.getElementById('openingResponsePanel'),
    btnSaveOpening: document.getElementById('btnSaveOpening'),
    registrationBackdrop: document.getElementById('registrationBackdrop'),
    registrationWorkstationName: document.getElementById('registrationWorkstationName'),
    registrationWorkstationSource: document.getElementById('registrationWorkstationSource'),
    registrationLocationRule: document.getElementById('registrationLocationRule'),
    registrationLocationSelect: document.getElementById('registrationLocationSelect'),
    registrationSuggestion: document.getElementById('registrationSuggestion'),
    btnConfirmRegistration: document.getElementById('btnConfirmRegistration'),
    completionBackdrop: document.getElementById('completionBackdrop'),
    completionTitle: document.getElementById('completionTitle'),
    completionMessage: document.getElementById('completionMessage')
  };

  function createDefaultOpeningShift(now = new Date()) {
    return {
      shift_date: formatLocalDate(now),
      opening_timestamp: formatLocalDateTime(now),
      last_shift_closing_cash: '245.00',
      opening_cash_matches: true,
      actual_opening_cash: '',
      override_reason: '',
      note: '',
      saved_at: null,
      shift_session_id: null
    };
  }

  function createEmptyShiftSessionUiState() {
    return {
      action_code: '',
      message: '',
      shift_session: null,
      allowed_actions: [],
      required_reason_fields: [],
      required_reason_fields_by_action: {},
      placeholder_values: {
        takeover_reason: '',
        abandon_reason: '',
        supersede_reason: '',
        temporary_close_reason: '',
        discrepancy_note: ''
      }
    };
  }

  function createEmptyManagerResolutionPreviewState() {
    return {
      loading: false,
      error: '',
      request_key: '',
      department_id: '',
      department_code: '',
      department_name: '',
      at_datetime: '',
      preview: null
    };
  }

  function createDiscrepancyEventDraftId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `eos-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getFallbackLocationOptions() {
    return Object.values(LOCATION_SHIFT_DEFAULTS).map((entry) => ({
      id: null,
      code: entry.location_code,
      label: entry.display_name,
      source: 'fallback'
    }));
  }

  function normalizeApiOrigin(origin) {
    return String(origin || '').trim().replace(/\/$/, '');
  }

  function getApiOrigin() {
    const params = new URLSearchParams(window.location.search);
    try {
      return (
        normalizeApiOrigin(params.get('api_origin')) ||
        normalizeApiOrigin(localStorage.getItem(API_ORIGIN_STORAGE_KEY)) ||
        normalizeApiOrigin(DEFAULT_API_ORIGIN)
      );
    } catch {
      return normalizeApiOrigin(DEFAULT_API_ORIGIN);
    }
  }

  function getEosApiOrigin() {
    const params = new URLSearchParams(window.location.search);
    return (
      normalizeApiOrigin(params.get('eos_api_origin')) ||
      normalizeApiOrigin(params.get('od_api_origin')) ||
      normalizeApiOrigin(window.location.origin) ||
      normalizeApiOrigin(getApiOrigin())
    );
  }

  function readStoredAuth() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function resolveCurrentUserLabel() {
    const auth = readStoredAuth();
    const params = new URLSearchParams(window.location.search);
    const candidates = [
      auth && auth.user && auth.user.first_name && auth.user.last_name ? `${auth.user.first_name} ${auth.user.last_name}` : '',
      auth && auth.user && auth.user.first_name ? auth.user.first_name : '',
      auth && auth.user ? auth.user.email : '',
      auth ? auth.email : '',
      auth ? auth.first_name : '',
      params.get('user')
    ].filter(Boolean);
    return candidates.length ? String(candidates[0]) : 'Reception User';
  }

  function resolveCurrentRole() {
    const auth = readStoredAuth();
    const params = new URLSearchParams(window.location.search);
    const candidates = [
      auth && auth.user && auth.user.role && auth.user.role.name,
      auth && auth.user ? auth.user.role_name : '',
      auth ? auth.role : '',
      params.get('eos_role'),
      params.get('role')
    ].filter(Boolean);
    return candidates.length ? String(candidates[0]).trim().toLowerCase() : 'operational';
  }

  function normalizeDepartmentCode(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return DEPARTMENT_OPTIONS.includes(normalized) ? normalized : '';
  }

  function normalizeLocationCode(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(LOCATION_DIRECTORY, normalized) ? normalized : 'UNKNOWN';
  }

  function getNamedWorkstationOption(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(NAMED_WORKSTATION_OPTIONS, normalized)
      ? NAMED_WORKSTATION_OPTIONS[normalized]
      : null;
  }

  function normalizeRegistrationSelection(value) {
    const namedOption = getNamedWorkstationOption(value);
    if (namedOption) return namedOption.option_value;
    const normalizedLocationCode = normalizeLocationCode(value);
    return isActiveOpenShiftLocation(normalizedLocationCode) ? normalizedLocationCode : '';
  }

  function isValidRegistrationSelection(value) {
    return Boolean(normalizeRegistrationSelection(value));
  }

  function readSavedNamedWorkstationAlias() {
    try {
      const savedValue = String(localStorage.getItem(NAMED_WORKSTATION_ALIAS_STORAGE_KEY) || '').trim().toUpperCase();
      return getNamedWorkstationOption(savedValue) ? savedValue : '';
    } catch {
      return '';
    }
  }

  function writeSavedNamedWorkstationAlias(aliasCode) {
    try {
      const namedOption = getNamedWorkstationOption(aliasCode);
      if (!namedOption) {
        localStorage.removeItem(NAMED_WORKSTATION_ALIAS_STORAGE_KEY);
        return;
      }
      localStorage.setItem(NAMED_WORKSTATION_ALIAS_STORAGE_KEY, namedOption.option_value);
    } catch {}
  }

  function buildNamedWorkstation(aliasCode) {
    const namedOption = getNamedWorkstationOption(aliasCode);
    if (!namedOption) return null;
    return {
      id: namedOption.workstation_id,
      display_name: namedOption.display_name,
      source: 'saved_named_alias',
      identifier_probe: `${namedOption.workstation_alias} ${namedOption.display_name}`.toLowerCase(),
      named_alias: namedOption.option_value
    };
  }

  function isChrisUser() {
    const auth = readStoredAuth();
    const candidates = [
      state.currentUser,
      auth && auth.user ? auth.user.email : '',
      auth ? auth.email : '',
      auth && auth.user ? auth.user.first_name : ''
    ]
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean);
    return candidates.some((entry) => (
      entry.includes('chrisgauci') ||
      entry.includes('drchrisgauci') ||
      entry.includes('christian') ||
      entry === 'chris'
    ));
  }

  function isActiveOpenShiftLocation(value) {
    return ACTIVE_LOCATION_OPTIONS.includes(normalizeLocationCode(value));
  }

  function getLocationShiftDefaults(locationCode) {
    const normalized = normalizeLocationCode(locationCode);
    return LOCATION_SHIFT_DEFAULTS[normalized]
      ? { ...LOCATION_SHIFT_DEFAULTS[normalized] }
      : { location_code: normalized, department_code: '', clinic_code: '', display_name: LOCATION_DIRECTORY[normalized] ? LOCATION_DIRECTORY[normalized].label : normalized };
  }

  function getSelectedLocationCode() {
    return normalizeLocationCode(state.selectedLocationCode || state.detectedLocation.code);
  }

  function getSelectedLocationDefaults() {
    return getLocationShiftDefaults(getSelectedLocationCode());
  }

  function getTemporaryPreviewDepartmentCode(locationCode) {
    const normalizedLocationCode = normalizeLocationCode(locationCode);
    const defaults = getLocationShiftDefaults(normalizedLocationCode);
    // Preview-only mapping for Open Shift:
    // - current page is location-driven
    // - manager resolution is department-driven
    // - short-term rule is Zabbar -> MDCZ, Qormi -> MDCQ
    // TODO: Replace this temporary reception-to-department preview mapping once
    // Open Shift receives explicit department context from shared master data.
    // TODO: Zabbar/Qormi receptions can serve multiple departments, so the final
    // manager preview must resolve from the actual active department context.
    return normalizeDepartmentCode(defaults.department_code);
  }

  function normalizeLocationOption(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const raw = row;
    const code = normalizeLocationCode(raw.code);
    if (!code || code === 'UNKNOWN') return null;
    if (!Object.prototype.hasOwnProperty.call(LOCATION_SHIFT_DEFAULTS, code)) {
      // TODO: Expand EOS Open Shift support once reception-location-to-shift defaults
      // are fully driven by shared master data rather than the current Zabbar/Qormi mapping.
      return null;
    }
    if (raw.has_active_reception !== true) return null;
    if (raw.is_active === false) return null;
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null,
      code,
      label: LOCATION_SHIFT_DEFAULTS[code].display_name,
      source: 'api'
    };
  }

  function hasAvailableLocation(code) {
    const normalized = normalizeLocationCode(code);
    return state.availableLocations.some((entry) => entry.code === normalized);
  }

  function getSelectedLocationEntry() {
    const normalized = getSelectedLocationCode();
    return state.availableLocations.find((entry) => entry.code === normalized) || null;
  }

  function renderLocationSelectOptions() {
    const openingOptionMarkup = [
      '<option value="">Select location</option>',
      ...state.availableLocations.map((entry) => (
        `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`
      ))
    ].join('');
    const registrationOptionMarkup = [
      openingOptionMarkup,
      '<option value="" disabled>──────────</option>',
      `<option value="CHRIS_LAPTOP">${escapeHtml('Chris laptop (defaults to Qormi)')}</option>`
    ].join('');
    refs.openingLocationSelect.innerHTML = openingOptionMarkup;
    refs.registrationLocationSelect.innerHTML = registrationOptionMarkup;
  }

  function syncSystemOpeningFields(now = new Date()) {
    state.openingShift.shift_date = formatLocalDate(now);
    state.openingShift.opening_timestamp = formatLocalDateTime(now);
  }

  function formatLocalDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const copy = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
    return copy.toISOString().slice(0, 10);
  }

  function formatLocalDateTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const copy = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
    return copy.toISOString().slice(0, 16);
  }

  function normalizeIsoMinute(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setSeconds(0, 0);
    return parsed.toISOString();
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('en-GB');
  }

  function formatTopDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).toUpperCase();
  }

  function formatTopTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-MT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function extractSqlTimeFromLocalDateTime(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const parts = normalized.split('T');
    return parts[1] ? `${parts[1].slice(0, 5)}:00` : '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showBanner(element, message) {
    if (!element) return;
    element.textContent = String(message || '').trim();
    element.classList.toggle('hidden', !element.textContent);
  }

  function showError(message) { showBanner(refs.errorBanner, message); }
  function showInfo(message) { showBanner(refs.infoBanner, message); }
  function showOpeningInlineError(message) { showBanner(refs.openingErrorBanner, message); }

  function clearMessages() {
    showError('');
    showInfo('');
    showOpeningInlineError('');
  }

  function isOpeningFormComplete() {
    return Boolean(
      isActiveOpenShiftLocation(getSelectedLocationCode()) &&
      String(state.openingShift.last_shift_closing_cash || '').trim() &&
      (
        state.openingShift.opening_cash_matches ||
        (
          String(state.openingShift.actual_opening_cash || '').trim() &&
          String(state.openingShift.override_reason || '').trim()
        )
      )
    );
  }

  function readWorkstationRegistry() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORKSTATION_CONFIGS_STORAGE_KEY) || '{}');
      return {
        workstations: parsed && typeof parsed === 'object' && parsed.workstations && typeof parsed.workstations === 'object'
          ? parsed.workstations
          : {}
      };
    } catch {
      return { workstations: {} };
    }
  }

  function writeWorkstationRegistry(registry) {
    localStorage.setItem(WORKSTATION_CONFIGS_STORAGE_KEY, JSON.stringify({ version: 1, workstations: registry.workstations || {} }));
  }

  function getWorkstationConfig(workstationId) {
    const registry = readWorkstationRegistry();
    return registry.workstations[String(workstationId || '').trim()] || null;
  }

  function saveWorkstationConfig(config) {
    const id = String(config.workstation_id || '').trim();
    if (!id) throw new Error('workstation_id is required');
    const now = new Date().toISOString();
    const registry = readWorkstationRegistry();
    const existing = registry.workstations[id] || null;
    registry.workstations[id] = {
      workstation_id: id,
      department_code: normalizeDepartmentCode(config.department_code),
      location_code: normalizeLocationCode(config.location_code),
      created_at: existing && existing.created_at ? existing.created_at : now,
      updated_at: now,
      modified_by_user: config.modified_by_user ? String(config.modified_by_user).trim() : null
    };
    writeWorkstationRegistry(registry);
    return registry.workstations[id];
  }

  const workstationDetection = {
    resolve() {
      const params = new URLSearchParams(window.location.search);
      const explicit = String(params.get('workstation') || params.get('ws') || '').trim();
      if (explicit) {
        return {
          id: `query:${explicit.toLowerCase()}`,
          display_name: explicit,
          source: 'query_param',
          identifier_probe: explicit.toLowerCase()
        };
      }
      const savedNamedAlias = readSavedNamedWorkstationAlias();
      const namedWorkstation = buildNamedWorkstation(savedNamedAlias);
      if (namedWorkstation) {
        return namedWorkstation;
      }
      let generatedId = '';
      try {
        generatedId = String(localStorage.getItem(GENERATED_WORKSTATION_ID_STORAGE_KEY) || '').trim();
        if (!generatedId) {
          generatedId = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          localStorage.setItem(GENERATED_WORKSTATION_ID_STORAGE_KEY, generatedId);
        }
      } catch {
        generatedId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      return {
        id: `generated:${generatedId}`,
        display_name: `Local Browser ${generatedId.slice(0, 8)}`,
        source: 'browser_local_id',
        identifier_probe: generatedId.toLowerCase()
      };
    }
  };

  function detectLocation(workstation) {
    const params = new URLSearchParams(window.location.search);
    const explicit = String(params.get('location') || params.get('reception') || '').trim().toUpperCase();
    if (explicit && LOCATION_DIRECTORY[explicit]) return { ...LOCATION_DIRECTORY[explicit], detection_rule: 'query_param' };
    const probe = [workstation ? workstation.display_name : '', workstation ? workstation.identifier_probe : ''].join(' ').toLowerCase();
    if (probe.includes('zabbar') || probe.includes('eosz')) return { ...LOCATION_DIRECTORY.ZABBAR, detection_rule: 'identifier_heuristic' };
    if (probe.includes('qormi') || probe.includes('eosq')) return { ...LOCATION_DIRECTORY.QORMI, detection_rule: 'identifier_heuristic' };
    if (probe.includes('gzira')) return { ...LOCATION_DIRECTORY.GZIRA, detection_rule: 'identifier_heuristic' };
    if (probe.includes('valletta')) return { ...LOCATION_DIRECTORY.VALLETTA, detection_rule: 'identifier_heuristic' };
    return { ...LOCATION_DIRECTORY.UNKNOWN, detection_rule: 'unmapped' };
  }

  function buildRequestHeaders() {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (state.currentUser) {
      headers['x-user'] = state.currentUser;
      headers['x-auth-user'] = state.currentUser;
    }
    if (state.currentRole) {
      headers['x-eos-role'] = state.currentRole;
      headers['x-role'] = state.currentRole;
    }
    return headers;
  }

  function isDeveloperAdminWarningRole() {
    return state.currentRole === 'management' || state.currentRole === 'manager' || state.currentRole === 'admin';
  }

  function normalizeStringList(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  }

  function normalizeRequiredReasonFieldsByAction(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = {};
    Object.keys(value).forEach((key) => {
      normalized[key] = normalizeStringList(value[key]);
    });
    return normalized;
  }

  function normalizeShiftSessionApiResponse(httpStatus, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('EOS shift session API returned an invalid response.');
    }
    const fallbackId = String(payload.id || '').trim();
    const fallbackCreatedAt = String(payload.created_at || '').trim();
    const shiftSession = payload.shift_session && typeof payload.shift_session === 'object'
      ? payload.shift_session
      : fallbackId
        ? { id: fallbackId, created_at: fallbackCreatedAt || null }
        : null;
    const normalizedLocationCode = shiftSession
      ? normalizeLocationCode(shiftSession.location_code || getSelectedLocationCode())
      : getSelectedLocationCode();
    const defaults = getLocationShiftDefaults(normalizedLocationCode);
    return {
      http_status: Number(httpStatus || 0),
      action_code: String(payload.action_code || '').trim(),
      message: String(payload.message || '').trim(),
      error: String(payload.error || '').trim(),
      shift_session: shiftSession ? {
        id: String(shiftSession.id || '').trim(),
        location_code: normalizedLocationCode,
        department_code: normalizeDepartmentCode(shiftSession.department_code || defaults.department_code),
        clinic_code: normalizeDepartmentCode(shiftSession.clinic_code || defaults.clinic_code),
        shift_date: String(shiftSession.shift_date || '').trim(),
        shift_start_time: String(shiftSession.shift_start_time || '').trim(),
        created_at: String(shiftSession.created_at || fallbackCreatedAt || '').trim() || null,
        current_owner: String(shiftSession.current_owner || shiftSession.created_by || '').trim(),
        created_by: String(shiftSession.created_by || '').trim(),
        taken_over_from_user: String(shiftSession.taken_over_from_user || '').trim(),
        taken_over_at: String(shiftSession.taken_over_at || '').trim(),
        takeover_reason: String(shiftSession.takeover_reason || '').trim(),
        status: String(shiftSession.status || '').trim()
      } : null,
      audit: payload.audit && typeof payload.audit === 'object' ? payload.audit : null,
      allowed_actions: normalizeStringList(payload.allowed_actions),
      required_reason_fields: normalizeStringList(payload.required_reason_fields),
      required_reason_fields_by_action: normalizeRequiredReasonFieldsByAction(payload.required_reason_fields_by_action)
    };
  }

  function buildOpeningShiftSessionPayload() {
    syncSystemOpeningFields(new Date());
    const defaults = getSelectedLocationDefaults();
    return {
      location_code: defaults.location_code,
      department_code: normalizeDepartmentCode(defaults.department_code),
      clinic_code: normalizeDepartmentCode(defaults.clinic_code),
      shift_date: String(state.openingShift.shift_date || '').trim(),
      shift_start_time: extractSqlTimeFromLocalDateTime(state.openingShift.opening_timestamp),
      opening_cash: getOpeningCashUsed(),
      opening_cash_matches: Boolean(state.openingShift.opening_cash_matches),
      previous_cashbox_end: String(state.openingShift.last_shift_closing_cash || '').trim()
        ? Number(state.openingShift.last_shift_closing_cash)
        : null,
      corrected_opening_cash: state.openingShift.opening_cash_matches || !String(state.openingShift.actual_opening_cash || '').trim()
        ? null
        : Number(state.openingShift.actual_opening_cash)
    };
  }

  function buildDiscrepancyEventPayload(shiftSession) {
    const draft = state.discrepancyEventDraft;
    if (!draft || state.openingShift.opening_cash_matches) return null;
    // This payload is built from the in-memory discrepancy draft.
    // The backend now persists the discrepancy event and may create queue rows,
    // but actual delivery is still out of scope.
    return {
      event_type: draft.event_type,
      source_module: draft.source_module,
      shift_session_id: String((shiftSession && shiftSession.id) || draft.shift_session_id || '').trim() || null,
      report_header_id: draft.report_header_id,
      location_code: draft.location_code,
      department_code: draft.department_code,
      department_id: draft.department_id,
      created_by: draft.created_by,
      discrepancy_type: draft.discrepancy_type,
      discrepancy_amount: draft.discrepancy_amount,
      note: draft.note,
      manager_resolution_preview: draft.manager_resolution_preview,
      admin_summary_required: draft.admin_summary_required,
      status: draft.status
    };
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildRequestHeaders(),
      credentials: 'include',
      body: JSON.stringify(body)
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { response, normalized: normalizeShiftSessionApiResponse(response.status, payload) };
  }

  async function createDiscrepancyEventViaApi(payload) {
    // Persistence step only:
    // - stores eos_discrepancy_event
    // - may create internal queue rows if routing preview is sufficient
    // - does not deliver notifications yet
    const response = await fetch(new URL('/api/eos/discrepancy-events', `${getEosApiOrigin()}/`).toString(), {
      method: 'POST',
      headers: buildRequestHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      const errorMessage = body && typeof body.error === 'string'
        ? body.error
        : `Discrepancy event save failed (${response.status}).`;
      throw new Error(errorMessage);
    }
    return {
      id: String(body.id || '').trim(),
      created_at: String(body.created_at || '').trim() || null
    };
  }

  async function createShiftSessionViaApi(payload) {
    const { response, normalized } = await postJson(new URL('/api/eos/shift-sessions', `${getEosApiOrigin()}/`).toString(), payload);
    if (!response.ok && !normalized.action_code) {
      throw new Error(normalized.error || `EOS shift session request failed (${response.status}).`);
    }
    return normalized;
  }

  async function takeOverShiftSessionViaApi(shiftSessionId, takeoverReason) {
    const url = new URL(`/api/eos/shift-sessions/${encodeURIComponent(String(shiftSessionId || '').trim())}/takeover`, `${getEosApiOrigin()}/`).toString();
    const { response, normalized } = await postJson(url, { takeover_reason: takeoverReason });
    if (!response.ok) throw new Error(normalized.error || normalized.message || `EOS shift takeover failed (${response.status}).`);
    return normalized;
  }

  async function abandonShiftSessionViaApi(shiftSessionId, abandonReason) {
    const url = new URL(`/api/eos/shift-sessions/${encodeURIComponent(String(shiftSessionId || '').trim())}/abandon`, `${getEosApiOrigin()}/`).toString();
    const { response, normalized } = await postJson(url, { abandon_reason: abandonReason });
    if (!response.ok) throw new Error(normalized.error || normalized.message || `EOS shift abandonment failed (${response.status}).`);
    return normalized;
  }

  async function supersedeShiftSessionViaApi(shiftSessionId, supersedeReason, openingPayload) {
    const url = new URL(`/api/eos/shift-sessions/${encodeURIComponent(String(shiftSessionId || '').trim())}/supersede`, `${getEosApiOrigin()}/`).toString();
    const { response, normalized } = await postJson(url, { ...openingPayload, supersede_reason: supersedeReason });
    if (!response.ok) throw new Error(normalized.error || normalized.message || `EOS shift supersede failed (${response.status}).`);
    return normalized;
  }

  function buildAppHubUrl() {
    const url = new URL('../app-hub.html', window.location.href);
    url.search = `api_origin=${encodeURIComponent(getApiOrigin())}`;
    return url.toString();
  }

  function buildHandoverUrl() {
    const url = new URL('../handover.html', window.location.href);
    url.search = `api_origin=${encodeURIComponent(getApiOrigin())}`;
    return url.toString();
  }

  function persistNotice(message) {
    try {
      sessionStorage.setItem(OPEN_SHIFT_NOTICE_STORAGE_KEY, JSON.stringify({ level: 'info', message }));
    } catch {}
  }

  function persistActiveShiftSession(activeSession) {
    try {
      sessionStorage.setItem(ACTIVE_SHIFT_SESSION_STORAGE_KEY, JSON.stringify(activeSession));
    } catch {}
  }

  async function loadAvailableLocations() {
    const fallbackLocations = getFallbackLocationOptions();
    try {
      const url = new URL('/api/locations', `${getEosApiOrigin()}/`);
      // TODO: Full location master-data loading for Open Shift now comes from the backend.
      // TODO: Keep this endpoint aligned with the shared operations-platform master data.
      url.searchParams.set('has_active_reception', 'true');
      url.searchParams.set('is_active', 'true');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`Location lookup failed (${response.status})`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Location lookup did not return an array');
      }

      const rows = payload
        .map((entry) => normalizeLocationOption(entry))
        .filter(Boolean);

      state.availableLocations = rows.length ? rows : fallbackLocations;
      if (!rows.length) {
        console.warn('[EOS Open Shift] /api/locations returned no supported active-reception locations. Using fallback list.');
      }
    } catch (error) {
      state.availableLocations = fallbackLocations;
      console.warn('[EOS Open Shift] Failed to load locations from /api/locations. Using fallback list.', error);
    }
    renderAll();
    refreshManagerResolutionPreview().catch((error) => {
      console.warn('[EOS Open Shift] Failed to refresh manager-resolution preview after location load.', error);
    });
  }

  async function loadPreviewDepartmentContext(locationCode) {
    const departmentCode = getTemporaryPreviewDepartmentCode(locationCode);
    if (!departmentCode) {
      return null;
    }

    const selectedLocation = getSelectedLocationEntry();
    const url = new URL('/api/departments', `${getEosApiOrigin()}/`);
    url.searchParams.set('is_active', 'true');
    if (selectedLocation && selectedLocation.id) {
      url.searchParams.set('default_reception_location_id', selectedLocation.id);
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Department lookup failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Department lookup did not return an array.');
    }

    const match = payload.find((row) => (
      row &&
      typeof row === 'object' &&
      normalizeDepartmentCode(row.code) === departmentCode
    ));

    if (!match || !String(match.id || '').trim()) {
      return {
        department_id: '',
        department_code: departmentCode,
        department_name: ''
      };
    }

    return {
      department_id: String(match.id || '').trim(),
      department_code,
      department_name: String(match.name || departmentCode).trim()
    };
  }

  async function fetchManagerResolutionPreview(departmentId, atDateTime) {
    const url = new URL(
      `/api/departments/${encodeURIComponent(String(departmentId || '').trim())}/manager-resolution-preview`,
      `${getEosApiOrigin()}/`
    );
    url.searchParams.set('at_datetime', atDateTime);

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const errorMessage = payload && typeof payload.error === 'string'
        ? payload.error
        : `Manager preview lookup failed (${response.status}).`;
      throw new Error(errorMessage);
    }

    return payload;
  }

  function getManagerResolutionAvailabilityLabel(preview) {
    const resolutionPath = String((preview && preview.resolution_path) || '').trim();
    if (resolutionPath === 'responsible_manager_available') return 'Available';
    if (resolutionPath.includes('_on_leave_')) return 'On approved leave';
    if (resolutionPath.includes('_inactive_')) return 'Inactive / unavailable';
    if (resolutionPath === 'no_responsible_manager_configured') return 'No responsible manager configured';
    if (resolutionPath === 'responsible_manager_not_found') return 'Responsible manager record missing';
    return 'Preview only';
  }

  function getManagerResolutionRecipientLabel(recipient) {
    if (!recipient || typeof recipient !== 'object') return 'None';
    return String(recipient.display_name || recipient.employee_code || recipient.id || 'Unknown').trim() || 'Unknown';
  }

  function getDiscrepancyAmountFromOpeningMismatch() {
    const previousClosingCash = Number(state.openingShift.last_shift_closing_cash || '');
    const actualOpeningCash = Number(state.openingShift.actual_opening_cash || '');
    if (!Number.isFinite(previousClosingCash) || !Number.isFinite(actualOpeningCash)) {
      return null;
    }
    return Number((actualOpeningCash - previousClosingCash).toFixed(2));
  }

  function syncDiscrepancyEventDraft() {
    if (state.openingShift.opening_cash_matches || !isActiveOpenShiftLocation(getSelectedLocationCode())) {
      state.discrepancyEventDraft = null;
      return;
    }

    const selectedLocationCode = getSelectedLocationCode();
    const departmentCode = getTemporaryPreviewDepartmentCode(selectedLocationCode);
    const previewState = state.managerResolutionPreview;
    const preview = previewState && previewState.preview ? previewState.preview : null;
    const existingDraft = state.discrepancyEventDraft;

    // In-memory draft only:
    // - built locally while the mismatch exists
    // - used as the source payload for later persistence
    // - not itself persisted or queued
    // Current backend state:
    // - POST /api/eos/discrepancy-events persists the event
    // - backend may also create internal queue rows
    // - delivery is still not implemented
    // TODO: Replace this browser-only draft lifecycle with persisted readback
    // once discrepancy event retrieval/edit flows exist.
    state.discrepancyEventDraft = {
      event_id: existingDraft && existingDraft.event_id ? existingDraft.event_id : createDiscrepancyEventDraftId(),
      event_type: 'opening_cash_mismatch',
      source_module: 'open_shift',
      shift_session_id: state.openingShift.shift_session_id || null,
      report_header_id: null,
      location_code: selectedLocationCode,
      department_code: departmentCode,
      department_id: previewState && previewState.department_id ? previewState.department_id : null,
      created_by: state.currentUser,
      created_at: existingDraft && existingDraft.created_at ? existingDraft.created_at : new Date().toISOString(),
      discrepancy_type: String(state.openingShift.override_reason || 'opening_cash_mismatch').trim() || 'opening_cash_mismatch',
      discrepancy_amount: getDiscrepancyAmountFromOpeningMismatch(),
      note: String(state.openingShift.note || '').trim() || null,
      manager_resolution_preview: preview,
      admin_summary_required: preview && typeof preview.admin_summary_required === 'boolean'
        ? preview.admin_summary_required
        : true,
      status: 'detected'
    };
  }

  async function refreshManagerResolutionPreview(options = {}) {
    const shouldShowPreview = !state.openingShift.opening_cash_matches && isActiveOpenShiftLocation(getSelectedLocationCode());
    if (!shouldShowPreview) {
      state.managerResolutionPreview = createEmptyManagerResolutionPreviewState();
      renderAll();
      return;
    }

    const selectedLocationCode = getSelectedLocationCode();
    const departmentCode = getTemporaryPreviewDepartmentCode(selectedLocationCode);
    const atDateTime = new Date(state.liveNow || new Date()).toISOString();
    const requestKey = `${selectedLocationCode}|${departmentCode}|${atDateTime.slice(0, 16)}`;

    if (
      !options.force &&
      state.managerResolutionPreview.request_key === requestKey &&
      (state.managerResolutionPreview.loading || state.managerResolutionPreview.preview || state.managerResolutionPreview.error)
    ) {
      renderAll();
      return;
    }

    state.managerResolutionPreview = {
      ...createEmptyManagerResolutionPreviewState(),
      loading: true,
      request_key: requestKey,
      department_code: departmentCode,
      at_datetime: atDateTime
    };
    renderAll();

    try {
      const departmentContext = await loadPreviewDepartmentContext(selectedLocationCode);
      if (state.managerResolutionPreview.request_key !== requestKey) return;
      if (!departmentContext || !departmentContext.department_id) {
        throw new Error(`Temporary department preview mapping could not resolve ${departmentCode || 'a department'} for ${selectedLocationCode}.`);
      }

      const preview = await fetchManagerResolutionPreview(departmentContext.department_id, atDateTime);
      if (state.managerResolutionPreview.request_key !== requestKey) return;

      state.managerResolutionPreview = {
        ...createEmptyManagerResolutionPreviewState(),
        request_key: requestKey,
        department_id: departmentContext.department_id,
        department_code: departmentContext.department_code,
        department_name: departmentContext.department_name,
        at_datetime: atDateTime,
        preview
      };
    } catch (error) {
      if (state.managerResolutionPreview.request_key !== requestKey) return;
      state.managerResolutionPreview = {
        ...createEmptyManagerResolutionPreviewState(),
        request_key: requestKey,
        department_code: departmentCode,
        at_datetime: atDateTime,
        error: error instanceof Error ? error.message : 'Manager-resolution preview unavailable.'
      };
    }

    renderAll();
  }

  function getCompactUserName(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'RECEPTION';
    if (raw.includes('@')) return raw.split('@')[0].trim().toUpperCase();
    return raw.split(/\s+/)[0].trim().toUpperCase();
  }

  function showCompletionAndRedirect(title, message) {
    state.completionTitle = String(title || '').trim() || 'Opening values saved';
    state.completionMessage = String(message || '').trim();
    state.completionRedirectPending = true;
    if (state.redirectTimerId) window.clearTimeout(state.redirectTimerId);
    state.redirectTimerId = window.setTimeout(() => {
      window.location.href = buildAppHubUrl();
    }, REDIRECT_DELAY_MS);
  }

  function activateOpeningShiftSession(shiftSession, successMessage, options = {}) {
    const defaults = getLocationShiftDefaults(shiftSession.location_code || getSelectedLocationCode());
    const activeSession = {
      id: shiftSession.id,
      shift_session_id: shiftSession.id,
      location_code: shiftSession.location_code || defaults.location_code,
      department_code: shiftSession.department_code || defaults.department_code,
      clinic_code: shiftSession.clinic_code || defaults.clinic_code,
      shift_date: shiftSession.shift_date || state.openingShift.shift_date,
      shift_start_time: shiftSession.shift_start_time || extractSqlTimeFromLocalDateTime(state.openingShift.opening_timestamp),
      opening_timestamp: state.openingShift.opening_timestamp,
      last_shift_closing_cash: state.openingShift.last_shift_closing_cash,
      opening_cash_matches: Boolean(state.openingShift.opening_cash_matches),
      actual_opening_cash: state.openingShift.opening_cash_matches ? '' : state.openingShift.actual_opening_cash,
      override_reason: state.openingShift.opening_cash_matches ? '' : state.openingShift.override_reason,
      note: state.openingShift.note || '',
      saved_at: shiftSession.created_at || normalizeIsoMinute(new Date()),
      current_owner: shiftSession.current_owner || state.currentUser,
      created_by: shiftSession.created_by || state.currentUser,
      taken_over_from_user: shiftSession.taken_over_from_user || options.amendingFromUser || '',
      taken_over_at: shiftSession.taken_over_at || '',
      takeover_reason: shiftSession.takeover_reason || '',
      status: shiftSession.status || 'open',
      owner_name: shiftSession.current_owner || shiftSession.created_by || state.currentUser,
      amending_from_user: options.amendingFromUser || shiftSession.taken_over_from_user || ''
    };
    persistActiveShiftSession(activeSession);
    persistNotice(successMessage);
    showCompletionAndRedirect('Opening values saved', successMessage);
  }

  function clearShiftSessionUi() {
    state.shiftSessionUi = createEmptyShiftSessionUiState();
  }

  function storeShiftSessionUiResponse(response) {
    state.shiftSessionUi = {
      ...createEmptyShiftSessionUiState(),
      action_code: response.action_code,
      message: response.message || response.error || '',
      shift_session: response.shift_session,
      allowed_actions: response.allowed_actions,
      required_reason_fields: response.required_reason_fields,
      required_reason_fields_by_action: response.required_reason_fields_by_action
    };
  }

  function getOpeningCashUsed() {
    return state.openingShift.opening_cash_matches
      ? Number(state.openingShift.last_shift_closing_cash || 0)
      : Number(state.openingShift.actual_opening_cash || 0);
  }

  function getOpeningResponseOwnerName() {
    const shiftSession = state.shiftSessionUi.shift_session;
    return String((shiftSession && (shiftSession.current_owner || shiftSession.created_by)) || '').trim() || 'Unknown user';
  }

  function getOpeningResolutionFieldValue(fieldName) {
    return String(state.shiftSessionUi.placeholder_values[fieldName] || '');
  }

  function setOpeningResolutionFieldValue(fieldName, value) {
    if (!Object.prototype.hasOwnProperty.call(state.shiftSessionUi.placeholder_values, fieldName)) return;
    state.shiftSessionUi.placeholder_values[fieldName] = String(value || '');
  }

  function getOpeningResolutionFieldLabel(fieldName) {
    return ({
      takeover_reason: 'Takeover Reason',
      abandon_reason: 'Abandon Reason',
      supersede_reason: 'Supersede Reason',
      temporary_close_reason: 'Temporary Close Reason',
      discrepancy_note: 'Discrepancy Note'
    })[fieldName] || fieldName.replace(/_/g, ' ');
  }

  function renderOpeningResolutionField(fieldName, multiline) {
    const label = escapeHtml(getOpeningResolutionFieldLabel(fieldName));
    const value = escapeHtml(getOpeningResolutionFieldValue(fieldName));
    return multiline
      ? `<label class="field-label">${label}<textarea data-opening-resolution-field="${escapeHtml(fieldName)}">${value}</textarea></label>`
      : `<label class="field-label">${label}<input type="text" data-opening-resolution-field="${escapeHtml(fieldName)}" value="${value}" /></label>`;
  }

  function getRequiredReasonFieldsForOpeningAction(actionName) {
    return actionName === 'take_over_and_resume'
      ? state.shiftSessionUi.required_reason_fields
      : state.shiftSessionUi.required_reason_fields_by_action[actionName] || [];
  }

  async function submitManagerTakeover() {
    const shiftSession = state.shiftSessionUi.shift_session;
    const takeoverReason = String(getOpeningResolutionFieldValue('takeover_reason') || '').trim();
    if (!shiftSession || !shiftSession.id) return showOpeningInlineError('Active EOS session details are missing for takeover.');
    if (!takeoverReason) return showOpeningInlineError('Takeover Reason required before manager takeover can continue.');
    state.openingSavePending = true;
    renderAll();
    try {
      const takeoverResponse = await takeOverShiftSessionViaApi(shiftSession.id, takeoverReason);
      const previousOwner = String(
        (takeoverResponse.audit && takeoverResponse.audit.previous_owner) ||
        (takeoverResponse.shift_session && takeoverResponse.shift_session.taken_over_from_user) ||
        getOpeningResponseOwnerName()
      ).trim() || 'Unknown user';
      activateOpeningShiftSession(
        takeoverResponse.shift_session,
        `Amending EOS of ${previousOwner}`,
        { amendingFromUser: previousOwner }
      );
    } catch (error) {
      showOpeningInlineError(error instanceof Error ? error.message : 'Manager takeover failed.');
    } finally {
      state.openingSavePending = false;
      renderAll();
    }
  }

  async function submitManagerAbandonShift() {
    const shiftSession = state.shiftSessionUi.shift_session;
    const abandonReason = String(getOpeningResolutionFieldValue('abandon_reason') || '').trim();
    if (!shiftSession || !shiftSession.id) return showOpeningInlineError('Unresolved EOS session details are missing for abandonment.');
    if (!abandonReason) return showOpeningInlineError('Abandon Reason required before this shift can be marked abandoned.');
    state.openingSavePending = true;
    renderAll();
    try {
      const abandonResponse = await abandonShiftSessionViaApi(shiftSession.id, abandonReason);
      const previousOwner = String(
        (abandonResponse.audit && abandonResponse.audit.previous_owner) ||
        getOpeningResponseOwnerName()
      ).trim() || 'Unknown user';
      clearShiftSessionUi();
      showInfo(`Previous EOS of ${previousOwner} was marked abandoned. Save and continue again to open the new shift.`);
    } catch (error) {
      showOpeningInlineError(error instanceof Error ? error.message : 'Shift abandonment failed.');
    } finally {
      state.openingSavePending = false;
      renderAll();
    }
  }

  async function submitManagerSupersedeShift() {
    const shiftSession = state.shiftSessionUi.shift_session;
    const supersedeReason = String(getOpeningResolutionFieldValue('supersede_reason') || '').trim();
    const openingPayload = buildOpeningShiftSessionPayload();
    if (!shiftSession || !shiftSession.id) return showOpeningInlineError('Unresolved EOS session details are missing for supersede.');
    if (!supersedeReason) return showOpeningInlineError('Supersede Reason required before a new shift can be started.');
    if (!openingPayload.location_code || !openingPayload.department_code || !openingPayload.clinic_code || !openingPayload.shift_date || !openingPayload.shift_start_time) {
      return showOpeningInlineError('Opening details must remain complete before the previous shift can be superseded.');
    }
    state.openingSavePending = true;
    renderAll();
    try {
      const supersedeResponse = await supersedeShiftSessionViaApi(shiftSession.id, supersedeReason, openingPayload);
      const previousOwner = String(
        (supersedeResponse.audit && supersedeResponse.audit.previous_owner) ||
        getOpeningResponseOwnerName()
      ).trim() || 'Unknown user';
      activateOpeningShiftSession(
        supersedeResponse.shift_session,
        `Previous EOS of ${previousOwner} was superseded and your new shift is now active.`
      );
    } catch (error) {
      showOpeningInlineError(error instanceof Error ? error.message : 'Shift supersede failed.');
    } finally {
      state.openingSavePending = false;
      renderAll();
    }
  }

  async function handleOpeningResolutionAction(actionName) {
    const missingFields = getRequiredReasonFieldsForOpeningAction(actionName).filter((fieldName) => !String(getOpeningResolutionFieldValue(fieldName)).trim());
    if (missingFields.length) {
      return showOpeningInlineError(`${missingFields.map(getOpeningResolutionFieldLabel).join(', ')} required before this action can continue.`);
    }
    showOpeningInlineError('');
    if (actionName === 'resume_existing_shift') {
      return activateOpeningShiftSession(
        state.shiftSessionUi.shift_session,
        'Your active EOS for this location has been resumed.'
      );
    }
    if (actionName === 'take_over_and_resume') return submitManagerTakeover();
    if (actionName === 'mark_previous_shift_abandoned') return submitManagerAbandonShift();
    if (actionName === 'supersede_previous_shift_and_start_new') return submitManagerSupersedeShift();
    // TODO: Replace the unresolved-shift "resume previous shift" action with its dedicated backend action.
    // TODO: Replace the emergency handover placeholder with the full temporary closure workflow and persisted review trail.
    const ownerName = getOpeningResponseOwnerName();
    const messages = {
      resume_previous_shift: `Placeholder only: manager resume of ${ownerName}'s unresolved EOS is not wired yet.`,
      emergency_handover_close_previous_and_start_new: 'Placeholder only: Emergency Handover Mode is acknowledged here, but the full form and persistence are not wired yet.'
    };
    showInfo(messages[actionName] || 'Placeholder EOS shift-session action acknowledged.');
  }

  function renderOpeningResponsePanel() {
    const response = state.shiftSessionUi;
    if (!response.action_code) {
      refs.openingResponsePanel.classList.add('hidden');
      refs.openingResponsePanel.innerHTML = '';
      return;
    }
    const ownerName = escapeHtml(getOpeningResponseOwnerName());
    const message = escapeHtml(response.message || 'EOS shift-session response received.');
    let content = '';
    if (response.action_code === 'open_shift_exists_same_owner') {
      content = `<div class="opening-response"><div class="opening-response-title">Existing Active EOS</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">You already own the active EOS for this location.</div><div class="opening-response-actions"><button class="btn" type="button" data-opening-resolution-action="resume_existing_shift">Resume Existing Shift</button></div></div>`;
    } else if (response.action_code === 'active_shift_owned_by_other_user') {
      content = `<div class="opening-response"><div class="opening-response-title">EOS Already Open</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">Owned by ${ownerName}</div><div class="opening-response-note">You cannot amend another user's EOS. Same-level users are blocked while this reception location remains owned by another user.</div></div>`;
    } else if (response.action_code === 'manager_takeover_available') {
      content = `<div class="opening-response"><div class="opening-response-title">Manager Takeover Available</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">Amending EOS of ${ownerName}</div><div class="opening-response-fields">${renderOpeningResolutionField('takeover_reason', false)}</div><div class="opening-response-actions"><button class="btn" type="button" data-opening-resolution-action="take_over_and_resume">Take Over and Resume</button></div><div class="opening-response-note">Takeover Reason is required. TODO: real auth and manager-role resolution remain placeholder-backed until EOS auth is wired centrally.</div></div>`;
    } else if (response.action_code === 'unresolved_shift_requires_resolution') {
      if (!response.allowed_actions.length) {
        content = `<div class="opening-response"><div class="opening-response-title">Unresolved Previous Shift</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">Current owner: ${ownerName}</div><div class="opening-response-note">A manager must resolve the previous shift before a new operational shift can start for this location.</div></div>`;
      } else {
        content = `<div class="opening-response"><div class="opening-response-title">Manager Resolution Required</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">Previous owner: ${ownerName}</div><div class="opening-response-fields">${response.allowed_actions.includes('resume_previous_shift') ? renderOpeningResolutionField('takeover_reason', false) : ''}${response.allowed_actions.includes('mark_previous_shift_abandoned') ? renderOpeningResolutionField('abandon_reason', false) : ''}${response.allowed_actions.includes('supersede_previous_shift_and_start_new') ? renderOpeningResolutionField('supersede_reason', false) : ''}</div><div class="opening-response-actions">${response.allowed_actions.includes('resume_previous_shift') ? '<button class="btn" type="button" data-opening-resolution-action="resume_previous_shift">Resume Previous Shift</button>' : ''}${response.allowed_actions.includes('mark_previous_shift_abandoned') ? '<button class="btn alt" type="button" data-opening-resolution-action="mark_previous_shift_abandoned">Mark Previous Shift Abandoned</button>' : ''}${response.allowed_actions.includes('supersede_previous_shift_and_start_new') ? '<button class="btn alt" type="button" data-opening-resolution-action="supersede_previous_shift_and_start_new">Supersede Previous Shift And Start New</button>' : ''}</div><div class="opening-response-note">Resume Previous Shift remains placeholder-only until its dedicated backend action is implemented. Abandon and supersede already call the real manager endpoints.</div></div>`;
      }
    } else if (response.action_code === 'emergency_handover_available') {
      content = `<div class="opening-response"><div class="opening-response-title">Temporary Closure Pending Manager Review</div><div class="opening-response-copy">${message}</div><div class="opening-response-owner">Previous shift owner: ${ownerName}</div><div class="opening-response-fields">${renderOpeningResolutionField('temporary_close_reason', false)}${renderOpeningResolutionField('discrepancy_note', true)}</div><div class="opening-response-actions"><button class="btn" type="button" data-opening-resolution-action="emergency_handover_close_previous_and_start_new">Emergency Handover Path</button></div><div class="opening-response-note">Placeholder only: the emergency handover path is surfaced here, but the full emergency handover form and persistence are not implemented yet.</div></div>`;
    } else {
      content = `<div class="opening-response"><div class="opening-response-title">Shift Session Response</div><div class="opening-response-copy">${message}</div></div>`;
    }
    refs.openingResponsePanel.innerHTML = content;
    refs.openingResponsePanel.classList.remove('hidden');
  }

  function renderTopBar() {
    const selectedDefaults = getSelectedLocationDefaults();
    const locationLabel = isActiveOpenShiftLocation(selectedDefaults.location_code)
      ? selectedDefaults.display_name
      : state.detectedLocation.label;
    refs.topDateLabel.textContent = formatTopDate(state.liveNow);
    refs.topTimeLabel.textContent = formatTopTime(state.liveNow);
    refs.loginUserCompact.textContent = getCompactUserName(state.currentUser);
    refs.loginLocationCompact.textContent = `Location: ${locationLabel}`;
    refs.loginWorkstationCompact.textContent = `PC logging in: ${state.workstation ? state.workstation.display_name : 'Unknown workstation'}`;
  }

  function renderOpeningForm() {
    const selectedDefaults = getSelectedLocationDefaults();
    const hasSelectedLocation = isActiveOpenShiftLocation(selectedDefaults.location_code);
    renderLocationSelectOptions();
    const hasMismatch = !state.openingShift.opening_cash_matches;
    refs.openingLocationSelect.value = hasSelectedLocation ? selectedDefaults.location_code : '';
    refs.selectedLocationDisplay.textContent = hasSelectedLocation ? selectedDefaults.display_name : '-';
    refs.selectedLocationHint.textContent = hasSelectedLocation
      ? `${selectedDefaults.display_name} reception is the active EOS opening location for this shift. Department and clinic are assigned automatically for this page.`
      : 'Choose Zabbar or Qormi. EOS shifts are opened per reception location, not per department location.';
    refs.lastShiftClosingCash.value = state.openingShift.last_shift_closing_cash || '';
    refs.lastCloseAmountDisplay.textContent = formatMoney(state.openingShift.last_shift_closing_cash || 0);
    refs.openingCashMatchesToggle.classList.toggle('is-on', state.openingShift.opening_cash_matches);
    refs.openingCashMatchesToggle.classList.toggle('is-off', hasMismatch);
    refs.openingCashMatchesToggle.setAttribute('aria-pressed', state.openingShift.opening_cash_matches ? 'true' : 'false');
    refs.openingCashMatchesLabel.textContent = state.openingShift.opening_cash_matches ? 'YES' : 'NO';
    refs.actualOpeningCash.value = state.openingShift.actual_opening_cash || '';
    refs.overrideReasonSelect.value = state.openingShift.override_reason || '';
    refs.openingNote.value = state.openingShift.note || '';
    refs.openingOverrideFields.classList.toggle('hidden', state.openingShift.opening_cash_matches);
    refs.openingMetaNote.textContent = state.openingShift.saved_at
      ? `Shift session ${state.openingShift.shift_session_id} is active from ${formatDateTime(state.openingShift.saved_at)}.`
      : 'Shift date and opening time are system-generated when you save the opening values.';
    renderOpeningResponsePanel();
  }

  function renderManagerResolutionPreview() {
    const shouldShowPreview = !state.openingShift.opening_cash_matches && isActiveOpenShiftLocation(getSelectedLocationCode());
    if (!shouldShowPreview) {
      refs.managerPreviewPanel.classList.add('hidden');
      refs.managerPreviewPanel.innerHTML = '';
      return;
    }

    const previewState = state.managerResolutionPreview;
    const departmentLabel = previewState.department_name
      ? `${previewState.department_code} - ${previewState.department_name}`
      : (previewState.department_code || 'Temporary department context');

    if (previewState.loading) {
      refs.managerPreviewPanel.innerHTML = `
        <div class="manager-preview-head">
          <div>
            <div class="manager-preview-title">Manager Resolution Preview</div>
            <div class="manager-preview-copy">Preview only. No persistence or delivery happens from this preview card.</div>
          </div>
          <div class="manager-preview-badge">Loading</div>
        </div>
        <div class="manager-preview-grid">
          <div class="manager-preview-item">
            <div class="manager-preview-label">Department Context</div>
            <div class="manager-preview-value">${escapeHtml(departmentLabel)}</div>
          </div>
          <div class="manager-preview-item">
            <div class="manager-preview-label">Status</div>
            <div class="manager-preview-value is-muted">Resolving manager availability...</div>
          </div>
        </div>
      `;
      refs.managerPreviewPanel.classList.remove('hidden');
      return;
    }

    if (previewState.error) {
      refs.managerPreviewPanel.innerHTML = `
        <div class="manager-preview-head">
          <div>
            <div class="manager-preview-title">Manager Resolution Preview</div>
            <div class="manager-preview-copy">Preview only. No persistence or delivery happens from this preview card.</div>
          </div>
          <div class="manager-preview-badge">Unavailable</div>
        </div>
        <div class="manager-preview-grid">
          <div class="manager-preview-item">
            <div class="manager-preview-label">Department Context</div>
            <div class="manager-preview-value">${escapeHtml(departmentLabel)}</div>
          </div>
          <div class="manager-preview-item">
            <div class="manager-preview-label">Preview Status</div>
            <div class="manager-preview-value is-muted">${escapeHtml(previewState.error)}</div>
          </div>
        </div>
      `;
      refs.managerPreviewPanel.classList.remove('hidden');
      return;
    }

    const preview = previewState.preview;
    const responsibleManager = getManagerResolutionRecipientLabel(preview && preview.responsible_manager);
    const fallbackManager = getManagerResolutionRecipientLabel(preview && preview.fallback_recipient);
    const availabilityLabel = getManagerResolutionAvailabilityLabel(preview);
    const adminSummaryRequired = preview && preview.admin_summary_required ? 'Yes' : 'No';
    const resolutionPath = preview && preview.resolution_path ? preview.resolution_path : 'unresolved';

    refs.managerPreviewPanel.innerHTML = `
      <div class="manager-preview-head">
        <div>
          <div class="manager-preview-title">Manager Resolution Preview</div>
          <div class="manager-preview-copy">Preview only. No persistence or delivery happens from this preview card.</div>
        </div>
        <div class="manager-preview-badge">${escapeHtml(availabilityLabel)}</div>
      </div>
      <div class="manager-preview-grid">
        <div class="manager-preview-item">
          <div class="manager-preview-label">Department Context</div>
          <div class="manager-preview-value">${escapeHtml(departmentLabel)}</div>
        </div>
        <div class="manager-preview-item">
          <div class="manager-preview-label">Responsible Manager</div>
          <div class="manager-preview-value">${escapeHtml(responsibleManager)}</div>
        </div>
        <div class="manager-preview-item">
          <div class="manager-preview-label">Availability Status</div>
          <div class="manager-preview-value">${escapeHtml(availabilityLabel)}</div>
        </div>
        <div class="manager-preview-item">
          <div class="manager-preview-label">Fallback Manager</div>
          <div class="manager-preview-value ${fallbackManager === 'None' ? 'is-muted' : ''}">${escapeHtml(fallbackManager)}</div>
        </div>
        <div class="manager-preview-item">
          <div class="manager-preview-label">Admin Summary Required</div>
          <div class="manager-preview-value">${escapeHtml(adminSummaryRequired)}</div>
        </div>
        <div class="manager-preview-item">
          <div class="manager-preview-label">Resolution Path</div>
          <div class="manager-preview-value">${escapeHtml(resolutionPath)}</div>
        </div>
      </div>
    `;
    refs.managerPreviewPanel.classList.remove('hidden');
  }

  function renderRegistrationModal() {
    if (!state.isRegistrationPending) {
      refs.registrationBackdrop.classList.add('hidden');
      refs.registrationBackdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      return;
    }
    const suggestion = isActiveOpenShiftLocation(state.detectedLocation.code) ? state.detectedLocation.code : '';
    renderLocationSelectOptions();
    refs.registrationWorkstationName.textContent = state.workstation ? state.workstation.display_name : 'Unknown workstation';
    refs.registrationWorkstationSource.textContent = state.workstation ? `${state.workstation.id} (${state.workstation.source})` : 'No workstation identifier available';
    refs.registrationLocationRule.textContent = state.detectedLocation && state.detectedLocation.detection_rule !== 'unmapped'
      ? `Detected via ${state.detectedLocation.detection_rule}`
      : 'No temporary location hint matched.';
    refs.registrationLocationSelect.value = normalizeRegistrationSelection(state.pendingRegistrationLocation) || '';
    refs.registrationSuggestion.textContent = suggestion
      ? `Suggested location based on workstation hint: ${LOCATION_SHIFT_DEFAULTS[suggestion].display_name}. This local mapping is temporary and will later move to central EOS storage.`
      : 'No temporary location suggestion is available. Choose the correct reception location manually. This local mapping is temporary and will later move to central EOS storage.';
    refs.btnConfirmRegistration.disabled = !isValidRegistrationSelection(refs.registrationLocationSelect.value);
    refs.registrationBackdrop.classList.remove('hidden');
    refs.registrationBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function renderCompletionOverlay() {
    const visible = state.completionRedirectPending;
    refs.completionTitle.textContent = state.completionTitle || 'Opening values saved';
    refs.completionMessage.textContent = state.completionMessage || '';
    refs.completionBackdrop.classList.toggle('hidden', !visible);
    refs.completionBackdrop.setAttribute('aria-hidden', visible ? 'false' : 'true');
    document.body.classList.toggle('redirect-pending', visible);
  }

  function renderAll() {
    syncDiscrepancyEventDraft();
    renderTopBar();
    renderOpeningForm();
    renderManagerResolutionPreview();
    renderRegistrationModal();
    renderCompletionOverlay();
    const disabled = state.busy || state.openingSavePending || state.isRegistrationPending || state.completionRedirectPending;
    refs.openingLocationSelect.disabled = disabled;
    refs.lastShiftClosingCash.disabled = disabled;
    refs.actualOpeningCash.disabled = disabled;
    refs.overrideReasonSelect.disabled = disabled;
    refs.openingNote.disabled = disabled;
    refs.openingCashMatchesToggle.disabled = disabled;
    refs.btnSaveOpening.disabled = disabled || !isOpeningFormComplete();
    refs.btnSaveOpening.textContent = state.openingSavePending ? 'Saving...' : 'Save and Continue';
  }

  function applyWorkstationContext() {
    state.workstation = workstationDetection.resolve();
    state.workstationConfig = getWorkstationConfig(state.workstation.id);
    state.detectedLocation = state.workstationConfig
      ? { ...LOCATION_DIRECTORY[normalizeLocationCode(state.workstationConfig.location_code)], detection_rule: 'saved_workstation_config' }
      : detectLocation(state.workstation);
    state.registeredDepartment = state.workstationConfig ? normalizeDepartmentCode(state.workstationConfig.department_code) : '';
    if (state.workstationConfig && isActiveOpenShiftLocation(state.workstationConfig.location_code)) {
      state.selectedLocationCode = normalizeLocationCode(state.workstationConfig.location_code);
      state.pendingRegistrationLocation = '';
      state.isRegistrationPending = false;
    } else {
      const suggestion = isActiveOpenShiftLocation(state.detectedLocation.code) ? state.detectedLocation.code : '';
      state.selectedLocationCode = suggestion;
      state.pendingRegistrationLocation = suggestion || (isChrisUser() ? 'CHRIS_LAPTOP' : '');
      state.isRegistrationPending = true;
    }
  }

  function confirmWorkstationRegistration() {
    const registrationSelection = normalizeRegistrationSelection(refs.registrationLocationSelect.value);
    const namedOption = getNamedWorkstationOption(registrationSelection);
    const locationCode = namedOption
      ? normalizeLocationCode(namedOption.default_location_code)
      : normalizeLocationCode(registrationSelection);
    const defaults = getLocationShiftDefaults(locationCode);
    if (!state.workstation || !isActiveOpenShiftLocation(locationCode) || !registrationSelection) return;
    if (namedOption) {
      writeSavedNamedWorkstationAlias(namedOption.option_value);
      state.workstation = buildNamedWorkstation(namedOption.option_value) || state.workstation;
    } else {
      writeSavedNamedWorkstationAlias('');
    }
    const savedConfig = saveWorkstationConfig({
      workstation_id: state.workstation.id,
      department_code: defaults.department_code,
      location_code: locationCode,
      modified_by_user: state.currentUser
    });
    state.workstationConfig = savedConfig;
    state.registeredDepartment = savedConfig.department_code;
    state.selectedLocationCode = normalizeLocationCode(savedConfig.location_code);
    state.detectedLocation = { ...LOCATION_DIRECTORY[state.selectedLocationCode], detection_rule: 'saved_workstation_config' };
    state.pendingRegistrationLocation = '';
    state.isRegistrationPending = false;
    showInfo(
      namedOption
        ? `${namedOption.display_name} registered with default location ${LOCATION_SHIFT_DEFAULTS[state.selectedLocationCode].display_name}. This local mapping will be replaced by central EOS storage later.`
        : `Workstation registered to ${LOCATION_SHIFT_DEFAULTS[state.selectedLocationCode].display_name}. This local mapping will be replaced by central EOS storage later.`
    );
    renderAll();
    refreshManagerResolutionPreview().catch((error) => {
      console.warn('[EOS Open Shift] Failed to refresh manager-resolution preview after workstation registration.', error);
    });
  }

  function noteDiscrepancyManagerNotificationPlaceholder(shiftSession) {
    const locationCode = normalizeLocationCode((shiftSession && shiftSession.location_code) || getSelectedLocationCode());
    const departmentCode = String((shiftSession && shiftSession.department_code) || '').trim();
    // Current state summary:
    // - manager preview is read-only and shown in-page
    // - discrepancy event can now be persisted
    // - queue rows may now be created server-side
    // - actual delivery/routing is still not implemented
    // TODO: Replace this placeholder with the shared manager-resolution /
    // notification-delivery workflow once queue processing exists end-to-end.
    try {
      console.info('[EOS Open Shift] Discrepancy preview/persistence acknowledged. Delivery remains pending for department/location', departmentCode || '(unknown department)', locationCode);
    } catch {}
  }

  function handleNonFatalDiscrepancyEventPersistenceFailure(error) {
    const message = error instanceof Error ? error.message : 'Discrepancy event persistence failed.';
    try {
      console.warn('[EOS Open Shift] Shift session was saved, but discrepancy event persistence/queue creation failed.', error);
    } catch {}
    if (isDeveloperAdminWarningRole()) {
      showInfo(`Developer/Admin warning: opening shift saved, but discrepancy event persistence or queue creation did not complete. ${message}`);
    }
  }

  async function saveOpeningDetails() {
    clearMessages();
    clearShiftSessionUi();
    if (state.isRegistrationPending) return showOpeningInlineError('This workstation must be registered to a reception location before opening values can be saved.');
    if (!isActiveOpenShiftLocation(getSelectedLocationCode())) return showOpeningInlineError('Location is required before the shift can be opened.');
    if (!String(state.openingShift.last_shift_closing_cash || '').trim()) return showOpeningInlineError('Last EOS close amount is required before the shift can be opened.');
    if (!state.openingShift.opening_cash_matches) {
      if (!String(state.openingShift.actual_opening_cash || '').trim()) return showOpeningInlineError('Actual Opening Cash is required when the cash does not match the previous close.');
      if (!String(state.openingShift.override_reason || '').trim()) return showOpeningInlineError('Override Reason is required when the cash does not match the previous close.');
    }
    const payload = buildOpeningShiftSessionPayload();
    if (!payload.shift_start_time) return showOpeningInlineError('System opening time is missing. Refresh the page and try again.');
    state.openingSavePending = true;
    renderAll();
    try {
      const shiftSessionResponse = await createShiftSessionViaApi(payload);
      if (['open_shift_exists_same_owner', 'active_shift_owned_by_other_user', 'manager_takeover_available', 'unresolved_shift_requires_resolution', 'emergency_handover_available'].includes(shiftSessionResponse.action_code)) {
        storeShiftSessionUiResponse(shiftSessionResponse);
        if (shiftSessionResponse.action_code === 'open_shift_exists_same_owner') {
          showInfo('You already have an active EOS for this location. Use Resume Existing Shift to continue.');
        }
      } else {
        const normalizedSession = {
          ...(shiftSessionResponse.shift_session || {}),
          location_code: payload.location_code,
          department_code: payload.department_code,
          clinic_code: payload.clinic_code,
          shift_date: payload.shift_date,
          shift_start_time: payload.shift_start_time,
          current_owner: (shiftSessionResponse.shift_session && shiftSessionResponse.shift_session.current_owner) || state.currentUser,
          created_by: (shiftSessionResponse.shift_session && shiftSessionResponse.shift_session.created_by) || state.currentUser
        };
        if (!state.openingShift.opening_cash_matches) {
          noteDiscrepancyManagerNotificationPlaceholder(normalizedSession);
          const discrepancyEventPayload = buildDiscrepancyEventPayload(normalizedSession);
          if (discrepancyEventPayload) {
            try {
              const createdDiscrepancyEvent = await createDiscrepancyEventViaApi(discrepancyEventPayload);
              if (state.discrepancyEventDraft) {
                state.discrepancyEventDraft = {
                  ...state.discrepancyEventDraft,
                  event_id: createdDiscrepancyEvent.id || state.discrepancyEventDraft.event_id,
                  created_at: createdDiscrepancyEvent.created_at || state.discrepancyEventDraft.created_at,
                  shift_session_id: normalizedSession.id || state.discrepancyEventDraft.shift_session_id
                };
              }
            } catch (error) {
              handleNonFatalDiscrepancyEventPersistenceFailure(error);
            }
          }
        }
        activateOpeningShiftSession(
          normalizedSession,
          state.openingShift.opening_cash_matches
            ? 'YOUR OPENING SHIFT VALUES have been saved. HAVE A GOOD DAY'
            : 'The discrepancy you reported in cashbox has been noted and the manager notified. Your shift values have been saved. Have a good day'
        );
      }
    } catch (error) {
      clearShiftSessionUi();
      showOpeningInlineError(error instanceof Error ? error.message : 'Failed to save opening details.');
    } finally {
      state.openingSavePending = false;
      renderAll();
    }
  }

  function bindEvents() {
    refs.btnAppHub.addEventListener('click', () => {
      window.location.href = buildAppHubUrl();
    });
    refs.btnCashboxHandover.addEventListener('click', () => {
      window.location.href = buildHandoverUrl();
    });
    refs.openingLocationSelect.addEventListener('change', () => {
      state.selectedLocationCode = normalizeLocationCode(refs.openingLocationSelect.value);
      state.openingShift.saved_at = null;
      state.openingShift.shift_session_id = null;
      renderAll();
      refreshManagerResolutionPreview().catch((error) => {
        console.warn('[EOS Open Shift] Failed to refresh manager-resolution preview after location change.', error);
      });
    });
    refs.lastShiftClosingCash.addEventListener('input', () => {
      state.openingShift.last_shift_closing_cash = refs.lastShiftClosingCash.value;
      renderAll();
    });
    refs.openingCashMatchesToggle.addEventListener('click', () => {
      if (refs.openingCashMatchesToggle.disabled) return;
      state.openingShift.opening_cash_matches = !state.openingShift.opening_cash_matches;
      renderAll();
      refreshManagerResolutionPreview({ force: true }).catch((error) => {
        console.warn('[EOS Open Shift] Failed to refresh manager-resolution preview after mismatch toggle.', error);
      });
    });
    refs.actualOpeningCash.addEventListener('input', () => {
      state.openingShift.actual_opening_cash = refs.actualOpeningCash.value;
      renderAll();
    });
    refs.overrideReasonSelect.addEventListener('change', () => {
      state.openingShift.override_reason = refs.overrideReasonSelect.value;
      renderAll();
    });
    refs.openingNote.addEventListener('input', () => {
      state.openingShift.note = refs.openingNote.value;
      renderAll();
    });
    refs.registrationLocationSelect.addEventListener('change', () => {
      state.pendingRegistrationLocation = normalizeRegistrationSelection(refs.registrationLocationSelect.value);
      renderRegistrationModal();
    });
    refs.btnConfirmRegistration.addEventListener('click', confirmWorkstationRegistration);
    refs.openingResponsePanel.addEventListener('input', (event) => {
      const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!target) return;
      const fieldName = String(target.dataset.openingResolutionField || '').trim();
      if (!fieldName) return;
      setOpeningResolutionFieldValue(fieldName, target.value);
    });
    refs.openingResponsePanel.addEventListener('click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest('[data-opening-resolution-action]') : null;
      if (!(target instanceof HTMLElement)) return;
      const actionName = String(target.dataset.openingResolutionAction || '').trim();
      if (!actionName) return;
      handleOpeningResolutionAction(actionName);
    });
    refs.btnSaveOpening.addEventListener('click', saveOpeningDetails);
  }

  function startClock() {
    window.setInterval(() => {
      state.liveNow = new Date();
      renderTopBar();
    }, 1000);
  }

  state.currentUser = resolveCurrentUserLabel();
  state.currentRole = resolveCurrentRole();
  state.availableLocations = getFallbackLocationOptions();
  syncSystemOpeningFields(new Date());
  applyWorkstationContext();
  bindEvents();
  renderAll();
  startClock();
  loadAvailableLocations();
})();
