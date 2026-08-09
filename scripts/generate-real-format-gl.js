// Generator file GL yang meniru PERSIS struktur kolom yang dilaporkan user
// (16 kolom, termasuk "Dr Amount (IDR)" berkurung satuan & "Journal Date"),
// dipakai untuk membuktikan & memverifikasi bug parsing kolom.
const path = require('path');
const ExcelJS = require('exceljs');

const HEADERS = [
  'Coa No', 'Coa Description', 'Branch', 'Journal Date', 'Created Date', 'Created By',
  'Reference Number', 'Transaction Type', 'Notes', 'Cost Center', 'Project',
  'General Ledger Info', 'Additional Information', 'Dr Amount (IDR)', 'Cr Amount (IDR)', 'Balance',
];

// baris transaksi contoh: penjualan (revenue, kredit), HPP & opex (debit), kas (debit), modal (kredit)
const ROWS = [
  ['110101', 'Kas', 'PNG01', new Date('2026-05-05'), new Date('2026-05-05'), 'admin', 'REF001', 'JV', '', 'CC01', '', '', '', 50000000, 0, 50000000],
  ['410101', 'Penjualan Produk A', 'PNG01', new Date('2026-05-05'), new Date('2026-05-05'), 'admin', 'REF001', 'JV', '', 'CC01', '', '', '', 0, 50000000, -50000000],
  ['510101', 'HPP Produk A', 'PNG01', new Date('2026-05-05'), new Date('2026-05-05'), 'admin', 'REF002', 'JV', '', 'CC01', '', '', '', 20000000, 0, 20000000],
  ['110101', 'Kas', 'PNG01', new Date('2026-05-05'), new Date('2026-05-05'), 'admin', 'REF002', 'JV', '', 'CC01', '', '', '', 0, 20000000, -20000000],
  ['610101', 'Beban Gaji', 'PNG01', new Date('2026-05-06'), new Date('2026-05-06'), 'admin', 'REF003', 'JV', '', 'CC01', '', '', '', 8000000, 0, 8000000],
  ['110101', 'Kas', 'PNG01', new Date('2026-05-06'), new Date('2026-05-06'), 'admin', 'REF003', 'JV', '', 'CC01', '', '', '', 0, 8000000, -8000000],
  ['310101', 'Modal Disetor', 'PNG01', new Date('2026-05-01'), new Date('2026-05-01'), 'admin', 'REF000', 'JV', '', 'CC01', '', '', '', 0, 100000000, -100000000],
  ['110101', 'Kas', 'PNG01', new Date('2026-05-01'), new Date('2026-05-01'), 'admin', 'REF000', 'JV', '', 'CC01', '', '', '', 100000000, 0, 100000000],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('GL');
  const headerRow = sheet.getRow(1);
  HEADERS.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  headerRow.font = { bold: true };
  ROWS.forEach((r, i) => {
    const row = sheet.getRow(i + 2);
    r.forEach((v, j) => (row.getCell(j + 1).value = v));
  });
  sheet.columns.forEach((c) => (c.width = 18));
  const outPath = path.join(__dirname, '..', 'sample-data', 'contoh-GL-format-real.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Ditulis ke', outPath);
}
main();
