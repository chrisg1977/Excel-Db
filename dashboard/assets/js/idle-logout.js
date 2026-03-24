/**
 * idle-logout.js
 * Auto-logout non-admin users after 15 minutes of inactivity.
 * Shows a 60-second warning countdown before logout.
 * Admins (role rank >= 5) are exempt.
 *
 * Usage: include this script on any authenticated page AFTER the
 * page's AUTH_STORAGE_KEY and role detection are initialised.
 * Call window.initIdleLogout(roleName) once the user role is known.
 */
(function () {
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
  const WARN_BEFORE_MS  = 60 * 1000;
  const ADMIN_RANK      = 5;

  const ROLE_RANK = {
    admin: 5, administrator: 5, superadmin: 5,
    full: 4,
    hr: 3,
    management: 2,
    'general user': 1
  };

  function getRoleRank(roleName) {
    const n = String(roleName || '').trim().toLowerCase();
    if (ROLE_RANK[n]) return ROLE_RANK[n];
    if (n.includes('super') || n.includes('admin')) return 5;
    if (n.includes('full'))    return 4;
    if (n.includes('hr'))      return 3;
    if (n.includes('manag'))   return 2;
    return 1;
  }

  function getAuthKey() {
    // Support both naming conventions used across pages
    return window.AUTH_STORAGE_KEY || 'empinfo.auth.v1';
  }

  function doLogout() {
    localStorage.removeItem(getAuthKey());
    // Redirect to login preserving api_origin if present
    const params = new URLSearchParams(window.location.search);
    const apiOrigin = params.get('api_origin') || '';
    const loginPath = (window.location.pathname.includes('/payroll/') || window.location.pathname.includes('/eos/') || window.location.pathname.includes('/views/'))
      ? '../login.html'
      : './login.html';
    window.location.href = apiOrigin
      ? `${loginPath}?api_origin=${encodeURIComponent(apiOrigin)}`
      : loginPath;
  }

  function injectOverlay() {
    if (document.getElementById('_idleWarningOverlay')) return;
    const div = document.createElement('div');
    div.id = '_idleWarningOverlay';
    div.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;align-items:center;justify-content:center;';
    div.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:32px 40px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.18);text-align:center;">
        <div style="font-size:2rem;margin-bottom:12px;">⏱️</div>
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:8px;color:#1a1d23;">Session Expiring</h2>
        <p style="color:#3d4350;margin-bottom:20px;">You will be signed out in <strong id="_idleCountdown">60</strong> seconds due to inactivity.</p>
        <button id="_idleStayBtn" style="background:#2E5090;color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:1rem;cursor:pointer;font-weight:600;">Stay Signed In</button>
      </div>`;
    document.body.appendChild(div);
  }

  window.initIdleLogout = function (roleName) {
    if (getRoleRank(roleName) >= ADMIN_RANK) return; // admins exempt

    injectOverlay();

    const overlay      = document.getElementById('_idleWarningOverlay');
    const countdownEl  = document.getElementById('_idleCountdown');
    const stayBtn      = document.getElementById('_idleStayBtn');
    let idleTimer      = null;
    let warnTimer      = null;
    let countdownInt   = null;

    function showWarning() {
      let secs = 60;
      countdownEl.textContent = secs;
      overlay.style.display = 'flex';
      countdownInt = setInterval(() => {
        secs--;
        countdownEl.textContent = secs;
        if (secs <= 0) { clearInterval(countdownInt); doLogout(); }
      }, 1000);
    }

    function hideWarning() {
      overlay.style.display = 'none';
      clearInterval(countdownInt);
    }

    function reset() {
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
      hideWarning();
      warnTimer = setTimeout(showWarning, IDLE_TIMEOUT_MS - WARN_BEFORE_MS);
      idleTimer = setTimeout(doLogout, IDLE_TIMEOUT_MS);
    }

    stayBtn.addEventListener('click', reset);
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(e => {
      document.addEventListener(e, reset, { passive: true });
    });

    reset();
  };
})();
