(function () {
  'use strict';

  const API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';
  const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
  const DEFAULT_API_ORIGIN = window.location.port === '8055'
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:8055`;

  const FALLBACK_LOCATIONS = [
    { id: '', code: 'ZABBAR', name: 'Zabbar', has_active_reception: true },
    { id: '', code: 'QORMI', name: 'Qormi', has_active_reception: true },
    { id: '', code: 'GZIRA', name: 'Gzira', has_active_reception: false },
    { id: '', code: 'VALLETTA', name: 'Valletta', has_active_reception: false }
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
    reports: [],
    selectedReportId: '',
    selectedReportDetail: null,
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
    filterAccountingPeriodId: document.getElementById('filterAccountingPeriodId'),
    filterClinicCode: document.getElementById('filterClinicCode'),
    filterDepartmentCode: document.getElementById('filterDepartmentCode'),
    filterLocationCode: document.getElementById('filterLocationCode'),
    filterGeneratedBy: document.getElementById('filterGeneratedBy'),
    filterReportType: document.getElementById('filterReportType'),
    filterStatus: document.getElementById('filterStatus'),
    filterDateFrom: document.getElementById('filterDateFrom'),
    filterDateTo: document.getElementById('filterDateTo'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    btnApplyFilters: document.getElementById('btnApplyFilters'),
    reportCountBadge: document.getElementById('reportCountBadge'),
    activeFilterBadge: document.getElementById('activeFilterBadge'),
    listStateNote: document.getElementById('listStateNote'),
    pageLimitSelect: document.getElementById('pageLimitSelect'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    pageRangeBadge: document.getElementById('pageRangeBadge'),
    reportTableBody: document.getElementById('reportTableBody'),
    detailTitle: document.getElementById('detailTitle'),
    detailSubtitle: document.getElementById('detailSubtitle'),
    detailHeaderIdBadge: document.getElementById('detailHeaderIdBadge'),
    detailEmpty: document.getElementById('detailEmpty'),
    detailContent: document.getElementById('detailContent'),
    headerGrid: document.getElementById('headerGrid'),
    summaryGrid: document.getElementById('summaryGrid'),
    auditCountLabel: document.getElementById('auditCountLabel'),
    rowCountLabel: document.getElementById('rowCountLabel'),
    auditTableBody: document.getElementById('auditTableBody'),
    rowTableBody: document.getElementById('rowTableBody')
  };

  function createDefaultFilters() {
    return {
      accounting_period_id: '',
      clinic_code: '',
      department_code: '',
      location_code: '',
      generated_by: '',
      report_type: '',
      status: '',
      report_start_at_from: '',
      report_start_at_to: ''
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

  function formatBoolean(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return '—';
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

  function normalizeLocationOption(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const code = String(row.code || '').trim().toUpperCase();
    const name = String(row.name || code).trim();
    if (!code) return null;
    return {
      id: row.id ? String(row.id).trim() : '',
      code,
      name,
      has_active_reception: Boolean(row.has_active_reception)
    };
  }

  function normalizeDepartmentOption(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const code = String(row.code || '').trim().toUpperCase();
    const name = String(row.name || code).trim();
    if (!code) return null;
    return {
      id: row.id ? String(row.id).trim() : '',
      code,
      name
    };
  }

  function dedupeByCode(rows) {
    const map = new Map();
    rows.forEach((row) => {
      if (!row || !row.code || map.has(row.code)) return;
      map.set(row.code, row);
    });
    return Array.from(map.values());
  }

  function renderFilterSelectOptions(ref, options, currentValue, emptyLabel, formatter) {
    if (!ref) return;
    const sorted = [...options].sort((left, right) => String(left.name || left.code).localeCompare(String(right.name || right.code)));
    const html = [`<option value="">${escapeHtml(emptyLabel)}</option>`]
      .concat(sorted.map((option) => {
        const label = formatter ? formatter(option) : `${option.code} — ${option.name}`;
        return `<option value="${escapeHtml(option.code)}"${option.code === currentValue ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }))
      .join('');
    ref.innerHTML = html;
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

    // TODO: Replace the clinic text filter with shared master-data lookup once a
    // dedicated clinic/business-unit read endpoint is available for management UI.
    // TODO: Replace the accounting-period UUID text filter once /api/eos/periods
    // is implemented for proper period code/name lookup.
    try {
      const locationsUrl = new URL('/api/locations', `${apiOrigin}/`);
      locationsUrl.searchParams.set('is_active', 'true');
      const departmentsUrl = new URL('/api/departments', `${apiOrigin}/`);
      departmentsUrl.searchParams.set('is_active', 'true');

      const [locationsResponse, departmentsResponse] = await Promise.all([
        fetchJson(locationsUrl.toString()),
        fetchJson(departmentsUrl.toString())
      ]);

      const normalizedLocations = dedupeByCode(
        Array.isArray(locationsResponse)
          ? locationsResponse.map(normalizeLocationOption).filter(Boolean)
          : []
      );
      const normalizedDepartments = dedupeByCode(
        Array.isArray(departmentsResponse)
          ? departmentsResponse.map(normalizeDepartmentOption).filter(Boolean)
          : []
      );

      state.locations = normalizedLocations.length ? normalizedLocations : FALLBACK_LOCATIONS;
      state.departments = normalizedDepartments.length ? normalizedDepartments : FALLBACK_DEPARTMENTS;
    } catch (error) {
      console.warn('[EOS Management Reports] Failed to load master-data filter lookups. Using fallback values.', error);
      state.locations = FALLBACK_LOCATIONS;
      state.departments = FALLBACK_DEPARTMENTS;
    }

    renderFilterSelectOptions(
      refs.filterLocationCode,
      state.locations,
      state.filters.location_code,
      'All locations',
      (option) => `${option.code} — ${option.name}`
    );
    renderFilterSelectOptions(
      refs.filterDepartmentCode,
      state.departments,
      state.filters.department_code,
      'All departments',
      (option) => `${option.code} — ${option.name}`
    );
  }

  function readFiltersFromDom() {
    return {
      accounting_period_id: String(refs.filterAccountingPeriodId.value || '').trim(),
      clinic_code: String(refs.filterClinicCode.value || '').trim().toUpperCase(),
      department_code: String(refs.filterDepartmentCode.value || '').trim().toUpperCase(),
      location_code: String(refs.filterLocationCode.value || '').trim().toUpperCase(),
      generated_by: String(refs.filterGeneratedBy.value || '').trim(),
      report_type: String(refs.filterReportType.value || '').trim(),
      status: String(refs.filterStatus.value || '').trim(),
      report_start_at_from: String(refs.filterDateFrom.value || '').trim(),
      report_start_at_to: String(refs.filterDateTo.value || '').trim()
    };
  }

  function writeFiltersToDom() {
    refs.filterAccountingPeriodId.value = state.filters.accounting_period_id;
    refs.filterClinicCode.value = state.filters.clinic_code;
    refs.filterDepartmentCode.value = state.filters.department_code;
    refs.filterLocationCode.value = state.filters.location_code;
    refs.filterGeneratedBy.value = state.filters.generated_by;
    refs.filterReportType.value = state.filters.report_type;
    refs.filterStatus.value = state.filters.status;
    refs.filterDateFrom.value = state.filters.report_start_at_from;
    refs.filterDateTo.value = state.filters.report_start_at_to;
  }

  function buildListUrl() {
    const url = new URL('/api/eos/reports', `${getEosApiOrigin()}/`);
    const filters = state.filters;

    if (filters.accounting_period_id) url.searchParams.set('accounting_period_id', filters.accounting_period_id);
    if (filters.clinic_code) url.searchParams.set('clinic_code', filters.clinic_code);
    if (filters.department_code) url.searchParams.set('department_code', filters.department_code);
    if (filters.location_code) url.searchParams.set('location_code', filters.location_code);
    if (filters.shift_session_id) url.searchParams.set('shift_session_id', filters.shift_session_id);
    if (filters.generated_by) url.searchParams.set('generated_by', filters.generated_by);
    if (filters.report_type) url.searchParams.set('report_type', filters.report_type);
    if (filters.status) url.searchParams.set('status', filters.status);

    const fromIso = datetimeLocalToIso(filters.report_start_at_from);
    const toIso = datetimeLocalToIso(filters.report_start_at_to);
    if (fromIso) url.searchParams.set('report_start_at_from', fromIso);
    if (toIso) url.searchParams.set('report_start_at_to', toIso);
    url.searchParams.set('limit', String(state.pagination.limit));
    url.searchParams.set('offset', String(state.pagination.offset));

    return url.toString();
  }

  function buildDetailUrl(reportHeaderId) {
    return new URL(`/api/eos/reports/${encodeURIComponent(String(reportHeaderId || '').trim())}`, `${getEosApiOrigin()}/`).toString();
  }

  function countActiveFilters(filters) {
    return Object.values(filters).filter((value) => String(value || '').trim()).length;
  }

  function updateFilterSummary() {
    const count = countActiveFilters(state.filters);
    refs.activeFilterBadge.textContent = count ? `${count} active filter${count === 1 ? '' : 's'}` : 'No filters';
  }

  function syncPaginationUi() {
    if (refs.pageLimitSelect) {
      refs.pageLimitSelect.value = String(state.pagination.limit);
    }

    const total = Number(state.pagination.total_count || 0);
    const offset = Number(state.pagination.offset || 0);
    const limit = Number(state.pagination.limit || 0);
    const start = total ? offset + 1 : 0;
    const end = total ? Math.min(offset + state.reports.length, total) : 0;

    refs.pageRangeBadge.textContent = `${start}-${end} of ${total}`;
    refs.btnPrevPage.disabled = state.loadingList || offset <= 0;
    refs.btnNextPage.disabled = state.loadingList || offset + limit >= total;
  }

  function renderReportTable() {
    refs.reportCountBadge.textContent = `${state.pagination.total_count} total`;
    syncPaginationUi();

    if (state.loadingList) {
      refs.listStateNote.textContent = 'Loading saved EOS reports...';
      refs.reportTableBody.innerHTML = `
        <tr>
          <td colspan="10">Loading saved report snapshots...</td>
        </tr>
      `;
      return;
    }

    if (!state.reports.length) {
      refs.listStateNote.textContent = 'No saved reports matched the current filters.';
      refs.reportTableBody.innerHTML = `
        <tr>
          <td colspan="10">No saved EOS reports found for the current filter set.</td>
        </tr>
      `;
      return;
    }

    refs.listStateNote.textContent = 'Click a saved report row to open its full snapshot detail.';
    refs.reportTableBody.innerHTML = state.reports.map((row) => `
      <tr data-report-id="${escapeHtml(row.report_header_id)}"${row.report_header_id === state.selectedReportId ? ' class="active"' : ''}>
        <td>${escapeHtml(formatDateTime(row.generated_at))}</td>
        <td>${escapeHtml(formatNullable(row.clinic_code))}</td>
        <td>${escapeHtml(formatNullable(row.department_code))}</td>
        <td>${escapeHtml(formatNullable(row.location_code))}</td>
        <td>${escapeHtml(formatNullable(row.generated_by))}</td>
        <td>${escapeHtml(formatNullable(row.report_type))}</td>
        <td>${escapeHtml(formatNullable(row.status))}</td>
        <td>${renderExceptionFlags(row)}</td>
        <td>${escapeHtml(formatDateTime(row.report_start_at))}</td>
        <td>${escapeHtml(formatDateTime(row.report_end_at))}</td>
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

  function buildSummaryCard(label, value, isMoney) {
    const formatted = isMoney ? formatMoney(value) : formatNullable(value);
    return `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value${isMoney ? ' money' : ''}">${escapeHtml(formatted)}</div>
      </div>
    `;
  }

  function buildFlagBadge(label, kind) {
    return `<span class="flag-badge ${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
  }

  function renderExceptionFlags(row) {
    const flags = [];

    if (row && row.discrepancy_present) {
      flags.push(buildFlagBadge('Discrepancy', 'discrepancy'));
    }
    if (row && row.manager_alert_created) {
      flags.push(buildFlagBadge('Mgr Alert', 'alert'));
    }
    if (row && row.temporary_closed_pending_review) {
      flags.push(buildFlagBadge('Temp Review', 'temporary'));
    }
    if (row && row.unresolved_review_pending) {
      flags.push(buildFlagBadge('Review Pending', 'review'));
    }

    // TODO: Add emergency_handover_used only after it is persisted on the
    // retrieval path. Do not infer a fake emergency-handover state here.

    if (!flags.length) {
      flags.push(buildFlagBadge('None', 'none'));
    }

    return `<div class="flag-badges">${flags.join('')}</div>`;
  }

  function renderAuditValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return '—';
    return `<div class="audit-value">${escapeHtml(text)}</div>`;
  }

  function renderDetail() {
    const detail = state.selectedReportDetail;

    if (!detail) {
      refs.detailEmpty.classList.remove('hidden');
      refs.detailContent.classList.add('hidden');
      refs.detailTitle.textContent = state.loadingDetail ? 'Loading saved report...' : 'Select a saved report';
      refs.detailSubtitle.textContent = state.loadingDetail
        ? 'Retrieving the saved EOS report snapshot.'
        : '';
      refs.detailHeaderIdBadge.classList.add('hidden');
      refs.detailHeaderIdBadge.textContent = '';
      return;
    }

    const header = detail.header || {};
    const summary = detail.summary || null;
    const rows = Array.isArray(detail.rows) ? detail.rows : [];
    const audit = Array.isArray(detail.audit) ? detail.audit : [];

    refs.detailEmpty.classList.add('hidden');
    refs.detailContent.classList.remove('hidden');
    refs.detailTitle.textContent = `${formatNullable(header.department_code)} • ${formatNullable(header.location_code)}`;
    refs.detailSubtitle.textContent = `Generated ${formatDateTime(header.generated_at)} by ${formatNullable(header.generated_by)} • ${formatNullable(header.report_type)} • ${formatNullable(header.status)}`;
    refs.detailHeaderIdBadge.textContent = header.report_header_id || '';
    refs.detailHeaderIdBadge.classList.toggle('hidden', !header.report_header_id);

    refs.headerGrid.innerHTML = [
      buildMetaCard('Report Header ID', formatNullable(header.report_header_id)),
      buildMetaCard('Accounting Period', formatNullable(header.accounting_period_id)),
      buildMetaCard('Shift Session', formatNullable(header.shift_session_id)),
      buildMetaCard('Location', formatNullable(header.location_code)),
      buildMetaCard('Clinic', formatNullable(header.clinic_code)),
      buildMetaCard('Department', formatNullable(header.department_code)),
      buildMetaCard('Generated By', formatNullable(header.generated_by)),
      buildMetaCard('Generated At', formatDateTime(header.generated_at)),
      buildMetaCard('Report Type', formatNullable(header.report_type)),
      buildMetaCard('Status', formatNullable(header.status)),
      buildMetaCard('Report Start', formatDateTime(header.report_start_at)),
      buildMetaCard('Report End', formatDateTime(header.report_end_at))
    ].join('');

    refs.summaryGrid.innerHTML = summary
      ? [
          buildSummaryCard('Opening Cash', summary.opening_cash, true),
          buildSummaryCard('Payment Total', summary.payment_total, true),
          buildSummaryCard('Cash Envelope', summary.cash_envelope_total, true),
          buildSummaryCard('Cashbox Expenses', summary.cashbox_expenses_total, true),
          buildSummaryCard('Sell Total', summary.sell_total, true),
          buildSummaryCard('Fee Total', summary.fee_total, true),
          buildSummaryCard('Expected Total', summary.expected_total, true),
          buildSummaryCard('Actual Total', summary.actual_total, true),
          buildSummaryCard('Discrepancy', summary.discrepancy_total, true),
          buildSummaryCard('Manager Alert Created', formatBoolean(summary.manager_alert_created), false)
        ].join('')
      : '<div class="empty-state">No saved summary row was returned for this report snapshot.</div>';

    refs.auditCountLabel.textContent = `${audit.length} audit entr${audit.length === 1 ? 'y' : 'ies'}`;
    refs.auditTableBody.innerHTML = audit.length
      ? audit.map((entry) => `
          <tr>
            <td>${escapeHtml(formatDateTime(entry.acted_at))}</td>
            <td>${escapeHtml(formatNullable(entry.acted_by))}</td>
            <td>${escapeHtml(formatNullable(entry.action))}</td>
            <td>${escapeHtml(formatNullable(entry.field_name))}</td>
            <td>${renderAuditValue(entry.old_value)}</td>
            <td>${renderAuditValue(entry.new_value)}</td>
          </tr>
        `).join('')
      : `
        <tr>
          <td colspan="6">No audit entries were returned for this saved report snapshot.</td>
        </tr>
      `;

    refs.rowCountLabel.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
    refs.rowTableBody.innerHTML = rows.length
      ? rows.map((row) => `
          <tr>
            <td>${escapeHtml(formatNullable(row.display_order))}</td>
            <td>${escapeHtml(formatNullable(row.patient_number))}</td>
            <td>${escapeHtml(`${formatNullable(row.surname)}, ${formatNullable(row.name)}`)}</td>
            <td>${escapeHtml(formatNullable(row.provider))}</td>
            <td>${escapeHtml(formatNullable(row.treatments))}</td>
            <td class="money">${escapeHtml(formatMoney(row.fee_total))}</td>
            <td>${escapeHtml(formatDateTime(row.appointment_datetime))}</td>
            <td>${escapeHtml(formatNullable(row.walkout_status))}</td>
            <td>${escapeHtml(formatBoolean(row.included))}</td>
            <td>${escapeHtml(formatBoolean(row.carry_forward))}</td>
          </tr>
        `).join('')
      : `
        <tr>
          <td colspan="10">No saved report rows were returned for this snapshot.</td>
        </tr>
      `;
  }

  async function loadReportDetail(reportHeaderId) {
    const normalizedId = String(reportHeaderId || '').trim();
    if (!normalizedId) return;

    state.loadingDetail = true;
    state.selectedReportId = normalizedId;
    renderReportTable();
    renderDetail();
    clearError();

    try {
      const detail = await fetchJson(buildDetailUrl(normalizedId));
      state.selectedReportDetail = detail;
      renderDetail();
      renderReportTable();
    } catch (error) {
      state.selectedReportDetail = null;
      renderDetail();
      renderReportTable();
      showError(`Failed to load saved EOS report snapshot: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.loadingDetail = false;
      renderDetail();
    }
  }

  async function loadReports(options = {}) {
    const { autoSelectFirst = true, resetOffset = false } = options;
    if (resetOffset) {
      state.pagination.offset = 0;
    }
    state.loadingList = true;
    clearError();
    renderReportTable();
    updateFilterSummary();

    try {
      const response = await fetchJson(buildListUrl());
      if (Array.isArray(response)) {
        state.reports = response;
        state.pagination.total_count = response.length;
      } else {
        state.reports = Array.isArray(response && response.items) ? response.items : [];
        state.pagination.total_count = Number(response && response.total_count);
        if (!Number.isFinite(state.pagination.total_count)) {
          state.pagination.total_count = state.reports.length;
        }
        state.pagination.limit = Number(response && response.limit) > 0
          ? Number(response.limit)
          : state.pagination.limit;
        state.pagination.offset = Number(response && response.offset) >= 0
          ? Number(response.offset)
          : state.pagination.offset;
      }

      const stillSelected = state.reports.some((row) => row.report_header_id === state.selectedReportId);
      if (!stillSelected) {
        state.selectedReportId = '';
        state.selectedReportDetail = null;
      }

      renderReportTable();
      renderDetail();

      if (state.reports.length) {
        const nextId = stillSelected
          ? state.selectedReportId
          : autoSelectFirst
            ? state.reports[0].report_header_id
            : '';
        if (nextId) {
          await loadReportDetail(nextId);
        }
      }
    } catch (error) {
      showError(`Failed to load saved EOS reports: ${error instanceof Error ? error.message : String(error)}`);
      renderReportTable();
    } finally {
      state.loadingList = false;
      renderReportTable();
    }
  }

  function handleReportTableClick(event) {
    const row = event.target instanceof Element ? event.target.closest('tr[data-report-id]') : null;
    if (!row) return;
    const reportHeaderId = row.getAttribute('data-report-id');
    if (!reportHeaderId || reportHeaderId === state.selectedReportId) return;
    loadReportDetail(reportHeaderId);
  }

  function bindEvents() {
    refs.btnAppHub.addEventListener('click', () => {
      window.location.href = getAppHubUrl();
    });

    refs.filterForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.filters = readFiltersFromDom();
      await loadReports({ autoSelectFirst: true, resetOffset: true });
    });

    refs.btnResetFilters.addEventListener('click', async () => {
      state.filters = createDefaultFilters();
      writeFiltersToDom();
      await loadReports({ autoSelectFirst: true, resetOffset: true });
    });

    refs.pageLimitSelect.addEventListener('change', async () => {
      const nextLimit = Number(refs.pageLimitSelect.value);
      state.pagination.limit = Number.isFinite(nextLimit) && nextLimit > 0 ? nextLimit : 50;
      state.pagination.offset = 0;
      await loadReports({ autoSelectFirst: true });
    });

    refs.btnPrevPage.addEventListener('click', async () => {
      state.pagination.offset = Math.max(0, state.pagination.offset - state.pagination.limit);
      await loadReports({ autoSelectFirst: true });
    });

    refs.btnNextPage.addEventListener('click', async () => {
      state.pagination.offset = state.pagination.offset + state.pagination.limit;
      await loadReports({ autoSelectFirst: true });
    });

    refs.reportTableBody.addEventListener('click', handleReportTableClick);
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
    await loadReports({ autoSelectFirst: true });
  }

  initialize().catch((error) => {
    showError(`Failed to initialize EOS management retrieval: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[EOS Management Reports] Initialization failed.', error);
  });
})();
