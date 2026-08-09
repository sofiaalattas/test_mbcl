// Generator GL "balanced" — setiap transaksi SELALU dipasangkan dengan
// contra-entry-nya di akun lain (bukan cuma "plug" di akhir seperti
// generate-sample-gl.js), jadi total Debit = total Credit persis di
// SETIAP baris pasangan maupun di keseluruhan file. Konsekuensinya:
// Neraca (Assets = Liabilities + Equity + Laba Berjalan) otomatis balance
// tanpa perlu penyesuaian apa pun — sifat ini murni identitas double-entry
// (lihat audit di lib/calculations.js computeBalanceSheet).
//
// Meniru format kolom REAL yang dipakai user di production (16 kolom,
// termasuk header block 11 baris sebelum tabel data) supaya bisa
// langsung di-upload lewat frontend tanpa masalah parsing.
//
// Jalankan: node scripts/generate-balanced-gl.js
const path = require('path');
const ExcelJS = require('exceljs');

const HEADERS = [
  'Coa No', 'Coa Description', 'Branch', 'Journal Date', 'Created Date', 'Created By',
  'Reference Number', 'Transaction Type', 'Notes', 'Cost Center', 'Project',
  'General Ledger Info', 'Additional Information', 'Dr Amount (IDR)', 'Cr Amount (IDR)', 'Balance',
];

const BRANCHES = [
  'Distribution Point-Makassar', 'Logistics Base-Semarang', 'Maintenance Hub-Medan',
  'Regional Depot-Palembang', 'Service Center-Bandung', 'Warehouse Barat-Jakarta',
  'Warehouse Timur-Surabaya',
];

const CREATED_BY = ['SYSTEM01', 'FINANCE02', 'ACCT03', 'ADMIN04', 'OPS05'];

// side: 'debit' = normal balance di Debit (asset/cogs/opex), 'credit' = normal balance
// di Credit (liability/equity/revenue) — dipakai untuk menentukan sisi mana yang
// dipakai saat akun ini jadi sisi "utama" transaksi.
const ACCOUNTS = {
  kas: { coaNo: '1 1 01 01', desc: 'Kas', side: 'debit' },
  bank: { coaNo: '1 1 01 02', desc: 'Bank', side: 'debit' },
  piutang: { coaNo: '1 1 02 01', desc: 'Piutang Usaha', side: 'debit' },
  persediaan: { coaNo: '1 1 03 01', desc: 'Persediaan Barang Dagang', side: 'debit' },
  peralatan: { coaNo: '1 2 01 01', desc: 'Peralatan & Mesin', side: 'debit' }, // sub: fixed
  kendaraan: { coaNo: '1 2 02 01', desc: 'Kendaraan Operasional', side: 'debit' }, // sub: fixed

  utangUsaha: { coaNo: '2 1 01 01', desc: 'Utang Usaha', side: 'credit' },
  utangBankPendek: { coaNo: '2 1 02 01', desc: 'Utang Bank Jangka Pendek', side: 'credit' },
  utangBankPanjang: { coaNo: '2 2 01 01', desc: 'Utang Bank Jangka Panjang', side: 'credit' }, // sub: longterm

  modal: { coaNo: '3 1 01 01', desc: 'Modal Disetor', side: 'credit' },
  labaDitahan: { coaNo: '3 1 02 01', desc: 'Laba Ditahan', side: 'credit' },

  revA: { coaNo: '4 1 01 01', desc: 'Penjualan Produk A', side: 'credit' },
  revB: { coaNo: '4 1 01 02', desc: 'Penjualan Produk B', side: 'credit' },
  revJasa: { coaNo: '4 1 02 01', desc: 'Pendapatan Jasa', side: 'credit' },
  revLain: { coaNo: '4 1 03 01', desc: 'Pendapatan Lain-lain', side: 'credit' },

  hppA: { coaNo: '5 1 01 01', desc: 'HPP Produk A', side: 'debit' },
  hppB: { coaNo: '5 1 01 02', desc: 'HPP Produk B', side: 'debit' },
  biayaProduksiLangsung: { coaNo: '5 1 02 01', desc: 'Biaya Produksi Langsung', side: 'debit' },
  biayaProduksiTidakLangsung: { coaNo: '5 1 02 02', desc: 'Biaya Produksi Tidak Langsung', side: 'debit' },

  gaji: { coaNo: '6 1 01 01', desc: 'Gaji Karyawan', side: 'debit' },
  tunjangan: { coaNo: '6 1 01 02', desc: 'Tunjangan Karyawan', side: 'debit' },
  pelatihan: { coaNo: '6 1 01 03', desc: 'Pelatihan & Pengembangan', side: 'debit' },
  sewa: { coaNo: '6 1 02 01', desc: 'Sewa Tempat', side: 'debit' },
  listrik: { coaNo: '6 1 02 02', desc: 'Listrik, Air & Internet', side: 'debit' },
  marketing: { coaNo: '6 1 03 01', desc: 'Marketing & Promosi', side: 'debit' },
  adminUmum: { coaNo: '6 1 03 02', desc: 'Biaya Administrasi Umum', side: 'debit' },
};

const REVENUE_ACCTS = [ACCOUNTS.revA, ACCOUNTS.revB, ACCOUNTS.revJasa, ACCOUNTS.revLain];
const COGS_ACCTS = [ACCOUNTS.hppA, ACCOUNTS.hppB, ACCOUNTS.biayaProduksiLangsung, ACCOUNTS.biayaProduksiTidakLangsung];
const OPEX_ACCTS = [
  ACCOUNTS.gaji, ACCOUNTS.tunjangan, ACCOUNTS.pelatihan, ACCOUNTS.sewa,
  ACCOUNTS.listrik, ACCOUNTS.marketing, ACCOUNTS.adminUmum,
];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function branchCostCenter(branch, kind, rand) {
  const map = { revenue: 'CC-4001', cogs: 'CC-5001', opex: 'CC-6001', finance: 'CC-3001' };
  if (map[kind]) return map[kind];
  const others = ['CC-2001', 'CC-2002', 'CC-2003'];
  return others[Math.floor(rand() * others.length)];
}

function branchFactor(branch) {
  const factors = {
    'Distribution Point-Makassar': 1.0, 'Logistics Base-Semarang': 0.9,
    'Maintenance Hub-Medan': 0.85, 'Regional Depot-Palembang': 0.95,
    'Service Center-Bandung': 1.1, 'Warehouse Barat-Jakarta': 1.25,
    'Warehouse Timur-Surabaya': 1.15,
  };
  return factors[branch] || 1;
}

function monthsRange(startYm, count) {
  const [y0, m0] = startYm.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const total = (m0 - 1) + i;
    const y = y0 + Math.floor(total / 12);
    const m = (total % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

function randomDateInMonth(ym, rand) {
  const [y, m] = ym.split('-').map(Number);
  const day = 1 + Math.floor(rand() * 27);
  return new Date(Date.UTC(y, m - 1, day));
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// Bangun satu file GL balanced sesuai konfigurasi skala.
// txnsPerBranchMonth: jumlah transaksi (masing2 = 2 baris berpasangan) per cabang per bulan.
async function generateGL({ outFileName, title, branches, months, txnsPerBranchMonth, seed }) {
  const rand = seededRandom(seed);
  let seq = 1;
  const rowsBuffer = [];

  function pushRow({ coaNo, coaDescription, branch, journalDate, createdDate, createdBy, ref, transType, notes, costCenter, project, glInfo, addInfo, debit, credit }) {
    rowsBuffer.push([
      coaNo, coaDescription, branch, journalDate, createdDate, createdBy, ref, transType, notes,
      costCenter, project, glInfo, addInfo, Math.round(debit), Math.round(credit), Math.round(debit - credit),
    ]);
  }

  // Setiap transaksi = 2 baris (debit di satu akun, credit di akun lain) dengan
  // Reference Number yang SAMA — inilah yang membuat file ini selalu balance,
  // bukan lewat plug di akhir seperti generator sebelumnya.
  function addPair(journalDate, branch, transType, notes, costCenterKind, debitAcct, creditAcct, amount) {
    const ref = `GLB${String(seq).padStart(7, '0')}`;
    const createdBy = CREATED_BY[Math.floor(rand() * CREATED_BY.length)];
    const createdDate = addDays(journalDate, Math.floor(rand() * 3));
    const costCenter = branchCostCenter(branch, costCenterKind, rand);
    const glInfo = `GL-${branch.slice(0, 3).toUpperCase()}-${seq}`;
    const addInfo = notes;
    pushRow({ coaNo: debitAcct.coaNo, coaDescription: debitAcct.desc, branch, journalDate, createdDate, createdBy, ref, transType, notes, costCenter, project: null, glInfo, addInfo, debit: amount, credit: 0 });
    pushRow({ coaNo: creditAcct.coaNo, coaDescription: creditAcct.desc, branch, journalDate, createdDate, createdBy, ref, transType, notes, costCenter, project: null, glInfo, addInfo, debit: 0, credit: amount });
    seq++;
  }

  // --- Modal awal & saldo laba ditahan (sekali di level perusahaan, bulan pertama) ---
  const firstMonth = months[0];
  const openingDate = randomDateInMonth(firstMonth, rand);
  const mainBranch = branches[0];
  addPair(openingDate, mainBranch, 'Capital Injection', 'Setoran modal awal pemegang saham', 'finance', ACCOUNTS.bank, ACCOUNTS.modal, 350_000_000 + rand() * 150_000_000);
  addPair(openingDate, mainBranch, 'Opening Balance', 'Saldo laba ditahan periode sebelumnya', 'finance', ACCOUNTS.bank, ACCOUNTS.labaDitahan, 200_000_000 + rand() * 150_000_000);

  // --- Setup awal per cabang: stok awal (buffer besar) & aset tetap ---
  // Stok awal dibuat cukup besar (bukan pas-pasan) supaya Persediaan tidak
  // pernah minus meski restock bulanan di bawah telat menyusul di bulan pertama.
  const estMonthlyCogs = txnsPerBranchMonth * 0.25 * 4_500_000;
  for (const branch of branches) {
    const bf = branchFactor(branch);
    const setupDate = randomDateInMonth(firstMonth, rand);
    addPair(setupDate, branch, 'Inventory Purchase', 'Pembelian stok awal', 'finance', ACCOUNTS.persediaan, ACCOUNTS.utangUsaha, estMonthlyCogs * 1.8 * bf);
    addPair(setupDate, branch, 'Asset Purchase', 'Pembelian peralatan operasional', 'finance', ACCOUNTS.peralatan, ACCOUNTS.utangBankPendek, (60_000_000 + rand() * 40_000_000) * bf);
    if (rand() > 0.5) {
      addPair(setupDate, branch, 'Asset Purchase', 'Pembelian kendaraan operasional', 'finance', ACCOUNTS.kendaraan, ACCOUNTS.utangBankPanjang, (120_000_000 + rand() * 80_000_000) * bf);
    }
  }

  // --- Transaksi operasional per cabang per bulan ---
  for (const ym of months) {
    for (const branch of branches) {
      const bf = branchFactor(branch);
      // Restock persediaan tiap awal bulan, disesuaikan skala transaksi COGS bulan itu
      // (dengan buffer) supaya saldo Persediaan tetap positif sepanjang periode.
      const restockDate = randomDateInMonth(ym, rand);
      addPair(restockDate, branch, 'Inventory Purchase', 'Restock persediaan bulanan', 'finance', ACCOUNTS.persediaan, ACCOUNTS.utangUsaha, estMonthlyCogs * (1.15 + rand() * 0.3) * bf);
      for (let t = 0; t < txnsPerBranchMonth; t++) {
        const date = randomDateInMonth(ym, rand);
        const roll = rand() * 100;
        if (roll < 35) {
          // Penjualan: kredit revenue, debit Kas (55%) atau Piutang (45%)
          const acct = REVENUE_ACCTS[Math.floor(rand() * REVENUE_ACCTS.length)];
          const amount = (2_000_000 + rand() * 13_000_000) * bf;
          const contra = rand() < 0.55 ? ACCOUNTS.kas : ACCOUNTS.piutang;
          addPair(date, branch, 'Sales', `Penjualan - ${acct.desc}`, 'revenue', contra, acct, amount);
        } else if (roll < 60) {
          // HPP: debit COGS, kredit Persediaan (stok keluar)
          const acct = COGS_ACCTS[Math.floor(rand() * COGS_ACCTS.length)];
          const amount = (1_000_000 + rand() * 7_000_000) * bf;
          addPair(date, branch, 'COGS', `Beban pokok - ${acct.desc}`, 'cogs', acct, ACCOUNTS.persediaan, amount);
        } else if (roll < 85) {
          // OpEx: debit beban, kredit Kas (70%) atau Utang Usaha (30%)
          const acct = OPEX_ACCTS[Math.floor(rand() * OPEX_ACCTS.length)];
          const amount = (500_000 + rand() * 5_500_000) * bf;
          const contra = rand() < 0.7 ? ACCOUNTS.kas : ACCOUNTS.utangUsaha;
          addPair(date, branch, 'Operating Expense', `Beban operasional - ${acct.desc}`, 'opex', acct, contra, amount);
        } else if (roll < 93) {
          // Penagihan piutang: debit Kas, kredit Piutang
          const amount = (1_000_000 + rand() * 9_000_000) * bf;
          addPair(date, branch, 'Collection', 'Penagihan piutang usaha', 'finance', ACCOUNTS.kas, ACCOUNTS.piutang, amount);
        } else {
          // Pembayaran utang: debit Utang Usaha, kredit Kas
          const amount = (1_000_000 + rand() * 7_000_000) * bf;
          addPair(date, branch, 'Payment', 'Pembayaran utang usaha', 'finance', ACCOUNTS.utangUsaha, ACCOUNTS.kas, amount);
        }
      }
    }
  }

  // --- Tulis workbook meniru format real (11 baris header block + tabel) ---
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  const nowStr = '09-08-2026 21:00:00';
  const periodLabel = `01-${months[0].split('-')[1]}-${months[0].split('-')[0]} - ${(() => {
    const last = months[months.length - 1].split('-');
    const lastDay = new Date(Date.UTC(Number(last[0]), Number(last[1]), 0)).getUTCDate();
    return `${lastDay}-${last[1]}-${last[0]}`;
  })()}`;

  sheet.getCell('A1').value = title;
  sheet.getCell('A3').value = 'Generated'; sheet.getCell('B3').value = nowStr;
  sheet.getCell('A4').value = 'Period'; sheet.getCell('B4').value = periodLabel;
  sheet.getCell('A5').value = 'Account'; sheet.getCell('B5').value = 'All Accounts';
  sheet.getCell('A6').value = 'Debit Credit Filter'; sheet.getCell('B6').value = 'all';
  sheet.getCell('A7').value = 'Account'; sheet.getCell('B7').value = 'All Accounts';
  sheet.getCell('A8').value = 'Generated Username'; sheet.getCell('B8').value = 'MISPOWERUSER01';
  sheet.getCell('A9').value = 'Report File Name'; sheet.getCell('B9').value = `General Ledger Report - Balanced Demo (${outFileName})`;

  const headerRow = sheet.getRow(11);
  HEADERS.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  headerRow.font = { bold: true };

  let r = 12;
  for (const row of rowsBuffer) {
    const dataRow = sheet.getRow(r++);
    row.forEach((v, i) => (dataRow.getCell(i + 1).value = v));
    dataRow.getCell(4).numFmt = 'yyyy-mm-dd';
    dataRow.getCell(5).numFmt = 'yyyy-mm-dd';
  }
  sheet.columns.forEach((c) => (c.width = 20));

  const outPath = path.join(__dirname, '..', 'sample-data', outFileName);
  await workbook.xlsx.writeFile(outPath);

  // Verifikasi cepat: total Dr harus = total Cr persis (bukti balance sebelum dikirim).
  let totalDr = 0, totalCr = 0;
  for (const row of rowsBuffer) { totalDr += row[13]; totalCr += row[14]; }

  return { outPath, rowCount: rowsBuffer.length, totalDr, totalCr };
}

async function main() {
  const versions = [
    {
      outFileName: 'GL-Balanced-Kecil-1Cabang-1Bulan.xlsx',
      title: 'PT Manufaktur Indonesia Sejahtera (Demo Balanced - Kecil)',
      branches: ['Warehouse Timur-Surabaya'],
      months: monthsRange('2026-06', 1),
      txnsPerBranchMonth: 250,
      seed: 11,
    },
    {
      outFileName: 'GL-Balanced-Standar-7Cabang-6Bulan.xlsx',
      title: 'PT Manufaktur Indonesia Sejahtera (Demo Balanced - Standar)',
      branches: BRANCHES,
      months: monthsRange('2026-01', 6),
      txnsPerBranchMonth: 119,
      seed: 22,
    },
    {
      outFileName: 'GL-Balanced-Besar-7Cabang-12Bulan.xlsx',
      title: 'PT Manufaktur Indonesia Sejahtera (Demo Balanced - Skala Besar)',
      branches: BRANCHES,
      months: monthsRange('2025-07', 12),
      txnsPerBranchMonth: 150,
      seed: 33,
    },
  ];

  for (const v of versions) {
    const result = await generateGL(v);
    console.log(`\n${v.outFileName}`);
    console.log(`  rows      : ${result.rowCount}`);
    console.log(`  total Dr  : ${result.totalDr.toLocaleString('id-ID')}`);
    console.log(`  total Cr  : ${result.totalCr.toLocaleString('id-ID')}`);
    console.log(`  Dr - Cr   : ${(result.totalDr - result.totalCr).toLocaleString('id-ID')} (harus 0)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
