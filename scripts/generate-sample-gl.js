// Generator file GL contoh untuk testing & sebagai referensi format upload.
// Jalankan: node scripts/generate-sample-gl.js
const path = require('path');
const ExcelJS = require('exceljs');

const BRANCHES = ['Central Kitchen', 'PNG01', 'PNG02', 'PNG03', 'PNG04', 'PNG05', 'PNG06'];
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

const ACCOUNTS = [
  // Neraca - dicatat sekali di akhir periode (Mei 2026), bukan per-bulan
  { coaNo: '1101', desc: 'Kas', type: 'asset-current' },
  { coaNo: '1102', desc: 'Bank BCA', type: 'asset-current' },
  { coaNo: '1103', desc: 'Piutang Usaha', type: 'asset-current' },
  { coaNo: '1201', desc: 'Peralatan Dapur', type: 'asset-fixed' },
  { coaNo: '1202', desc: 'Kendaraan Operasional', type: 'asset-fixed' },
  { coaNo: '2101', desc: 'Utang Usaha', type: 'liability-current' },
  { coaNo: '2201', desc: 'Utang Bank Jangka Panjang', type: 'liability-lt' },
  { coaNo: '3101', desc: 'Modal Disetor', type: 'equity' },
  { coaNo: '3102', desc: 'Laba Ditahan', type: 'equity' },
  // P&L - dicatat per bulan per cabang
  { coaNo: '4101', desc: 'Penjualan Makanan', type: 'revenue' },
  { coaNo: '4102', desc: 'Penjualan Minuman', type: 'revenue' },
  { coaNo: '5101', desc: 'Harga Pokok Penjualan', type: 'cogs' },
  { coaNo: '6101', desc: 'Gaji Karyawan', type: 'opex' },
  { coaNo: '6102', desc: 'Sewa Tempat', type: 'opex' },
  { coaNo: '6103', desc: 'Listrik & Air', type: 'opex' },
  { coaNo: '6104', desc: 'Marketing', type: 'opex' },
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function branchFactor(branch) {
  const factors = { 'Central Kitchen': 0.6, PNG01: 1.3, PNG02: 1.1, PNG03: 0.9, PNG04: 1.0, PNG05: 0.8, PNG06: 0.7 };
  return factors[branch] || 1;
}

async function main() {
  const rand = seededRandom(42);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('GL');

  sheet.getCell('A1').value = 'PT Manufaktur Indonesia Sejahtera - General Ledger Report (Contoh/Sample)';
  sheet.getCell('A2').value = 'Period: 01-12-2025 s/d 31-05-2026';

  const headers = ['Tanggal', 'CoA No', 'CoA Description', 'Branch', 'Department', 'Dr Amount', 'Cr Amount', 'Balance'];
  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  headerRow.font = { bold: true };

  let r = 5;
  function addRow({ date, coaNo, desc, branch, dept, debit, credit }) {
    const row = sheet.getRow(r++);
    row.getCell(1).value = date;
    row.getCell(2).value = coaNo;
    row.getCell(3).value = desc;
    row.getCell(4).value = branch;
    row.getCell(5).value = dept;
    row.getCell(6).value = Math.round(debit);
    row.getCell(7).value = Math.round(credit);
    row.getCell(8).value = Math.round(debit - credit);
  }

  // Transaksi P&L per bulan per cabang — sambil jalan, catat total revenue/cogs/opex
  // supaya Net Income bisa dihitung dan dipakai untuk plug ekuitas di bawah (double-entry
  // konsisten: Laba Ditahan (saldo AWAL periode) + Laba Berjalan (dihitung dari transaksi
  // P&L ini oleh aplikasi) harus pas dengan Total Assets - Total Liabilities - Modal).
  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOpex = 0;
  for (const month of MONTHS) {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 20));
    for (const branch of BRANCHES) {
      const bf = branchFactor(branch);
      const revenueFood = (40_000_000 + rand() * 15_000_000) * bf;
      const revenueDrink = (12_000_000 + rand() * 5_000_000) * bf;
      const cogs = (revenueFood + revenueDrink) * (0.35 + rand() * 0.05);
      const gaji = (10_000_000 + rand() * 3_000_000) * bf;
      const sewa = 6_000_000 * bf;
      const listrik = (2_500_000 + rand() * 1_000_000) * bf;
      const marketing = (1_500_000 + rand() * 1_500_000) * bf;

      addRow({ date, coaNo: '4101', desc: 'Penjualan Makanan', branch, dept: 'F&B', debit: 0, credit: revenueFood });
      addRow({ date, coaNo: '4102', desc: 'Penjualan Minuman', branch, dept: 'F&B', debit: 0, credit: revenueDrink });
      addRow({ date, coaNo: '5101', desc: 'Harga Pokok Penjualan', branch, dept: 'F&B', debit: cogs, credit: 0 });
      addRow({ date, coaNo: '6101', desc: 'Gaji Karyawan', branch, dept: 'Operasional', debit: gaji, credit: 0 });
      addRow({ date, coaNo: '6102', desc: 'Sewa Tempat', branch, dept: 'Operasional', debit: sewa, credit: 0 });
      addRow({ date, coaNo: '6103', desc: 'Listrik & Air', branch, dept: 'Operasional', debit: listrik, credit: 0 });
      addRow({ date, coaNo: '6104', desc: 'Marketing', branch, dept: 'Marketing', debit: marketing, credit: 0 });

      totalRevenue += revenueFood + revenueDrink;
      totalCogs += cogs;
      totalOpex += gaji + sewa + listrik + marketing;
    }
  }
  const netIncomeFromPnL = Math.round(totalRevenue - totalCogs - totalOpex);

  // Saldo neraca akhir periode (Mei 2026), per cabang disederhanakan jadi 1 baris gabungan tiap akun.
  // "Laba Ditahan" dihitung sebagai angka plug supaya Assets = Liabilities + Equity + Laba
  // Berjalan (Net Income dari transaksi P&L di atas) persis balance — dashboard menambahkan
  // Net Income periode berjalan ke Ekuitas (lihat lib/calculations.js computeBalanceSheet),
  // jadi plug di sini HARUS memperhitungkan itu supaya tidak dobel/kurang hitung.
  const balanceDate = new Date(Date.UTC(2026, 4, 31));
  const nonPlugBalances = {
    '1101': 80_000_000 + rand() * 40_000_000, // Kas
    '1102': 80_000_000 + rand() * 40_000_000, // Bank BCA
    '1103': 80_000_000 + rand() * 40_000_000, // Piutang Usaha
    '1201': 250_000_000 + rand() * 50_000_000, // Peralatan Dapur
    '1202': 250_000_000 + rand() * 50_000_000, // Kendaraan Operasional
    '2101': 45_000_000 + rand() * 20_000_000, // Utang Usaha
    '2201': 150_000_000, // Utang Bank Jangka Panjang
    '3101': 300_000_000, // Modal Disetor
  };
  const totalAssets = nonPlugBalances['1101'] + nonPlugBalances['1102'] + nonPlugBalances['1103'] + nonPlugBalances['1201'] + nonPlugBalances['1202'];
  const totalLiabilities = nonPlugBalances['2101'] + nonPlugBalances['2201'];
  nonPlugBalances['3102'] = totalAssets - totalLiabilities - nonPlugBalances['3101'] - netIncomeFromPnL; // Laba Ditahan (plug)

  const balanceAccounts = ACCOUNTS.filter((a) => a.type.startsWith('asset') || a.type.startsWith('liability') || a.type === 'equity');
  for (const acc of balanceAccounts) {
    const base = nonPlugBalances[acc.coaNo];
    const isDebitNormal = acc.type.startsWith('asset');
    addRow({
      date: balanceDate,
      coaNo: acc.coaNo,
      desc: acc.desc,
      branch: 'Central Kitchen',
      dept: 'Finance',
      debit: isDebitNormal ? base : 0,
      credit: isDebitNormal ? 0 : base,
    });
  }

  sheet.getColumn(1).numFmt = 'dd-mm-yyyy';
  sheet.columns.forEach((c) => (c.width = 22));

  const outPath = path.join(__dirname, '..', 'sample-data', 'contoh-GL.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Sample GL ditulis ke', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
