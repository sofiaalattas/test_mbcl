const TOKEN_KEY = 'findash:token';
const EXPIRES_KEY = 'findash:expiresAt';
const TEMA_STORAGE_KEY = 'findash:tema';
const REFRESH_MS = 60000;

const fmtIDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

function rupiah(n) {
  return fmtIDR.format(n || 0);
}
function positifNegatif(n) {
  return n < 0 ? 'nilai-negatif' : 'nilai-positif';
}

// ---- Sinkronisasi tinggi header sticky ----
// app-bar & tab-nav sama-sama sticky bertumpuk. Tinggi keduanya TIDAK dihardcode
// di CSS (bisa berubah kalau nama perusahaan panjang, font beda, atau layar sempit
// bikin teks wrap) — kalau top offset di CSS tidak sesuai tinggi asli, elemen akan
// saling tumpuk/menutupi teks saat discroll. Diukur & disimpan sebagai CSS variable,
// dan dipantau ResizeObserver supaya selalu akurat walau kontennya berubah.
function syncStickyOffsets() {
  const appBar = document.querySelector('.app-bar');
  const tabNav = document.getElementById('tab-nav');
  if (!appBar || !tabNav) return;
  const root = document.documentElement;
  function update() {
    root.style.setProperty('--app-bar-h', `${appBar.offsetHeight}px`);
    root.style.setProperty('--tab-nav-h', `${tabNav.offsetHeight}px`);
  }
  update();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(update).observe(appBar);
    new ResizeObserver(update).observe(tabNav);
  } else {
    window.addEventListener('resize', update);
  }
}

// ---- Tema ----
const elTombolTema = document.getElementById('tombol-tema');
function temaAktif() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function terapkanTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  elTombolTema.setAttribute('aria-checked', tema === 'dark' ? 'true' : 'false');
}
terapkanTema(localStorage.getItem(TEMA_STORAGE_KEY) || temaAktif());
elTombolTema.addEventListener('click', () => {
  const t = temaAktif() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(TEMA_STORAGE_KEY, t);
  terapkanTema(t);
  redrawAllCharts();
});

// ---- Auth ----
const elLoginOverlay = document.getElementById('login-overlay');
const elApp = document.getElementById('app');
const elLoginPassword = document.getElementById('login-password');
const elLoginError = document.getElementById('login-error');
const elLoginSubmit = document.getElementById('login-submit');

function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
  if (!token || Date.now() > expiresAt) return null;
  return token;
}

function showLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
  elLoginOverlay.hidden = false;
  elApp.hidden = true;
}

function showApp() {
  elLoginOverlay.hidden = true;
  elApp.hidden = false;
  syncStickyOffsets();
  init();
}

async function doLogin() {
  elLoginError.hidden = true;
  elLoginSubmit.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: elLoginPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      elLoginError.textContent = data.error || 'Gagal login.';
      elLoginError.hidden = false;
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(EXPIRES_KEY, String(data.expiresAt));
    elLoginPassword.value = '';
    showApp();
  } catch (e) {
    elLoginError.textContent = 'Tidak bisa terhubung ke server.';
    elLoginError.hidden = false;
  } finally {
    elLoginSubmit.disabled = false;
  }
}
elLoginSubmit.addEventListener('click', doLogin);
elLoginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

document.getElementById('tombol-logout').addEventListener('click', showLogin);

async function api(pathAndQuery, opts = {}) {
  const token = getToken();
  if (!token) { showLogin(); throw new Error('no-session'); }
  const res = await fetch(pathAndQuery, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  return res;
}

// ---- State & filters (disimpan di URL supaya bisa dishare) ----
let currentMeta = null;
const charts = {};

function readStateFromURL() {
  const p = new URLSearchParams(location.search);
  return {
    tab: p.get('tab') || 'overview',
    preset: p.get('preset') || 'ALL',
    dateFrom: p.get('from') || '',
    dateTo: p.get('to') || '',
    branch: p.get('branch') || 'ALL',
    dept: p.get('dept') || 'ALL',
  };
}
function writeStateToURL(state) {
  const p = new URLSearchParams();
  p.set('tab', state.tab);
  if (state.preset && state.preset !== 'ALL') p.set('preset', state.preset);
  if (state.dateFrom) p.set('from', state.dateFrom);
  if (state.dateTo) p.set('to', state.dateTo);
  if (state.branch && state.branch !== 'ALL') p.set('branch', state.branch);
  if (state.dept && state.dept !== 'ALL') p.set('dept', state.dept);
  history.replaceState(null, '', `?${p.toString()}`);
}

let state = readStateFromURL();

function filterQuery() {
  const p = new URLSearchParams();
  if (state.dateFrom) p.set('dateFrom', state.dateFrom);
  if (state.dateTo) p.set('dateTo', state.dateTo);
  if (state.branch !== 'ALL') p.set('branch', state.branch);
  if (state.dept !== 'ALL') p.set('dept', state.dept);
  return p.toString();
}

// Hitung rentang tanggal dari preset ("Bulan Ini" dst). Acuan "hari ini" dipakai
// tanggal TERAKHIR di data GL (bukan jam device) — data GL biasanya historis,
// jadi "Bulan Ini" harus relatif terhadap data supaya tidak pernah kosong.
function computePresetRange(preset, meta) {
  if (!meta || !meta.dateRange) return { from: '', to: '' };
  const { min, max } = meta.dateRange;
  const clamp = (iso) => (iso < min ? min : iso > max ? max : iso);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const ref = new Date(`${max}T00:00:00.000Z`);
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  switch (preset) {
    case 'THIS_MONTH':
      return { from: clamp(fmt(new Date(Date.UTC(y, m, 1)))), to: clamp(fmt(new Date(Date.UTC(y, m + 1, 0)))) };
    case 'LAST_MONTH':
      return { from: clamp(fmt(new Date(Date.UTC(y, m - 1, 1)))), to: clamp(fmt(new Date(Date.UTC(y, m, 0)))) };
    case 'LAST_3_MONTHS':
      return { from: clamp(fmt(new Date(Date.UTC(y, m - 2, 1)))), to: clamp(fmt(new Date(Date.UTC(y, m + 1, 0)))) };
    case 'ALL':
    default:
      return { from: '', to: '' };
  }
}

// ---- Tabs ----
const elTabNav = document.getElementById('tab-nav');
elTabNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-item');
  if (!btn) return;
  setTab(btn.dataset.tab);
});

function setTab(tab) {
  state.tab = tab;
  writeStateToURL(state);
  Array.from(elTabNav.children).forEach((b) => b.classList.toggle('aktif', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((el) => (el.hidden = el.id !== `tab-${tab}`));
  document.getElementById('filter-bar').hidden = tab === 'upload';
  loadActiveTab();
}

// ---- Filters ----
const elFilterPreset = document.getElementById('filter-preset');
const elFilterPresetField = document.getElementById('filter-preset-field');
const elFilterDateFrom = document.getElementById('filter-date-from');
const elFilterDateTo = document.getElementById('filter-date-to');
const elFilterDateFromField = document.getElementById('filter-date-from-field');
const elFilterDateToField = document.getElementById('filter-date-to-field');
const elFilterBranch = document.getElementById('filter-branch');
const elFilterDept = document.getElementById('filter-dept');
const elFilterDeptField = document.getElementById('filter-dept-field');

function populateFilters(meta) {
  elFilterBranch.innerHTML = '<option value="ALL">Semua Cabang</option>' +
    (meta.branches || []).map((b) => `<option value="${b}">${b}</option>`).join('');
  if (meta.departments && meta.departments.length) {
    elFilterDept.innerHTML = '<option value="ALL">Semua Departemen</option>' +
      meta.departments.map((d) => `<option value="${d}">${d}</option>`).join('');
    elFilterDeptField.hidden = false;
  } else {
    elFilterDeptField.hidden = true;
  }

  // Kalender tanggal cuma masuk akal kalau GL punya kolom tanggal per baris.
  const punyaKalender = Boolean(meta.hasDatePerRow && meta.dateRange);
  elFilterPresetField.hidden = !punyaKalender;
  elFilterDateFromField.hidden = !punyaKalender;
  elFilterDateToField.hidden = !punyaKalender;
  if (punyaKalender) {
    elFilterDateFrom.min = meta.dateRange.min;
    elFilterDateFrom.max = meta.dateRange.max;
    elFilterDateTo.min = meta.dateRange.min;
    elFilterDateTo.max = meta.dateRange.max;
  }

  elFilterBranch.value = state.branch;
  elFilterDept.value = state.dept;
  elFilterPreset.value = state.preset;
  elFilterDateFrom.value = state.dateFrom;
  elFilterDateTo.value = state.dateTo;
}

elFilterPreset.addEventListener('change', () => {
  state.preset = elFilterPreset.value;
  if (state.preset !== 'CUSTOM') {
    const range = computePresetRange(state.preset, currentMeta);
    state.dateFrom = range.from;
    state.dateTo = range.to;
    elFilterDateFrom.value = state.dateFrom;
    elFilterDateTo.value = state.dateTo;
  }
  writeStateToURL(state);
  loadActiveTab();
});

elFilterDateFrom.addEventListener('change', () => {
  state.dateFrom = elFilterDateFrom.value;
  state.preset = 'CUSTOM';
  elFilterPreset.value = 'CUSTOM';
  elFilterDateTo.min = state.dateFrom || (currentMeta && currentMeta.dateRange ? currentMeta.dateRange.min : '');
  writeStateToURL(state);
  loadActiveTab();
});

elFilterDateTo.addEventListener('change', () => {
  state.dateTo = elFilterDateTo.value;
  state.preset = 'CUSTOM';
  elFilterPreset.value = 'CUSTOM';
  elFilterDateFrom.max = state.dateTo || (currentMeta && currentMeta.dateRange ? currentMeta.dateRange.max : '');
  writeStateToURL(state);
  loadActiveTab();
});

[[elFilterBranch, 'branch'], [elFilterDept, 'dept']].forEach(([el, key]) => {
  el.addEventListener('change', () => {
    state[key] = el.value;
    writeStateToURL(state);
    loadActiveTab();
  });
});

// ---- Chart helper ----
function chartColors() {
  const dark = temaAktif() === 'dark';
  return {
    text: dark ? '#eef0f3' : '#1c1c1c',
    grid: dark ? '#3a3d44' : '#e3e5e9',
    accent: '#2f6fed',
    accent2: '#27ae60',
    danger: '#e74c3c',
    palette: ['#2f6fed', '#27ae60', '#f39c12', '#e74c3c', '#8e44ad', '#16a085', '#d35400', '#2c3e50'],
  };
}

// Sengaja menahan (bukan melempar) error di sini: kalau Chart.js gagal dimuat
// (mis. CDN diblokir di jaringan user), laporan tetap harus menampilkan KPI
// card & tabel — hanya grafiknya yang kosong, bukan seluruh halaman rusak.
function makeChart(id, config) {
  try {
    const canvas = document.getElementById(id);
    if (charts[id]) charts[id].destroy();
    if (typeof Chart === 'undefined') throw new Error('Chart.js belum termuat');
    charts[id] = new Chart(canvas, config);
    return charts[id];
  } catch (err) {
    console.error(`Gagal render chart "${id}":`, err);
    return null;
  }
}

function redrawAllCharts() {
  loadActiveTab();
}

// ---- KPI card render ----
function renderKpiGrid(container, items) {
  container.innerHTML = items.map((it) => `
    <div class="kpi-card">
      <p class="kpi-label">${it.label}</p>
      <p class="kpi-value ${it.klass || ''}">${it.value}</p>
      ${it.sub ? `<p class="kpi-sub">${it.sub}</p>` : ''}
    </div>`).join('');
}

// ---- No data banner ----
function showNoData(show) {
  document.getElementById('no-data-banner').hidden = !show;
}

// ---- Overview ----
async function loadOverview() {
  const res = await api(`/api/reports/overview?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  const c = chartColors();

  renderKpiGrid(document.getElementById('overview-kpi'), [
    { label: 'Total Revenue', value: rupiah(data.kpi.revenue) },
    { label: 'Total Expense', value: rupiah(data.kpi.expense) },
    { label: 'Net Income', value: rupiah(data.kpi.netIncome), klass: positifNegatif(data.kpi.netIncome) },
    { label: 'Profit Margin', value: `${fmtNum.format(data.kpi.profitMargin)}%`, klass: positifNegatif(data.kpi.profitMargin) },
  ]);

  makeChart('chart-trend', {
    type: 'line',
    data: {
      labels: data.monthlyTrend.map((m) => m.period),
      datasets: [
        { label: 'Revenue', data: data.monthlyTrend.map((m) => m.revenue), borderColor: c.accent, backgroundColor: c.accent, tension: 0.3 },
        { label: 'Expense', data: data.monthlyTrend.map((m) => m.expense), borderColor: c.danger, backgroundColor: c.danger, tension: 0.3 },
      ],
    },
    options: baseChartOptions(c),
  });

  makeChart('chart-expense', {
    type: 'bar',
    data: {
      labels: data.expenseBreakdown.map((e) => e.category),
      datasets: [{ label: 'Expense', data: data.expenseBreakdown.map((e) => e.amount), backgroundColor: c.accent }],
    },
    options: { ...baseChartOptions(c), indexAxis: 'y' },
  });
}

function baseChartOptions(c) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: c.text } } },
    scales: {
      x: { ticks: { color: c.text }, grid: { color: c.grid } },
      y: { ticks: { color: c.text }, grid: { color: c.grid } },
    },
  };
}

// Pie/doughnut tidak punya sumbu x/y — jangan pakai baseChartOptions (yang set scales),
// karena Chart.js akan tetap menggambar garis skala kosong di sekelilingnya.
function pieChartOptions(c) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: c.text } } },
  };
}

// ---- P&L ----
async function loadPnL() {
  const res = await api(`/api/reports/pnl?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  const c = chartColors();

  renderKpiGrid(document.getElementById('pnl-kpi'), [
    { label: 'Revenue', value: rupiah(data.summary.revenue) },
    { label: 'COGS', value: rupiah(data.summary.cogs) },
    { label: 'Gross Profit', value: rupiah(data.summary.grossProfit), klass: positifNegatif(data.summary.grossProfit) },
    { label: 'Operating Expense', value: rupiah(data.summary.opex) },
    { label: 'Net Income', value: rupiah(data.summary.netIncome), klass: positifNegatif(data.summary.netIncome) },
    { label: 'Profit Margin', value: `${fmtNum.format(data.summary.profitMargin)}%` },
  ]);

  makeChart('chart-pnl-waterfall', {
    type: 'bar',
    data: {
      labels: ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'Net Income'],
      datasets: [{
        data: [data.summary.revenue, -data.summary.cogs, data.summary.grossProfit, -data.summary.opex, data.summary.netIncome],
        backgroundColor: [c.accent, c.danger, c.accent2, c.danger, c.accent2],
      }],
    },
    options: { ...baseChartOptions(c), plugins: { legend: { display: false } } },
  });

  const rows = [
    ...data.detail.revenue.map((d) => ['Revenue', d.key, d.value]),
    ...data.detail.cogs.map((d) => ['COGS', d.key, d.value]),
    ...data.detail.opex.map((d) => ['Operating Expense', d.key, d.value]),
  ];
  renderTable('pnl-table', rows);
}

function renderTable(id, rows) {
  const tbody = document.querySelector(`#${id} tbody`);
  tbody.innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="${positifNegatif(r[2])}">${rupiah(r[2])}</td></tr>`).join('') ||
    '<tr><td colspan="3" class="info-lampiran">Tidak ada data.</td></tr>';
}

// ---- Neraca ----
async function loadBalance() {
  const res = await api(`/api/reports/balance?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  const c = chartColors();

  renderKpiGrid(document.getElementById('balance-kpi'), [
    { label: 'Total Assets', value: rupiah(data.summary.totalAssets) },
    { label: 'Total Liabilities', value: rupiah(data.summary.totalLiabilities) },
    { label: 'Total Equity', value: rupiah(data.summary.totalEquity), sub: `Termasuk Laba Berjalan ${rupiah(data.equity.currentPeriodNetIncome)}` },
    { label: 'Current Ratio', value: data.ratios.currentRatio != null ? fmtNum.format(data.ratios.currentRatio) : '-' },
  ]);

  const elWarn = document.getElementById('balance-warning');
  if (!data.summary.balanced) {
    elWarn.hidden = false;
    elWarn.textContent = `⚠️ Neraca tidak seimbang. Selisih Assets vs (Liabilities+Equity): ${rupiah(data.summary.diff)}. Periksa klasifikasi CoA di file GL.`;
  } else {
    elWarn.hidden = true;
  }

  makeChart('chart-assets', {
    type: 'pie',
    data: { labels: ['Current Assets', 'Fixed Assets'], datasets: [{ data: [data.assets.current, data.assets.fixed], backgroundColor: [c.accent, c.accent2] }] },
    options: pieChartOptions(c),
  });
  makeChart('chart-liab-equity', {
    type: 'pie',
    data: {
      labels: ['Current Liab.', 'LT Liab.', 'Equity'],
      datasets: [{ data: [data.liabilities.current, data.liabilities.longterm, data.equity.total], backgroundColor: [c.danger, c.palette[4], c.accent2] }],
    },
    options: pieChartOptions(c),
  });

  renderTable('balance-assets-table', [
    ...data.assets.detail.current.map((d) => ['Current Assets', d.key, d.value]),
    ...data.assets.detail.fixed.map((d) => ['Fixed Assets', d.key, d.value]),
  ]);
  renderTable('balance-liab-table', [
    ...data.liabilities.detail.current.map((d) => ['Current Liabilities', d.key, d.value]),
    ...data.liabilities.detail.longterm.map((d) => ['LT Liabilities', d.key, d.value]),
    ...data.equity.detail.map((d) => ['Equity', d.key, d.value]),
  ]);
}

// ---- Cash Flow ----
async function loadCashflow() {
  const res = await api(`/api/reports/cashflow?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  const c = chartColors();

  document.getElementById('cashflow-note').textContent = 'ℹ️ ' + data.note;

  renderKpiGrid(document.getElementById('cashflow-kpi'), [
    { label: 'Operating Activities', value: rupiah(data.operating), klass: positifNegatif(data.operating) },
    { label: 'Investing Activities', value: rupiah(data.investing), klass: positifNegatif(data.investing) },
    { label: 'Financing Activities', value: rupiah(data.financing), klass: positifNegatif(data.financing) },
    { label: 'Net Change in Cash', value: rupiah(data.netChange), klass: positifNegatif(data.netChange) },
    { label: 'Beginning Cash (estimasi)', value: rupiah(data.beginningCash) },
    { label: 'Ending Cash', value: rupiah(data.endingCash) },
  ]);

  makeChart('chart-cashflow', {
    type: 'bar',
    data: {
      labels: ['Beginning Cash', 'Operating', 'Investing', 'Financing', 'Ending Cash'],
      datasets: [{
        data: [data.beginningCash, data.operating, data.investing, data.financing, data.endingCash],
        backgroundColor: [c.palette[7], c.accent, c.palette[2], c.palette[4], c.accent2],
      }],
    },
    options: { ...baseChartOptions(c), plugins: { legend: { display: false } } },
  });
}

// ---- Kinerja Cabang ----
async function loadBranch() {
  const res = await api(`/api/reports/branch?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  const c = chartColors();

  makeChart('chart-branch', {
    type: 'bar',
    data: {
      labels: data.branches.map((b) => b.branch),
      datasets: [{ label: 'Net Income', data: data.branches.map((b) => b.netIncome), backgroundColor: c.accent }],
    },
    options: {
      ...baseChartOptions(c),
      plugins: { legend: { display: false } },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const branch = data.branches[elements[0].index].branch;
        openBranchDrilldown(branch);
      },
    },
  });

  const tbody = document.querySelector('#branch-table tbody');
  tbody.innerHTML = data.branches.map((b) => `
    <tr class="baris-klik" data-branch="${b.branch}">
      <td>${b.branch}</td>
      <td>${rupiah(b.revenue)}</td>
      <td>${rupiah(b.expense)}</td>
      <td class="${positifNegatif(b.netIncome)}">${rupiah(b.netIncome)}</td>
      <td class="${positifNegatif(b.margin)}">${fmtNum.format(b.margin)}%</td>
    </tr>`).join('');
  tbody.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => openBranchDrilldown(tr.dataset.branch)));
}

// ---- Drill-down modal ----
const elDrillOverlay = document.getElementById('drilldown-overlay');
document.getElementById('drilldown-close').addEventListener('click', () => (elDrillOverlay.hidden = true));

async function openBranchDrilldown(branch) {
  const p = new URLSearchParams(filterQuery());
  p.set('branch', branch);
  const res = await api(`/api/reports/pnl?${p.toString()}`);
  if (!res.ok) return;
  const { data } = await res.json();

  document.getElementById('drilldown-title').textContent = `Detail Cabang: ${branch}`;
  document.getElementById('drilldown-breadcrumb').innerHTML =
    `<span>Kinerja Cabang</span> › <strong>${branch}</strong> (Revenue ${rupiah(data.summary.revenue)}, Net Income ${rupiah(data.summary.netIncome)})`;

  const rows = [
    ...data.detail.revenue.map((d) => ['Revenue: ' + d.key, d.value]),
    ...data.detail.cogs.map((d) => ['COGS: ' + d.key, d.value]),
    ...data.detail.opex.map((d) => ['OpEx: ' + d.key, d.value]),
  ];
  const tbody = document.querySelector('#drilldown-table tbody');
  tbody.innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td class="${positifNegatif(r[1])}">${rupiah(r[1])}</td></tr>`).join('') ||
    '<tr><td colspan="2" class="info-lampiran">Tidak ada data.</td></tr>';

  elDrillOverlay.hidden = false;
}

// ---- Upload GL ----
const elDropzone = document.getElementById('dropzone');
const elInputGlFile = document.getElementById('input-gl-file');
const elTombolPilihGl = document.getElementById('tombol-pilih-gl');
const elDropzoneFilename = document.getElementById('dropzone-filename');
const elTombolUploadSubmit = document.getElementById('tombol-upload-submit');
const elUploadMessage = document.getElementById('upload-message');
const elUploadProgress = document.getElementById('upload-progress');
let pendingGlFile = null;

elTombolPilihGl.addEventListener('click', () => elInputGlFile.click());
elInputGlFile.addEventListener('change', () => setPendingFile(elInputGlFile.files[0]));

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  elDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    elDropzone.classList.toggle('dropzone-aktif', evt === 'dragover');
  });
});
elDropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setPendingFile(file);
});

function setPendingFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) {
    elUploadMessage.textContent = 'File harus berformat .xlsx.';
    elUploadMessage.hidden = false;
    return;
  }
  pendingGlFile = file;
  elUploadMessage.hidden = true;
  elDropzoneFilename.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  elTombolUploadSubmit.disabled = false;
}

elTombolUploadSubmit.addEventListener('click', async () => {
  if (!pendingGlFile) return;
  elTombolUploadSubmit.disabled = true;
  elUploadMessage.hidden = true;
  elUploadProgress.hidden = false;

  const formData = new FormData();
  formData.append('file', pendingGlFile);
  const periodLabel = document.getElementById('input-period-label').value.trim();
  if (periodLabel) formData.append('periodLabel', periodLabel);

  try {
    const res = await api('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      elUploadMessage.textContent = data.error || 'Gagal memproses file.';
      elUploadMessage.hidden = false;
      return;
    }
    const metodePeringatan = data.meta.calculationMethod === 'balance-fallback'
      ? ' ⚠️ Kolom Debit/Kredit tidak terdeteksi, hasil pakai kolom Balance saja — cek detail di bawah.'
      : '';
    elUploadMessage.className = 'pesan-sukses';
    elUploadMessage.textContent = `✅ Berhasil! ${data.meta.rowCount} baris transaksi diproses (data lama sudah digantikan), periode: ${data.meta.periodLabel}.${metodePeringatan}`;
    elUploadMessage.hidden = false;
    pendingGlFile = null;
    elDropzoneFilename.textContent = '';
    elTombolUploadSubmit.disabled = true;
    await loadMeta();
    loadActiveTab();
  } catch (err) {
    elUploadMessage.className = 'pesan-error';
    elUploadMessage.textContent = 'Tidak bisa terhubung ke server.';
    elUploadMessage.hidden = false;
  } finally {
    elUploadProgress.hidden = true;
    elTombolUploadSubmit.disabled = !pendingGlFile;
  }
});

function waktuRelatif(iso) {
  if (!iso) return '-';
  const detik = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (detik < 60) return 'baru saja';
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

const KOLOM_LABEL = {
  date: 'Tanggal', coaNo: 'CoA No', coaDescription: 'Deskripsi Akun', branch: 'Cabang',
  department: 'Departemen', debit: 'Debit', credit: 'Kredit', balance: 'Balance',
};

function renderGlCurrentInfo(meta) {
  const el = document.getElementById('gl-current-info');
  if (!meta) {
    el.innerHTML = '<p class="info-lampiran">Belum ada data GL yang diunggah.</p>';
    return;
  }

  const kolomTerdeteksi = (meta.detectedColumns || []).map((k) => KOLOM_LABEL[k] || k).join(', ');
  const pakaiDebitKredit = meta.calculationMethod === 'debit-credit';
  const metodeBaris = pakaiDebitKredit
    ? `<p class="info-lampiran">✅ Dihitung dari kolom <strong>Debit &amp; Kredit</strong> (akurat, mengikuti normal balance tiap akun).</p>`
    : `<p class="pesan-error">⚠️ Kolom Debit/Kredit tidak terdeteksi — dihitung dari kolom <strong>Balance</strong> saja. Ini bisa TIDAK AKURAT kalau Balance adalah saldo kumulatif (bukan net per-baris). Periksa nama kolom di file Excel Anda (cek daftar kolom terdeteksi di bawah).</p>`;

  const unclassifiedWarning = meta.unclassifiedCoaCount
    ? `<p class="pesan-error">⚠️ ${meta.unclassifiedCoaCount} kode akun tidak dikenali polanya (bukan awalan 1-6), contoh: ${meta.unclassifiedCoaSample.join(', ')} — baris ini DIABAIKAN dari semua total laporan.</p>`
    : '';

  el.innerHTML = `
    <p><strong>File:</strong> ${meta.filename}</p>
    <p><strong>Periode:</strong> ${meta.periodLabel}</p>
    <p><strong>Jumlah baris ter-load:</strong> ${meta.rowCount}</p>
    <p><strong>Cabang terdeteksi:</strong> ${meta.branches.join(', ')}</p>
    <p><strong>Kolom terdeteksi:</strong> ${kolomTerdeteksi || '-'}</p>
    ${metodeBaris}
    ${unclassifiedWarning}
    <p><strong>Diunggah:</strong> ${waktuRelatif(meta.uploadedAt)}</p>
  `;
}

// ---- Load meta & bootstrap ----
async function loadMeta() {
  try {
    const res = await api('/api/gl/meta');
    if (res.status === 404) {
      currentMeta = null;
      showNoData(true);
      renderGlCurrentInfo(null);
      populateFilters({ periods: [], branches: [], departments: [] });
      return;
    }
    if (!res.ok) return;
    const { meta } = await res.json();
    currentMeta = meta;
    showNoData(false);
    renderGlCurrentInfo(meta);
    populateFilters(meta);
  } catch (e) { /* ditangani di api() */ }
}

async function loadActiveTab() {
  if (!currentMeta && state.tab !== 'upload') return;
  const loaders = { overview: loadOverview, pnl: loadPnL, balance: loadBalance, cashflow: loadCashflow, branch: loadBranch };
  const loader = loaders[state.tab];
  if (loader) {
    try {
      await loader();
    } catch (e) {
      if (e.message !== 'no-session' && e.message !== 'unauthorized') console.error(`Gagal memuat tab "${state.tab}":`, e);
    }
  }
}

async function init() {
  Array.from(elTabNav.children).forEach((b) => b.classList.toggle('aktif', b.dataset.tab === state.tab));
  document.querySelectorAll('.tab-panel').forEach((el) => (el.hidden = el.id !== `tab-${state.tab}`));
  document.getElementById('filter-bar').hidden = state.tab === 'upload';
  await loadMeta();
  await loadActiveTab();
}

if (getToken()) {
  showApp();
} else {
  showLogin();
}

setInterval(() => {
  if (getToken() && !elApp.hidden) loadActiveTab();
}, REFRESH_MS);
