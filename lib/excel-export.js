const ExcelJS = require('exceljs');

const CURRENCY_FMT = '#,##0;[Red]-#,##0';
const PERCENT_FMT = '0.0"%"';
const DATE_FMT = 'dd-mm-yyyy';

const KATEGORI_LABEL = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', cogs: 'COGS', opex: 'Operating Expense', other: 'Lainnya',
};

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    cell.alignment = { vertical: 'middle' };
  });
}

function styleTitle(cell, text) {
  cell.value = text;
  cell.font = { bold: true, size: 14 };
}

function addKpiBlock(sheet, startRow, pairs) {
  let r = startRow;
  for (const [label, value, fmt] of pairs) {
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`A${r}`).font = { bold: true };
    const cell = sheet.getCell(`B${r}`);
    cell.value = value;
    if (fmt) cell.numFmt = fmt;
    r++;
  }
  return r;
}

function addTable(sheet, startRow, headers, rows, numericCols = []) {
  const headerRow = sheet.getRow(startRow);
  headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  styleHeaderRow(headerRow);

  rows.forEach((rowData, idx) => {
    const row = sheet.getRow(startRow + 1 + idx);
    rowData.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      if (numericCols.includes(i)) cell.numFmt = CURRENCY_FMT;
    });
  });

  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  return startRow + 1 + rows.length;
}

function newSheet(workbook, reportName, meta) {
  const sheet = workbook.addWorksheet(reportName);
  styleTitle(sheet.getCell('A1'), reportName);
  sheet.getCell('A2').value = `Periode: ${meta.periodLabel || '-'}`;
  sheet.getCell('A2').font = { italic: true };
  return sheet;
}

function addOverviewSheet(workbook, data, meta) {
  const sheet = newSheet(workbook, 'Ringkasan Eksekutif', meta);
  let r = addKpiBlock(sheet, 4, [
    ['Total Revenue', data.kpi.revenue, CURRENCY_FMT],
    ['Total Expense', data.kpi.expense, CURRENCY_FMT],
    ['Net Income', data.kpi.netIncome, CURRENCY_FMT],
    ['Profit Margin (%)', data.kpi.profitMargin, PERCENT_FMT],
  ]);
  r += 1;
  sheet.getCell(`A${r}`).value = 'Tren Bulanan';
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  r += 1;
  addTable(
    sheet,
    r,
    ['Periode', 'Revenue', 'Expense', 'Net Income'],
    data.monthlyTrend.map((m) => [m.period, m.revenue, m.expense, m.netIncome]),
    [1, 2, 3]
  );
  return sheet;
}

function addPnLSheet(workbook, data, meta) {
  const sheet = newSheet(workbook, 'Laba Rugi', meta);
  let r = addKpiBlock(sheet, 4, [
    ['Revenue', data.summary.revenue, CURRENCY_FMT],
    ['COGS', data.summary.cogs, CURRENCY_FMT],
    ['Gross Profit', data.summary.grossProfit, CURRENCY_FMT],
    ['Operating Expense', data.summary.opex, CURRENCY_FMT],
    ['Net Income', data.summary.netIncome, CURRENCY_FMT],
    ['Profit Margin (%)', data.summary.profitMargin, PERCENT_FMT],
  ]);
  r += 1;
  const allDetail = [
    ...data.detail.revenue.map((d) => ['Revenue', d.key, d.value]),
    ...data.detail.cogs.map((d) => ['COGS', d.key, d.value]),
    ...data.detail.opex.map((d) => ['Operating Expense', d.key, d.value]),
  ];
  addTable(sheet, r, ['Kategori', 'Akun', 'Nominal'], allDetail, [2]);
  return sheet;
}

function addBalanceSheet(workbook, data, meta) {
  const sheet = newSheet(workbook, 'Neraca', meta);
  let r = addKpiBlock(sheet, 4, [
    ['Total Assets', data.summary.totalAssets, CURRENCY_FMT],
    ['Total Liabilities', data.summary.totalLiabilities, CURRENCY_FMT],
    ['Total Equity', data.summary.totalEquity, CURRENCY_FMT],
    ['Balanced?', data.summary.balanced ? 'Ya' : 'Tidak (selisih ' + data.summary.diff + ')'],
  ]);
  r += 1;
  const allDetail = [
    ...data.assets.detail.current.map((d) => ['Current Assets', d.key, d.value]),
    ...data.assets.detail.fixed.map((d) => ['Fixed Assets', d.key, d.value]),
    ...data.liabilities.detail.current.map((d) => ['Current Liabilities', d.key, d.value]),
    ...data.liabilities.detail.longterm.map((d) => ['Long-term Liabilities', d.key, d.value]),
    ...data.equity.detail.map((d) => ['Equity', d.key, d.value]),
  ];
  addTable(sheet, r, ['Kategori', 'Akun', 'Nominal'], allDetail, [2]);
  return sheet;
}

function addCashflowSheet(workbook, data, meta) {
  const sheet = newSheet(workbook, 'Cash Flow (Estimasi)', meta);
  sheet.getCell('A3').value = data.note;
  sheet.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF888888' } };
  addKpiBlock(sheet, 5, [
    ['Operating Activities', data.operating, CURRENCY_FMT],
    ['Investing Activities', data.investing, CURRENCY_FMT],
    ['Financing Activities', data.financing, CURRENCY_FMT],
    ['Net Change in Cash', data.netChange, CURRENCY_FMT],
    ['Beginning Cash (estimasi)', data.beginningCash, CURRENCY_FMT],
    ['Ending Cash', data.endingCash, CURRENCY_FMT],
  ]);
  return sheet;
}

function addBranchSheet(workbook, data, meta) {
  const sheet = newSheet(workbook, 'Kinerja Cabang', meta);
  addTable(
    sheet,
    4,
    ['Cabang', 'Revenue', 'Expense', 'Net Income', 'Margin (%)'],
    data.branches.map((b) => [b.branch, b.revenue, b.expense, b.netIncome, b.margin]),
    [1, 2, 3]
  );
  return sheet;
}

// Sheet data GL mentah (hasil parsing, sudah terklasifikasi) — untuk audit/telusur
// balik angka di sheet laporan lain ke baris transaksi aslinya.
function addGLDataSheet(workbook, rows, meta) {
  const sheet = newSheet(workbook, 'GL (Data Mentah)', meta);
  sheet.getCell('A3').value = `Total baris: ${rows.length}`;
  sheet.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF888888' } };

  const headerRow = sheet.getRow(5);
  ['Tanggal', 'CoA No', 'CoA Description', 'Branch', 'Department', 'Klasifikasi', 'Debit', 'Kredit', 'Nilai (Normal Balance)'].forEach(
    (h, i) => (headerRow.getCell(i + 1).value = h)
  );
  styleHeaderRow(headerRow);

  rows.forEach((r, idx) => {
    const row = sheet.getRow(6 + idx);
    row.getCell(1).value = r.date ? new Date(r.date) : null;
    if (r.date) row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).value = r.coaNo;
    row.getCell(3).value = r.coaDescription;
    row.getCell(4).value = r.branch;
    row.getCell(5).value = r.department || '';
    row.getCell(6).value = KATEGORI_LABEL[r.classification] || r.classification;
    row.getCell(7).value = r.debit;
    row.getCell(7).numFmt = CURRENCY_FMT;
    row.getCell(8).value = r.credit;
    row.getCell(8).numFmt = CURRENCY_FMT;
    row.getCell(9).value = r.value;
    row.getCell(9).numFmt = CURRENCY_FMT;
  });

  sheet.columns.forEach((col) => (col.width = 20));
  sheet.getColumn(3).width = 30;
  return sheet;
}

const SHEET_BUILDERS = {
  overview: addOverviewSheet,
  pnl: addPnLSheet,
  balance: addBalanceSheet,
  cashflow: addCashflowSheet,
  branch: addBranchSheet,
};

function newWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();
  return workbook;
}

async function buildReportWorkbookBuffer(reportType, data, meta) {
  const builder = SHEET_BUILDERS[reportType];
  if (!builder) throw new Error(`Tipe laporan tidak dikenal: ${reportType}`);
  const workbook = newWorkbook();
  builder(workbook, data, meta);
  return workbook.xlsx.writeBuffer();
}

// Satu file Excel berisi SEMUA laporan sebagai sheet terpisah: Laba Rugi, Neraca,
// Cash Flow, Kinerja Cabang, dan GL (Data Mentah) — dipakai tombol "Export Semua Laporan".
async function buildCombinedWorkbookBuffer({ pnl, balance, cashflow, branch, glRows }, meta) {
  const workbook = newWorkbook();
  addPnLSheet(workbook, pnl, meta);
  addBalanceSheet(workbook, balance, meta);
  addCashflowSheet(workbook, cashflow, meta);
  addBranchSheet(workbook, branch, meta);
  addGLDataSheet(workbook, glRows, meta);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportWorkbookBuffer, buildCombinedWorkbookBuffer };
