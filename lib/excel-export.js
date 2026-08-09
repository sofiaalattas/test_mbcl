const ExcelJS = require('exceljs');

const CURRENCY_FMT = '#,##0;[Red]-#,##0';
const PERCENT_FMT = '0.0"%"';

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6FED' } };
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

function newWorkbook(reportName, meta) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Financial Dashboard';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(reportName);
  styleTitle(sheet.getCell('A1'), reportName);
  sheet.getCell('A2').value = `Periode: ${meta.periodLabel || '-'}`;
  sheet.getCell('A2').font = { italic: true };
  return { workbook, sheet };
}

function buildOverviewWorkbook(data, meta) {
  const { workbook, sheet } = newWorkbook('Ringkasan Eksekutif', meta);
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
  return workbook;
}

function buildPnLWorkbook(data, meta) {
  const { workbook, sheet } = newWorkbook('Laba Rugi', meta);
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
  return workbook;
}

function buildBalanceWorkbook(data, meta) {
  const { workbook, sheet } = newWorkbook('Neraca', meta);
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
  return workbook;
}

function buildCashflowWorkbook(data, meta) {
  const { workbook, sheet } = newWorkbook('Cash Flow (Estimasi)', meta);
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
  return workbook;
}

function buildBranchWorkbook(data, meta) {
  const { workbook, sheet } = newWorkbook('Kinerja Cabang', meta);
  addTable(
    sheet,
    4,
    ['Cabang', 'Revenue', 'Expense', 'Net Income', 'Margin (%)'],
    data.branches.map((b) => [b.branch, b.revenue, b.expense, b.netIncome, b.margin]),
    [1, 2, 3]
  );
  return workbook;
}

const BUILDERS = {
  overview: buildOverviewWorkbook,
  pnl: buildPnLWorkbook,
  balance: buildBalanceWorkbook,
  cashflow: buildCashflowWorkbook,
  branch: buildBranchWorkbook,
};

async function buildReportWorkbookBuffer(reportType, data, meta) {
  const builder = BUILDERS[reportType];
  if (!builder) throw new Error(`Tipe laporan tidak dikenal: ${reportType}`);
  const workbook = builder(data, meta);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildReportWorkbookBuffer };
