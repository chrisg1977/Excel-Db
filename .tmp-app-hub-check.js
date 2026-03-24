
    const API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';
    const DEFAULT_API_ORIGIN = window.location.port === '8055'
      ? window.location.origin
      : `${window.location.protocol}//${window.location.hostname}:8055`;
    function normalizeApiOrigin(origin) {
      const raw = String(origin || '').trim();
      if (!raw) return '';
      return raw.replace(/\/$/, '');
    }
    function readStoredApiOrigin() {
      try {
        return normalizeApiOrigin(localStorage.getItem(API_ORIGIN_STORAGE_KEY));
      } catch {
        return '';
      }
    }
    const API_ORIGIN_QUERY = normalizeApiOrigin(new URLSearchParams(window.location.search).get('api_origin'));
    const API_ORIGIN_STORED = readStoredApiOrigin();
    const API_ORIGIN =
      API_ORIGIN_QUERY
      || API_ORIGIN_STORED
      || normalizeApiOrigin(DEFAULT_API_ORIGIN);
    let ACTIVE_API_ORIGIN = API_ORIGIN;
    const PAGE_PARAMS = new URLSearchParams(window.location.search);
    const OD_FORCE_AUTH = PAGE_PARAMS.get('od_force_auth') === '1';
    function persistApiOrigin(origin) {
      const normalized = normalizeApiOrigin(origin);
      if (!normalized) return;
      ACTIVE_API_ORIGIN = normalized;
      try {
        localStorage.setItem(API_ORIGIN_STORAGE_KEY, normalized);
      } catch {}
    }
    function buildApiOriginCandidates(preferredOrigin = '') {
      const set = new Set();
      const add = (value) => {
        const normalized = normalizeApiOrigin(value);
        if (normalized) set.add(normalized);
      };
      add(preferredOrigin);
      add(API_ORIGIN_QUERY);
      add(API_ORIGIN_STORED);
      add(DEFAULT_API_ORIGIN);
      add('http://localhost:8055');
      add('http://127.0.0.1:8055');
      if (window.location.hostname) {
        add(`http://${window.location.hostname}:8055`);
        add(`https://${window.location.hostname}:8055`);
      }
      return Array.from(set);
    }
    function isNetworkFetchError(error) {
      const message = String(error instanceof Error ? error.message : error || '').toLowerCase();
      return (
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('network request failed') ||
        message.includes('load failed')
      );
    }
    persistApiOrigin(API_ORIGIN);
    const AUTH_STORAGE_KEY = 'empinfo.auth.v1';
    const RECEIPT_DRAFT_STORAGE_KEY = 'receipt-books.current-draft.v2';
    const OD_DEBUG = new URLSearchParams(window.location.search).get('od_debug') === '1';

    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const btnLogout = document.getElementById('btnLogout');
    const appsGrid = document.getElementById('appsGrid');
    const noApps = document.getElementById('noApps');
    const errorMessage = document.getElementById('errorMessage');
    const receiptDraftReminder = document.getElementById('receiptDraftReminder');
    const receiptDraftReminderTitle = document.getElementById('receiptDraftReminderTitle');
    const receiptDraftReminderCopy = document.getElementById('receiptDraftReminderCopy');
    const btnResumeReceiptDraft = document.getElementById('btnResumeReceiptDraft');
    const btnReviewReceiptDrafts = document.getElementById('btnReviewReceiptDrafts');
    const draftReviewBackdrop = document.getElementById('draftReviewBackdrop');
    const draftReviewList = document.getElementById('draftReviewList');
    const draftReviewCopy = document.getElementById('draftReviewCopy');
    const btnCloseDraftReview = document.getElementById('btnCloseDraftReview');
    const welcomeTitleEl = document.getElementById('welcomeTitle');
    const welcomeDateTimeEl = document.getElementById('welcomeDateTime');
    const appSearchInput = document.getElementById('appSearchInput');
    const btnNavBack = document.getElementById('btnNavBack');
    const btnNavForward = document.getElementById('btnNavForward');
    const btnEOS = document.getElementById('btnEOS');
    const btnReceiptBooks = document.getElementById('btnReceiptBooks');
    const btnSaveStatusLogo = document.getElementById('btnSaveStatusLogo');
    const handoverSidebar = document.getElementById('handoverSidebar');
    const handoverSummaryBtn = document.getElementById('handoverSummaryBtn');
    const handoverSummaryHandover = document.getElementById('handoverSummaryHandover');
    const handoverSummaryTodo = document.getElementById('handoverSummaryTodo');
    const handoverSummaryMeta = document.getElementById('handoverSummaryMeta');
    let timeTicker = null;
    let handoverTicker = null;
    let accessibleApps = [];
    let currentUserEmail = '';
    let currentUserRole = '';
    let currentUserRoleRank = 0;
    let managerReminderDrafts = [];
    let managerDelegateUsers = [];
    let currentServerReceiptDraft = null;
    function getOdLaunchEndpoints(apiOrigin) {
      const origin = normalizeApiOrigin(apiOrigin);
      return [
        `${origin}/od-launch-auth/auth/od/launch`,
        `${origin}/auth/od/launch`
      ];
    }
    const EMPINFO_ALLOWED_EMAILS = new Set(['drchrisgauci@gmail.com', 'chrisgauci@mediatrixmalta.com']);
    const ROLE_RANK = {
      'general user': 1,
      management: 2,
      hr: 3,
      full: 4,
      admin: 5,
      administrator: 5,
      superadmin: 5
    };
    const FULL_IMAGE_TILE_KEYS = new Set(['payroll', 'mythings', 'empinfo']);

    function getRoleRank(roleName) {
      const normalized = String(roleName || '').trim().toLowerCase();
      if (!normalized) return 0;
      if (ROLE_RANK[normalized]) return ROLE_RANK[normalized];
      if (normalized.includes('super') || normalized.includes('admin')) return ROLE_RANK.admin;
      if (normalized.includes('full')) return ROLE_RANK.full;
      if (normalized.includes('hr')) return ROLE_RANK.hr;
      if (normalized.includes('manag')) return ROLE_RANK.management;
      if (normalized.includes('general') || normalized.includes('user')) return ROLE_RANK['general user'];
      return 0;
    }

    const APP_CATALOG = {
      hr: { id: 'hr', name: 'HR Dashboard', icon: 'HR', icon_image: '1.png', path: '/dashboard/empinfo-dashboard.html', description: 'Employee management dashboard' },
      payroll: { id: 'payroll', name: 'Payroll', icon: 'PAY', icon_image: 'payroll main.png', path: '/payroll/payroll.html', description: 'Payroll processing' },
      eos: { id: 'eos', name: 'End of Shift', icon: 'EOS', icon_image: '2.png', path: '/eos.html', description: 'End of shift monies input' },
      'receipt-books': { id: 'receipt-books', name: 'Receipt Books', icon: 'RB', path: '/dashboard/receipt-books.html', description: 'Receipt books entry and reporting' },
      timesheets: { id: 'timesheets', name: 'Timesheets', icon: 'TS', icon_image: '22.png', path: '/timesheets/timesheets.html', description: 'Timesheet tracking' },
      products: { id: 'products', name: 'Products', icon: 'PRD', icon_image: 'providers.png', path: '/products/products.html', description: 'Product catalog' },
      mythings: { id: 'mythings', name: 'My Things', icon: 'ME', icon_image: 'corez22.png', path: '/mythings/mythings.html', description: 'Personal workspace' },
      reports: { id: 'reports', name: 'Reports', icon: 'RPT', icon_image: 'o3p.png', path: '/dashboard/app-hub.html', description: 'Reports and analytics' },
      'admin-tools': { id: 'admin-tools', name: 'Admin Tools', icon: 'ADM', icon_image: 'landing.png', path: '/directus/admin', description: 'System administration' },
      empinfo: { id: 'empinfo', name: 'EMPINFO', icon: 'EMP', icon_image: 'empinfo.png', path: '/dashboard/empinfo-dashboard.html', description: 'Employee information' }
    };

    function getLaunchParams() {
      const params = new URLSearchParams(window.location.search);
      const firstNonEmptyParam = (keys) => {
        for (const key of keys) {
          const value = (params.get(key) || '').trim();
          if (value) return value;
        }
        return '';
      };
      return {
        od_user: firstNonEmptyParam([
          'od_user', 'od_username', 'odusername',
          'user', 'username', 'UserName', 'ODUserName'
        ]),
        od_user_num: firstNonEmptyParam([
          'od_user_num', 'odusernum', 'od_num',
          'user_num', 'usernum', 'UserNum'
        ]),
        od_ts: firstNonEmptyParam(['od_ts', 'ts']),
        od_sig: firstNonEmptyParam(['od_sig', 'sig', 'signature']),
        directus_email: firstNonEmptyParam(['directus_email', 'email', 'Email'])
      };
    }

    function hasAnyLaunchPayload() {
      const localOnlyKeys = new Set([
        'api_origin',
        'od_debug',
        'payroll_scope',
        'od_force_auth',
        'od_launch_at'
      ]);
      for (const [key, value] of PAGE_PARAMS.entries()) {
        if (localOnlyKeys.has(String(key || '').toLowerCase())) continue;
        if (String(value || '').trim()) return true;
      }
      return false;
    }

    function hasLaunchParams() {
      const p = getLaunchParams();
      return Boolean(p.od_user || p.od_user_num || p.directus_email || hasAnyLaunchPayload());
    }

    function hasLaunchIdentity() {
      const p = getLaunchParams();
      return Boolean(p.od_user || p.od_user_num || p.directus_email);
    }

    function getAuthToken() {
      try {
        const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
        const expiresAt = stored?.expires_at ? new Date(stored.expires_at).getTime() : null;
        if (expiresAt && Date.now() > expiresAt) return null;
        return stored?.access_token || null;
      } catch {
        return null;
      }
    }

    function getStoredRefreshToken() {
      const stored = getStoredAuthRecord();
      return String(stored?.refresh_token || '').trim();
    }

    async function refreshStoredSession(preferredOrigin = ACTIVE_API_ORIGIN) {
      const stored = getStoredAuthRecord();
      const refreshToken = String(stored?.refresh_token || '').trim();
      if (!refreshToken) return null;

      let sawUnauthorized = false;
      let lastError = null;
      for (const origin of buildApiOriginCandidates(preferredOrigin)) {
        try {
          const response = await fetch(`${origin}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          const payload = await response.json().catch(() => ({}));
          if (response.status === 401 || response.status === 403) {
            sawUnauthorized = true;
            continue;
          }
          if (!response.ok) {
            const message = payload?.errors?.[0]?.message || payload?.error || 'Failed to refresh session';
            throw new Error(message);
          }

          const data = payload?.data || {};
          const expiresMs = Number(data?.expires || 0);
          const expiresAt = expiresMs ? new Date(Date.now() + expiresMs).toISOString() : null;
          setStoredAuth({
            ...stored,
            access_token: data?.access_token || null,
            refresh_token: data?.refresh_token || refreshToken,
            expires_at: expiresAt,
            auth_mode: data?.auth_mode || stored?.auth_mode || 'refresh'
          });
          persistApiOrigin(origin);
          return getAuthToken();
        } catch (error) {
          lastError = error;
          if (!isNetworkFetchError(error)) break;
        }
      }

      if (sawUnauthorized) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } else if (lastError) {
        writeOdDebug('Session refresh failed.', {
          message: String(lastError instanceof Error ? lastError.message : lastError || '')
        });
      }
      return null;
    }

    async function ensureValidAuthToken(preferredOrigin = ACTIVE_API_ORIGIN) {
      const token = getAuthToken();
      if (token) return token;
      if (!getStoredRefreshToken()) return null;
      return refreshStoredSession(preferredOrigin);
    }

    async function apiFetchJson(path, options = {}) {
      const token = await ensureValidAuthToken();
      if (!token) throw new Error('No auth token');
      const response = await fetch(`${ACTIVE_API_ORIGIN}${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if ((response.status === 401 || response.status === 403) && !options.__skipRefreshRetry) {
        const refreshedToken = await refreshStoredSession();
        if (refreshedToken) {
          return apiFetchJson(path, { ...options, __skipRefreshRetry: true });
        }
      }
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || payload?.errors?.[0]?.message || 'Request failed');
      }
      return payload;
    }

    function getReceiptDraftTodoDelta() {
      const draft = readPendingReceiptDraft();
      const activeEmail = getCurrentAuthEmail();
      const draftOwnerEmail = String(draft?.draftOwnerEmail || '').trim().toLowerCase();
      if (!draft) return 0;
      if (draftOwnerEmail && (!activeEmail || draftOwnerEmail !== activeEmail)) return 0;
      return 1;
    }

    async function refreshHandoverSummary() {
      if (!handoverSummaryHandover || !handoverSummaryTodo || !handoverSummaryMeta) return;
      try {
        const payload = await apiFetchJson('/handover/summary');
        const data = payload?.data || {};
        const handoverCount = Number(data?.handover_count || 0);
        const todoCount = Number(data?.todo_count || 0) + getReceiptDraftTodoDelta();
        const claimedByOthers = Number(data?.group_claimed_by_others || 0);
        handoverSummaryHandover.textContent = `Handover: ${handoverCount}`;
        handoverSummaryTodo.textContent = `To Do: ${todoCount}`;
        handoverSummaryMeta.textContent = claimedByOthers > 0
          ? `${claimedByOthers} group handover(s) already taken care of`
          : 'Tap to open full details';
      } catch {
        handoverSummaryHandover.textContent = 'Handover: -';
        handoverSummaryTodo.textContent = 'To Do: -';
        handoverSummaryMeta.textContent = 'Open full details';
      }
    }

    function getStoredAuthRecord() {
      try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function setStoredAuth(data) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data || {}));
    }

    function getOdDebugPanel() {
      let panel = document.getElementById('odDebugPanel');
      if (panel) return panel;
      panel = document.createElement('div');
      panel.id = 'odDebugPanel';
      panel.style.display = 'none';
      panel.style.marginTop = '10px';
      panel.style.padding = '10px';
      panel.style.border = '1px solid #f2c94c';
      panel.style.borderRadius = '8px';
      panel.style.background = '#fff8db';
      panel.style.color = '#7a5d00';
      panel.style.fontSize = '12px';
      panel.style.whiteSpace = 'pre-wrap';
      panel.style.wordBreak = 'break-word';
      panel.style.lineHeight = '1.45';
      const container = document.querySelector('.main-content') || document.body;
      container.insertBefore(panel, container.firstChild);
      return panel;
    }

    function maskValue(value, keep = 8) {
      const raw = String(value || '');
      if (!raw) return '';
      if (raw.length <= keep) return raw;
      return `${raw.slice(0, keep)}...(${raw.length})`;
    }

    function debugLaunchSnapshot(launch) {
      return {
        od_user: launch?.od_user || '',
        od_user_num: launch?.od_user_num || '',
        directus_email: launch?.directus_email || '',
        od_ts: launch?.od_ts || '',
        od_sig: maskValue(launch?.od_sig || '', 10)
      };
    }

    function writeOdDebug(message, data) {
      if (!OD_DEBUG) return;
      const panel = getOdDebugPanel();
      const line = data === undefined
        ? String(message || '')
        : `${String(message || '')} ${JSON.stringify(data, null, 2)}`;
      panel.textContent += `${line}\n`;
      panel.style.display = 'block';
    }

    function clearLaunchParamsFromUrl() {
      const url = new URL(window.location.href);
      const keepKeys = new Set(['api_origin', 'od_debug', 'payroll_scope']);
      const deleteKeys = [];
      for (const [key] of url.searchParams.entries()) {
        if (!keepKeys.has(String(key || '').toLowerCase())) {
          deleteKeys.push(key);
        }
      }
      for (const key of deleteKeys) {
        url.searchParams.delete(key);
      }
      window.history.replaceState({}, '', url.toString());
    }

    function redirectToLogin(reason = '') {
      const loginApiOrigin = normalizeApiOrigin(ACTIVE_API_ORIGIN) || normalizeApiOrigin(API_ORIGIN);
      if (OD_DEBUG && hasLaunchParams()) {
        writeOdDebug('Redirect to login blocked by debug mode.', { reason: String(reason || '') });
        const panel = getOdDebugPanel();
        if (!document.getElementById('odDebugLoginBtn')) {
          const btn = document.createElement('button');
          btn.id = 'odDebugLoginBtn';
          btn.type = 'button';
          btn.textContent = 'Go To Login';
          btn.style.marginTop = '8px';
          btn.style.padding = '6px 10px';
          btn.style.borderRadius = '6px';
          btn.style.border = '1px solid #d4b341';
          btn.style.background = '#fff';
          btn.style.cursor = 'pointer';
          btn.addEventListener('click', () => {
            const loginUrl = './login.html?api_origin=' + encodeURIComponent(loginApiOrigin);
            window.location.href = loginUrl;
          });
          panel.appendChild(btn);
        }
        return;
      }
      const loginUrl = './login.html?api_origin=' + encodeURIComponent(loginApiOrigin);
      window.location.href = loginUrl;
    }

    async function authenticateFromOdLaunch(options = {}) {
      const launch = getLaunchParams();
      const allowExistingTokenFallback = options.allowExistingTokenFallback === true;
      writeOdDebug('OD launch params received:', debugLaunchSnapshot(launch));
      if (!launch.od_user && !launch.od_user_num && !launch.directus_email) {
        writeOdDebug('No recognized OD user identity found in launch params.');
        return false;
      }

      let response = null;
      let payload = {};
      let selectedOrigin = '';
      const triedOrigins = [];
      for (const origin of buildApiOriginCandidates(ACTIVE_API_ORIGIN)) {
        triedOrigins.push(origin);
        const endpoints = getOdLaunchEndpoints(origin);
        for (const endpoint of endpoints) {
          writeOdDebug('Trying endpoint:', endpoint);
          let candidate = null;
          try {
            candidate = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(launch)
            });
          } catch (error) {
            writeOdDebug('Endpoint fetch failed:', {
              endpoint,
              message: String(error instanceof Error ? error.message : error || '')
            });
            continue;
          }
          const candidatePayload = await candidate.json().catch(() => ({}));
          writeOdDebug('Endpoint response:', {
            endpoint,
            status: candidate.status,
            ok: candidate.ok,
            error: String(candidatePayload?.error || ''),
            has_data: Boolean(candidatePayload?.data)
          });
          const payloadError = String(candidatePayload?.error || '').trim().toLowerCase();
          const hasApplicationError = Boolean(payloadError);
          if (candidate.ok || candidate.status !== 404 || hasApplicationError) {
            response = candidate;
            payload = candidatePayload;
            selectedOrigin = origin;
            break;
          }
        }
        if (response) break;
      }
      if (!response) {
        if (allowExistingTokenFallback && getAuthToken()) {
          writeOdDebug('No launch endpoint reached. Falling back to existing browser session.', { triedOrigins });
          return false;
        }
        writeOdDebug('No launch endpoint found (all 404).');
        throw new Error(`OpenDental launch endpoint not reachable. Tried: ${triedOrigins.join(', ')}`);
      }

      if (!response.ok) {
        const message = String(payload?.error || 'OpenDental launch failed');
        const normalized = message.toLowerCase();
        if (
          normalized.includes('no directus mapping found') ||
          normalized.includes('mapped directus user not found') ||
          normalized.includes('od_user, od_user_num, or directus_email is required') ||
          normalized.includes('missing or invalid od_ts') ||
          normalized.includes('admin')
        ) {
          if (allowExistingTokenFallback && getAuthToken()) {
            writeOdDebug('OD launch rejected. Falling back to existing browser session.', { message });
            return false;
          }
          writeOdDebug('OD launch rejected and would redirect to login.', { message });
          redirectToLogin(message);
          return false;
        }
        writeOdDebug('OD launch returned non-redirectable error.', { message });
        throw new Error(message);
      }

      if (selectedOrigin) {
        persistApiOrigin(selectedOrigin);
      }
      const data = payload?.data || {};
      setStoredAuth({
        access_token: data?.access_token || null,
        refresh_token: data?.refresh_token || null,
        expires_at: null,
        auth_mode: data?.auth_mode || 'od_launch'
      });

      clearLaunchParamsFromUrl();
      writeOdDebug('OD launch succeeded. Token stored.');
      return true;
    }

    async function loadApps(options = {}) {
      const allowRefreshRetry = options.allowRefreshRetry !== false;
      const token = await ensureValidAuthToken();
      if (!token) {
        writeOdDebug('No auth token while loading apps.');
        redirectToLogin('No auth token while loading apps');
        return;
      }

      const origins = buildApiOriginCandidates(ACTIVE_API_ORIGIN);
      const triedOrigins = [];
      let lastError = null;

      for (const origin of origins) {
        triedOrigins.push(origin);
        try {
          const data = await loadAppsViaCoreApi(token, origin);
          persistApiOrigin(origin);
          renderUserInfo(data.user);
          accessibleApps = Array.isArray(data.apps) ? data.apps : [];
          applyAppSearch();
          return;
        } catch (error) {
          if (error instanceof Error && error.message === 'UNAUTHORIZED') {
            if (allowRefreshRetry) {
              const refreshedToken = await refreshStoredSession(origin);
              if (refreshedToken) {
                writeOdDebug('Token refreshed after unauthorized app load.', { origin });
                return loadApps({ allowRefreshRetry: false });
              }
            }
            writeOdDebug('Token unauthorized while loading apps.', { origin });
            redirectToLogin('Unauthorized while loading apps');
            return;
          }
          if (!isNetworkFetchError(error)) {
            console.error('Error loading apps:', error);
            const message = error instanceof Error ? error.message : 'Failed to load apps';
            showError(message);
            return;
          }
          lastError = error;
        }
      }

      console.error('Error loading apps:', lastError);
      showError(`Failed to fetch API. Tried: ${triedOrigins.join(', ')}. Open app-hub with ?api_origin=http://YOUR_DIRECTUS_HOST:8055`);
    }

    async function loadAppsViaCoreApi(token, apiOrigin) {
      function toUserModel(user, roleName) {
        return {
          id: user.id,
          email: user.email,
          first_name: user.first_name || '',
          name: user.first_name || user.email || 'User',
          role: roleName || 'limited'
        };
      }

      function appendUniversalApps(appsIn) {
        const apps = Array.isArray(appsIn) ? [...appsIn] : [];
        const addApp = (id) => {
          const app = APP_CATALOG[id];
          if (!app) return;
          if (apps.some((entry) => String(entry?.id || '').toLowerCase() === id)) return;
          apps.push(app);
        };

        addApp('eos');
        addApp('receipt-books');
        return apps;
      }

      function buildRoleFallbackApps(roleRank, isEmpinfoAllowed, isPayrollAllowed) {
        const apps = [];
        const addApp = (id) => {
          const app = APP_CATALOG[id];
          if (!app) return;
          if (apps.some((entry) => entry.id === app.id)) return;
          apps.push(app);
        };

        if (isPayrollAllowed) addApp('payroll');
        if (isEmpinfoAllowed) addApp('empinfo');
        if (roleRank >= ROLE_RANK.full) addApp('admin-tools');
        if (apps.length === 0) addApp('mythings');
        return appendUniversalApps(apps);
      }

      async function loadViaUserAppsEndpoint() {
        const response = await fetch(`${apiOrigin}/user-apps/user/apps`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('UNAUTHORIZED');
        }
        if (!response.ok) {
          const message = payload?.error || payload?.errors?.[0]?.message || 'Failed to load user apps';
          const normalized = String(message || '').toLowerCase();
          if (
            response.status === 404 ||
            normalized.includes('/user-apps/user/apps') ||
            normalized.includes("route") && normalized.includes("doesn't exist")
          ) {
            return null;
          }
          throw new Error(message);
        }
        return {
          user: payload?.user || {},
          apps: appendUniversalApps(Array.isArray(payload?.apps) ? payload.apps : [])
        };
      }

      const userResponse = await fetch(`${apiOrigin}/users/me?fields=id,email,first_name,role.name`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const userPayload = await userResponse.json().catch(() => ({}));
      if (userResponse.status === 401) {
        throw new Error('UNAUTHORIZED');
      }
      if (!userResponse.ok) {
        throw new Error(userPayload?.errors?.[0]?.message || 'Failed to load current user');
      }

      const user = userPayload?.data || {};
      const roleName = String(user?.role?.name || '').trim();
      const normalizedRole = roleName.toLowerCase();
      const email = String(user?.email || '').trim().toLowerCase();
      const roleRank = getRoleRank(roleName);
      const isManagerOrAbove = roleRank >= ROLE_RANK.management;
      const isHr = roleRank >= ROLE_RANK.hr;
      const isEmpinfoAllowed = isManagerOrAbove || EMPINFO_ALLOWED_EMAILS.has(email);
      const isPayrollAllowed = roleRank >= ROLE_RANK.hr;

      const params = new URLSearchParams();
      params.set('fields', 'app_id,is_active,directus_user_id,directus_user_email');
      params.set('filter[_and][0][is_active][_eq]', 'true');
      params.set('filter[_and][1][_or][0][directus_user_id][_eq]', String(user?.id || ''));
      params.set('filter[_and][1][_or][1][directus_user_email][_eq]', email);
      params.set('limit', '200');

      const subsResponse = await fetch(`${apiOrigin}/items/app_hub_subscriptions?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const subsPayload = await subsResponse.json().catch(() => ({}));
      if (subsResponse.status === 401) {
        throw new Error('UNAUTHORIZED');
      }
      if (!subsResponse.ok) {
        const subsStatus = Number(subsResponse.status || 0);
        const subsError = String(subsPayload?.errors?.[0]?.message || subsPayload?.error || '').toLowerCase();
        if (
          subsStatus === 403 ||
          subsStatus === 404 ||
          (
            subsError.includes('app_hub_subscriptions') &&
            (
              subsError.includes('permission') ||
              subsError.includes('forbidden') ||
              subsError.includes('does not exist')
            )
          )
        ) {
          const legacyApps = await loadViaUserAppsEndpoint();
          if (legacyApps && Array.isArray(legacyApps.apps) && legacyApps.apps.length > 0) {
            return legacyApps;
          }
          return {
            user: toUserModel(user, roleName),
            apps: buildRoleFallbackApps(roleRank, isEmpinfoAllowed, isPayrollAllowed)
          };
        }
        throw new Error(subsPayload?.errors?.[0]?.message || subsPayload?.error || 'Failed to load app subscriptions');
      }

      const subs = Array.isArray(subsPayload?.data) ? subsPayload.data : [];
      const appIds = [...new Set(subs.map((s) => String(s.app_id || '').toLowerCase()).filter(Boolean))];
      let apps = appIds.map((id) => APP_CATALOG[id]).filter(Boolean);

      if (!isEmpinfoAllowed) {
        apps = apps.filter((app) => app.id !== 'empinfo');
      }
      if (!isPayrollAllowed) {
        apps = apps.filter((app) => app.id !== 'payroll');
      } else if (!apps.some((app) => app.id === 'payroll')) {
        apps.push(APP_CATALOG.payroll);
      }
      apps = appendUniversalApps(apps);

      return {
        user: toUserModel(user, roleName),
        apps
      };
    }

    function renderUserInfo(user) {
      userNameEl.textContent = user.name || user.email;
      userRoleEl.textContent = user.role || 'User';
      currentUserEmail = String(user?.email || '').trim().toLowerCase();
      currentUserRole = String(user.role || '').trim().toLowerCase();
      currentUserRoleRank = getRoleRank(user.role || '');
      const firstName = String(user?.first_name || '').trim() || getFirstName(user);
      welcomeTitleEl.textContent = `Welcome back ${firstName}`;
      startTimeTicker();
      void refreshReceiptDraftReminder();
    }

    function getFirstName(user) {
      const explicitFirstName = String(user?.first_name || '').trim();
      const explicitLastName = String(user?.last_name || '').trim();
      const emailLocal = String(user?.email || '')
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

      if (explicitFirstName && explicitLastName && emailLocal) {
        const firstToken = explicitFirstName.split(/\s+/)[0];
        const lastToken = explicitLastName.split(/\s+/)[0];
        const firstNeedle = firstToken.toLowerCase();
        const lastNeedle = lastToken.toLowerCase();
        const firstShort = firstNeedle.slice(0, 4);
        const lastShort = lastNeedle.slice(0, 4);

        const firstIndex = emailLocal.indexOf(firstNeedle);
        const lastIndex = emailLocal.indexOf(lastNeedle);
        const firstShortIndex = firstNeedle.length >= 4 ? emailLocal.indexOf(firstShort) : -1;
        const lastShortIndex = lastNeedle.length >= 4 ? emailLocal.indexOf(lastShort) : -1;

        const firstMatchIndex = firstIndex >= 0 ? firstIndex : firstShortIndex;
        const lastMatchIndex = lastIndex >= 0 ? lastIndex : lastShortIndex;

        if (firstMatchIndex >= 0 && lastMatchIndex >= 0) {
          return lastMatchIndex < firstMatchIndex ? lastToken : firstToken;
        }
        if (lastMatchIndex >= 0) return lastToken;
        if (firstMatchIndex >= 0) return firstToken;
      }

      if (explicitFirstName) return explicitFirstName.split(/\s+/)[0];
      if (explicitLastName) return explicitLastName.split(/\s+/)[0];

      const fromName = String(user?.name || '').trim();
      if (fromName) {
        const parts = fromName.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0];

        const emailLocalPart = String(user?.email || '')
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');

        if (emailLocalPart) {
          const matched = parts.find((part) => emailLocalPart.includes(part.toLowerCase()));
          if (matched) return matched;
        }

        return parts[0];
      }

      const fromEmail = String(user?.email || '').trim();
      if (fromEmail.includes('@')) {
        const localPart = fromEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
        if (localPart) return localPart.split(/\s+/)[0];
      }
      return 'User';
    }

    function getFirstNameFromEmail(email) {
      const value = String(email || '').trim();
      if (!value.includes('@')) return '';
      const localPart = value.split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (!localPart) return '';
      return localPart.split(/\s+/)[0];
    }

    function parseJwtPayload(token) {
      try {
        const payloadPart = String(token || '').split('.')[1];
        if (!payloadPart) return null;
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        return JSON.parse(atob(padded));
      } catch {
        return null;
      }
    }

    function getFirstNameFromStoredAuth() {
      const stored = getStoredAuthRecord();

      const storedEmail = String(stored?.email || '').trim();
      if (storedEmail) {
        const fromStoredEmail = getFirstNameFromEmail(storedEmail);
        if (fromStoredEmail) return fromStoredEmail;
      }

      const token = stored?.access_token || getAuthToken();
      if (!token) return '';
      const payload = parseJwtPayload(token);
      if (!payload) return '';
      const firstName = String(payload?.first_name || payload?.firstname || '').trim();
      if (firstName) return firstName;
      const fromEmail = getFirstNameFromEmail(payload?.email || payload?.mail || '');
      return fromEmail;
    }

    function getCurrentAuthEmail() {
      if (currentUserEmail) return currentUserEmail;
      const stored = getStoredAuthRecord();
      const directEmail = String(stored?.email || '').trim().toLowerCase();
      if (directEmail) return directEmail;

      const payload = parseJwtPayload(stored?.access_token || getAuthToken() || '');
      return String(payload?.email || payload?.mail || '').trim().toLowerCase();
    }

    async function fetchReceiptDraftJson(path, options = {}) {
      const token = getAuthToken();
      const response = await fetch(`${ACTIVE_API_ORIGIN}${path}`, {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    }

    function readPendingReceiptDraft() {
      try {
        const draft = JSON.parse(localStorage.getItem(RECEIPT_DRAFT_STORAGE_KEY) || 'null');
        if (!draft || typeof draft !== 'object') return null;

        const hasEntries = Array.isArray(draft.calculatorEntries) && draft.calculatorEntries.length > 0;
        const hasCoreValues = [
          draft.department,
          draft.identifier,
          draft.firstReceiptNumber,
          draft.lastReceiptNumber,
          draft.firstReceiptDate,
          draft.lastReceiptDate,
          draft.calcInput
        ].some((value) => String(value || '').trim());

        if (!hasEntries && !hasCoreValues) return null;
        return draft;
      } catch {
        return null;
      }
    }

    function getLaunchablePendingReceiptDraft() {
      if (currentServerReceiptDraft) {
        return {
          draft: currentServerReceiptDraft,
          draftUid: String(currentServerReceiptDraft?.draft_uid || currentServerReceiptDraft?.draft?.draftServerUid || '').trim()
        };
      }

      const localDraft = readPendingReceiptDraft();
      const activeEmail = getCurrentAuthEmail();
      const draftOwnerEmail = String(localDraft?.draftOwnerEmail || '').trim().toLowerCase();
      if (!localDraft) return null;
      if (draftOwnerEmail && activeEmail && draftOwnerEmail !== activeEmail) return null;

      return {
        draft: localDraft,
        draftUid: String(localDraft?.draftServerUid || '').trim()
      };
    }

    function getReceiptDraftRange(draft) {
      const start = Number(draft?.firstReceiptNumber || draft?.first_receipt_number || 0);
      const end = Number(draft?.lastReceiptNumber || draft?.last_receipt_number || 0);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];

      const range = [];
      for (let value = start; value <= end; value += 1) {
        range.push(value);
      }
      return range;
    }

    function formatDraftUpdatedAt(value) {
      const date = new Date(String(value || ''));
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function getUserDraftReminderState(draft) {
      const range = getReceiptDraftRange(draft);
      const entryCount = Array.isArray(draft?.calculatorEntries) ? draft.calculatorEntries.length : 0;
      const nextReceipt = range.length && entryCount < range.length ? range[entryCount] : '';
      const updatedAt = formatDraftUpdatedAt(draft?.draftUpdatedAt || draft?.updated_at);
      return { range, entryCount, nextReceipt, updatedAt };
    }

    function describeManagerDraft(draft) {
      const startReceipt = Number(draft?.first_receipt_number || 0);
      const endReceipt = Number(draft?.last_receipt_number || 0);
      const lastEntered = Number(draft?.last_entered_receipt_number || 0);
      const nextReceipt = Number(draft?.next_receipt_number || 0);
      const ownerName = String(draft?.owner?.name || draft?.owner?.email || '').trim();
      const assignedName = String(draft?.assigned_to?.name || draft?.assigned_to?.email || '').trim();
      const updatedAt = formatDraftUpdatedAt(draft?.updated_at);
      const stopText = lastEntered
        ? `Stopped after receipt ${lastEntered}.`
        : 'No receipt values have been entered yet.';
      const nextText = nextReceipt
        ? ` Next receipt ${nextReceipt}.`
        : ' Draft is ready to save.';
      const rangeText = startReceipt && endReceipt
        ? `Book ${startReceipt} to ${endReceipt}.`
        : 'Book range still incomplete.';
      const timeText = updatedAt ? ` Last autosaved ${updatedAt}.` : '';
      return `${rangeText} Started by ${ownerName || 'unknown user'}. Assigned to ${assignedName || 'unknown user'}. ${stopText}${nextText}${timeText}`;
    }

    function clearReceiptDraftReminder() {
      receiptDraftReminder.classList.remove('show');
      receiptDraftReminderTitle.textContent = '';
      receiptDraftReminderCopy.textContent = '';
      if (btnResumeReceiptDraft) btnResumeReceiptDraft.style.display = 'none';
      if (btnReviewReceiptDrafts) btnReviewReceiptDrafts.style.display = 'none';
    }

    function renderUserDraftReminder(draft) {
      const { range, entryCount, nextReceipt, updatedAt } = getUserDraftReminderState(draft);
      if (nextReceipt) {
        receiptDraftReminderTitle.textContent = `Starting from receipt number ${nextReceipt}`;
      } else if (range.length && entryCount >= range.length) {
        receiptDraftReminderTitle.textContent = 'Receipt book draft ready to save';
      } else {
        receiptDraftReminderTitle.textContent = 'A receipt book draft is still pending';
      }

      const timeText = updatedAt ? ` Last autosaved ${updatedAt}.` : '';
      receiptDraftReminderCopy.textContent = `A receipt book draft is still pending.${timeText} You will be reminded every day on login until it is saved or cleared.`;
      if (btnResumeReceiptDraft) btnResumeReceiptDraft.style.display = '';
      if (btnReviewReceiptDrafts) btnReviewReceiptDrafts.style.display = 'none';
      receiptDraftReminder.classList.add('show');
    }

    function renderAdminDraftReminder(drafts) {
      const escalatedDrafts = Array.isArray(drafts) ? drafts.filter((draft) => draft?.escalates_to_admin) : [];
      const firstDraft = escalatedDrafts[0] || drafts[0] || null;
      const count = escalatedDrafts.length || drafts.length;
      receiptDraftReminderTitle.textContent = count === 1
        ? '1 receipt book draft has been pending for over 30 days'
        : `${count} receipt book drafts have been pending for over 30 days`;
      receiptDraftReminderCopy.textContent = firstDraft
        ? `Admin escalation: this draft has remained pending for more than 30 days. ${describeManagerDraft(firstDraft)}`
        : 'Admin escalation: a receipt book draft has remained pending for more than 30 days.';
      if (btnResumeReceiptDraft) btnResumeReceiptDraft.style.display = currentServerReceiptDraft ? '' : 'none';
      if (btnReviewReceiptDrafts) btnReviewReceiptDrafts.style.display = '';
      receiptDraftReminder.classList.add('show');
    }

    function renderManagerDraftReminder(drafts) {
      const firstDraft = drafts[0] || null;
      const count = Array.isArray(drafts) ? drafts.length : 0;
      receiptDraftReminderTitle.textContent = count === 1
        ? '1 receipt book draft needs management review'
        : `${count} receipt book drafts need management review`;
      receiptDraftReminderCopy.textContent = firstDraft
        ? describeManagerDraft(firstDraft)
        : 'A receipt book draft is still pending and needs management review.';
      if (btnResumeReceiptDraft) btnResumeReceiptDraft.style.display = currentServerReceiptDraft ? '' : 'none';
      if (btnReviewReceiptDrafts) btnReviewReceiptDrafts.style.display = '';
      receiptDraftReminder.classList.add('show');
    }

    async function fetchCurrentReceiptDraftFromServer() {
      const { response, payload } = await fetchReceiptDraftJson('/receipt-books/drafts/current');
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Failed to load receipt draft');
      return payload?.draft || null;
    }

    async function fetchManagerReceiptDrafts() {
      const { response, payload } = await fetchReceiptDraftJson('/receipt-books/drafts/manager/reminders');
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Failed to load draft reminders');
      return Array.isArray(payload?.drafts) ? payload.drafts : [];
    }

    async function fetchReceiptDraftDelegates() {
      if (managerDelegateUsers.length) return managerDelegateUsers;
      const { response, payload } = await fetchReceiptDraftJson('/receipt-books/drafts/delegates');
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Failed to load delegate users');
      managerDelegateUsers = Array.isArray(payload?.users) ? payload.users : [];
      return managerDelegateUsers;
    }

    async function postReceiptDraftAction(path, body = {}) {
      const { response, payload } = await fetchReceiptDraftJson(path, {
        method: 'POST',
        body
      });
      if (!response.ok) throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Draft action failed');
      return payload?.draft || null;
    }

    function renderManagerDraftReviewList() {
      if (!draftReviewList) return;
      if (!managerReminderDrafts.length) {
        draftReviewList.innerHTML = '<div class="draft-review-empty">No receipt book drafts currently need management review.</div>';
        return;
      }

      const delegateOptions = [
        '<option value="">Delegate to...</option>',
        ...managerDelegateUsers.map((user) => (
          `<option value="${String(user.id || '').replace(/"/g, '&quot;')}">${String(user.name || user.email || '').replace(/</g, '&lt;')} (${String(user.email || '').replace(/</g, '&lt;')})</option>`
        ))
      ].join('');

      draftReviewList.innerHTML = managerReminderDrafts.map((draft) => {
        const titleBits = [
          String(draft?.department_code || '').trim(),
          String(draft?.identifier || '').trim(),
          draft?.first_receipt_number && draft?.last_receipt_number
            ? `${draft.first_receipt_number}-${draft.last_receipt_number}`
            : 'Range pending'
        ].filter(Boolean);
        const metaText = `${describeManagerDraft(draft)}${draft?.escalates_to_admin ? ' Pending over 30 days. Admin informed.' : ''}`;
        return `
          <div class="draft-review-card" data-draft-id="${draft.id}">
            <div class="draft-review-card-head">
              <div class="draft-review-card-title">${titleBits.join(' / ')}</div>
              <div class="draft-review-chip">${draft?.escalates_to_admin ? 'ADMIN ESCALATED' : String(draft?.status || 'ACTIVE')}</div>
            </div>
            <div class="draft-review-meta">${metaText}</div>
            <div class="draft-review-actions">
              <button class="draft-review-btn warn" type="button" data-manager-action="wait" data-draft-id="${draft.id}">Wait 1 Week</button>
              <button class="draft-review-btn danger" type="button" data-manager-action="stop" data-draft-id="${draft.id}">Stop Book</button>
              <select class="draft-review-select" data-delegate-select="${draft.id}">${delegateOptions}</select>
              <button class="draft-review-btn alt" type="button" data-manager-action="delegate" data-draft-id="${draft.id}">Delegate</button>
            </div>
          </div>
        `;
      }).join('');
    }

    async function openDraftReviewModal() {
      try {
        await fetchReceiptDraftDelegates();
      } catch {
      }
      renderManagerDraftReviewList();
      draftReviewCopy.textContent = 'Management can stop a book, delegate it to another user, or leave it waiting for one week before the next reminder. Admin is escalated automatically after 30 days pending.';
      draftReviewBackdrop.classList.add('open');
    }

    function closeDraftReviewModal() {
      draftReviewBackdrop.classList.remove('open');
    }

    async function handleManagerDraftAction(action, draftId) {
      const draftIdValue = Number(draftId || 0);
      if (!draftIdValue) return;

      if (action === 'wait') {
        await postReceiptDraftAction(`/receipt-books/drafts/${draftIdValue}/wait`, {});
      } else if (action === 'stop') {
        await postReceiptDraftAction(`/receipt-books/drafts/${draftIdValue}/stop`, {});
      } else if (action === 'delegate') {
        const select = draftReviewList.querySelector(`[data-delegate-select="${draftIdValue}"]`);
        const delegateUserId = String(select?.value || '').trim();
        if (!delegateUserId) {
          showError('Select a user before delegating this receipt book.');
          return;
        }
        await postReceiptDraftAction(`/receipt-books/drafts/${draftIdValue}/delegate`, {
          delegate_user_id: delegateUserId
        });
      } else {
        return;
      }

      errorMessage.classList.remove('show');
      await refreshReceiptDraftReminder();
      renderManagerDraftReviewList();
      if (!managerReminderDrafts.length) {
        closeDraftReviewModal();
      }
    }

    async function refreshReceiptDraftReminder() {
      clearReceiptDraftReminder();
      currentServerReceiptDraft = null;

      const localDraft = readPendingReceiptDraft();
      const activeEmail = getCurrentAuthEmail();

      try {
        if (getAuthToken()) {
          currentServerReceiptDraft = await fetchCurrentReceiptDraftFromServer();
        }
      } catch {
        currentServerReceiptDraft = null;
      }

      if (accessibleApps.length) {
        applyAppSearch();
      }

      if (currentUserRoleRank >= ROLE_RANK.management) {
        try {
          managerReminderDrafts = getAuthToken() ? await fetchManagerReceiptDrafts() : [];
        } catch {
          managerReminderDrafts = [];
        }
        const escalatedDrafts = currentUserRoleRank >= ROLE_RANK.admin
          ? managerReminderDrafts.filter((draft) => draft?.escalates_to_admin)
          : [];
        if (escalatedDrafts.length) {
          renderAdminDraftReminder(escalatedDrafts);
          return;
        }
        if (managerReminderDrafts.length) {
          renderManagerDraftReminder(managerReminderDrafts);
          return;
        }
      } else {
        managerReminderDrafts = [];
      }

      if (currentServerReceiptDraft) {
        const draft = currentServerReceiptDraft?.draft || {};
        renderUserDraftReminder({
          ...draft,
          firstReceiptNumber: draft.firstReceiptNumber || currentServerReceiptDraft.first_receipt_number,
          lastReceiptNumber: draft.lastReceiptNumber || currentServerReceiptDraft.last_receipt_number,
          draftUpdatedAt: draft.draftUpdatedAt || currentServerReceiptDraft.updated_at,
          calculatorEntries: Array.isArray(draft.calculatorEntries) ? draft.calculatorEntries : []
        });
        return;
      }

      const draftOwnerEmail = String(localDraft?.draftOwnerEmail || '').trim().toLowerCase();
      if (localDraft && (!draftOwnerEmail || !activeEmail || draftOwnerEmail === activeEmail)) {
        renderUserDraftReminder(localDraft);
        return;
      }

      clearReceiptDraftReminder();
    }

    async function hydrateFirstNameFromProfile() {
      const token = getAuthToken();
      if (!token) return;
      try {
        const response = await fetch(`${ACTIVE_API_ORIGIN}/users/me?fields=first_name,last_name,email`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        const user = payload?.data || {};
        const candidate = String(user?.first_name || user?.name || '').trim() || getFirstNameFromEmail(user?.email || '');
        if (!candidate) return;
        welcomeTitleEl.textContent = `Welcome back ${candidate}`;
      } catch {
      }
    }

    function initializeWelcomeBar() {
      const fromToken = getFirstNameFromStoredAuth();
      const launch = getLaunchParams();
      const fromLaunchEmail = getFirstNameFromEmail(launch?.directus_email || '');
      const firstName = fromToken || fromLaunchEmail || '';
      welcomeTitleEl.textContent = `Welcome back ${firstName}`;
      startTimeTicker();
      void refreshReceiptDraftReminder();
      hydrateFirstNameFromProfile();
    }

    function formatDateTime(now = new Date()) {
      const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear()).slice(-2);
      const time = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${weekday} ${day}/${month}/${year} - ${time}`;
    }

    function startTimeTicker() {
      if (timeTicker) {
        clearInterval(timeTicker);
      }
      welcomeDateTimeEl.textContent = formatDateTime();
      timeTicker = setInterval(() => {
        welcomeDateTimeEl.textContent = formatDateTime();
      }, 1000);
    }

    function getAppKey(app) {
      const id = String(app?.id || '').toLowerCase();
      if (id) return id;
      const source = `${app?.name || ''} ${app?.path || ''} ${app?.description || ''}`.toLowerCase();
      if (source.includes('payroll')) return 'payroll';
      if (source.includes('empinfo') || source.includes('employee')) return 'empinfo';
      return 'other';
    }

    function resolveAppPath(path) {
      const rawPath = String(path || '').trim();
      if (!rawPath) return '#';
      if (/^https?:\/\//i.test(rawPath)) return rawPath;

      const currentDir = window.location.pathname.replace(/\/[^/]*$/, '/');
      if (rawPath.startsWith('/dashboard/')) {
        return `${currentDir}${rawPath.replace(/^\/dashboard\//, '')}`.replace(/\/{2,}/g, '/');
      }
      if (rawPath.startsWith('/')) return rawPath;
      return `${currentDir}${rawPath}`.replace(/\/{2,}/g, '/');
    }

    function buildAppHref(app) {
      const sourcePath = typeof app === 'string' ? app : app?.path;
      let resolvedPath = resolveAppPath(sourcePath);
      const appContext = typeof app === 'string' ? { path: app } : app;
      const appKey = getAppKey(appContext);
      if (appKey === 'empinfo' || /employee-form\.html/i.test(String(sourcePath || ''))) {
        resolvedPath = resolveAppPath('/dashboard/empinfo-dashboard.html');
      }
      const extraParams = new URLSearchParams();
      extraParams.set('api_origin', ACTIVE_API_ORIGIN);
      if (appKey === 'payroll' && currentUserRole === 'hr') {
        extraParams.set('payroll_scope', 'o3p');
      }
      if (appKey === 'receipt-books') {
        const pendingDraft = getLaunchablePendingReceiptDraft();
        if (pendingDraft) {
          extraParams.set('resume_draft', '1');
          if (pendingDraft.draftUid) {
            extraParams.set('draft_uid', pendingDraft.draftUid);
          }
        }
      }
      const separator = resolvedPath.includes('?') ? '&' : '?';
      return `${resolvedPath}${separator}${extraParams.toString()}`;
    }

    function buildSetupHref() {
      const resolvedPath = resolveAppPath('/dashboard/setup.html');
      const separator = resolvedPath.includes('?') ? '&' : '?';
      return `${resolvedPath}${separator}api_origin=${encodeURIComponent(ACTIVE_API_ORIGIN)}`;
    }

    function buildTieghiHref() {
      const resolvedPath = resolveAppPath('/dashboard/tieghi.html');
      const separator = resolvedPath.includes('?') ? '&' : '?';
      return `${resolvedPath}${separator}api_origin=${encodeURIComponent(ACTIVE_API_ORIGIN)}`;
    }

    function getAppIconMarkup(app) {
      if (app?.icon_image) {
        const iconPath = String(app.icon_image).replace(/ /g, '%20');
        return `
          <img class="app-icon-image" src="assets/logos/${iconPath}" alt="${app.name || 'App'}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';" />
          <span class="app-icon-fallback" style="display:none;">${app.icon || '[]'}</span>
        `;
      }

      const key = getAppKey(app);
      if (key === 'empinfo') {
        return `
          <img class="app-icon-image" src="assets/logos/empinfo.png" alt="EMPINFO" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';" />
          <span class="app-icon-fallback" style="display:none;">${app.icon || '👤'}</span>
        `;
      }
      if (key === 'payroll') {
        return `
          <img class="app-icon-image" src="assets/logos/payroll%20main.png" alt="Payroll" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';" />
          <span class="app-icon-fallback" style="display:none;">${app.icon || '💰'}</span>
        `;
      }
      return `<span class="app-icon-fallback">${app.icon || '📦'}</span>`;
    }

    function buildThreeByThreeLayout(apps) {
      const gridSize = 9;
      const slots = Array(gridSize).fill(null);
      const reservedByKey = {
        empinfo: 7,
        payroll: 6,
        mythings: 8
      };

      const remainingApps = [];

      for (const app of apps) {
        const key = getAppKey(app);
        if (reservedByKey[key] !== undefined && !slots[reservedByKey[key]]) {
          slots[reservedByKey[key]] = app;
        } else {
          remainingApps.push(app);
        }
      }

      let cursor = 0;
      for (const app of remainingApps) {
        while (cursor < gridSize && slots[cursor]) cursor += 1;
        if (cursor >= gridSize) break;
        slots[cursor] = app;
      }

      return slots;
    }

    function renderApps(apps) {
      if (!apps || apps.length === 0) {
        appsGrid.style.display = 'none';
        noApps.style.display = 'block';
        return;
      }

      noApps.style.display = 'none';

      const slots = buildThreeByThreeLayout(apps);
      appsGrid.innerHTML = slots.map((app) => {
        if (!app) {
          return `<div class="app-card is-empty" aria-hidden="true"></div>`;
        }

        const appKey = getAppKey(app);
        const canSeeSetup = currentUserRoleRank >= ROLE_RANK.hr;
        if (appKey === 'mythings' && canSeeSetup) {
          const iconPath = String(app?.icon_image || 'corez22.png').replace(/ /g, '%20');
          const canOpenTieghi = currentUserRoleRank >= ROLE_RANK.admin;
          const tieghiMarkup = canOpenTieghi
            ? `
              <a class="split-tile-half bottom" href="${buildTieghiHref()}" title="Tieghi Admin">
                <img class="split-bottom-image" src="assets/logos/${iconPath}" alt="Tieghi" />
                <span class="split-bottom-overlay"></span>
                <span class="split-bottom-tag">Admin</span>
                <span class="split-caption bottom-caption">Tieghi</span>
              </a>
            `
            : `
              <button class="split-tile-half bottom disabled" type="button" disabled title="Tieghi is admin only">
                <img class="split-bottom-image" src="assets/logos/${iconPath}" alt="Tieghi" />
                <span class="split-bottom-overlay"></span>
                <span class="split-bottom-tag">Admin Only</span>
                <span class="split-caption bottom-caption">Tieghi</span>
              </button>
            `;
          return `
            <div class="app-card split-tile-card">
              <a class="split-tile-half top" href="${buildSetupHref()}">
                <span class="split-cog">⚙</span>
                <span class="split-caption">Setup</span>
              </a>
              ${tieghiMarkup}
            </div>
          `;
        }
        const cardClass = FULL_IMAGE_TILE_KEYS.has(appKey) ? 'app-card image-fill-card' : 'app-card';
        return `
          <a class="${cardClass}" href="${buildAppHref(app)}">
            <div class="app-icon">${getAppIconMarkup(app)}</div>
            <div class="app-name">${app.name}</div>
            <div class="app-description">${app.description || ''}</div>
            <div class="app-arrow">Open →</div>
          </a>
        `;
      }).join('');

      appsGrid.style.display = 'grid';
    }

    function normalizeSearchValue(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeSearchLoose(value) {
      return normalizeSearchValue(value).replace(/[^a-z0-9]+/g, '');
    }

    function buildSearchVariants(value) {
      const base = normalizeSearchValue(value);
      const compact = normalizeSearchLoose(value);
      const variants = new Set([base, compact].filter(Boolean));

      if (base.endsWith('s')) variants.add(base.slice(0, -1));
      if (compact.endsWith('s')) variants.add(compact.slice(0, -1));

      return Array.from(variants).filter(Boolean);
    }

    function filterAccessibleApps(query) {
      const normalized = normalizeSearchValue(query);
      if (!normalized) return [...accessibleApps];
      const variants = buildSearchVariants(query);

      return accessibleApps.filter((app) => {
        const haystack = [app?.name, app?.description, app?.id]
          .map((v) => normalizeSearchValue(v))
          .join(' ');
        const haystackLoose = normalizeSearchLoose(haystack);

        return variants.some((candidate) => {
          const candidateLoose = normalizeSearchLoose(candidate);
          return haystack.includes(candidate) || (candidateLoose && haystackLoose.includes(candidateLoose));
        });
      });
    }

    function applyAppSearch() {
      const query = appSearchInput ? appSearchInput.value : '';
      const filteredApps = filterAccessibleApps(query);
      renderApps(filteredApps);

      if (!filteredApps.length) {
        const hasQuery = Boolean(normalizeSearchValue(query));
        const titleEl = noApps.querySelector('.no-apps-title');
        const textEl = noApps.querySelector('.no-apps-text');
        if (titleEl) titleEl.textContent = hasQuery ? 'No Matching Apps' : 'No Apps Available';
        if (textEl) {
          textEl.textContent = hasQuery
            ? 'No permitted apps match your search.'
            : "You don't have access to any apps. Contact your administrator.";
        }
      }
    }

    function showError(message) {
      errorMessage.textContent = message;
      errorMessage.classList.add('show');
    }

    btnLogout.addEventListener('click', () => {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      redirectToLogin();
    });

    if (btnNavBack) {
      btnNavBack.addEventListener('click', () => window.history.back());
    }

    if (btnNavForward) {
      btnNavForward.addEventListener('click', () => window.history.forward());
    }
    if (btnEOS) {
      btnEOS.addEventListener('click', () => {
        window.location.href = buildAppHref(APP_CATALOG.eos);
      });
    }
    if (btnReceiptBooks) {
      btnReceiptBooks.addEventListener('click', () => {
        window.location.href = buildAppHref(APP_CATALOG['receipt-books']);
      });
    }
    if (btnResumeReceiptDraft) {
      btnResumeReceiptDraft.addEventListener('click', () => {
        window.location.href = buildAppHref(APP_CATALOG['receipt-books']);
      });
    }
    if (btnReviewReceiptDrafts) {
      btnReviewReceiptDrafts.addEventListener('click', () => {
        void openDraftReviewModal();
      });
    }
    if (btnCloseDraftReview) {
      btnCloseDraftReview.addEventListener('click', () => {
        closeDraftReviewModal();
      });
    }
    if (draftReviewBackdrop) {
      draftReviewBackdrop.addEventListener('click', (event) => {
        if (event.target === draftReviewBackdrop) {
          closeDraftReviewModal();
        }
      });
    }
    if (draftReviewList) {
      draftReviewList.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;
        const action = target.getAttribute('data-manager-action');
        const draftId = target.getAttribute('data-draft-id');
        if (!action || !draftId) return;
        void handleManagerDraftAction(action, draftId);
      });
    }
    if (btnSaveStatusLogo) {
      btnSaveStatusLogo.addEventListener('click', () => {
        window.location.href = `./app-hub.html?api_origin=${encodeURIComponent(ACTIVE_API_ORIGIN)}`;
      });
    }
    if (handoverSummaryBtn) {
      handoverSummaryBtn.addEventListener('click', () => {
        const href = `./handover.html?api_origin=${encodeURIComponent(ACTIVE_API_ORIGIN)}`;
        window.location.href = href;
      });
    }
    if (appSearchInput) {
      appSearchInput.addEventListener('input', applyAppSearch);
    }

    initializeWelcomeBar();

    (async () => {
      try {
        if (OD_DEBUG) {
          writeOdDebug('OD debug mode enabled via ?od_debug=1');
        }
        const storedAuth = getStoredAuthRecord();
        const hadExistingToken = Boolean(storedAuth?.access_token || storedAuth?.refresh_token);
        if (OD_FORCE_AUTH || hasLaunchIdentity()) {
          writeOdDebug('OD launch authentication forced.', {
            force_auth: OD_FORCE_AUTH,
            has_launch_identity: hasLaunchIdentity(),
            has_launch_params: hasLaunchParams(),
            had_existing_token: hadExistingToken
          });
          const authenticated = await authenticateFromOdLaunch({
            allowExistingTokenFallback: hadExistingToken
          });
          if (!authenticated && !await ensureValidAuthToken()) {
            writeOdDebug('Authentication from OD launch did not complete.');
            redirectToLogin('Authentication from OD launch did not complete');
            return;
          }
        }
        await loadApps();
        await refreshHandoverSummary();
        if (handoverTicker) clearInterval(handoverTicker);
        handoverTicker = setInterval(refreshHandoverSummary, 30000);
      } catch (error) {
        console.error('OD launch auth failed:', error);
        showError(error instanceof Error ? error.message : 'OD launch authentication failed');
      }
    })();
  
