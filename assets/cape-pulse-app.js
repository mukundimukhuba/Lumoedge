(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM) {
    document.getElementById('root').textContent = 'Could not load website builder.';
    return;
  }
  const h = React.createElement;
  const useState = React.useState;
  const useEffect = React.useEffect;
  const SESSION_KEY = 'ub-web/admin-session-v1';
  const FONT_OPTIONS = [
    { id: 'space', label: 'Space Grotesk' },
    { id: 'orbitron', label: 'Orbitron' },
    { id: 'sora', label: 'Sora' },
    { id: 'manrope', label: 'Manrope' },
    { id: 'inter', label: 'Inter' },
    { id: 'mono', label: 'JetBrains Mono' },
  ];
  const LAYOUT_OPTIONS = [
    { id: 'classic', label: 'Classic' },
    { id: 'stacked', label: 'Stacked' },
    { id: 'split', label: 'Split' },
  ];
  const ACCENT_OPTIONS = [
    { id: 'cyan', label: 'Cyan', hex: '#22d3ee' },
    { id: 'gold', label: 'Gold', hex: '#f5d76e' },
    { id: 'green', label: 'Green', hex: '#4ade80' },
    { id: 'pink', label: 'Pink', hex: '#f472b6' },
    { id: 'orange', label: 'Orange', hex: '#ff9f1c' },
    { id: 'blue', label: 'Blue', hex: '#60a5fa' },
  ];

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : '/' + path;
    return p;
  }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {}; } catch { return {}; }
  }
  function writeSession(data) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data || {})); } catch {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }
  function sessionHeaders(admin) {
    const sess = readSession();
    const headers = { 'Content-Type': 'application/json' };
    const token = String(sess.token || '');
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['x-lumo-session'] = token;
    }
    const id = (admin && admin.id) || sess.adminId;
    if (id) headers['x-lumo-admin-id'] = String(id);
    return headers;
  }
  function themeOf(draft) {
    return {
      font: draft.themeFont || 'space',
      layout: draft.themeLayout || 'classic',
      accent: draft.themeAccent || 'cyan',
    };
  }
  function Field(props) {
    return h('div', { className: 'cp-field' },
      h('label', null, props.label),
      props.area
        ? h('textarea', { value: props.value || '', onChange: function (e) { props.onChange(e.target.value); }, rows: props.rows || 4 })
        : h('input', {
            type: props.type || 'text',
            value: props.value || '',
            onChange: function (e) { props.onChange(e.target.value); },
            placeholder: props.placeholder || '',
            autoComplete: props.autoComplete || 'off',
          })
    );
  }
  function MiniPreview(props) {
    const draft = props.draft || {};
    const theme = themeOf(draft);
    return h('div', {
      className: 'le-store le-preview-frame le-glass',
      style: { pointerEvents: 'none', maxHeight: 560, overflow: 'hidden' },
      'data-font': theme.font,
      'data-layout': theme.layout,
      'data-accent': theme.accent,
    },
      h('div', { className: 'le-store-nav-row' },
        h('div', { className: 'le-store-brand' },
          h('img', { src: '/lumo-logo.png', alt: '' }),
          h('span', null, 'CAPE PULSE')
        ),
        h('div', { className: 'le-store-powered' }, 'Powered by Swagstack')
      ),
      h('div', { className: 'le-store-hero', style: { padding: '18px 0' } },
        h('div', null,
          h('h1', { style: { fontSize: 26 } }, draft.robotName || 'Your website'),
          draft.headline ? h('p', { className: 'le-store-headline' }, draft.headline) : null,
          h('p', null, draft.shortDescription || '')
        ),
        h('div', { className: 'le-store-visual' },
          h('img', { src: draft.robotImage || '/lumo-logo.png', alt: '' })
        )
      )
    );
  }
  function isSuperAdmin(admin) {
    if (!admin) return false;
    const email = String(admin.email || '').trim().toLowerCase();
    return admin.role === 'super' || admin.id === 'LM-004821' || email === 'mukundimukhuba8@gmail.com';
  }
  function Shell(props) {
    return h('div', { className: 'cp-shell' },
      h('header', { className: 'cp-top' },
        h('div', { className: 'cp-brand' },
          h('img', { src: '/lumo-logo.png', alt: 'Lumoedge Cape Pulse' }),
          h('div', null,
            h('strong', null, 'Lumoedge Cape Pulse'),
            h('span', null, isSuperAdmin(props.admin) ? 'Mentors under this platform · Website customize' : 'Website customize')
          )
        ),
        props.admin
          ? h('div', { className: 'cp-actions' },
              h('div', { className: 'cp-pill' }, props.admin.email || props.admin.id || 'Signed in'),
              h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', onClick: props.onLogout }, 'Log out')
            )
          : h('div', { className: 'cp-pill' }, 'Website builder')
      ),
      props.children,
      h('footer', { className: 'cp-foot' }, 'Lumoedge Cape Pulse · Powered by Swagstack')
    );
  }
  function CustomersPanel(props) {
    const admin = props.admin;
    const listState = useState(null);
    const errState = useState('');
    const qState = useState('');
    const busyState = useState('');
    const msgState = useState('');
    const customers = listState[0], setCustomers = listState[1];
    const error = errState[0], setError = errState[1];
    const q = qState[0], setQ = qState[1];
    const busy = busyState[0], setBusy = busyState[1];
    const message = msgState[0], setMessage = msgState[1];

    async function loadCustomers() {
      const res = await fetch(apiUrl('/api/special/customers'), {
        headers: sessionHeaders(admin),
        cache: 'no-store',
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load customers');
      return Array.isArray(data.customers) ? data.customers : [];
    }

    useEffect(function () {
      var cancelled = false;
      (async function () {
        try {
          let rows = await loadCustomers();
          if (cancelled) return;
          const shared = rows.filter(function (row) {
            const eas = Array.isArray(row.eaNames) ? row.eaNames : [row.eaNames];
            return eas.some(function (name) {
              return String(name || '').trim().toLowerCase() === 'unlimited bull';
            });
          }).length;
          if (shared > 10 || (rows.length && shared === rows.length)) {
            setMessage('Assigning unique EA names…');
            const fixRes = await fetch(apiUrl('/api/special/fix-ea-names'), {
              method: 'POST',
              headers: sessionHeaders(admin),
              body: '{}',
            });
            const fixData = await fixRes.json().catch(function () { return {}; });
            if (fixRes.ok && fixData.ok) {
              rows = await loadCustomers();
              if (!cancelled) setMessage('Updated ' + (fixData.renamed || 0) + ' EA names to unique names.');
            } else if (!cancelled) {
              setMessage('');
            }
          }
          if (!cancelled) setCustomers(rows);
        } catch (e) {
          if (!cancelled) setError(e && e.message ? e.message : 'Could not load customers');
        }
      })();
      return function () { cancelled = true; };
    }, [admin && admin.id]);

    async function setWebsiteStatus(row, action) {
      const websiteId = row && row.website && row.website.websiteId;
      if (!websiteId) return;
      setBusy(websiteId + ':' + action);
      setError('');
      try {
        const res = await fetch(apiUrl('/api/websites/' + encodeURIComponent(websiteId)), {
          method: 'PATCH',
          headers: sessionHeaders(admin),
          body: JSON.stringify({ action: action }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not update website');
        setCustomers(function (prev) {
          return (prev || []).map(function (item) {
            if (item.email !== row.email) return item;
            return Object.assign({}, item, {
              website: Object.assign({}, item.website || {}, {
                status: data.website && data.website.status ? data.website.status : action,
                url: (data.website && data.website.url) || (item.website && item.website.url) || '',
              }),
            });
          });
        });
        setMessage(action === 'disable' ? 'Website disabled.' : 'Website re-enabled.');
      } catch (e) {
        setError(e && e.message ? e.message : 'Could not update website');
      } finally {
        setBusy('');
      }
    }

    const needle = String(q || '').trim().toLowerCase();
    const rows = (customers || []).filter(function (row) {
      if (!needle) return true;
      const hay = [row.firstName, row.lastName, row.fullName, row.email, (row.eaNames || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(needle) >= 0;
    });
    return h('div', { className: 'cp-card' },
      h('h1', null, 'Mentors under this platform'),
      h('p', { className: 'cp-muted' },
        customers
          ? (customers.length + ' mentors under this platform · each has a unique EA name. Disable a linked mentor website when needed.')
          : 'Loading mentors…'
      ),
      h('div', { className: 'cp-actions' },
        h('input', {
          className: 'cp-search',
          value: q,
          onChange: function (e) { setQ(e.target.value); },
          placeholder: 'Search name, email, or EA',
        }),
        h('a', {
          className: 'cp-btn cp-btn-ghost',
          href: '/assets/r350-swagstack-report.csv',
          target: '_blank',
          rel: 'noreferrer',
        }, 'Download CSV')
      ),
      message ? h('p', { className: 'cp-success' }, message) : null,
      error ? h('p', { className: 'cp-error' }, error) : null,
      !customers && !error ? h('p', { className: 'cp-muted' }, 'Loading…') : null,
      customers && !rows.length ? h('p', { className: 'cp-muted' }, 'No matching customers.') : null,
      rows.length
        ? h('div', { className: 'cp-customer-list' },
            rows.map(function (row) {
              const name = row.fullName || [row.firstName, row.lastName].filter(Boolean).join(' ') || '—';
              const eas = Array.isArray(row.eaNames) ? row.eaNames.join(' · ') : (row.eaNames || '—');
              const site = row.website || null;
              const siteStatus = site ? String(site.status || 'draft') : '';
              const siteBusy = site && busy.indexOf(site.websiteId) === 0;
              return h('div', { className: 'cp-customer-row', key: row.email },
                h('div', null,
                  h('strong', null, name),
                  h('div', { className: 'cp-muted' }, row.email),
                  site
                    ? h('div', { className: 'cp-site-line' },
                        'Website: ' + siteStatus.toUpperCase(),
                        site.url ? h('a', { href: site.url, target: '_blank', rel: 'noreferrer' }, ' open') : null
                      )
                    : null
                ),
                h('div', { className: 'cp-customer-meta' },
                  h('span', null, row.amount || 'R350'),
                  h('span', null, row.paidAt ? String(row.paidAt).slice(0, 10) : '—'),
                  h('span', { className: 'cp-ea-pill' }, eas),
                  site && siteStatus !== 'disabled'
                    ? h('button', {
                        type: 'button',
                        className: 'cp-btn cp-btn-ghost cp-btn-tiny',
                        disabled: !!siteBusy,
                        onClick: function () { setWebsiteStatus(row, 'disable'); },
                      }, siteBusy ? '…' : 'Disable website')
                    : null,
                  site && siteStatus === 'disabled'
                    ? h('button', {
                        type: 'button',
                        className: 'cp-btn cp-btn-primary cp-btn-tiny',
                        disabled: !!siteBusy,
                        onClick: function () { setWebsiteStatus(row, 'enable'); },
                      }, siteBusy ? '…' : 'Enable website')
                    : null
                )
              );
            })
          )
        : null
    );
  }

  function WebsitesPanel(props) {
    const admin = props.admin;
    const listState = useState(null);
    const errState = useState('');
    const busyState = useState('');
    const msgState = useState('');
    const websites = listState[0], setWebsites = listState[1];
    const error = errState[0], setError = errState[1];
    const busy = busyState[0], setBusy = busyState[1];
    const message = msgState[0], setMessage = msgState[1];

    async function load() {
      const res = await fetch(apiUrl('/api/websites'), {
        headers: sessionHeaders(admin),
        cache: 'no-store',
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load websites');
      setWebsites(Array.isArray(data.websites) ? data.websites : []);
    }

    useEffect(function () {
      var cancelled = false;
      (async function () {
        try {
          await load();
        } catch (e) {
          if (!cancelled) setError(e && e.message ? e.message : 'Could not load websites');
        }
      })();
      return function () { cancelled = true; };
    }, [admin && admin.id]);

    async function patchStatus(site, action) {
      if (!site || !site.websiteId) return;
      setBusy(site.websiteId);
      setError('');
      setMessage('');
      try {
        const res = await fetch(apiUrl('/api/websites/' + encodeURIComponent(site.websiteId)), {
          method: 'PATCH',
          headers: sessionHeaders(admin),
          body: JSON.stringify({ action: action }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
        setWebsites(function (prev) {
          return (prev || []).map(function (row) {
            if (row.websiteId !== site.websiteId) return row;
            return Object.assign({}, row, data.website || {}, {
              status: (data.website && data.website.status) || action,
            });
          });
        });
        setMessage(action === 'disable' ? 'Website disabled.' : action === 'enable' ? 'Website enabled.' : 'Website updated.');
      } catch (e) {
        setError(e && e.message ? e.message : 'Update failed');
      } finally {
        setBusy('');
      }
    }

    return h('div', { className: 'cp-card' },
      h('h1', null, 'Mentor websites'),
      h('p', { className: 'cp-muted' }, 'Disable or re-enable any mentor public website. Sites are never deleted.'),
      message ? h('p', { className: 'cp-success' }, message) : null,
      error ? h('p', { className: 'cp-error' }, error) : null,
      !websites && !error ? h('p', { className: 'cp-muted' }, 'Loading…') : null,
      websites && !websites.length ? h('p', { className: 'cp-muted' }, 'No mentor websites yet.') : null,
      websites && websites.length
        ? h('div', { className: 'cp-customer-list' },
            websites.map(function (site) {
              const status = String(site.status || 'draft');
              const label = site.robotName || site.mentorName || site.slug || site.websiteId;
              const isBusy = busy === site.websiteId;
              return h('div', { className: 'cp-customer-row', key: site.websiteId },
                h('div', null,
                  h('strong', null, label),
                  h('div', { className: 'cp-muted' }, site.email || site.mentorId || '—'),
                  site.url ? h('a', { href: site.url, target: '_blank', rel: 'noreferrer' }, site.url.replace('https://', '')) : null
                ),
                h('div', { className: 'cp-customer-meta' },
                  h('span', null, status.toUpperCase()),
                  status !== 'disabled'
                    ? h('button', {
                        type: 'button',
                        className: 'cp-btn cp-btn-ghost cp-btn-tiny',
                        disabled: !!isBusy,
                        onClick: function () { patchStatus(site, 'disable'); },
                      }, isBusy ? '…' : 'Disable')
                    : h('button', {
                        type: 'button',
                        className: 'cp-btn cp-btn-primary cp-btn-tiny',
                        disabled: !!isBusy,
                        onClick: function () { patchStatus(site, 'enable'); },
                      }, isBusy ? '…' : 'Enable'),
                  status === 'published'
                    ? h('button', {
                        type: 'button',
                        className: 'cp-btn cp-btn-ghost cp-btn-tiny',
                        disabled: !!isBusy,
                        onClick: function () { patchStatus(site, 'unpublish'); },
                      }, 'Unpublish')
                    : null
                )
              );
            })
          )
        : null
    );
  }
  function loginErrorMessage(data, fallback) {
    const code = String((data && data.error) || '').toLowerCase();
    if (code === 'pending') {
      return 'Your registration is waiting for Super Admin approval. Once approved, you can customize your website.';
    }
    if (code === 'inactive') return (data && data.message) || 'This account is inactive.';
    if (code === 'invalid_credentials') return 'Wrong email or password.';
    if (code === 'not_registered') return 'No account found. Register first, then wait for approval.';
    if (code === 'too_many_attempts') return 'Too many attempts. Try again later.';
    if (code === 'password_reset_required') return 'Password reset required. Use the main portal to reset.';
    return (data && (data.message || data.error)) || fallback || 'Login failed';
  }

  function Login(props) {
    const modeState = useState('login');
    const nameState = useState('');
    const emailState = useState('');
    const passwordState = useState('');
    const busyState = useState(false);
    const errorState = useState('');
    const successState = useState('');
    const mode = modeState[0], setMode = modeState[1];
    const fullName = nameState[0], setFullName = nameState[1];
    const email = emailState[0], setEmail = emailState[1];
    const password = passwordState[0], setPassword = passwordState[1];
    const busy = busyState[0], setBusy = busyState[1];
    const error = errorState[0], setError = errorState[1];
    const success = successState[0], setSuccess = successState[1];

    function switchMode(next) {
      setMode(next);
      setError('');
      setSuccess('');
    }

    async function submit(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      setBusy(true); setError(''); setSuccess('');
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 20000) : null;
      try {
        if (mode === 'register') {
          const res = await fetch(apiUrl('/api/auth/register'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              password: password,
              fullName: fullName,
              mentorName: fullName,
            }),
            signal: controller ? controller.signal : undefined,
          });
          const data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.message || data.error || 'Registration failed');
          setSuccess('Registered. mukundimukhuba8@gmail.com must approve you before you can customize your website.');
          setMode('login');
          setPassword('');
          return;
        }
        const res = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password }),
          signal: controller ? controller.signal : undefined,
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok || !data.admin) throw new Error(loginErrorMessage(data, 'Login failed'));
        const admin = data.admin;
        writeSession({
          token: data.sessionToken || '',
          adminId: admin.id,
          role: admin.role || 'admin',
          email: admin.email || email,
        });
        props.onReady({
          id: admin.id,
          role: admin.role || 'admin',
          email: admin.email || email,
          fullName: admin.fullName || '',
        });
      } catch (err) {
        const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
        setError(aborted ? 'Request timed out. Check connection and try again.' : (err && err.message ? err.message : 'Request failed'));
      } finally {
        if (timer) clearTimeout(timer);
        setBusy(false);
      }
    }

    return h(Shell, null,
      h('form', { className: 'cp-card cp-login', onSubmit: submit },
        h('h1', null, mode === 'register' ? 'Register to customize' : 'Customize your website'),
        h('p', { className: 'cp-muted' },
          mode === 'register'
            ? 'Create an account. Super Admin (mukundimukhuba8@gmail.com) must approve you before you can customize and publish your website.'
            : 'Sign in after Super Admin has approved your mentor account. This page is only for website customize — not the trading portal.'
        ),
        h('div', { className: 'cp-auth-tabs' },
          h('button', {
            type: 'button',
            className: 'cp-auth-tab' + (mode === 'login' ? ' is-on' : ''),
            onClick: function () { switchMode('login'); },
          }, 'Login'),
          h('button', {
            type: 'button',
            className: 'cp-auth-tab' + (mode === 'register' ? ' is-on' : ''),
            onClick: function () { switchMode('register'); },
          }, 'Register')
        ),
        mode === 'register'
          ? h(Field, { label: 'Full name', value: fullName, onChange: setFullName, autoComplete: 'name', placeholder: 'Your name' })
          : null,
        h(Field, { label: 'Email', value: email, onChange: setEmail, type: 'email', autoComplete: 'email', placeholder: 'you@email.com' }),
        h(Field, { label: 'Password', value: password, onChange: setPassword, type: 'password', autoComplete: mode === 'register' ? 'new-password' : 'current-password' }),
        success ? h('p', { className: 'cp-success' }, success) : null,
        error ? h('p', { className: 'cp-error' }, error) : null,
        h('button', {
          type: 'submit',
          className: 'cp-btn cp-btn-primary',
          disabled: busy,
        }, busy
          ? (mode === 'register' ? 'Registering…' : 'Signing in…')
          : (mode === 'register' ? 'Register' : 'Continue'))
      )
    );
  }

  function ApprovalsPanel(props) {
    const admin = props.admin;
    const listState = useState(null);
    const errState = useState('');
    const msgState = useState('');
    const busyState = useState('');
    const qState = useState('');
    const pending = listState[0], setPending = listState[1];
    const error = errState[0], setError = errState[1];
    const message = msgState[0], setMessage = msgState[1];
    const busy = busyState[0], setBusy = busyState[1];
    const q = qState[0], setQ = qState[1];

    async function load() {
      const res = await fetch(apiUrl('/api/auth/admins?role=pending'), {
        headers: sessionHeaders(admin),
        cache: 'no-store',
      });
      const data = await res.json().catch(function () { return []; });
      if (!res.ok) throw new Error((data && data.error) || 'Could not load registrations');
      const rows = Array.isArray(data) ? data : (data.admins || []);
      setPending(rows.filter(function (row) {
        return String(row && row.role || '').toLowerCase() === 'pending';
      }));
    }

    useEffect(function () {
      var cancelled = false;
      (async function () {
        try { await load(); }
        catch (e) { if (!cancelled) setError(e && e.message ? e.message : 'Could not load registrations'); }
      })();
      return function () { cancelled = true; };
    }, [admin && admin.id]);

    async function approve(row) {
      if (!row || !row.id) return;
      setBusy(row.id);
      setError('');
      setMessage('');
      try {
        const res = await fetch(apiUrl('/api/auth/admins/' + encodeURIComponent(row.id)), {
          method: 'PATCH',
          headers: sessionHeaders(admin),
          body: JSON.stringify({ role: 'admin', fallback: row }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.message || data.error || 'Approve failed');
        setPending(function (prev) {
          return (prev || []).filter(function (item) { return item.id !== row.id; });
        });
        setMessage('Approved ' + (row.fullName || row.email) + ' — they can now customize their website.');
      } catch (e) {
        setError(e && e.message ? e.message : 'Approve failed');
      } finally {
        setBusy('');
      }
    }

    const needle = String(q || '').trim().toLowerCase();
    const rows = (pending || []).filter(function (row) {
      if (!needle) return true;
      const hay = [row.fullName, row.email, row.mentorName, row.eaName, row.id].join(' ').toLowerCase();
      return hay.indexOf(needle) >= 0;
    });

    return h('div', { className: 'cp-card' },
      h('h1', null, 'Approve mentors'),
      h('p', { className: 'cp-muted' },
        pending
          ? (pending.length + ' waiting for approval to customize websites.')
          : 'Loading registrations…'
      ),
      h('div', { className: 'cp-actions' },
        h('input', {
          className: 'cp-search',
          value: q,
          onChange: function (e) { setQ(e.target.value); },
          placeholder: 'Search pending mentor',
        }),
        h('button', {
          type: 'button',
          className: 'cp-btn cp-btn-ghost',
          onClick: function () {
            setError('');
            load().catch(function (e) { setError(e && e.message ? e.message : 'Refresh failed'); });
          },
        }, 'Refresh')
      ),
      message ? h('p', { className: 'cp-success' }, message) : null,
      error ? h('p', { className: 'cp-error' }, error) : null,
      !pending && !error ? h('p', { className: 'cp-muted' }, 'Loading…') : null,
      pending && !rows.length ? h('p', { className: 'cp-muted' }, 'No pending registrations.') : null,
      rows.length
        ? h('div', { className: 'cp-customer-list' },
            rows.map(function (row) {
              const name = row.fullName || row.mentorName || '—';
              const isBusy = busy === row.id;
              return h('div', { className: 'cp-customer-row', key: row.id || row.email },
                h('div', null,
                  h('strong', null, name),
                  h('div', { className: 'cp-muted' }, row.email || '—'),
                  row.eaName ? h('div', { className: 'cp-site-line' }, 'EA: ' + row.eaName) : null
                ),
                h('div', { className: 'cp-customer-meta' },
                  h('span', null, 'PENDING'),
                  h('button', {
                    type: 'button',
                    className: 'cp-btn cp-btn-primary cp-btn-tiny',
                    disabled: !!isBusy,
                    onClick: function () { approve(row); },
                  }, isBusy ? '…' : 'Approve')
                )
              );
            })
          )
        : null
    );
  }
  function Builder(props) {
    const admin = props.admin;
    const websiteState = useState(null);
    const draftState = useState({});
    const modeState = useState('home');
    const busyState = useState('');
    const messageState = useState('');
    const errorState = useState('');
    const website = websiteState[0], setWebsite = websiteState[1];
    const draft = draftState[0], setDraft = draftState[1];
    const mode = modeState[0], setMode = modeState[1];
    const busy = busyState[0], setBusy = busyState[1];
    const message = messageState[0], setMessage = messageState[1];
    const error = errorState[0], setError = errorState[1];
    const theme = themeOf(draft);
    function setField(key) {
      return function (value) {
        setDraft(function (prev) {
          const next = Object.assign({}, prev);
          next[key] = value;
          return next;
        });
      };
    }
    async function load() {
      const res = await fetch(apiUrl('/api/websites/me'), { headers: sessionHeaders(admin), cache: 'no-store' });
      const data = await res.json().catch(function () { return {}; });
      if (res.status === 401) { clearSession(); props.onLogout(); return; }
      if (data.website) { setWebsite(data.website); setDraft(data.website); }
      else { setWebsite(null); setDraft({}); }
    }
    useEffect(function () { if (admin && admin.id) load(); }, [admin && admin.id]);

    async function create() {
      setBusy('create'); setError('');
      try {
        const res = await fetch(apiUrl('/api/websites/me'), { method: 'POST', headers: sessionHeaders(admin), body: '{}' });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not create website');
        setWebsite(data.website); setDraft(data.website); setMode('edit');
      } catch (e) { setError(e && e.message ? e.message : 'Could not create website'); }
      finally { setBusy(''); }
    }
    async function save() {
      setBusy('save'); setError(''); setMessage('');
      try {
        const res = await fetch(apiUrl('/api/websites/me'), { method: 'PUT', headers: sessionHeaders(admin), body: JSON.stringify(draft) });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
        setWebsite(data.website); setDraft(data.website); setMessage('Changes saved.');
      } catch (e) { setError(e && e.message ? e.message : 'Save failed'); }
      finally { setBusy(''); }
    }
    async function publish() {
      setBusy('publish'); setError(''); setMessage('');
      try {
        const res = await fetch(apiUrl('/api/websites/me/publish'), { method: 'POST', headers: sessionHeaders(admin), body: JSON.stringify(draft) });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.missing ? 'Add robot name, both prices, and both durations.' : (data.error || 'Publish failed'));
        setWebsite(data.website); setDraft(data.website); setMode('home'); setMessage(data.message || 'Your website is live.');
      } catch (e) { setError(e && e.message ? e.message : 'Publish failed'); }
      finally { setBusy(''); }
    }
    async function unpublish() {
      setBusy('unpublish');
      try {
        const res = await fetch(apiUrl('/api/websites/me/unpublish'), { method: 'POST', headers: sessionHeaders(admin), body: '{}' });
        const data = await res.json().catch(function () { return {}; });
        if (data.website) { setWebsite(data.website); setDraft(data.website); }
      } finally { setBusy(''); }
    }
    async function disableOwn() {
      if (!website || !website.websiteId || !isSuperAdmin(admin)) return;
      setBusy('disable'); setError(''); setMessage('');
      try {
        const res = await fetch(apiUrl('/api/websites/' + encodeURIComponent(website.websiteId)), {
          method: 'PATCH',
          headers: sessionHeaders(admin),
          body: JSON.stringify({ action: 'disable' }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not disable website');
        setWebsite(data.website); setDraft(data.website); setMessage('Website disabled.');
      } catch (e) { setError(e && e.message ? e.message : 'Could not disable website'); }
      finally { setBusy(''); }
    }
    async function enableOwn() {
      if (!website || !website.websiteId || !isSuperAdmin(admin)) return;
      setBusy('enable'); setError(''); setMessage('');
      try {
        const res = await fetch(apiUrl('/api/websites/' + encodeURIComponent(website.websiteId)), {
          method: 'PATCH',
          headers: sessionHeaders(admin),
          body: JSON.stringify({ action: 'enable' }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not enable website');
        setWebsite(data.website); setDraft(data.website); setMessage('Website enabled.');
      } catch (e) { setError(e && e.message ? e.message : 'Could not enable website'); }
      finally { setBusy(''); }
    }
    async function upload(kind, file) {
      if (!file || !admin || !admin.id) return;
      if (!String(file.type || '').startsWith('image/')) { setError('Upload a JPG or PNG image.'); return; }
      const dataUrl = await new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('Could not read image')); };
        reader.readAsDataURL(file);
      });
      const key = 'web-' + kind + '-' + admin.id;
      const res = await fetch(apiUrl('/api/images/' + encodeURIComponent(key)), {
        method: 'PUT',
        headers: sessionHeaders(admin),
        body: JSON.stringify({ dataUrl: dataUrl }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { setError(data.error || 'Image upload failed'); return; }
      setDraft(function (prev) {
        const next = Object.assign({}, prev);
        next[kind === 'robot' ? 'robotImage' : 'mentorImage'] = data.url || ('/api/images/' + encodeURIComponent(key));
        return next;
      });
    }

    if (!website) {
      return h(Shell, { admin: admin, onLogout: props.onLogout },
        h('div', { style: { display: 'grid', gap: 16 } },
          isSuperAdmin(admin) ? h(ApprovalsPanel, { admin: admin }) : null,
          isSuperAdmin(admin) ? h(CustomersPanel, { admin: admin }) : null,
          isSuperAdmin(admin) ? h(WebsitesPanel, { admin: admin }) : null,
          h('div', { className: 'cp-card' },
            h('h1', null, 'Create your website'),
            h('p', { className: 'cp-muted' }, 'Build a public mentor website with your own fonts, layout, and colors — then publish.'),
            h('button', { type: 'button', className: 'cp-btn cp-btn-primary', disabled: !!busy, onClick: function () { create(); } }, busy ? 'Creating…' : 'Create website'),
            error ? h('p', { className: 'cp-error' }, error) : null
          )
        )
      );
    }

    if (mode === 'edit' || mode === 'preview') {
      return h(Shell, { admin: admin, onLogout: props.onLogout },
        h('div', { style: { display: 'grid', gap: 16 } },
          h('div', { className: 'cp-card' },
            h('h1', null, 'Customize website'),
            h('p', { className: 'cp-muted' }, 'Choose look & feel, fill in your content, then publish. Preview updates live.')
          ),
          h('div', { className: 'cp-split' },
            h('div', { className: 'cp-card' },
              h('h2', null, 'Look & feel'),
              h('div', null,
                h('label', null, 'Font'),
                h('div', { className: 'cp-style-row' }, FONT_OPTIONS.map(function (opt) {
                  return h('button', {
                    key: opt.id, type: 'button',
                    className: 'cp-chip' + (theme.font === opt.id ? ' is-on' : ''),
                    onClick: function () { setField('themeFont')(opt.id); },
                  }, opt.label);
                }))
              ),
              h('div', null,
                h('label', null, 'Layout'),
                h('div', { className: 'cp-style-row' }, LAYOUT_OPTIONS.map(function (opt) {
                  return h('button', {
                    key: opt.id, type: 'button',
                    className: 'cp-chip' + (theme.layout === opt.id ? ' is-on' : ''),
                    onClick: function () { setField('themeLayout')(opt.id); },
                  }, opt.label);
                }))
              ),
              h('div', null,
                h('label', null, 'Accent color'),
                h('div', { className: 'cp-style-row' }, ACCENT_OPTIONS.map(function (opt) {
                  return h('button', {
                    key: opt.id, type: 'button',
                    className: 'cp-swatch' + (theme.accent === opt.id ? ' is-on' : ''),
                    title: opt.label,
                    style: { background: opt.hex, color: opt.hex },
                    onClick: function () { setField('themeAccent')(opt.id); },
                    'aria-label': opt.label,
                  });
                }))
              ),
              h('h2', null, 'Website information'),
              h(Field, { label: 'Robot / EA Name', value: draft.robotName, onChange: setField('robotName') }),
              h(Field, { label: 'Headline', value: draft.headline, onChange: setField('headline') }),
              h(Field, { label: 'Short Description', value: draft.shortDescription, onChange: setField('shortDescription'), area: true, rows: 3 }),
              h(Field, { label: 'Long Description', value: draft.robotDescription, onChange: setField('robotDescription'), area: true, rows: 5 }),
              h('h2', null, 'Images'),
              draft.robotImage ? h('img', { src: draft.robotImage, alt: '', style: { width: 120, height: 120, objectFit: 'cover', borderRadius: 16 } }) : null,
              h('input', { type: 'file', accept: 'image/*', onChange: function (e) { upload('robot', e.target.files && e.target.files[0]); } }),
              h('h2', null, 'Pricing'),
              h(Field, { label: 'iPhone price', value: draft.iphonePrice, onChange: setField('iphonePrice'), placeholder: 'R600' }),
              h(Field, { label: 'iPhone duration', value: draft.iphoneDuration, onChange: setField('iphoneDuration'), placeholder: '30 Days' }),
              h(Field, { label: 'Android price', value: draft.androidPrice, onChange: setField('androidPrice'), placeholder: 'R500' }),
              h(Field, { label: 'Android duration', value: draft.androidDuration, onChange: setField('androidDuration'), placeholder: '30 Days' }),
              h('h2', null, 'Mentor'),
              h(Field, { label: 'Display name', value: draft.mentorName, onChange: setField('mentorName') }),
              h(Field, { label: 'Biography', value: draft.mentorBio, onChange: setField('mentorBio'), area: true }),
              draft.mentorImage ? h('img', { src: draft.mentorImage, alt: '', style: { width: 88, height: 88, borderRadius: '50%', objectFit: 'cover' } }) : null,
              h('input', { type: 'file', accept: 'image/*', onChange: function (e) { upload('mentor', e.target.files && e.target.files[0]); } }),
              h('h2', null, 'Contact'),
              h(Field, { label: 'WhatsApp Number', value: draft.whatsapp, onChange: setField('whatsapp') }),
              h(Field, { label: 'WhatsApp Link', value: draft.whatsappLink, onChange: setField('whatsappLink') }),
              h(Field, { label: 'Email', value: draft.email, onChange: setField('email') }),
              h(Field, { label: 'Telegram', value: draft.telegram, onChange: setField('telegram') }),
              h(Field, { label: 'Instagram', value: draft.instagram, onChange: setField('instagram') }),
              h(Field, { label: 'TikTok', value: draft.tiktok, onChange: setField('tiktok') })
            ),
            h('div', { className: 'cp-card' },
              h('h2', null, 'Live preview'),
              h(MiniPreview, { draft: draft })
            )
          ),
          h('div', { className: 'cp-actions' },
            h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', disabled: !!busy, onClick: function () { save(); } }, 'Save changes'),
            h('button', { type: 'button', className: 'cp-btn cp-btn-primary', disabled: !!busy, onClick: function () { publish(); } }, 'Publish website'),
            h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', onClick: function () { setMode('home'); } }, 'Back')
          ),
          message ? h('p', { className: 'cp-success' }, message) : null,
          error ? h('p', { className: 'cp-error' }, error) : null
        )
      );
    }

    const live = website.status === 'published';
    const disabled = website.status === 'disabled';
    const url = website.url || '';
    const superUser = isSuperAdmin(admin);
    return h(Shell, { admin: admin, onLogout: props.onLogout },
      h('div', { style: { display: 'grid', gap: 16 } },
        superUser ? h(ApprovalsPanel, { admin: admin }) : null,
        superUser ? h(CustomersPanel, { admin: admin }) : null,
        superUser ? h(WebsitesPanel, { admin: admin }) : null,
        h('div', { className: 'cp-card' },
          h('h1', null, 'Your website'),
          h('div', { className: 'cp-status' },
            h('span', { className: 'cp-dot ' + (live ? '' : (website.status === 'draft' ? 'draft' : 'down')) }),
            h('span', null, 'Status: ' + (live ? 'Published' : String(website.status || 'Draft').toUpperCase()))
          ),
          url
            ? h('p', null, 'Public link: ', h('strong', null, url.replace('https://', '')))
            : h('p', { className: 'cp-muted' }, 'Publish to get your public website link.'),
          message ? h('p', { className: 'cp-success' }, message) : null,
          error ? h('p', { className: 'cp-error' }, error) : null,
          h('div', { className: 'cp-actions' },
            url ? h('a', { className: 'cp-btn cp-btn-primary', href: website.publicPath || url, target: '_blank', rel: 'noreferrer' }, 'Open website') : null,
            h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', onClick: function () { setMode('edit'); } }, 'Customize'),
            live
              ? h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', disabled: !!busy, onClick: function () { unpublish(); } }, 'Unpublish')
              : (!disabled
                  ? h('button', { type: 'button', className: 'cp-btn cp-btn-primary', disabled: !!busy, onClick: function () { publish(); } }, 'Publish')
                  : null),
            superUser && !disabled
              ? h('button', { type: 'button', className: 'cp-btn cp-btn-ghost', disabled: !!busy, onClick: function () { disableOwn(); } }, busy === 'disable' ? '…' : 'Disable website')
              : null,
            superUser && disabled
              ? h('button', { type: 'button', className: 'cp-btn cp-btn-primary', disabled: !!busy, onClick: function () { enableOwn(); } }, busy === 'enable' ? '…' : 'Enable website')
              : null
          )
        )
      )
    );
  }
  function App() {
    const adminState = useState(null);
    const bootState = useState(true);
    const admin = adminState[0], setAdmin = adminState[1];
    const booting = bootState[0], setBooting = bootState[1];
    useEffect(function () {
      document.title = 'Lumoedge Cape Pulse — Customize Website';
      const sess = readSession();
      if (sess.adminId) setAdmin({ id: sess.adminId, role: sess.role || 'admin', email: sess.email || '' });
      setBooting(false);
    }, []);
    function logout() { clearSession(); setAdmin(null); }
    if (booting) return h(Shell, null, h('div', { className: 'cp-card' }, h('p', { className: 'cp-muted' }, 'Loading…')));
    if (!admin) return h(Login, { onReady: setAdmin });
    return h(Builder, { admin: admin, onLogout: logout });
  }

  const rootEl = document.getElementById('root');
  if (ReactDOM.createRoot) {
    const root = window.__CAPE_PULSE_ROOT || (window.__CAPE_PULSE_ROOT = ReactDOM.createRoot(rootEl));
    root.render(h(App));
  } else {
    ReactDOM.render(h(App), rootEl);
  }
})();
