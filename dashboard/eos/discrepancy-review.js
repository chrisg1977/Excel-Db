(function () {
  'use strict';

  const API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';
  const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
  const DEFAULT_API_ORIGIN = window.location.port === '8055'
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:8055`;

  const FALLBACK_LOCATIONS = [
    { id: '', code: 'ZABBAR', name: 'Zabbar' },
    { id: '', code: 'QORMI', name: 'Qormi' },
    { id: '', code: 'GZIRA', name: 'Gzira' },
    { id: '', code: 'VALLETTA', name: 'Valletta' }
  ];

  const FALLBACK_DEPARTMENTS = [
    { id: '', code: 'MDCZ', name: 'Mediatrix Dental Clinic - Zabbar' },
    { id: '', code: 'MPLUS', name: 'MPLUS Clinics' },
    { id: '', code: 'EDLAB', name: 'Eight Dental Lab' },
    { id: '', code: 'MPHARM', name: 'Mplus Pharmacy' },
    { id: '', code: 'MDCQ', name: 'Mediatrix Dental Clinic - Qormi' },
    { id: '', code: 'PODO', name: 'Mediatrix Podiatry Centre' },
    { id: '', code: 'RUNLAB', name: 'Running Lab' },
    { id: '', code: 'FLEXP', name: 'Flex+' },
    { id: '', code: 'MHB', name: 'MHB' },
    { id: '', code: 'BLUMQ', name: 'Blu-M Central Qormi' },
    { id: '', code: 'BLUMG', name: 'Blu-M City' },
    { id: '', code: 'BLUMV', name: 'Blu-M Capital' }
  ];

  const state = {
    apiOrigin: '',
    currentUser: 'Management User',
    currentRole: 'management',
    filters: createDefaultFilters(),
    pagination: {
      limit: 50,
      offset: 0,
      total_count: 0
    },
    locations: [],
    departments: [],
    events: [],
    selectedEventId: '',
    selectedEventDetail: null,
    loadingList: false,
    loadingDetail: false
  };

  const refs = {
    errorBanner: document.getElementById('errorBanner'),
    infoBanner: document.getElementById('infoBanner'),
    currentUserLabel: document.getElementById('currentUserLabel'),
    currentRoleLabel: document.getElementById('currentRoleLabel'),
    currentApiOriginLabel: document.getElementById('currentApiOriginLabel'),
    btnAppHub: document.getElementById('btnAppHub'),
    filterForm: document.getElementById('filterForm'),
    filterLocationCode: document.getElementById('filterLocationCode'),
    filterDepartmentCode: document.getElementById('filterDepartmentCode'),
    filterEventType: document.getElementById('filterEventType'),
    filterStatus: document.getElementById('filterStatus'),
    filterCreatedBy: document.getElementById('filterCreatedBy'),
    filterCreatedAtFrom: document.getElementById('filterCreatedAtFrom'),
    filterCreatedAtTo: document.getElementById('filterCreatedAtTo'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    btnApplyFilters: document.getElementById('btnApplyFilters'),
    eventCountBadge: document.getElementById('eventCountBadge'),
    activeFilterBadge: document.getElementById('activeFilterBadge'),
    listStateNote: document.getElementById('listStateNote'),
    pageLimitSelect: document.getElementById('pageLimitSelect'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    pageRangeBadge: document.getElementById('pageRangeBadge'),
    eventTableBody: document.getElementById('eventTableBody'),
    detailTitle: document.getElementById('detailTitle'),
    detailSubtitle: document.getElementById('detailSubtitle'),
    detailEventIdBadge: document.getElementById('detailEventIdBadge'),
    detailEmpty: document.getElementById('detailEmpty'),
    detailContent: document.getElementById('detailContent'),
    eventMetaGrid: document.getElementById('eventMetaGrid'),
    managerPreviewJson: document.getElementById('managerPreviewJson'),
    eventPayloadJson: document.getElementById('eventPayloadJson'),
    latestReviewJson: document.getElementById('latestReviewJson')
  };

  function createDefaultFilters() {
    return {
      location_code: '',
      department_code: '',
      event_type: '',
      status: '',
      created_by: '',
      created_at_from: '',
      created_at_to: ''
    };
  }

  function normalizeApiOrigin(origin) {
    return String(origin || '').trim().replace(/\/$/, '');
  }

  function getStoredApiOrigin() {
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
      normalizeApiOrigin(getStoredApiOrigin())
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
      auth && auth.user && auth.user.first_name && auth.user.last_name
        ? `${auth.user.first_name} ${auth.user.last_name}`
        : '',
      auth && auth.user && auth.user.first_name ? auth.user.first_name : '',
      auth && auth.user ? auth.user.email : '',
      auth ? auth.email : '',
      params.get('user')
    ].filter(Boolean);
    return candidates.length ? String(candidates[0]) : 'Management User';
  }

  function resolveCurrentRole() {
    const auth = readStoredAuth();
    const params = new URLSearchParams(window.location.search);
    const candidates = [
      auth && auth.user && auth.user.role && auth.user.role.name,
      auth && auth.user ? auth.user.role_name : '',
      auth ? auth.role : '',
      params.get('role'),
      params.get('eos_role')
    ].filter(Boolean);
    return candidates.length ? String(candidates[0]).trim().toLowerCase() : 'management';
  }

  function getAppHubUrl() {
    const url = new URL('../app-hub.html', window.location.href);
    const apiOrigin = getStoredApiOrigin();
    if (apiOrigin) {
      url.searchParams.set('api_origin', apiOrigin);
    }
    return url.toString();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showBanner(ref, message) {
    if (!ref) return;
    const text = String(message || '').trim();
    ref.textContent = text;
    ref.classList.toggle('hidden', !text);
  }

  function showError(message) {
    showBanner(refs.errorBanner, message);
  }

  function clearError() {
    showBanner(refs.errorBanner, '');
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Malta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(parsed);
  }

  function formatMoney(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return '—';
    return new Intl.NumberFormat('en-MT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(parsed);
  }

  function formatNullable(value) {
    const text = String(value ?? '').trim();
    return text || '—';
  }

  function datetimeLocalToIso(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  function stringifyJson(value) {
    if (value === null || value === undefined || value === '') return 'null';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function normalizeLocationOption(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const code = String(row.code || '').trim().toUpperCase();
    const name = String(row.name || code).trim();
    if (!code) return null;
    return { id: row.id ? String(row.id).trim() : '', code, name };
  }

  function normalizeDepartmentOption(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const code = String(row.code || '').trim().toUpperCase();
    const name = String(row.name || code).trim();
    if (!code) return null;
    return { id: row.id ? String(row.id).trim() : '', code, name };
  }

  function dedupeByCode(rows) {
    const map = new Map();
    rows.forEach((row) => {
      if (!row || !row.code || map.has(row.code)) return;
      map.set(row.code, row);
    });
    return Array.from(map.values());
  }

  function renderFilterSelectOptions(ref, options, currentValue, emptyLabel) {
    if (!ref) return;
    const sorted = [...options].sort((left, right) => String(left.name || left.code).localeCompare(String(right.name || right.code)));
    ref.innerHTML = [`<option value="">${escapeHtml(emptyLabel)}</option>`]
      .concat(sorted.map((option) => `<option value="${escapeHtml(option.code)}"${option.code === currentValue ? ' selected' : ''}>${escapeHtml(`${option.code} — ${option.name}`)}</option>`))
      .join('');
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = parsed && typeof parsed.error === 'string'
        ? parsed.error
        : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return parsed;
  }

  async function loadFilterLookups() {
    const apiOrigin = getEosApiOrigin();
    try {
      const [locationsResponse, departmentsResponse] = await Promise.all([
        fetchJson(new URL('/api/locations?is_active=true', `${apiOrigin}/`).toString()),
        fetchJson(new URL('/api/departments?is_active=true', `${apiOrigin}/`).toString())
      ]);
      state.locations = dedupeByCode(
        Array.isArray(locationsResponse) ? locationsResponse.map(normalizeLocationOption).filter(Boolean) : []
      );
      state.departments = dedupeByCode(
        Array.isArray(departmentsResponse) ? departmentsResponse.map(normalizeDepartmentOption).filter(Boolean) : []
      );
      if (!state.locations.length) state.locations = FALLBACK_LOCATIONS;
      if (!state.departments.length) state.departments = FALLBACK_DEPARTMENTS;
    } catch (error) {
      console.warn('[EOS Discrepancy Review] Failed to load filter lookups. Using fallback values.', error);
      state.locations = FALLBACK_LOCATIONS;
      state.departments = FALLBACK_DEPARTMENTS;
    }

    renderFilterSelectOptions(refs.filterLocationCode, state.locations, state.filters.location_code, 'All locations');
    renderFilterSelectOptions(refs.filterDepartmentCode, state.departments, state.filters.department_code, 'All departments');
  }

  function readFiltersFromDom() {
    return {
      location_code: String(refs.filterLocationCode.value || '').trim().toUpperCase(),
      department_code: String(refs.filterDepartmentCode.value || '').trim().toUpperCase(),
      event_type: String(refs.filterEventType.value || '').trim(),
      status: String(refs.filterStatus.value || '').trim(),
      created_by: String(refs.filterCreatedBy.value || '').trim(),
      created_at_from: String(refs.filterCreatedAtFrom.value || '').trim(),
      created_at_to: String(refs.filterCreatedAtTo.value || '').trim()
    };
  }

  function writeFiltersToDom() {
    refs.filterLocationCode.value = state.filters.location_code;
    refs.filterDepartmentCode.value = state.filters.department_code;
    refs.filterEventType.value = state.filters.event_type;
    refs.filterStatus.value = state.filters.status;
    refs.filterCreatedBy.value = state.filters.created_by;
    refs.filterCreatedAtFrom.value = state.filters.created_at_from;
    refs.filterCreatedAtTo.value = state.filters.created_at_to;
  }

  function buildListUrl() {
    const url = new URL('/api/eos/discrepancy-events', `${getEosApiOrigin()}/`);
    const filters = state.filters;
    if (filters.location_code) url.searchParams.set('location_code', filters.location_code);
    if (filters.department_code) url.searchParams.set('department_code', filters.department_code);
    if (filters.event_type) url.searchParams.set('event_type', filters.event_type);
    if (filters.status) url.searchParams.set('status', filters.status);
    if (filters.created_by) url.searchParams.set('created_by', filters.created_by);
    const fromIso = datetimeLocalToIso(filters.created_at_from);
    const toIso = datetimeLocalToIso(filters.created_at_to);
    if (fromIso) url.searchParams.set('created_at_from', fromIso);
    if (toIso) url.searchParams.set('created_at_to', toIso);
    url.searchParams.set('limit', String(state.pagination.limit));
    url.searchParams.set('offset', String(state.pagination.offset));
    return url.toString();
  }

  function buildDetailUrl(eventId) {
    return new URL(`/api/eos/discrepancy-events/${encodeURIComponent(String(eventId || '').trim())}`, `${getEosApiOrigin()}/`).toString();
  }

  function countActiveFilters(filters) {
    return Object.values(filters).filter((value) => String(value || '').trim()).length;
  }

  function updateFilterSummary() {
    const count = countActiveFilters(state.filters);
    refs.activeFilterBadge.textContent = count ? `${count} active filter${count === 1 ? '' : 's'}` : 'No filters';
  }

  function syncPaginationUi() {
    refs.pageLimitSelect.value = String(state.pagination.limit);
    const total = Number(state.pagination.total_count || 0);
    const offset = Number(state.pagination.offset || 0);
    const limit = Number(state.pagination.limit || 0);
    const start = total ? offset + 1 : 0;
    const end = total ? Math.min(offset + state.events.length, total) : 0;
    refs.pageRangeBadge.textContent = `${start}-${end} of ${total}`;
    refs.btnPrevPage.disabled = state.loadingList || offset <= 0;
    refs.btnNextPage.disabled = state.loadingList || offset + limit >= total;
  }

  function renderEventTable() {
    refs.eventCountBadge.textContent = `${state.pagination.total_count} total`;
    syncPaginationUi();

    if (state.loadingList) {
      refs.listStateNote.textContent = 'Loading discrepancy events...';
      refs.eventTableBody.innerHTML = '<tr><td colspan="8">Loading discrepancy events...</td></tr>';
      return;
    }

    if (!state.events.length) {
      refs.listStateNote.textContent = 'No discrepancy events matched the current filters.';
      refs.eventTableBody.innerHTML = '<tr><td colspan="8">No discrepancy events found for the current filter set.</td></tr>';
      return;
    }

    refs.listStateNote.textContent = 'Click an event row to inspect its saved payload and routing preview.';
    refs.eventTableBody.innerHTML = state.events.map((row) => `
      <tr data-event-id="${escapeHtml(row.event_id)}"${row.event_id === state.selectedEventId ? ' class="active"' : ''}>
        <td>${escapeHtml(formatDateTime(row.created_at))}</td>
        <td>${escapeHtml(formatNullable(row.location_code))}</td>
        <td>${escapeHtml(formatNullable(row.department_code))}</td>
        <td>${escapeHtml(formatNullable(row.event_type))}</td>
        <td>${escapeHtml(formatNullable(row.discrepancy_type))}</td>
        <td class="money">${escapeHtml(formatMoney(row.discrepancy_amount))}</td>
        <td>${escapeHtml(formatNullable(row.created_by))}</td>
        <td>${escapeHtml(formatNullable(row.status))}</td>
      </tr>
    `).join('');
  }

  function buildMetaCard(label, value) {
    return `
      <div class="meta-card">
        <div class="meta-label">${escapeHtml(label)}</div>
        <div class="meta-value">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function renderDetail() {
    const detail = state.selectedEventDetail;
    if (!detail) {
      refs.detailEmpty.classList.remove('hidden');
      refs.detailContent.classList.add('hidden');
      refs.detailTitle.textContent = state.loadingDetail ? 'Loading discrepancy event...' : 'Select a discrepancy event';
      refs.detailSubtitle.textContent = state.loadingDetail ? 'Retrieving the saved discrepancy event detail.' : '';
      refs.detailEventIdBadge.classList.add('hidden');
      refs.detailEventIdBadge.textContent = '';
      return;
    }

    const event = detail.event || {};
    const latestReview = detail.latest_review || null;
    refs.detailEmpty.classList.add('hidden');
    refs.detailContent.classList.remove('hidden');
    refs.detailTitle.textContent = `${formatNullable(event.event_type)} • ${formatNullable(event.location_code)}`;
    refs.detailSubtitle.textContent = `Created ${formatDateTime(event.created_at)} by ${formatNullable(event.created_by)} • ${formatNullable(event.status)}`;
    refs.detailEventIdBadge.textContent = event.event_id || '';
    refs.detailEventIdBadge.classList.toggle('hidden', !event.event_id);

    refs.eventMetaGrid.innerHTML = [
      buildMetaCard('Event ID', formatNullable(event.event_id)),
      buildMetaCard('Location', formatNullable(event.location_code)),
      buildMetaCard('Department', formatNullable(event.department_code)),
      buildMetaCard('Event Type', formatNullable(event.event_type)),
      buildMetaCard('Discrepancy Type', formatNullable(event.discrepancy_type)),
      buildMetaCard('Discrepancy Amount', formatMoney(event.discrepancy_amount)),
      buildMetaCard('Created By', formatNullable(event.created_by)),
      buildMetaCard('Created At', formatDateTime(event.created_at)),
      buildMetaCard('Status', formatNullable(event.status)),
      buildMetaCard('Admin Summary Required', event.admin_summary_required ? 'Yes' : 'No'),
      buildMetaCard('Shift Session', formatNullable(event.shift_session_id)),
      buildMetaCard('Report Header', formatNullable(event.report_header_id))
    ].join('');

    refs.managerPreviewJson.textContent = stringifyJson(event.manager_resolution_preview);
    refs.eventPayloadJson.textContent = stringifyJson(event);
    refs.latestReviewJson.textContent = latestReview ? stringifyJson(latestReview) : 'null';
  }

  async function loadEventDetail(eventId) {
    const normalizedId = String(eventId || '').trim();
    if (!normalizedId) return;
    state.loadingDetail = true;
    state.selectedEventId = normalizedId;
    clearError();
    renderEventTable();
    renderDetail();
    try {
      state.selectedEventDetail = await fetchJson(buildDetailUrl(normalizedId));
      renderDetail();
      renderEventTable();
    } catch (error) {
      state.selectedEventDetail = null;
      renderDetail();
      renderEventTable();
      showError(`Failed to load discrepancy event detail: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.loadingDetail = false;
      renderDetail();
    }
  }

  async function loadEvents(options = {}) {
    const { autoSelectFirst = true, resetOffset = false } = options;
    if (resetOffset) {
      state.pagination.offset = 0;
    }
    state.loadingList = true;
    clearError();
    renderEventTable();
    updateFilterSummary();

    try {
      const response = await fetchJson(buildListUrl());
      state.events = Array.isArray(response && response.items) ? response.items : [];
      state.pagination.total_count = Number(response && response.total_count);
      if (!Number.isFinite(state.pagination.total_count)) state.pagination.total_count = state.events.length;
      state.pagination.limit = Number(response && response.limit) > 0 ? Number(response.limit) : state.pagination.limit;
      state.pagination.offset = Number(response && response.offset) >= 0 ? Number(response.offset) : state.pagination.offset;

      const stillSelected = state.events.some((row) => row.event_id === state.selectedEventId);
      if (!stillSelected) {
        state.selectedEventId = '';
        state.selectedEventDetail = null;
      }

      renderEventTable();
      renderDetail();

      if (state.events.length) {
        const nextId = stillSelected
          ? state.selectedEventId
          : autoSelectFirst
            ? state.events[0].event_id
            : '';
        if (nextId) {
          await loadEventDetail(nextId);
        }
      }
    } catch (error) {
      showError(`Failed to load discrepancy events: ${error instanceof Error ? error.message : String(error)}`);
      renderEventTable();
    } finally {
      state.loadingList = false;
      renderEventTable();
    }
  }

  function handleEventTableClick(event) {
    const row = event.target instanceof Element ? event.target.closest('tr[data-event-id]') : null;
    if (!row) return;
    const eventId = row.getAttribute('data-event-id');
    if (!eventId || eventId === state.selectedEventId) return;
    loadEventDetail(eventId);
  }

  function bindEvents() {
    refs.btnAppHub.addEventListener('click', () => {
      window.location.href = getAppHubUrl();
    });

    refs.filterForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.filters = readFiltersFromDom();
      await loadEvents({ autoSelectFirst: true, resetOffset: true });
    });

    refs.btnResetFilters.addEventListener('click', async () => {
      state.filters = createDefaultFilters();
      writeFiltersToDom();
      await loadEvents({ autoSelectFirst: true, resetOffset: true });
    });

    refs.pageLimitSelect.addEventListener('change', async () => {
      const nextLimit = Number(refs.pageLimitSelect.value);
      state.pagination.limit = Number.isFinite(nextLimit) && nextLimit > 0 ? nextLimit : 50;
      state.pagination.offset = 0;
      await loadEvents({ autoSelectFirst: true });
    });

    refs.btnPrevPage.addEventListener('click', async () => {
      state.pagination.offset = Math.max(0, state.pagination.offset - state.pagination.limit);
      await loadEvents({ autoSelectFirst: true });
    });

    refs.btnNextPage.addEventListener('click', async () => {
      state.pagination.offset = state.pagination.offset + state.pagination.limit;
      await loadEvents({ autoSelectFirst: true });
    });

    refs.eventTableBody.addEventListener('click', handleEventTableClick);
  }

  async function initialize() {
    state.apiOrigin = getEosApiOrigin();
    state.currentUser = resolveCurrentUserLabel();
    state.currentRole = resolveCurrentRole();
    refs.currentUserLabel.textContent = state.currentUser;
    refs.currentRoleLabel.textContent = `Role: ${state.currentRole || 'management'}`;
    refs.currentApiOriginLabel.textContent = `API: ${state.apiOrigin}`;

    // TODO: Enforce management-or-higher access here once the shared auth layer
    // exposes final role claims consistently across dashboard modules.
    writeFiltersToDom();
    await loadFilterLookups();
    bindEvents();
    await loadEvents({ autoSelectFirst: true });
  }

  initialize().catch((error) => {
    showError(`Failed to initialize EOS discrepancy review: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[EOS Discrepancy Review] Initialization failed.', error);
  });
})();
