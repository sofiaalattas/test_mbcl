// Semua fungsi di sini bekerja di atas `rows` hasil lib/excel-parser.js
// (satu baris = satu baris transaksi GL yang sudah diklasifikasi & diberi `value`
// mengikuti saldo normal akun).

const IDR = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function filterRows(rows, { period, branch, department } = {}) {
  return rows.filter((r) => {
    if (period && period !== 'ALL' && r.period !== period) return false;
    if (branch && branch !== 'ALL' && r.branch !== branch) return false;
    if (department && department !== 'ALL' && r.department !== department) return false;
    return true;
  });
}

function sumByClass(rows, classNames) {
  const set = new Set(classNames);
  return IDR(rows.filter((r) => set.has(r.classification)).reduce((s, r) => s + r.value, 0));
}

function groupSum(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r) || '(Tidak diketahui)';
    map.set(key, (map.get(key) || 0) + r.value);
  }
  return [...map.entries()].map(([key, value]) => ({ key, value: IDR(value) }));
}

function profitMargin(netIncome, revenue) {
  if (!revenue) return 0;
  return IDR((netIncome / revenue) * 100);
}

// ---- FEATURE 2: Executive Dashboard Overview ----
function computeOverview(allRows, { period, branch, department } = {}) {
  const filtered = filterRows(allRows, { period, branch, department });

  const revenue = sumByClass(filtered, ['revenue']);
  const cogs = sumByClass(filtered, ['cogs']);
  const opex = sumByClass(filtered, ['opex']);
  const expense = IDR(cogs + opex);
  const netIncome = IDR(revenue - expense);

  // Tren bulanan: selalu across semua periode yang tersedia (mengikuti filter branch/dept saja),
  // supaya grafik tren tetap tampil walau satu bulan dipilih di KPI card.
  const trendRows = filterRows(allRows, { branch, department });
  const trendMap = new Map();
  for (const r of trendRows) {
    if (!r.period) continue;
    if (!trendMap.has(r.period)) trendMap.set(r.period, { revenue: 0, expense: 0 });
    const bucket = trendMap.get(r.period);
    if (r.classification === 'revenue') bucket.revenue += r.value;
    if (r.classification === 'cogs' || r.classification === 'opex') bucket.expense += r.value;
  }
  const monthlyTrend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, revenue: IDR(v.revenue), expense: IDR(v.expense), netIncome: IDR(v.revenue - v.expense) }));

  // Expense breakdown by CoA description (top-level kategori pengeluaran)
  const expenseRows = filtered.filter((r) => r.classification === 'cogs' || r.classification === 'opex');
  const expenseBreakdown = groupSum(expenseRows, (r) => r.coaDescription || r.coaNo)
    .filter((e) => e.value !== 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((e) => ({ category: e.key, amount: e.value }));

  return {
    kpi: { revenue, expense, netIncome, profitMargin: profitMargin(netIncome, revenue) },
    monthlyTrend,
    expenseBreakdown,
  };
}

// ---- FEATURE 3: Laporan Laba Rugi (P&L) ----
function computePnL(allRows, { period, branch, department } = {}) {
  const filtered = filterRows(allRows, { period, branch, department });

  const revenue = sumByClass(filtered, ['revenue']);
  const cogs = sumByClass(filtered, ['cogs']);
  const grossProfit = IDR(revenue - cogs);
  const opex = sumByClass(filtered, ['opex']);
  const netIncome = IDR(grossProfit - opex);

  const detailByAccount = (classNames) =>
    groupSum(
      filtered.filter((r) => classNames.includes(r.classification)),
      (r) => `${r.coaNo} - ${r.coaDescription}`
    )
      .filter((d) => d.value !== 0)
      .sort((a, b) => b.value - a.value);

  return {
    summary: { revenue, cogs, grossProfit, opex, netIncome, profitMargin: profitMargin(netIncome, revenue) },
    detail: {
      revenue: detailByAccount(['revenue']),
      cogs: detailByAccount(['cogs']),
      opex: detailByAccount(['opex']),
    },
    byBranch: groupSum(
      filtered.filter((r) => ['revenue', 'cogs', 'opex'].includes(r.classification)),
      (r) => r.branch
    ),
  };
}

// ---- FEATURE 4: Neraca (Balance Sheet) ----
function computeBalanceSheet(allRows, { period, branch, department } = {}) {
  const filtered = filterRows(allRows, { period, branch, department });

  const currentAssets = IDR(
    filtered.filter((r) => r.classification === 'asset' && r.sub === 'current').reduce((s, r) => s + r.value, 0)
  );
  const fixedAssets = IDR(
    filtered.filter((r) => r.classification === 'asset' && r.sub === 'fixed').reduce((s, r) => s + r.value, 0)
  );
  const totalAssets = IDR(currentAssets + fixedAssets);

  const currentLiabilities = IDR(
    filtered.filter((r) => r.classification === 'liability' && r.sub === 'current').reduce((s, r) => s + r.value, 0)
  );
  const longtermLiabilities = IDR(
    filtered.filter((r) => r.classification === 'liability' && r.sub === 'longterm').reduce((s, r) => s + r.value, 0)
  );
  const totalLiabilities = IDR(currentLiabilities + longtermLiabilities);

  const totalEquity = sumByClass(filtered, ['equity']);

  const diff = IDR(totalAssets - (totalLiabilities + totalEquity));
  const balanced = Math.abs(diff) <= 2; // toleransi pembulatan (nilai dibulatkan ke rupiah penuh)

  const detailByAccount = (classNames, sub) =>
    groupSum(
      filtered.filter((r) => classNames.includes(r.classification) && (!sub || r.sub === sub)),
      (r) => `${r.coaNo} - ${r.coaDescription}`
    )
      .filter((d) => d.value !== 0)
      .sort((a, b) => b.value - a.value);

  const ratios = {
    currentRatio: currentLiabilities ? IDR(currentAssets / currentLiabilities) : null,
    debtRatio: totalAssets ? IDR(totalLiabilities / totalAssets) : null,
  };

  return {
    summary: { totalAssets, totalLiabilities, totalEquity, balanced, diff },
    assets: { current: currentAssets, fixed: fixedAssets, total: totalAssets, detail: { current: detailByAccount(['asset'], 'current'), fixed: detailByAccount(['asset'], 'fixed') } },
    liabilities: { current: currentLiabilities, longterm: longtermLiabilities, total: totalLiabilities, detail: { current: detailByAccount(['liability'], 'current'), longterm: detailByAccount(['liability'], 'longterm') } },
    equity: { total: totalEquity, detail: detailByAccount(['equity']) },
    ratios,
  };
}

// ---- FEATURE 6: Kinerja Cabang (Branch Performance) ----
function computeBranchPerformance(allRows, { period, department } = {}) {
  const filtered = filterRows(allRows, { period, department });
  const branches = [...new Set(filtered.map((r) => r.branch))];

  const result = branches.map((branch) => {
    const rowsForBranch = filtered.filter((r) => r.branch === branch);
    const revenue = sumByClass(rowsForBranch, ['revenue']);
    const expense = IDR(sumByClass(rowsForBranch, ['cogs']) + sumByClass(rowsForBranch, ['opex']));
    const netIncome = IDR(revenue - expense);
    return { branch, revenue, expense, netIncome, margin: profitMargin(netIncome, revenue) };
  });

  result.sort((a, b) => b.netIncome - a.netIncome);
  return { branches: result };
}

// ---- FEATURE 5: Cash Flow Statement (estimasi, lihat catatan di README) ----
// Catatan penting: dengan hanya 1 file GL snapshot (bukan perbandingan neraca
// awal vs akhir periode), cash flow di sini adalah ESTIMASI berbasis klasifikasi
// akun, bukan cash flow akurat metode langsung/tidak langsung penuh.
function computeCashFlow(allRows, { period, branch, department } = {}) {
  const filtered = filterRows(allRows, { period, branch, department });

  const revenue = sumByClass(filtered, ['revenue']);
  const cogs = sumByClass(filtered, ['cogs']);
  const opex = sumByClass(filtered, ['opex']);
  const operating = IDR(revenue - cogs - opex); // proxy: net income dari aktivitas operasi

  const investing = IDR(
    -filtered.filter((r) => r.classification === 'asset' && r.sub === 'fixed').reduce((s, r) => s + r.value, 0)
  );

  const financing = IDR(
    filtered
      .filter((r) => (r.classification === 'liability' && r.sub === 'longterm') || r.classification === 'equity')
      .reduce((s, r) => s + r.value, 0)
  );

  const netChange = IDR(operating + investing + financing);

  const cashRows = filtered.filter(
    (r) => r.classification === 'asset' && r.sub === 'current' && /kas|cash|bank/i.test(r.coaDescription || '')
  );
  const endingCash = sumByClass(cashRows, ['asset']);
  const beginningCash = IDR(endingCash - netChange);

  return {
    isEstimate: true,
    note: 'Estimasi berbasis klasifikasi akun dari satu file GL (bukan perbandingan neraca 2 periode). Untuk cash flow akurat, unggah GL awal & akhir periode secara terpisah.',
    operating,
    investing,
    financing,
    netChange,
    beginningCash,
    endingCash,
  };
}

module.exports = {
  filterRows,
  sumByClass,
  computeOverview,
  computePnL,
  computeBalanceSheet,
  computeBranchPerformance,
  computeCashFlow,
};
