(function () {
  'use strict';

  var ACTIVE_IDLE_MS = 60 * 1000;
  var TICK_MS = 15 * 1000;
  var FLUSH_THRESHOLD_SECONDS = 15;
  var AUTH_STORAGE_KEY = 'empinfo.auth.v1';
  var API_ORIGIN_STORAGE_KEY = 'empinfo.api_origin.v1';

  var params = new URLSearchParams(window.location.search || '');
  var apiOrigin = params.get('api_origin') || localStorage.getItem(API_ORIGIN_STORAGE_KEY) || 'http://localhost:8055';
  var appId = (document.body && document.body.getAttribute('data-app-id')) || 'mcorez';
  var pagePath = window.location.pathname || '';

  var pendingSeconds = 0;
  var lastTickMs = Date.now();
  var lastActivityMs = Date.now();
  var hasFocus = !document.hidden;
  var isTracking = true;

  function getAccessToken() {
    try {
      var stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '{}');
      return stored && stored.access_token ? String(stored.access_token) : '';
    } catch (error) {
      return '';
    }
  }

  function markActivity() {
    lastActivityMs = Date.now();
  }

  function isActive(nowMs) {
    if (!hasFocus || document.hidden) return false;
    return nowMs - lastActivityMs <= ACTIVE_IDLE_MS;
  }

  function postUsage(seconds, urgent) {
    var token = getAccessToken();
    if (!token || !seconds || seconds <= 0) return;

    var payload = JSON.stringify({
      app_id: String(appId || '').toLowerCase(),
      active_seconds: Math.round(seconds),
      page_path: pagePath,
      client_ts: Date.now()
    });

    var endpoint = apiOrigin.replace(/\/+$/, '') + '/usage-analytics/usage/track';
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    };

    if (urgent && navigator.sendBeacon) {
      try {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      } catch (error) {
        // Fall through to fetch
      }
    }

    fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: payload,
      keepalive: Boolean(urgent)
    }).catch(function () {
      // Best-effort telemetry only.
    });
  }

  function flush(urgent) {
    if (pendingSeconds < 1) return;
    var toSend = pendingSeconds;
    pendingSeconds = 0;
    postUsage(toSend, urgent);
  }

  function tick() {
    if (!isTracking) return;
    var nowMs = Date.now();
    var elapsedSeconds = Math.floor((nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;

    if (elapsedSeconds <= 0) return;
    if (!isActive(nowMs)) return;

    pendingSeconds += elapsedSeconds;
    if (pendingSeconds >= FLUSH_THRESHOLD_SECONDS) {
      flush(false);
    }
  }

  function onVisibilityChanged() {
    hasFocus = !document.hidden;
    if (!hasFocus) {
      flush(true);
      return;
    }
    lastActivityMs = Date.now();
    lastTickMs = Date.now();
  }

  ['click', 'keydown', 'mousedown', 'mousemove', 'touchstart', 'scroll'].forEach(function (eventName) {
    window.addEventListener(eventName, markActivity, { passive: true });
  });

  window.addEventListener('focus', function () {
    hasFocus = true;
    markActivity();
  });

  window.addEventListener('blur', function () {
    hasFocus = false;
    flush(true);
  });

  document.addEventListener('visibilitychange', onVisibilityChanged);
  window.addEventListener('beforeunload', function () {
    flush(true);
    isTracking = false;
  });

  setInterval(tick, TICK_MS);
})();
