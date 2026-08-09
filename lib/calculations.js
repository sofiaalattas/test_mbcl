// Semua fungsi di sini bekerja di atas `rows` hasil lib/excel-parser.js
// (satu baris = satu baris transaksi GL yang sudah diklasifikasi & diberi `value`
// mengikuti saldo normal akun).

const IDR = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// dateFrom/dateTo: string tanggal 'YYYY-MM-DD' dari <input type="date">.
// Baris tanpa tanggal (r.date null) dikecualikan kalau filter tanggal aktif —
// tidak bisa dipastikan masuk rentang atau tidak.
function inDateRange(rowDateIso, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  if (!rowDateIso) return false;
  const t = new Date(rowDateIso).getTime();
  if (dateFrom && t < new Date(`${dateFrom}T00:00:00.000Z`).getTime()) return false;
  if (dateTo && t > new Date(`${dateTo}T23:59:59.999Z`).getTime()) return false;
  return true;
}

function filterRows(rows, { period, branch, department, dateFrom, dateTo } = {}) {
  return rows.filter((r) => {
    if (period && period !== 'ALL' && r.period !== period) return false;
    if (!inDateRange(r.date, dateFrom, dateTo)) return false;
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

// Sama seperti groupSum, tapi khusus grouping per akun (CoA No + Description) —
// mengembalikan field terpisah (bukan string gabungan "coaNo - desc") supaya
// konsumen (tabel UI, export Excel) bisa pakai kolom Kode Akun & Nama Akun
// masing-masing tanpa perlu split-string yang rapuh.
function groupSumByAccount(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.coaNo} ${r.coaDescription}`;
    if (!map.has(key)) map.set(key, { coaNo: r.coaNo, coaDescription: r.coaDescription, value: 0 });
    map.get(key).value += r.value;
  }
  return [...map.values()].map((v) => ({ ...v, value: IDR(v.value) }));
}

function profitMargin(netIncome, revenue) {
  if (!revenue) return 0;
  return IDR((netIncome / revenue) * 100);
}

// ---- FEATURE 2: Executive Dashboard Overview ----
function computeOverview(allRows, { period, branch, department, dateFrom, dateTo } = {}) {
  const filtered = filterRows(allRows, { period, branch, department, dateFrom, dateTo });

  const revenue = sumByClass(filtered, ['revenue']);
  const cogs = sumByClass(filtered, ['cogs']);
  const opex = sumByClass(filtered, ['opex']);
  const expense = IDR(cogs + opex);
  const netIncome = IDR(revenue - expense);

  // Tren bulanan: ikut rentang tanggal & filter branch/dept yang dipilih,
  // supaya grafik tren merefleksikan periode kalender yang sedang difilter.
  const trendRows = filterRows(allRows, { branch, department, dateFrom, dateTo });
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
function computePnL(allRows, { period, branch, department, dateFrom, dateTo } = {}) {
  const filtered = filterRows(allRows, { period, branch, department, dateFrom, dateTo });

  const revenue = sumByClass(filtered, ['revenue']);
  const cogs = sumByClass(filtered, ['cogs']);
  const grossProfit = IDR(revenue - cogs);
  const opex = sumByClass(filtered, ['opex']);
  const netIncome = IDR(grossProfit - opex);

  const detailByAccount = (classNames) =>
    groupSumByAccount(filtered.filter((r) => classNames.includes(r.classification)))
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
function computeBalanceSheet(allRows, { period, branch, department, dateFrom, dateTo } = {}) {
  const filtered = filterRows(allRows, { period, branch, department, dateFrom, dateTo });

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

  const equityAccounts = sumByClass(filtered, ['equity']);

  // Ekuitas neraca harus mengikutsertakan Laba Berjalan (Net Income periode berjalan),
  // bukan cuma saldo akun 3xxxx — kalau tidak, neraca tidak akan pernah balance
  // selama belum ada jurnal penutup yang memindahkan laba ke akun ekuitas.
  const revenueForEquity = sumByClass(filtered, ['revenue']);
  const cogsForEquity = sumByClass(filtered, ['cogs']);
  const opexForEquity = sumByClass(filtered, ['opex']);
  const currentPeriodNetIncome = IDR(revenueForEquity - cogsForEquity - opexForEquity);
  const totalEquity = IDR(equityAccounts + currentPeriodNetIncome);

  const diff = IDR(totalAssets - (totalLiabilities + totalEquity));
  // Toleransi pembulatan: tiap baris GL dibulatkan ke rupiah penuh, jadi selisih receh
  // (beberapa rupiah) di file dengan ratusan/ribuan baris adalah wajar, bukan indikasi
  // data salah. 100 rupiah tetap jauh di bawah signifikansi bisnis apa pun.
  const balanced = Math.abs(diff) <= 100;

  const detailByAccount = (classNames, sub) =>
    groupSumByAccount(filtered.filter((r) => classNames.includes(r.classification) && (!sub || r.sub === sub)))
      .filter((d) => d.value !== 0)
      .sort((a, b) => b.value - a.value);

  const ratios = {
    currentRatio: currentLiabilities ? IDR(currentAssets / currentLiabilities) : null,
    debtRatio: totalAssets ? IDR(totalLiabilities / totalAssets) : null,
  };

  const equityDetail = detailByAccount(['equity']);
  if (currentPeriodNetIncome !== 0) {
    equityDetail.push({ coaNo: '', coaDescription: 'Laba Berjalan (Net Income)', value: currentPeriodNetIncome });
  }

  // Diagnosa: akun yang tidak masuk kategori manapun (kode CoA di luar 1-6xxxx,
  // atau kosong) HILANG dari semua total di atas tanpa peringatan — tampilkan
  // rinciannya di sini supaya kalau Neraca tidak balance, penyebabnya kelihatan
  // langsung (bukan cuma "selisih sekian rupiah" tanpa konteks).
  const unclassifiedRows = filtered.filter((r) => r.classification === 'other');
  const unclassifiedAccounts = groupSumByAccount(unclassifiedRows)
    .filter((d) => d.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const unclassifiedTotalValue = IDR(unclassifiedRows.reduce((s, r) => s + r.value, 0));

  return {
    summary: { totalAssets, totalLiabilities, totalEquity, balanced, diff },
    assets: { current: currentAssets, fixed: fixedAssets, total: totalAssets, detail: { current: detailByAccount(['asset'], 'current'), fixed: detailByAccount(['asset'], 'fixed') } },
    liabilities: { current: currentLiabilities, longterm: longtermLiabilities, total: totalLiabilities, detail: { current: detailByAccount(['liability'], 'current'), longterm: detailByAccount(['liability'], 'longterm') } },
    equity: { total: totalEquity, accountsOnly: equityAccounts, currentPeriodNetIncome, detail: equityDetail },
    ratios,
    unclassified: { count: unclassifiedAccounts.length, totalValue: unclassifiedTotalValue, accounts: unclassifiedAccounts.slice(0, 20) },
  };
}

// ---- FEATURE 6: Kinerja Cabang (Branch Performance) ----
function computeBranchPerformance(allRows, { period, department, dateFrom, dateTo } = {}) {
  const filtered = filterRows(allRows, { period, department, dateFrom, dateTo });
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
function computeCashFlow(allRows, { period, branch, department, dateFrom, dateTo } = {}) {
  const filtered = filterRows(allRows, { period, branch, department, dateFrom, dateTo });

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
