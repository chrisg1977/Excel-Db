
    function resolveDefaultApiOrigin() {
      const queryOrigin = new URLSearchParams(window.location.search).get('api_origin');
      if (queryOrigin) return queryOrigin;

      const { protocol, hostname } = window.location;
      if (protocol === 'file:') return 'http://localhost:8055';

      const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
      if (isLocalHost) return `${protocol}//${hostname}:8055`;

      return `http://${hostname}:8055`;
    }

    const API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';
    const DEPLOYMENT_API_ORIGINS = [
      'http://192.168.35.116:8055',
      'https://192.168.35.116:8055'
    ];
    let API_ORIGIN = resolveDefaultApiOrigin();
    const AUTH_STORAGE_KEY = 'empinfo.auth.v1';

    const signInForm = document.getElementById('signInForm');
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    const otpForm = document.getElementById('otpForm');

    const emailEl = document.getElementById('email');
    const passwordEl = document.getElementById('password');
    const btnSignIn = document.getElementById('btnSignIn');
    const signInError = document.getElementById('signInError');

    const forgotEmailEl = document.getElementById('forgotEmail');
    const btnRequestOtp = document.getElementById('btnRequestOtp');
    const forgotError = document.getElementById('forgotError');
    const forgotSuccess = document.getElementById('forgotSuccess');

    const otpDigits = document.querySelectorAll('.otp-digit');
    const btnVerifyOtp = document.getElementById('btnVerifyOtp');
    const otpError = document.getElementById('otpError');
    const otpSuccess = document.getElementById('otpSuccess');
    const otpPhoneDisplay = document.getElementById('otpPhoneDisplay');

    let otpRequestEmail = null;
    let otpRequestId = null;

    function showError(el, message) {
      el.textContent = message;
      el.classList.add('show');
    }

    function clearError(el) {
      el.textContent = '';
      el.classList.remove('show');
    }

    function showSuccess(el, message) {
      el.textContent = message;
      el.classList.add('show');
    }

    function clearSuccess(el) {
      el.textContent = '';
      el.classList.remove('show');
    }

    function switchForm(fromForm, toForm) {
      fromForm.classList.remove('active');
      toForm.classList.add('active');
    }

    function setLoadingButton(button, loadingText, defaultText, loading) {
      button.disabled = loading;
      button.innerHTML = loading ? `${loadingText}<span class="loading"></span>` : defaultText;
    }

    function parseStoredAuth() {
      try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    }

    function normalizeApiOrigin(origin) {
      if (!origin) return null;
      const raw = String(origin).trim();
      if (!raw) return null;
      try {
        const parsed = new URL(raw);
        if (!parsed.hostname) return null;
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.origin;
      } catch {
        return null;
      }
    }

    function getStoredApiOrigin() {
      const value = localStorage.getItem(API_ORIGIN_STORAGE_KEY);
      const normalized = normalizeApiOrigin(value);
      if (!normalized && value) {
        localStorage.removeItem(API_ORIGIN_STORAGE_KEY);
      }
      return normalized;
    }

    function setStoredApiOrigin(origin) {
      const normalized = normalizeApiOrigin(origin);
      if (!normalized) return;
      localStorage.setItem(API_ORIGIN_STORAGE_KEY, normalized);
    }

    function getCandidateApiOrigins() {
      const queryOrigin = new URLSearchParams(window.location.search).get('api_origin');
      const storedOrigin = getStoredApiOrigin();
      const { protocol, hostname } = window.location;
      const hasHost = Boolean(hostname && hostname.trim());

      const candidates = [
        queryOrigin,
        storedOrigin,
        API_ORIGIN,
        ...DEPLOYMENT_API_ORIGINS,
        protocol === 'https:' && hasHost ? `https://${hostname}:8055` : null,
        hasHost ? `http://${hostname}:8055` : null,
        'http://localhost:8055',
        'http://127.0.0.1:8055'
      ].filter(Boolean);

      const normalized = candidates
        .map((origin) => normalizeApiOrigin(origin))
        .filter(Boolean);

      return [...new Set(normalized)];
    }

    function setStoredAuth(data) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data || {}));
    }

    function getAuthToken() {
      const stored = parseStoredAuth();
      const expiresAt = stored?.expires_at ? new Date(stored.expires_at).getTime() : null;
      if (expiresAt && Date.now() > expiresAt) return null;
      return stored?.access_token || null;
    }

    async function refreshStoredSession() {
      const stored = parseStoredAuth();
      const refreshToken = String(stored?.refresh_token || '').trim();
      if (!refreshToken) return null;

      const response = await fetchWithApiFallback('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      }, 'Session refresh');

      const payload = await readJsonSafely(response);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          return null;
        }
        throw new Error(payload?.errors?.[0]?.message || payload?.error || 'Session refresh failed');
      }

      const data = payload?.data || {};
      const expiresMs = Number(data?.expires || 0);
      const expiresAt = expiresMs ? new Date(Date.now() + expiresMs).toISOString() : null;
      setStoredAuth({
        ...stored,
        access_token: data?.access_token || null,
        refresh_token: data?.refresh_token || refreshToken,
        expires_at: expiresAt
      });
      return getAuthToken();
    }

    function maskedPhone(phone) {
      if (!phone || phone.length < 4) return '********';
      return '*'.repeat(phone.length - 4) + phone.slice(-4);
    }

    async function readJsonSafely(response) {
      try {
        return await response.json();
      } catch {
        return {};
      }
    }

    function getHttpLoginUrlHint() {
      const url = new URL(window.location.href);
      url.protocol = 'http:';
      const hasApiOrigin = url.searchParams.has('api_origin');
      if (!hasApiOrigin) {
        const firstHttpCandidate = getCandidateApiOrigins().find(origin => origin.startsWith('http://'));
        if (firstHttpCandidate) {
          url.searchParams.set('api_origin', firstHttpCandidate);
        }
      }
      return url.toString();
    }

    async function diagnoseReachableOrigins() {
      const candidates = getCandidateApiOrigins();
      const reachable = [];

      await Promise.all(candidates.map(async (origin) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        try {
          // no-cors allows detecting basic reachability even when CORS blocks normal API calls.
          await fetch(`${origin}/server/health`, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
          });
          reachable.push(origin);
        } catch {
          // unreachable or blocked at network level
        } finally {
          clearTimeout(timeoutId);
        }
      }));

      return reachable;
    }

    async function toReadableApiError(error, actionLabel) {
      if (error instanceof TypeError) {
        const attempted = getCandidateApiOrigins().join(', ');
        const isLikelyMixedContent =
          window.location.protocol === 'https:' &&
          getCandidateApiOrigins().some(origin => origin.startsWith('http://'));

        if (isLikelyMixedContent) {
          const httpLoginUrl = getHttpLoginUrlHint();
          return `${actionLabel} failed: browser blocked HTTP API calls from this HTTPS page (mixed content). Tried: ${attempted}. Open this over HTTP: ${httpLoginUrl}`;
        }

        const reachable = await diagnoseReachableOrigins();
        if (reachable.length > 0) {
          return `${actionLabel} failed: API host is reachable but browser blocked the request (likely CORS). Reachable: ${reachable.join(', ')}. Add your page origin to DIRECTUS CORS_ORIGIN or serve this page from the same host as Directus.`;
        }

        return `${actionLabel} failed: cannot reach API. Tried: ${attempted}. Open login with ?api_origin=http://YOUR_DIRECTUS_HOST:8055`;
      }
      return error?.message || `${actionLabel} failed`;
    }

    async function fetchWithApiFallback(path, options, actionLabel) {
      let lastError = null;
      for (const origin of getCandidateApiOrigins()) {
        try {
          const response = await fetch(`${origin}${path}`, options);
          API_ORIGIN = origin;
          setStoredApiOrigin(origin);
          return response;
        } catch (error) {
          lastError = error;
        }
      }

      // Drop stale/bad cache so next page load re-resolves origins automatically.
      localStorage.removeItem(API_ORIGIN_STORAGE_KEY);
      throw new Error(await toReadableApiError(lastError, actionLabel));
    }

    async function authenticateDirectus(email, password) {
      const response = await fetchWithApiFallback('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }, 'Sign in');

      const payload = await readJsonSafely(response);
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
        expires_at: expiresAt,
        email
      });

      return true;
    }

    async function resolveLoginToEmail(loginInput) {
      const input = String(loginInput || '').trim();
      if (!input) {
        throw new Error('Login is required');
      }

      // If user typed email, keep it.
      if (input.includes('@')) {
        return input.toLowerCase();
      }

      const response = await fetchWithApiFallback('/auth/login-identity/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: input })
      }, 'Login identity resolution');

      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const message = payload?.error || payload?.errors?.[0]?.message || 'Could not resolve login identity';
        throw new Error(message);
      }

      const resolved = String(payload?.data?.resolved_email || '').trim().toLowerCase();
      if (!resolved) {
        throw new Error('Could not resolve login identity');
      }
      return resolved;
    }

    async function requestOtpCode(email) {
      const token = getAuthToken();
      const response = await fetchWithApiFallback('/auth/otp/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ email })
      }, 'OTP request');

      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const message = payload?.error || 'Failed to request OTP';
        throw new Error(message);
      }

      return {
        phone: payload?.phone || null,
        masked_phone: maskedPhone(payload?.phone || ''),
        otp_id: payload?.otp_id || null
      };
    }

    async function verifyOtpCode(email, code, otpId) {
      const token = getAuthToken();
      const response = await fetchWithApiFallback('/auth/otp/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ email, code, otp_id: otpId })
      }, 'OTP verification');

      const payload = await readJsonSafely(response);
      if (!response.ok) {
        const message = payload?.error || 'OTP verification failed';
        throw new Error(message);
      }

      const data = payload?.data || {};
      const expiresMs = Number(data?.expires || 3600000);
      const expiresAt = new Date(Date.now() + expiresMs).toISOString();
      setStoredAuth({
        access_token: data?.access_token || null,
        refresh_token: data?.refresh_token || null,
        expires_at: expiresAt,
        otp_verified: true,
        email
      });

      return true;
    }

    btnSignIn.addEventListener('click', async () => {
      clearError(signInError);
      const loginInput = emailEl.value.trim();
      const password = passwordEl.value.trim();

      if (!loginInput || !password) {
        showError(signInError, 'Login and password are required');
        return;
      }

      setLoadingButton(btnSignIn, 'Signing in', 'Sign In', true);

      try {
        const resolvedEmail = await resolveLoginToEmail(loginInput);
        emailEl.value = resolvedEmail;
        await authenticateDirectus(resolvedEmail, password);
        window.location.href = './app-hub.html?api_origin=' + encodeURIComponent(API_ORIGIN);
      } catch (error) {
        showError(signInError, error?.message || 'Sign in failed');
        setLoadingButton(btnSignIn, 'Signing in', 'Sign In', false);
      }
    });

    document.getElementById('linkForgotPassword').addEventListener('click', () => {
      clearError(signInError);
      clearError(forgotError);
      clearSuccess(forgotSuccess);
      clearError(otpError);
      clearSuccess(otpSuccess);
      forgotEmailEl.value = emailEl.value;
      switchForm(signInForm, forgotPasswordForm);
    });

    document.getElementById('linkBackToSignIn').addEventListener('click', () => {
      clearError(forgotError);
      clearSuccess(forgotSuccess);
      clearError(otpError);
      clearSuccess(otpSuccess);
      switchForm(forgotPasswordForm, signInForm);
      clearOtpFields();
    });

    btnRequestOtp.addEventListener('click', async () => {
      clearError(forgotError);
      clearSuccess(forgotSuccess);
      clearError(otpError);
      clearSuccess(otpSuccess);
      const loginInput = forgotEmailEl.value.trim();

      if (!loginInput) {
        showError(forgotError, 'Login is required');
        return;
      }

      setLoadingButton(btnRequestOtp, 'Sending', 'Send Code', true);

      try {
        const email = await resolveLoginToEmail(loginInput);
        forgotEmailEl.value = email;
        const result = await requestOtpCode(email);
        otpRequestEmail = email;
        otpRequestId = result.otp_id;

        otpPhoneDisplay.textContent = result.masked_phone;
        clearOtpFields();
        switchForm(forgotPasswordForm, otpForm);
        showSuccess(otpSuccess, 'Code sent. Check your phone and enter the 6-digit code.');
        otpDigits[0].focus();
      } catch (error) {
        showError(forgotError, error?.message || 'Failed to send OTP');
      } finally {
        setLoadingButton(btnRequestOtp, 'Sending', 'Send Code', false);
      }
    });

    function clearOtpFields() {
      otpDigits.forEach(el => (el.value = ''));
    }

    otpDigits.forEach((input, index) => {
      input.addEventListener('input', (e) => {
        if (!/^\d$/.test(e.target.value)) {
          e.target.value = '';
          return;
        }
        if (index < otpDigits.length - 1) {
          otpDigits[index + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
          otpDigits[index - 1].focus();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        const digits = paste.replace(/\D/g, '').split('');
        digits.forEach((digit, i) => {
          if (index + i < otpDigits.length) {
            otpDigits[index + i].value = digit;
          }
        });
        if (digits.length > 0) {
          otpDigits[Math.min(index + digits.length, otpDigits.length - 1)].focus();
        }
      });
    });

    btnVerifyOtp.addEventListener('click', async () => {
      clearError(otpError);
      clearSuccess(otpSuccess);
      const code = Array.from(otpDigits).map(el => el.value).join('');

      if (code.length !== 6) {
        showError(otpError, 'Please enter all 6 digits');
        return;
      }

      if (!otpRequestEmail) {
        showError(otpError, 'Session expired, please try again');
        return;
      }

      setLoadingButton(btnVerifyOtp, 'Verifying', 'Verify Code', true);

      try {
        await verifyOtpCode(otpRequestEmail, code, otpRequestId);
        window.location.href = './app-hub.html?api_origin=' + encodeURIComponent(API_ORIGIN);
      } catch (error) {
        showError(otpError, error?.message || 'Verification failed');
        setLoadingButton(btnVerifyOtp, 'Verifying', 'Verify Code', false);
      }
    });

    document.getElementById('linkResendOtp').addEventListener('click', async () => {
      clearError(otpError);
      clearSuccess(otpSuccess);

      if (!otpRequestEmail) {
        showError(otpError, 'Session expired, please request a new code.');
        switchForm(otpForm, forgotPasswordForm);
        return;
      }

      setLoadingButton(btnVerifyOtp, 'Resending', 'Verify Code', true);
      try {
        const result = await requestOtpCode(otpRequestEmail);
        otpRequestId = result.otp_id;
        otpPhoneDisplay.textContent = result.masked_phone;
        clearOtpFields();
        showSuccess(otpSuccess, 'A new code has been sent.');
        otpDigits[0].focus();
      } catch (error) {
        showError(otpError, error?.message || 'Failed to resend OTP');
      } finally {
        setLoadingButton(btnVerifyOtp, 'Verifying', 'Verify Code', false);
      }
    });

    emailEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSignIn.click();
    });

    passwordEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSignIn.click();
    });

    forgotEmailEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnRequestOtp.click();
    });

    (async () => {
      try {
        const token = getAuthToken() || await refreshStoredSession();
        if (token) {
          window.location.href = './app-hub.html?api_origin=' + encodeURIComponent(API_ORIGIN);
        }
      } catch {
        // Leave the user on the login page if session refresh fails.
      }
    })();
  
