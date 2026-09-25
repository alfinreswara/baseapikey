'use strict';

const config = window.__BASEAPIKEY_CONFIG__ || { gatewayUrl: 'http://localhost:3000' };
const state = {
  accessToken: sessionStorage.getItem('bak_access_token'),
  user: JSON.parse(sessionStorage.getItem('bak_user') || 'null'),
  organizations: [],
  activeOrganizationId: localStorage.getItem('bak_active_org'),
  view: 'overview',
  models: [],
  invitationToken: location.pathname.match(/^\/invitations\/([^/]+)$/)?.[1] || null,
};
localStorage.removeItem('bak_refresh_token');
const sessionChannel =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('baseapikey-session') : null;
let refreshPromise = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char],
  );
const money = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
const number = (value) =>
  new Intl.NumberFormat('en-US', {
    notation: Number(value) > 9999 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
const dateTime = (value) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  window.setTimeout(() => item.remove(), 4200);
}

async function api(path, options = {}, canRefresh = true) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type'])
    headers['Content-Type'] = 'application/json';
  const response = await fetch(`${config.gatewayUrl}${path}`, { ...options, headers });
  if (response.status === 401 && canRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) return api(path, options, false);
  }
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || body?.message || `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return body;
}

async function performRefresh(accessTokenAtStart) {
  if (state.accessToken && state.accessToken !== accessTokenAtStart) return true;
  try {
    const response = await fetch('/api/session/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) {
        clearSession();
        showAuth('login');
      }
      return false;
    }
    const payload = await response.json();
    const data = payload.data || payload;
    setTokens(data);
    return true;
  } catch {
    return false;
  }
}

function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const accessTokenAtStart = state.accessToken;
  const refresh = () => performRefresh(accessTokenAtStart);
  const locks = navigator.locks;
  const pending = locks?.request ? locks.request('baseapikey-session-refresh', refresh) : refresh();
  refreshPromise = pending.finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function setTokens(data, broadcast = true) {
  state.accessToken = data.accessToken;
  sessionStorage.setItem('bak_access_token', state.accessToken || '');
  if (data.user) {
    state.user = data.user;
    sessionStorage.setItem('bak_user', JSON.stringify(data.user));
  }
  if (broadcast) sessionChannel?.postMessage({ type: 'tokens', data });
}

function clearSession(broadcast = true) {
  state.accessToken = null;
  state.user = null;
  sessionStorage.removeItem('bak_access_token');
  sessionStorage.removeItem('bak_user');
  localStorage.removeItem('bak_refresh_token');
  localStorage.removeItem('bak_active_org');
  if (broadcast) sessionChannel?.postMessage({ type: 'logout' });
}

sessionChannel?.addEventListener('message', (event) => {
  if (event.data?.type === 'tokens' && event.data.data?.accessToken)
    setTokens(event.data.data, false);
  if (event.data?.type === 'logout') {
    clearSession(false);
    showAuth('login');
  }
});

function metric(label, value, note = '') {
  return `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-note">${escapeHtml(note)}</div></div>`;
}

function empty(title, copy) {
  return `<div class="empty-state"><b>${escapeHtml(title)}</b>${escapeHtml(copy)}</div>`;
}
function tag(value, kind = '') {
  return `<span class="tag ${kind}">${escapeHtml(value)}</span>`;
}

function table(columns, rows) {
  if (!rows.length) return empty('Nothing here yet', 'New data will appear here automatically.');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function showConsole() {
  if (!state.user) {
    try {
      const profile = await api('/api/v1/me');
      state.user = profile.data || profile;
      sessionStorage.setItem('bak_user', JSON.stringify(state.user));
    } catch {
      clearSession();
      showAuth('login');
      return;
    }
  }
  $('#auth-screen').classList.add('hidden');
  $('#console').classList.remove('hidden');
  $('#user-name').textContent = state.user?.fullName || state.user?.username || 'Account';
  $('#user-email').textContent = state.user?.email || '';
  $('#user-avatar').textContent = (state.user?.fullName ||
    state.user?.email ||
    'U')[0].toUpperCase();
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', state.user?.role !== 'ADMIN'));
  await Promise.allSettled([checkApi(), loadModels()]);
  if (state.invitationToken) {
    try {
      await api(
        `/api/v1/organization-invitations/${encodeURIComponent(state.invitationToken)}/accept`,
        { method: 'POST' },
      );
      history.replaceState({}, '', '/');
      state.invitationToken = null;
      toast('Organization invitation accepted');
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  await loadOrganizations();
  await navigate('overview');
}

function showAuth(view = 'login') {
  $('#console').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#login-form').classList.toggle('hidden', view !== 'login');
  $('#register-form').classList.toggle('hidden', view !== 'register');
}

async function checkApi() {
  const pill = $('#api-status');
  try {
    await api('/health/live', {}, false);
    pill.className = 'status-pill ok';
    pill.innerHTML = '<i></i>API operational';
  } catch {
    pill.className = 'status-pill bad';
    pill.innerHTML = '<i></i>API unavailable';
  }
}

async function loadOrganizations() {
  const payload = await api('/api/v1/me/organizations');
  state.organizations = payload.data || [];
  const currentOrganizationId = state.organizations.find((org) => org.isCurrent)?.id;
  if (currentOrganizationId) state.activeOrganizationId = currentOrganizationId;
  else if (
    !state.activeOrganizationId ||
    !state.organizations.some((org) => org.id === state.activeOrganizationId)
  )
    state.activeOrganizationId = state.organizations[0]?.id || null;
  localStorage.setItem('bak_active_org', state.activeOrganizationId || '');
  const select = $('#organization-select');
  select.innerHTML = state.organizations
    .map(
      (org) =>
        `<option value="${escapeHtml(org.id)}" ${org.id === state.activeOrganizationId ? 'selected' : ''}>${escapeHtml(org.name)}</option>`,
    )
    .join('');
  const active = activeOrganization();
  $('#org-avatar').textContent = (active?.name || 'O')[0].toUpperCase();
}

function activeOrganization() {
  return state.organizations.find((org) => org.id === state.activeOrganizationId);
}

async function switchOrganization(id) {
  await api(`/api/v1/me/organizations/${encodeURIComponent(id)}/switch`, { method: 'POST' });
  state.activeOrganizationId = id;
  localStorage.setItem('bak_active_org', id);
  const org = activeOrganization();
  $('#org-avatar').textContent = (org?.name || 'O')[0].toUpperCase();
  toast(`Switched to ${org?.name || 'organization'}`);
  await loadView(state.view);
}

async function loadModels() {
  const payload = await api('/v1/models', {}, false);
  state.models = payload.data || [];
  renderModels();
}

async function navigate(view) {
  state.view = view;
  $$('.view').forEach((el) => el.classList.remove('active-view'));
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $(`#view-${view}`)?.classList.add('active-view');
  const titles = {
    overview: ['OPERATIONS', 'Overview'],
    keys: ['CREDENTIALS', 'API keys'],
    usage: ['ANALYTICS', 'Usage'],
    models: ['CATALOG', 'Models'],
    team: ['ORGANIZATION', 'Team'],
    billing: ['FINANCE', 'Billing'],
    admin: ['PLATFORM', 'Admin'],
  };
  $('#page-kicker').textContent = titles[view]?.[0] || 'CONSOLE';
  $('#page-title').textContent = titles[view]?.[1] || view;
  $('.view-action').classList.toggle('hidden', !['overview', 'keys'].includes(view));
  await loadView(view);
}

async function loadView(view) {
  try {
    if (view === 'overview') await loadOverview();
    if (view === 'keys') await loadKeys();
    if (view === 'usage') await loadUsage();
    if (view === 'models') renderModels();
    if (view === 'team') await loadTeam();
    if (view === 'billing') await loadBilling();
    if (view === 'admin') await loadAdmin();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function range(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

async function loadOverview() {
  const [summary, history, timeseries, keys] = await Promise.all([
    api(`/api/v1/usage/summary?${range(30)}`),
    api(`/api/v1/usage/history?${range(30)}&limit=6`),
    api(`/api/v1/usage?${range(30)}&group_by=day`),
    api('/v1/api-keys'),
  ]);
  const totals = summary.totals || summary.data?.totals || {};
  $('#overview-metrics').innerHTML = [
    metric('REQUESTS', number(totals.requests), 'Last 30 days'),
    metric('TOKENS', number(totals.totalTokens), 'Input + output'),
    metric('ESTIMATED COST', money(totals.cost), 'Current organization'),
    metric(
      'ACTIVE KEYS',
      number((keys.data || []).filter((key) => key.status === 'ACTIVE').length),
      'Ready to use',
    ),
  ].join('');
  const points = timeseries.data || timeseries || [];
  const max = Math.max(1, ...points.map((point) => point.requests));
  $('#usage-chart').className = points.length ? 'bar-chart' : 'chart-empty';
  $('#usage-chart').innerHTML = points.length
    ? points
        .map(
          (point) =>
            `<div class="bar" style="height:${Math.max(4, (point.requests / max) * 100)}%" title="${escapeHtml(point.date)}: ${point.requests} requests"></div>`,
        )
        .join('')
    : 'Usage data will appear after your first request.';
  $('#recent-usage').innerHTML = usageTable(history.data || []);
}

function usageTable(items) {
  return table(
    [
      { label: 'TIME', render: (row) => dateTime(row.createdAt) },
      {
        label: 'MODEL',
        render: (row) =>
          `<b>${escapeHtml(row.model)}</b><br><span class="subtle">${escapeHtml(row.provider)}</span>`,
      },
      { label: 'TOKENS', render: (row) => number(row.totalTokens) },
      { label: 'COST', render: (row) => money(row.estimatedCost) },
      { label: 'LATENCY', render: (row) => `${number(row.latencyMs)} ms` },
      {
        label: 'STATUS',
        render: (row) =>
          tag(
            row.status || (row.statusCode < 400 ? 'SUCCESS' : 'FAILED'),
            row.statusCode < 400 ? 'good' : 'bad',
          ),
      },
    ],
    items,
  );
}

async function loadKeys() {
  const payload = await api('/v1/api-keys');
  const keys = payload.data || [];
  $('#keys-table').innerHTML = table(
    [
      { label: 'NAME', render: (row) => `<b>${escapeHtml(row.name)}</b>` },
      {
        label: 'PREFIX',
        render: (row) => `<span class="mono">${escapeHtml(row.keyPrefix)}••••••</span>`,
      },
      {
        label: 'PERMISSIONS',
        render: (row) => (row.permissions || []).map((item) => tag(item)).join(' '),
      },
      { label: 'LAST USED', render: (row) => dateTime(row.lastUsedAt) },
      {
        label: 'STATUS',
        render: (row) => tag(row.status, row.status === 'ACTIVE' ? 'good' : 'bad'),
      },
      {
        label: '',
        render: (row) =>
          row.status === 'ACTIVE'
            ? `<div class="table-actions"><button data-key-rotate="${row.id}">Rotate</button><button class="danger" data-key-revoke="${row.id}">Revoke</button></div>`
            : '',
      },
    ],
    keys,
  );
}

async function loadUsage() {
  const days = Number($('#usage-range').value || 30);
  const query = range(days);
  const [summary, history] = await Promise.all([
    api(`/api/v1/usage/summary?${query}`),
    api(`/api/v1/usage/history?${query}&limit=50`),
  ]);
  const totals = summary.totals || summary.data?.totals || {};
  $('#usage-metrics').innerHTML = [
    metric('REQUESTS', number(totals.requests), `${days}-day window`),
    metric(
      'SUCCESS RATE',
      totals.requests
        ? `${((totals.successfulRequests / totals.requests) * 100).toFixed(1)}%`
        : '—',
      `${number(totals.failedRequests)} failed`,
    ),
    metric('TOKENS', number(totals.totalTokens), `${number(totals.promptTokens)} input`),
    metric('COST', money(totals.cost), 'Estimated total'),
  ].join('');
  $('#usage-table').innerHTML = usageTable(history.data || []);
}

function renderModels() {
  const query = ($('#model-search')?.value || '').toLowerCase();
  const models = state.models.filter((model) =>
    `${model.id} ${model.display_name} ${model.owned_by}`.toLowerCase().includes(query),
  );
  $('#model-grid').innerHTML = models.length
    ? models
        .map(
          (model) =>
            `<article class="model-card"><div>${tag(model.category)} ${model.capabilities.streaming ? tag('STREAM') : ''}</div><h4>${escapeHtml(model.display_name)}</h4><p class="mono">${escapeHtml(model.id)}</p><p>${number(model.context_window)} context · ${escapeHtml(model.provider?.name || model.owned_by)}</p><div class="model-price"><span>Input ${money(model.pricing.input)}/1M</span><span>Output ${money(model.pricing.output)}/1M</span></div></article>`,
        )
        .join('')
    : empty('No models found', 'Try a different search.');
}

async function loadTeam() {
  if (!state.activeOrganizationId) return;
  const payload = await api(
    `/api/v1/organizations/${state.activeOrganizationId}/members?limit=100`,
  );
  $('#team-table').innerHTML = table(
    [
      {
        label: 'MEMBER',
        render: (row) =>
          `<b>${escapeHtml(row.fullName)}</b><br><span class="subtle">${escapeHtml(row.email)}</span>`,
      },
      { label: 'USERNAME', render: (row) => `@${escapeHtml(row.username)}` },
      { label: 'ROLE', render: (row) => tag(row.role, row.role === 'OWNER' ? 'good' : '') },
      {
        label: 'STATUS',
        render: (row) => tag(row.status, row.status === 'ACTIVE' ? 'good' : 'warn'),
      },
      { label: 'JOINED', render: (row) => dateTime(row.joinedAt) },
    ],
    payload.data || [],
  );
}

async function loadBilling() {
  if (!state.activeOrganizationId) return;
  const [account, transactions, invoices] = await Promise.all([
    api(`/api/v1/organizations/${state.activeOrganizationId}/billing`),
    api(`/api/v1/organizations/${state.activeOrganizationId}/billing/transactions?limit=50`),
    api(`/api/v1/organizations/${state.activeOrganizationId}/billing/invoices?limit=50`),
  ]);
  const data = account.data || {};
  $('#billing-metrics').innerHTML = [
    metric('CREDIT BALANCE', money((data.creditBalanceCents || 0) / 100), data.currency || 'USD'),
    metric('ACCOUNT STATUS', data.status || '—', 'Billing account'),
    metric('PLAN', activeOrganization()?.plan || 'FREE', 'Organization plan'),
    metric('INVOICES', number((invoices.data || []).length), 'Recent billing periods'),
  ].join('');
  $('#billing-table').innerHTML = table(
    [
      { label: 'DATE', render: (row) => dateTime(row.createdAt) },
      { label: 'TYPE', render: (row) => tag(row.type, row.type === 'PURCHASE' ? 'good' : '') },
      { label: 'DESCRIPTION', key: 'description' },
      { label: 'AMOUNT', render: (row) => money(row.amountCents / 100) },
      { label: 'BALANCE', render: (row) => money(row.balanceAfterCents / 100) },
    ],
    transactions.data || [],
  );
}

async function loadAdmin() {
  const [providers, audits, health, usage] = await Promise.all([
    api('/api/v1/admin/providers?limit=100'),
    api('/api/v1/admin/audit-logs?limit=12'),
    api('/api/v1/admin/health'),
    api('/api/v1/admin/usage'),
  ]);
  const providerRows = providers.data || [];
  $('#admin-metrics').innerHTML = [
    metric('USERS', number(usage.data?.users), 'Registered accounts'),
    metric('ORGANIZATIONS', number(usage.data?.organizations), 'Active tenants'),
    metric('REQUESTS', number(usage.data?.requests), 'All time'),
    metric('SYSTEM', health.data?.status || 'UNKNOWN', health.data?.database || 'Database'),
  ].join('');
  $('#provider-table').innerHTML = table(
    [
      {
        label: 'PROVIDER',
        render: (row) =>
          `<b>${escapeHtml(row.name)}</b><br><span class="mono">${escapeHtml(row.slug)}</span>`,
      },
      {
        label: 'HEALTH',
        render: (row) =>
          tag(
            row.healthStatus,
            row.healthStatus === 'HEALTHY' ? 'good' : row.healthStatus === 'DOWN' ? 'bad' : 'warn',
          ),
      },
      { label: 'PRIORITY', key: 'priority' },
      { label: 'CHECKED', render: (row) => dateTime(row.healthCheckedAt) },
    ],
    providerRows,
  );
  $('#audit-table').innerHTML = table(
    [
      { label: 'TIME', render: (row) => dateTime(row.createdAt) },
      { label: 'ACTION', render: (row) => `<span class="mono">${escapeHtml(row.action)}</span>` },
      {
        label: 'SEVERITY',
        render: (row) => tag(row.severity, row.severity === 'INFO' ? '' : 'warn'),
      },
    ],
    audits.data || [],
  );
}

function openDialog(kind) {
  const dialog = $('#app-dialog');
  const fields = $('#dialog-fields');
  const title = $('#dialog-title');
  const kicker = $('#dialog-kicker');
  $('#dialog-form').reset();
  $('#dialog-submit').classList.remove('hidden');
  dialog.dataset.kind = kind;
  kicker.textContent = 'CREATE';
  const forms = {
    'create-key': [
      'Create API key',
      '<label>Name<input name="name" required maxlength="80" placeholder="Production app" /></label><label>Expires at (optional)<input name="expiresAt" type="datetime-local" /></label>',
    ],
    'invite-member': [
      'Invite team member',
      '<label>Email<input name="email" type="email" required placeholder="teammate@company.com" /></label><label>Role<select name="role"><option>MEMBER</option><option>ADMIN</option></select></label>',
    ],
    'buy-credits': [
      'Buy credits',
      '<label>Amount (USD)<input name="amount" type="number" min="5" max="10000" step="1" value="25" required /></label>',
    ],
    'add-provider': [
      'Add provider',
      '<label>Name<input name="name" required /></label><label>Slug<input name="slug" required pattern="[a-z0-9-]+" /></label><label>Base URL<input name="baseUrl" type="url" required /></label><label>API key<input name="apiKey" type="password" required /></label>',
    ],
  };
  title.textContent = forms[kind]?.[0] || 'New item';
  fields.innerHTML = forms[kind]?.[1] || '';
  dialog.showModal();
}

async function submitDialog(event) {
  event.preventDefault();
  const dialog = $('#app-dialog');
  if (event.submitter?.value === 'cancel') {
    dialog.close();
    return;
  }
  const kind = dialog.dataset.kind;
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form.entries());
  try {
    if (kind === 'create-key') {
      const body = {
        name: values.name,
        ...(values.expiresAt ? { expiresAt: new Date(values.expiresAt).toISOString() } : {}),
      };
      const payload = await api('/v1/api-keys', { method: 'POST', body: JSON.stringify(body) });
      $('#dialog-fields').innerHTML =
        `<div class="secret-box"><b>Copy this key now.</b><p>It will not be shown again.</p><code>${escapeHtml(payload.data.apiKey)}</code><button type="button" class="secondary wide" data-copy-secret="${escapeHtml(payload.data.apiKey)}">Copy API key</button></div>`;
      $('#dialog-submit').classList.add('hidden');
      await loadKeys();
      return;
    }
    if (kind === 'invite-member')
      await api(`/api/v1/organizations/${state.activeOrganizationId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: values.email, role: values.role }),
      });
    if (kind === 'buy-credits') {
      const amountCents = Math.round(Number(values.amount) * 100);
      const payload = await api(
        `/api/v1/organizations/${state.activeOrganizationId}/billing/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({
            amountCents,
            successUrl: location.href,
            cancelUrl: location.href,
          }),
        },
      );
      if (payload.data?.checkoutUrl) location.href = payload.data.checkoutUrl;
    }
    if (kind === 'add-provider')
      await api('/api/v1/admin/providers', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          priority: 100,
          timeoutMs: 60000,
          maxRetries: 2,
          supportsStreaming: true,
          supportsImages: false,
          supportsEmbeddings: true,
          supportsAudio: false,
          supportsVision: false,
        }),
      });
    dialog.close();
    toast('Saved successfully');
    await loadView(state.view);
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.authView) showAuth(target.dataset.authView);
  if (target.dataset.view) navigate(target.dataset.view);
  if (target.dataset.viewLink) navigate(target.dataset.viewLink);
  if (target.dataset.action) openDialog(target.dataset.action);
  if (target.dataset.copySecret) {
    await navigator.clipboard.writeText(target.dataset.copySecret);
    toast('API key copied');
  }
  if (
    target.dataset.keyRotate &&
    confirm('Rotate this key? The current secret will stop working immediately.')
  ) {
    try {
      const payload = await api(`/v1/api-keys/${target.dataset.keyRotate}/rotate`, {
        method: 'POST',
      });
      openDialog('create-key');
      $('#dialog-title').textContent = 'Rotated API key';
      $('#dialog-fields').innerHTML =
        `<div class="secret-box"><b>Copy this key now.</b><p>It will not be shown again.</p><code>${escapeHtml(payload.data?.apiKey || payload.apiKey)}</code></div>`;
      $('#dialog-submit').classList.add('hidden');
      await loadKeys();
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  if (target.dataset.keyRevoke && confirm('Revoke this key permanently?')) {
    try {
      await api(`/v1/api-keys/${target.dataset.keyRevoke}/revoke`, { method: 'POST' });
      toast('API key revoked');
      await loadKeys();
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch('/api/session/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload?.error?.message || `Sign in failed (${response.status})`);
    setTokens(payload.data || payload);
    await showConsole();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api(
      '/v1/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      },
      false,
    );
    toast('Account created. Sign in to continue.');
    showAuth('login');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
$('#organization-select').addEventListener('change', (event) =>
  switchOrganization(event.target.value),
);
$('#usage-range').addEventListener('change', loadUsage);
$('#model-search').addEventListener('input', renderModels);
$('#refresh-button').addEventListener('click', () => loadView(state.view));
$('#dialog-form').addEventListener('submit', submitDialog);
$('#copy-snippet').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#quickstart-code').textContent);
  toast('Snippet copied');
});
$('#logout-button').addEventListener('click', async () => {
  try {
    await fetch('/api/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {},
    });
  } catch {
    /* Local logout must still complete when the API is unavailable. */
  }
  clearSession();
  showAuth('login');
});

if (state.accessToken) showConsole();
else refreshSession().then((ok) => (ok ? showConsole() : (clearSession(), showAuth())));
