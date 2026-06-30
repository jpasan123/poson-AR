(function visitTracker() {
  const cfg = window.VISIT_TRACKING;
  if (!cfg?.enabled || !cfg.webhookUrl) return;

  const SESSION_KEY = 'ar_visit_session';

  function sessionId() {
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID())
          || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      return `s-${Date.now().toString(36)}`;
    }
  }

  function pageMeta() {
    const params = new URLSearchParams(location.search);
    return {
      event: 'page_view',
      timestamp: new Date().toISOString(),
      page: location.pathname.split('/').pop() || 'index.html',
      fullUrl: location.href,
      exp: params.get('exp') || '',
      sessionId: sessionId(),
      referrer: document.referrer || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      platform: navigator.platform || '',
      userAgent: navigator.userAgent || '',
      email: '',
      name: '',
    };
  }

  function send(payload) {
    const body = JSON.stringify(payload);
    const url = cfg.webhookUrl;
    try {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        if (ok) return;
      }
    } catch { /* fall through */ }
    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }

  function track(event, extra) {
    send({ ...pageMeta(), event, ...extra });
  }

  track('page_view');

  window.addEventListener('ar:started', (e) => {
    track('ar_started', { exp: e.detail?.mode || '', ...(e.detail || {}) });
  });

  window.addEventListener('ar:target_found', (e) => {
    track('ar_scan', { exp: e.detail?.expId || '', ...(e.detail || {}) });
  });

  function decodeJwtEmail(credential) {
    try {
      const payload = credential.split('.')[1];
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return { email: json.email || '', name: json.name || '' };
    } catch {
      return { email: '', name: '' };
    }
  }

  function initGoogleOneTap() {
    const clientId = cfg.googleClientId;
    if (!clientId || !window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response) => {
        const { email, name } = decodeJwtEmail(response.credential);
        if (!email) return;
        try { localStorage.setItem('ar_visit_email', email); } catch { /* ignore */ }
        track('google_sign_in', { email, name });
      },
    });

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) return;
    });
  }

  if (cfg.googleClientId) {
    const gsi = document.createElement('script');
    gsi.src = 'https://accounts.google.com/gsi/client';
    gsi.async = true;
    gsi.defer = true;
    gsi.onload = initGoogleOneTap;
    document.head.appendChild(gsi);
  } else {
    try {
      const saved = localStorage.getItem('ar_visit_email');
      if (saved) track('return_visitor', { email: saved });
    } catch { /* ignore */ }
  }
})();
