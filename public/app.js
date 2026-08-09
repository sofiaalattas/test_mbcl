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
// Label akun tampil dari field terpisah coaNo/coaDescription (bukan string
// gabungan dari backend) — dipakai tabel UI maupun export Excel.
function akunLabel(d) {
  return d.coaNo ? `${d.coaNo} - ${d.coaDescription}` : d.coaDescription;
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

// Cache data laporan yang TERAKHIR SUKSES ditampilkan per tab — dipakai tombol
// Export supaya file yang di-generate PERSIS sama dengan yang sedang tampil di
// layar (bukan fetch ulang terpisah yang bisa saja beda kalau ada race
// condition), sesuai aturan wajib "export = state yang sama persis".
const lastReportData = { pnl: null, balance: null, cashflow: null, branch: null };

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
  // Filter bar SELALU tampil di semua tab (termasuk Upload GL) — tombol Export
  // ada di dalamnya dan butuh filter Periode/Cabang/Departemen tetap bisa
  // diatur di tab manapun, termasuk saat mengekspor data GL mentah.
  updateTombolExportLabel(tab);
  loadActiveTab();
}

const EXPORT_LABEL_PER_TAB = {
  overview: null, // tab Overview tidak punya export tersendiri (sudah tercakup di tab lain)
  pnl: 'Export Laba Rugi ke Excel',
  balance: 'Export Neraca ke Excel',
  cashflow: 'Export Cash Flow ke Excel',
  branch: 'Export Kinerja Cabang ke Excel',
  upload: 'Export Data GL ke Excel',
};

function updateTombolExportLabel(tab) {
  const label = EXPORT_LABEL_PER_TAB[tab];
  elTombolExportTab.title = label || 'Pilih tab laporan untuk export';
  elTombolExportTab.disabled = !currentMeta || !label;
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
const elTombolExportTab = document.getElementById('tombol-export-tab');

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

// Klik di MANA SAJA pada kotak tanggal (bukan cuma ikon kalender kecil di pojok)
// langsung membuka date picker native browser. showPicker() baru didukung browser
// modern (Chrome/Edge 99+) — browser lain otomatis fallback ke perilaku klik biasa
// (fokus + buka picker lewat ikon), tidak error.
function bukaDatePickerSaatKlik(input) {
  input.addEventListener('click', () => {
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); } catch (err) { /* browser menolak (mis. dipanggil terlalu cepat) -> abaikan, fallback native */ }
    }
  });
}
bukaDatePickerSaatKlik(elFilterDateFrom);
bukaDatePickerSaatKlik(elFilterDateTo);

[[elFilterBranch, 'branch'], [elFilterDept, 'dept']].forEach(([el, key]) => {
  el.addEventListener('change', () => {
    state[key] = el.value;
    writeStateToURL(state);
    loadActiveTab();
  });
});

// ---- Chart helper ----
// Baca warna langsung dari CSS custom property (satu sumber kebenaran dengan
// style.css, otomatis ikut light/dark tanpa duplikasi daftar warna di JS).
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartColors() {
  const dark = temaAktif() === 'dark';
  return {
    text: cssVar('--text', dark ? '#f3f4f6' : '#111827'),
    textMuted: cssVar('--text-muted', dark ? '#9aa1ac' : '#5b6472'),
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(17,24,39,0.06)',
    accent: cssVar('--accent', '#4f46e5'),
    positive: cssVar('--positive-fill', '#16a34a'),
    negative: cssVar('--negative-fill', '#dc2626'),
    neutralA: cssVar('--neutral-a', '#4f46e5'),
    neutralB: cssVar('--neutral-b', '#93c5fd'),
    neutralC: cssVar('--neutral-c', '#9ca3af'),
  };
}

// Format ringkas untuk label sumbu chart ("Rp 2,9 M" bukan "Rp 2.978.031.876") —
// presisi penuh tetap ada di tooltip lewat rupiah().
function compactRupiah(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fmt1 = (v) => {
    const s = v.toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s.replace('.', ','));
  };
  if (abs >= 1e12) return `${sign}Rp ${fmt1(abs / 1e12)} T`;
  if (abs >= 1e9) return `${sign}Rp ${fmt1(abs / 1e9)} M`;
  if (abs >= 1e6) return `${sign}Rp ${fmt1(abs / 1e6)} Jt`;
  if (abs >= 1e3) return `${sign}Rp ${Math.round(abs / 1e3)} Rb`;
  return rupiah(n);
}

function moneyTooltipPlugin() {
  return {
    callbacks: {
      label: (ctx) => {
        const label = ctx.dataset.label && ctx.chart.data.datasets.length > 1 ? ctx.dataset.label + ': ' : '';
        const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
        return label + rupiah(val);
      },
    },
  };
}

function pieMoneyTooltipPlugin() {
  return { callbacks: { label: (ctx) => `${ctx.label}: ${rupiah(ctx.parsed)}` } };
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
        { label: 'Revenue', data: data.monthlyTrend.map((m) => m.revenue), borderColor: c.positive, backgroundColor: c.positive, tension: 0.3, pointRadius: 3 },
        { label: 'Expense', data: data.monthlyTrend.map((m) => m.expense), borderColor: c.negative, backgroundColor: c.negative, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: baseChartOptions(c, 'y'),
  });

  makeChart('chart-expense', {
    type: 'bar',
    data: {
      labels: data.expenseBreakdown.map((e) => e.category),
      datasets: [{ label: 'Expense', data: data.expenseBreakdown.map((e) => e.amount), backgroundColor: c.accent, borderRadius: 4 }],
    },
    options: { ...baseChartOptions(c, 'x'), indexAxis: 'y', plugins: { ...baseChartOptions(c, 'x').plugins, legend: { display: false } } },
  });
}

// valueAxis: 'y' (bar/line vertikal, default) atau 'x' (bar horizontal indexAxis:'y') —
// sumbu itu yang diberi format Rupiah ringkas; sumbu satunya (kategori/label) polos.
function baseChartOptions(c, valueAxis = 'y') {
  const moneyTick = { color: c.textMuted, font: { size: 11 }, callback: (v) => compactRupiah(v) };
  const categoryTick = { color: c.textMuted, font: { size: 11 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: c.text, boxWidth: 12, font: { size: 12 } } },
      tooltip: moneyTooltipPlugin(),
    },
    scales: {
      x: { ticks: valueAxis === 'x' ? moneyTick : categoryTick, grid: { color: valueAxis === 'x' ? c.grid : 'transparent' } },
      y: { ticks: valueAxis === 'y' ? moneyTick : categoryTick, grid: { color: valueAxis === 'y' ? c.grid : 'transparent' } },
    },
  };
}

// Pie/doughnut tidak punya sumbu x/y — jangan pakai baseChartOptions (yang set scales),
// karena Chart.js akan tetap menggambar garis skala kosong di sekelilingnya.
function pieChartOptions(c) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: c.text, boxWidth: 12, font: { size: 12 } } },
      tooltip: pieMoneyTooltipPlugin(),
    },
  };
}

// ---- P&L ----
async function loadPnL() {
  const res = await api(`/api/reports/pnl?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  lastReportData.pnl = data;
  const c = chartColors();

  renderKpiGrid(document.getElementById('pnl-kpi'), [
    { label: 'Revenue', value: rupiah(data.summary.revenue) },
    { label: 'COGS', value: rupiah(data.summary.cogs) },
    { label: 'Gross Profit', value: rupiah(data.summary.grossProfit), klass: positifNegatif(data.summary.grossProfit) },
    { label: 'Operating Expense', value: rupiah(data.summary.opex) },
    { label: 'Net Income', value: rupiah(data.summary.netIncome), klass: positifNegatif(data.summary.netIncome) },
    { label: 'Profit Margin', value: `${fmtNum.format(data.summary.profitMargin)}%` },
  ]);

  // Revenue selalu masuk (hijau), COGS/OpEx selalu mengurangi (merah) secara visual
  // waterfall; Gross Profit & Net Income warnanya mengikuti tanda aktualnya sendiri
  // (bisa merah kalau ternyata rugi) — bukan di-hardcode hijau.
  makeChart('chart-pnl-waterfall', {
    type: 'bar',
    data: {
      labels: ['Revenue', 'COGS', 'Gross Profit', 'OpEx', 'Net Income'],
      datasets: [{
        data: [data.summary.revenue, -data.summary.cogs, data.summary.grossProfit, -data.summary.opex, data.summary.netIncome],
        backgroundColor: [
          c.positive,
          c.negative,
          positifNegatif(data.summary.grossProfit) === 'nilai-negatif' ? c.negative : c.positive,
          c.negative,
          positifNegatif(data.summary.netIncome) === 'nilai-negatif' ? c.negative : c.positive,
        ],
        borderRadius: 4,
      }],
    },
    options: { ...baseChartOptions(c, 'y'), plugins: { ...baseChartOptions(c, 'y').plugins, legend: { display: false } } },
  });

  const rows = [
    ...data.detail.revenue.map((d) => ['Revenue', akunLabel(d), d.value]),
    ...data.detail.cogs.map((d) => ['COGS', akunLabel(d), d.value]),
    ...data.detail.opex.map((d) => ['Operating Expense', akunLabel(d), d.value]),
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
  lastReportData.balance = data;
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
    let html = `⚠️ Neraca tidak seimbang. Selisih Assets vs (Liabilities+Equity): <strong>${rupiah(data.summary.diff)}</strong>.`;
    if (data.unclassified.count > 0) {
      // Diagnosa langsung: akun mana yang tidak masuk kategori manapun (kode CoA
      // di luar 1-6xxxx) dan karena itu nilainya hilang dari semua total di atas.
      html += ` Ditemukan <strong>${data.unclassified.count} kode akun</strong> yang tidak dikenali polanya (bukan awalan 1-6),
        total nilai ${rupiah(data.unclassified.totalValue)} — baris ini <u>dikecualikan</u> dari semua perhitungan neraca:
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>CoA No</th><th>Deskripsi</th><th>Nominal</th></tr></thead><tbody>
          ${data.unclassified.accounts.map((a) => `<tr><td>${a.coaNo || '(kosong)'}</td><td>${a.coaDescription || '-'}</td><td class="${positifNegatif(a.value)}">${rupiah(a.value)}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="margin:8px 0 0 0">Perbaiki kode akun ini di file GL (harus diawali digit 1-6) lalu unggah ulang.</p>`;
    } else {
      html += ' Tidak ada kode akun tak dikenali — kemungkinan selisih dari kesalahan pencatatan di sumber data GL. Periksa klasifikasi CoA di file GL.';
    }
    elWarn.innerHTML = html;
  } else {
    elWarn.hidden = true;
  }

  // Komposisi aset/liabilitas+ekuitas adalah kategori NETRAL (bukan positif/negatif),
  // jadi sengaja pakai gradasi netral (aksen + biru muda + abu), bukan merah/ungu/oranye.
  makeChart('chart-assets', {
    type: 'pie',
    data: { labels: ['Current Assets', 'Fixed Assets'], datasets: [{ data: [data.assets.current, data.assets.fixed], backgroundColor: [c.neutralA, c.neutralB] }] },
    options: pieChartOptions(c),
  });
  makeChart('chart-liab-equity', {
    type: 'pie',
    data: {
      labels: ['Current Liab.', 'LT Liab.', 'Equity'],
      datasets: [{ data: [data.liabilities.current, data.liabilities.longterm, data.equity.total], backgroundColor: [c.neutralA, c.neutralB, c.neutralC] }],
    },
    options: pieChartOptions(c),
  });

  renderTable('balance-assets-table', [
    ...data.assets.detail.current.map((d) => ['Current Assets', akunLabel(d), d.value]),
    ...data.assets.detail.fixed.map((d) => ['Fixed Assets', akunLabel(d), d.value]),
  ]);
  renderTable('balance-liab-table', [
    ...data.liabilities.detail.current.map((d) => ['Current Liabilities', akunLabel(d), d.value]),
    ...data.liabilities.detail.longterm.map((d) => ['LT Liabilities', akunLabel(d), d.value]),
    ...data.equity.detail.map((d) => ['Equity', akunLabel(d), d.value]),
  ]);
}

// ---- Cash Flow ----
async function loadCashflow() {
  const res = await api(`/api/reports/cashflow?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  lastReportData.cashflow = data;
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

  // Saldo awal/akhir kas = netral (bukan arus, cuma titik referensi). Operating/
  // Investing/Financing masing-masing bisa positif (arus masuk) atau negatif (arus
  // keluar) secara riil, jadi warnanya dinamis ikut tanda aktual, bukan di-hardcode.
  const cfWarna = (v) => (positifNegatif(v) === 'nilai-negatif' ? c.negative : c.positive);
  makeChart('chart-cashflow', {
    type: 'bar',
    data: {
      labels: ['Beginning Cash', 'Operating', 'Investing', 'Financing', 'Ending Cash'],
      datasets: [{
        data: [data.beginningCash, data.operating, data.investing, data.financing, data.endingCash],
        backgroundColor: [c.neutralC, cfWarna(data.operating), cfWarna(data.investing), cfWarna(data.financing), c.neutralC],
        borderRadius: 4,
      }],
    },
    options: { ...baseChartOptions(c, 'y'), plugins: { ...baseChartOptions(c, 'y').plugins, legend: { display: false } } },
  });
}

// ---- Kinerja Cabang ----
async function loadBranch() {
  const res = await api(`/api/reports/branch?${filterQuery()}`);
  if (!res.ok) return;
  const { data } = await res.json();
  lastReportData.branch = data;
  const c = chartColors();

  makeChart('chart-branch', {
    type: 'bar',
    data: {
      labels: data.branches.map((b) => b.branch),
      datasets: [{
        label: 'Net Income',
        data: data.branches.map((b) => b.netIncome),
        backgroundColor: data.branches.map((b) => (positifNegatif(b.netIncome) === 'nilai-negatif' ? c.negative : c.positive)),
        borderRadius: 4,
      }],
    },
    options: {
      ...baseChartOptions(c, 'y'),
      plugins: { ...baseChartOptions(c, 'y').plugins, legend: { display: false } },
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
    ...data.detail.revenue.map((d) => ['Revenue: ' + akunLabel(d), d.value]),
    ...data.detail.cogs.map((d) => ['COGS: ' + akunLabel(d), d.value]),
    ...data.detail.opex.map((d) => ['OpEx: ' + akunLabel(d), d.value]),
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

// ============================================================
// EXPORT EXCEL PER TAB (client-side, exceljs)
// Prinsip wajib: data yang di-export HARUS state yang sama persis dengan yang
// sedang tampil di layar (lastReportData + state filter saat ini) — bukan
// fetch/hitung ulang terpisah yang berisiko tidak sinkron.
// ============================================================

const XLS_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }; // abu-abu muda
const XLS_CURRENCY_FMT = '"Rp" #,##0;[Red]-"Rp" #,##0';
const XLS_PERCENT_FMT = '0.0"%"';
const XLS_DATE_FMT = 'dd-mm-yyyy';
const XLS_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

// Label periode aktif untuk header file & nama file — mengikuti filter kalender
// (Dari/Sampai Tanggal) kalau di-set, atau rentang penuh data (YTD) kalau tidak.
function labelPeriodeAktif() {
  if (state.dateFrom && state.dateTo) return `${state.dateFrom} s/d ${state.dateTo}`;
  if (state.dateFrom) return `Sejak ${state.dateFrom}`;
  if (state.dateTo) return `Sampai ${state.dateTo}`;
  if (currentMeta && currentMeta.dateRange) return `${currentMeta.dateRange.min} s/d ${currentMeta.dateRange.max} (YTD)`;
  return (currentMeta && currentMeta.periodLabel) || 'Semua (YTD)';
}

function sanitizeFilenamePart(s) {
  return String(s || '').replace(/[^a-zA-Z0-9-]+/g, '');
}

// Format: [NamaTab]_[NamaCabang]_[dariTanggal]_[sampaiTanggal atau label]_[YYYYMMDD].xlsx
function buildExportFilename(tabLabel) {
  const cabang = state.branch === 'ALL' ? 'SemuaCabang' : sanitizeFilenamePart(state.branch);
  let periode;
  if (state.dateFrom && state.dateTo) {
    periode = `${state.dateFrom}_${state.dateTo}`;
  } else if (currentMeta && currentMeta.dateRange) {
    periode = `${currentMeta.dateRange.min}_${currentMeta.dateRange.max}`;
  } else {
    periode = 'YTD';
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${tabLabel}_${cabang}_${periode}_${stamp}.xlsx`;
}

// Beberapa baris header di puncak sheet: identitas laporan + ringkasan filter
// yang dipakai — bukti bahwa isi file = kondisi filter saat tombol Export diklik.
function addExportHeader(sheet, judulLaporan) {
  sheet.getCell('A1').value = 'PT Manufaktur Indonesia Sejahtera';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = judulLaporan;
  sheet.getCell('A2').font = { bold: true, size: 12, color: { argb: 'FF4F46E5' } };
  const info = [
    `Periode: ${labelPeriodeAktif()}`,
    `Cabang: ${state.branch === 'ALL' ? 'Semua Cabang' : state.branch}`,
    `Departemen: ${state.dept === 'ALL' ? 'Semua Departemen' : state.dept}`,
    `Tanggal Export: ${new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}`,
  ];
  info.forEach((text, i) => {
    const cell = sheet.getCell(`A${3 + i}`);
    cell.value = text;
    cell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  });
  return 3 + info.length + 1; // baris kosong pemisah sebelum tabel
}

function styleXlsTableHeader(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = XLS_HEADER_FILL;
    cell.border = XLS_THIN_BORDER;
  });
}

// headers: [{ label, key?, width?, fmt?: 'currency'|'percent'|'date' }]
// rows: array of plain objects atau array — pakai accessor `get(row, colDef)`
function addExportTable(sheet, startRow, columns, rows) {
  const headerRow = sheet.getRow(startRow);
  columns.forEach((col, i) => (headerRow.getCell(i + 1).value = col.label));
  styleXlsTableHeader(headerRow);

  if (rows.length === 0) {
    const emptyRow = sheet.getRow(startRow + 1);
    emptyRow.getCell(1).value = 'Tidak ada data untuk filter yang dipilih.';
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
    sheet.mergeCells(startRow + 1, 1, startRow + 1, columns.length);
    return startRow + 2;
  }

  rows.forEach((rowData, idx) => {
    const row = sheet.getRow(startRow + 1 + idx);
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = typeof col.value === 'function' ? col.value(rowData) : rowData[col.key];
      cell.border = XLS_THIN_BORDER;
      if (col.fmt === 'currency') cell.numFmt = XLS_CURRENCY_FMT;
      if (col.fmt === 'percent') cell.numFmt = XLS_PERCENT_FMT;
      if (col.fmt === 'date') cell.numFmt = XLS_DATE_FMT;
    });
  });

  // Auto-width sederhana berdasarkan konten terpanjang per kolom.
  columns.forEach((col, i) => {
    let maxLen = String(col.label).length;
    rows.forEach((rowData) => {
      const v = typeof col.value === 'function' ? col.value(rowData) : rowData[col.key];
      const len = v == null ? 0 : String(v instanceof Date ? v.toLocaleDateString('id-ID') : v).length;
      if (len > maxLen) maxLen = len;
    });
    sheet.getColumn(i + 1).width = Math.min(Math.max(maxLen + 3, 12), 45);
  });

  return startRow + 1 + rows.length;
}

function addExportKpiBlock(sheet, startRow, pairs) {
  let r = startRow;
  for (const [label, value, fmt] of pairs) {
    const labelCell = sheet.getCell(`A${r}`);
    labelCell.value = label;
    labelCell.font = { bold: true };
    const valCell = sheet.getCell(`B${r}`);
    valCell.value = value;
    if (fmt === 'currency') valCell.numFmt = XLS_CURRENCY_FMT;
    if (fmt === 'percent') valCell.numFmt = XLS_PERCENT_FMT;
    r++;
  }
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 22;
  return r;
}

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Builder per tab ----

function exportPnLWorkbook() {
  const data = lastReportData.pnl;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();

  const ringkasan = workbook.addWorksheet('Ringkasan');
  let r = addExportHeader(ringkasan, 'Laporan Laba Rugi (P&L)');
  addExportKpiBlock(ringkasan, r, [
    ['Revenue', data.summary.revenue, 'currency'],
    ['COGS', data.summary.cogs, 'currency'],
    ['Gross Profit', data.summary.grossProfit, 'currency'],
    ['Operating Expense', data.summary.opex, 'currency'],
    ['Net Income', data.summary.netIncome, 'currency'],
    ['Profit Margin (%)', data.summary.profitMargin, 'percent'],
  ]);

  const rincian = workbook.addWorksheet('Rincian Akun');
  r = addExportHeader(rincian, 'Rincian Akun — Laba Rugi');
  const detailRows = [
    ...data.detail.revenue.map((d) => ({ kategori: 'Revenue', ...d })),
    ...data.detail.cogs.map((d) => ({ kategori: 'COGS', ...d })),
    ...data.detail.opex.map((d) => ({ kategori: 'Operating Expense', ...d })),
  ];
  addExportTable(rincian, r, [
    { label: 'Kategori', key: 'kategori' },
    { label: 'Kode Akun', key: 'coaNo' },
    { label: 'Nama Akun', key: 'coaDescription' },
    { label: 'Nominal', key: 'value', fmt: 'currency' },
  ], detailRows);

  const alur = workbook.addWorksheet('Alur Laba Rugi');
  r = addExportHeader(alur, 'Alur Laba Rugi');
  addExportTable(alur, r, [
    { label: 'Tahap', key: 'tahap' },
    { label: 'Nominal', key: 'nominal', fmt: 'currency' },
  ], [
    { tahap: 'Revenue', nominal: data.summary.revenue },
    { tahap: 'COGS', nominal: -data.summary.cogs },
    { tahap: 'Gross Profit', nominal: data.summary.grossProfit },
    { tahap: 'Operating Expense', nominal: -data.summary.opex },
    { tahap: 'Net Income', nominal: data.summary.netIncome },
  ]);

  return { workbook, filename: buildExportFilename('LabaRugi') };
}

function exportBalanceWorkbook() {
  const data = lastReportData.balance;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Neraca');
  let r = addExportHeader(sheet, 'Neraca (Balance Sheet)');

  sheet.getCell(`A${r}`).value = 'ASET';
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  r = addExportTable(sheet, r, [
    { label: 'Kategori', key: 'kategori' },
    { label: 'Kode Akun', key: 'coaNo' },
    { label: 'Nama Akun', key: 'coaDescription' },
    { label: 'Nominal', key: 'value', fmt: 'currency' },
  ], [
    ...data.assets.detail.current.map((d) => ({ kategori: 'Current Assets', ...d })),
    ...data.assets.detail.fixed.map((d) => ({ kategori: 'Fixed Assets', ...d })),
  ]);
  sheet.getCell(`A${r}`).value = 'Total Aset';
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).value = data.summary.totalAssets;
  sheet.getCell(`D${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).numFmt = XLS_CURRENCY_FMT;
  r += 2;

  sheet.getCell(`A${r}`).value = 'LIABILITAS';
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  r = addExportTable(sheet, r, [
    { label: 'Kategori', key: 'kategori' },
    { label: 'Kode Akun', key: 'coaNo' },
    { label: 'Nama Akun', key: 'coaDescription' },
    { label: 'Nominal', key: 'value', fmt: 'currency' },
  ], [
    ...data.liabilities.detail.current.map((d) => ({ kategori: 'Current Liabilities', ...d })),
    ...data.liabilities.detail.longterm.map((d) => ({ kategori: 'LT Liabilities', ...d })),
  ]);
  sheet.getCell(`A${r}`).value = 'Total Liabilitas';
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).value = data.summary.totalLiabilities;
  sheet.getCell(`D${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).numFmt = XLS_CURRENCY_FMT;
  r += 2;

  sheet.getCell(`A${r}`).value = 'EKUITAS';
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  r = addExportTable(sheet, r, [
    { label: 'Kategori', key: 'kategori' },
    { label: 'Kode Akun', key: 'coaNo' },
    { label: 'Nama Akun', key: 'coaDescription' },
    { label: 'Nominal', key: 'value', fmt: 'currency' },
  ], data.equity.detail.map((d) => ({ kategori: 'Equity', ...d })));
  sheet.getCell(`A${r}`).value = 'Total Ekuitas';
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).value = data.summary.totalEquity;
  sheet.getCell(`D${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).numFmt = XLS_CURRENCY_FMT;
  r += 2;

  sheet.getCell(`A${r}`).value = 'Total Liabilitas + Ekuitas';
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).value = data.summary.totalLiabilities + data.summary.totalEquity;
  sheet.getCell(`D${r}`).font = { bold: true };
  sheet.getCell(`D${r}`).numFmt = XLS_CURRENCY_FMT;
  r += 1;
  sheet.getCell(`A${r}`).value = data.summary.balanced ? '✅ Balance (Aset = Liabilitas + Ekuitas)' : `⚠️ TIDAK BALANCE — selisih ${rupiah(data.summary.diff)}`;
  sheet.getCell(`A${r}`).font = { bold: true, color: { argb: data.summary.balanced ? 'FF15803D' : 'FFB91C1C' } };
  sheet.mergeCells(r, 1, r, 4);

  return { workbook, filename: buildExportFilename('Neraca') };
}

function exportCashflowWorkbook() {
  const data = lastReportData.cashflow;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Cash Flow');
  let r = addExportHeader(sheet, 'Cash Flow Statement (Estimasi)');
  sheet.getCell(`A${r}`).value = data.note;
  sheet.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(r, 1, r, 2);
  r += 2;

  addExportKpiBlock(sheet, r, [
    ['Saldo Kas Awal (estimasi)', data.beginningCash, 'currency'],
    ['Operating Activities', data.operating, 'currency'],
    ['Investing Activities', data.investing, 'currency'],
    ['Financing Activities', data.financing, 'currency'],
    ['Net Change in Cash', data.netChange, 'currency'],
    ['Saldo Kas Akhir', data.endingCash, 'currency'],
  ]);

  return { workbook, filename: buildExportFilename('CashFlow') };
}

function exportBranchWorkbook() {
  const data = lastReportData.branch;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Kinerja Cabang');
  let r = addExportHeader(sheet, 'Kinerja Cabang');

  const branches = [...data.branches].sort((a, b) => b.netIncome - a.netIncome);
  r = addExportTable(sheet, r, [
    { label: 'Cabang', key: 'branch' },
    { label: 'Revenue', key: 'revenue', fmt: 'currency' },
    { label: 'Expense', key: 'expense', fmt: 'currency' },
    { label: 'Net Income', key: 'netIncome', fmt: 'currency' },
    { label: 'Margin (%)', key: 'margin', fmt: 'percent' },
  ], branches);

  if (branches.length > 0) {
    const totalRevenue = branches.reduce((s, b) => s + b.revenue, 0);
    const totalExpense = branches.reduce((s, b) => s + b.expense, 0);
    const totalNetIncome = branches.reduce((s, b) => s + b.netIncome, 0);
    const row = sheet.getRow(r);
    row.getCell(1).value = branches.length > 1 ? 'Total' : branches[0].branch;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = totalRevenue;
    row.getCell(3).value = totalExpense;
    row.getCell(4).value = totalNetIncome;
    row.getCell(5).value = totalRevenue ? IDR_ROUND((totalNetIncome / totalRevenue) * 100) : 0;
    [2, 3, 4].forEach((c) => { row.getCell(c).numFmt = XLS_CURRENCY_FMT; row.getCell(c).font = { bold: true }; });
    row.getCell(5).numFmt = XLS_PERCENT_FMT;
    row.getCell(5).font = { bold: true };
    row.eachCell((cell) => (cell.border = XLS_THIN_BORDER));
  }

  return { workbook, filename: buildExportFilename('KinerjaCabang') };
}

function IDR_ROUND(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// GL mentah butuh fetch terpisah (baris transaksi lengkap tidak pernah dikirim
// ke browser untuk tab lain supaya payload halaman tetap ringan) — diambil
// tepat saat tombol diklik, dengan filter yang sama seperti laporan lain.
async function exportGLWorkbook() {
  const res = await api(`/api/gl/rows?${filterQuery()}`);
  if (!res.ok) throw new Error('Gagal mengambil data GL.');
  const { rows } = await res.json();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Data GL');
  let r = addExportHeader(sheet, 'Data GL (Raw)');
  sheet.getCell(`A${r}`).value = `Total baris: ${rows.length}`;
  sheet.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  r += 2;

  // Kolom = union semua nama header asli yang pernah terdeteksi di file (raw),
  // supaya export GL menyertakan SEMUA kolom asli (Reference Number, Created
  // By, Notes, Project, dst) — bukan cuma field yang dipakai untuk kalkulasi.
  const rawKeys = [];
  const seen = new Set();
  rows.forEach((row) => {
    Object.keys(row.raw || {}).forEach((k) => {
      if (!seen.has(k)) { seen.add(k); rawKeys.push(k); }
    });
  });

  const columns = rawKeys.map((key) => ({
    label: key,
    value: (row) => {
      const v = row.raw ? row.raw[key] : undefined;
      return v === undefined || v === null || v === '' ? '' : v;
    },
  }));

  addExportTable(sheet, r, columns, rows);

  return { workbook, filename: buildExportFilename('DataGL') };
}

// ---- Klik tombol export (kontekstual sesuai tab aktif) ----
elTombolExportTab.addEventListener('click', async () => {
  if (!currentMeta) return;
  const builders = { pnl: exportPnLWorkbook, balance: exportBalanceWorkbook, cashflow: exportCashflowWorkbook, branch: exportBranchWorkbook, upload: exportGLWorkbook };
  const builder = builders[state.tab];
  if (!builder) return;

  // Data tab ini belum pernah berhasil dimuat (mis. baru login langsung klik cepat) —
  // jangan export data lama/kosong, minta user tunggu render selesai dulu.
  if (state.tab !== 'upload' && !lastReportData[state.tab]) {
    alert('Data laporan belum selesai dimuat. Coba lagi sebentar.');
    return;
  }

  const teksAsli = elTombolExportTab.innerHTML;
  elTombolExportTab.disabled = true;
  elTombolExportTab.innerHTML = '<span class="spinner-export"></span> Membuat file...';
  try {
    const { workbook, filename } = await builder();
    await downloadWorkbook(workbook, filename);
  } catch (err) {
    console.error('Export gagal:', err);
    alert('Gagal membuat file Excel. Coba lagi.');
  } finally {
    elTombolExportTab.disabled = false;
    elTombolExportTab.innerHTML = teksAsli;
  }
});

// ---- Load meta & bootstrap ----
async function loadMeta() {
  try {
    const res = await api('/api/gl/meta');
    if (res.status === 404) {
      currentMeta = null;
      showNoData(true);
      renderGlCurrentInfo(null);
      populateFilters({ periods: [], branches: [], departments: [] });
      elTombolExportSemua.hidden = true;
      updateTombolExportLabel(state.tab);
      return;
    }
    if (!res.ok) return;
    const { meta } = await res.json();
    currentMeta = meta;
    showNoData(false);
    renderGlCurrentInfo(meta);
    populateFilters(meta);
    elTombolExportSemua.hidden = false;
    updateTombolExportLabel(state.tab);
  } catch (e) { /* ditangani di api() */ }
}

// ---- Export Semua Laporan (1 file Excel, 5 sheet: Laba Rugi, Neraca, Cash
// Flow, Kinerja Cabang, GL Data Mentah) — ikut filter periode/cabang/dept aktif ----
const elTombolExportSemua = document.getElementById('tombol-export-semua');
elTombolExportSemua.addEventListener('click', async () => {
  elTombolExportSemua.disabled = true;
  const teksAsli = elTombolExportSemua.textContent;
  elTombolExportSemua.textContent = 'Membuat file...';
  try {
    const res = await api(`/api/export/all?${filterQuery()}`);
    if (!res.ok) throw new Error('export gagal');
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'Laporan_Keuangan_Lengkap.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Gagal export laporan ke Excel. Coba lagi.');
  } finally {
    elTombolExportSemua.disabled = false;
    elTombolExportSemua.textContent = teksAsli;
  }
});

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
  updateTombolExportLabel(state.tab);
  await loadMeta(); // ikut update label export (currentMeta baru terisi di sini)
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
