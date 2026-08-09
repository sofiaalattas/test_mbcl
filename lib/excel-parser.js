const ExcelJS = require('exceljs');

// Alias nama kolom yang dikenali (huruf kecil, tanpa spasi berlebih) -> field internal.
// PENTING: "created date" SENGAJA tidak dimasukkan ke alias `date` — itu tanggal
// audit/pembuatan record, bukan tanggal transaksi (beda makna dengan "Journal Date").
const COLUMN_ALIASES = {
  date: ['tanggal', 'tgl', 'date', 'posting date', 'trans date', 'transaction date', 'journal date', 'tanggal jurnal', 'tanggal transaksi', 'gl date'],
  coaNo: ['coa no', 'coa_no', 'coano', 'account no', 'account code', 'kode akun', 'no akun', 'coa'],
  coaDescription: ['coa description', 'coa desc', 'account name', 'nama akun', 'description', 'keterangan akun', 'keterangan'],
  branch: ['branch', 'cabang'],
  department: ['department', 'departemen', 'divisi', 'dept', 'cost center', 'costcenter'],
  debit: ['dr amount', 'dr_amount', 'debit', 'dr', 'debit amount'],
  credit: ['cr amount', 'cr_amount', 'credit', 'kredit', 'cr', 'credit amount'],
  balance: ['balance', 'saldo'],
};

const REQUIRED_FIELDS = ['coaNo', 'branch'];
const HEADER_SCAN_ROWS = 15;
const MIN_HEADER_MATCHES = 3;

// Normalisasi header: lowercase, rapikan spasi, DAN buang isi dalam kurung
// (mis. "Dr Amount (IDR)" -> "dr amount"). Tanpa ini, header apa pun yang diberi
// suffix satuan mata uang di real-world file (IDR/Rp) gagal cocok exact-match,
// dan parser diam-diam jatuh ke kolom Balance yang ambigu — ini akar bug utama
// yang bikin Revenue minus & nominal salah (lihat audit Agustus 2026).
function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findFieldForHeader(headerText) {
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(headerText)) return field;
  }
  return null;
}

// Cari baris header di antara HEADER_SCAN_ROWS baris pertama: baris dengan
// jumlah kecocokan alias kolom terbanyak (dan minimal MIN_HEADER_MATCHES).
// Selain `columnMap` (field yang dikenali), sekalian kembalikan `allHeaders`
// (SEMUA kolom apa adanya, termasuk yang tidak dikenali seperti "Reference
// Number"/"Created By"/dst) — dipakai supaya export "GL Data Mentah" bisa
// menyertakan seluruh kolom asli file, bukan cuma yang dipakai untuk hitung.
function detectHeaderRow(worksheet) {
  let bestRow = null;
  let bestScore = 0;
  let bestMap = null;
  let bestHeaders = null;

  const maxRow = Math.min(worksheet.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= maxRow; r++) {
    const row = worksheet.getRow(r);
    const map = {};
    const headers = [];
    let score = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const original = cellToString(cell);
      if (!original) return;
      headers.push({ text: original, colNumber });
      const field = findFieldForHeader(normalizeHeader(cell.value));
      if (field && !map[field]) {
        map[field] = colNumber;
        score++;
      }
    });
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      bestMap = map;
      bestHeaders = headers;
    }
  }

  if (bestScore < MIN_HEADER_MATCHES) return null;
  return { headerRow: bestRow, columnMap: bestMap, allHeaders: bestHeaders };
}

function cellToNumber(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.result !== undefined) return Number(v.result) || 0;
  const num = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function cellToString(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && v.text) return String(v.text);
  return String(v).trim();
}

// Nilai "apa adanya" untuk kolom yang tidak dikenali (dipakai di raw export):
// pertahankan tipe number/Date asli kalau ada, supaya hasil export Excel tetap
// bisa dihitung/di-sort, bukan berubah jadi teks.
function cellToRawValue(cell) {
  const v = cell && cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.result !== undefined) return v.result;
  return cellToString(cell);
}

function cellToDate(cell) {
  const v = cell && cell.value;
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.result) {
    const d = new Date(v.result);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function periodKeyFromDate(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Coba temukan label periode dari baris-baris metadata di atas header
// (mis. "Period: 01-12-2025 s/d 31-05-2026" atau "Periode: Jan - Mei 2026").
function detectPeriodLabelFromMetadata(worksheet, headerRow) {
  const scanUntil = Math.max(0, headerRow - 1);
  for (let r = 1; r <= scanUntil; r++) {
    const row = worksheet.getRow(r);
    let rowText = '';
    row.eachCell({ includeEmpty: false }, (cell) => {
      rowText += ' ' + cellToString(cell);
    });
    rowText = rowText.trim();
    if (/period/i.test(rowText) && rowText.length > 5) {
      return rowText.replace(/^period[e]?\s*:?\s*/i, '').trim();
    }
  }
  return null;
}

// Klasifikasi akun berdasarkan digit pertama CoA No.
// 1=Asset(11 current,12 fixed) 2=Liability(21 current,22 LT) 3=Equity 4=Revenue 5=COGS 6=OpEx
//
// PENTING (bug audit Agustus 2026): kode akun zero-padded (mis. "0110101" —
// awalan segmen/perusahaan "0" + kode akun sebenarnya) sebelumnya membuat
// digit pertama jadi '0' -> jatuh ke default 'other' -> nilainya HILANG TOTAL
// dari semua total laporan (Aset/Liabilitas/dst), tanpa peringatan apa pun.
// Ini bisa jadi penyebab Neraca tidak balance dengan selisih besar. Fix:
// buang angka nol di depan sebelum ambil digit klasifikasi.
function classifyAccount(coaNo) {
  const rawDigits = String(coaNo || '').replace(/\D/g, '');
  const digits = rawDigits.replace(/^0+/, '');
  if (!digits) return { class: 'other', sub: null };
  const first = digits[0];
  const first2 = digits.slice(0, 2);
  switch (first) {
    case '1':
      return { class: 'asset', sub: first2 === '12' ? 'fixed' : 'current' };
    case '2':
      return { class: 'liability', sub: first2 === '22' ? 'longterm' : 'current' };
    case '3':
      return { class: 'equity', sub: null };
    case '4':
      return { class: 'revenue', sub: null };
    case '5':
      return { class: 'cogs', sub: null };
    case '6':
      return { class: 'opex', sub: null };
    default:
      return { class: 'other', sub: null };
  }
}

const DEBIT_NORMAL_CLASSES = new Set(['asset', 'cogs', 'opex']);

// Nilai baris mengikuti saldo normal akun: Asset/COGS/OpEx = Debit - Kredit,
// Liability/Equity/Revenue = Kredit - Debit. Ini membuat semua total bisa
// dijumlahkan langsung tanpa perlu tahu tanda +/- per baris.
function rowValue(classification, debit, credit) {
  return DEBIT_NORMAL_CLASSES.has(classification.class) ? debit - credit : credit - debit;
}

class GLParseError extends Error {}

// Parse buffer .xlsx GL menjadi { meta, rows }.
// rows: [{ date, period, coaNo, coaDescription, branch, department, debit, credit, balance, classification, sub, value }]
async function parseGLBuffer(buffer, options = {}) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new GLParseError('File bukan .xlsx yang valid atau rusak.');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new GLParseError('File Excel tidak memiliki sheet.');

  const detected = detectHeaderRow(worksheet);
  if (!detected) {
    throw new GLParseError(
      'Kolom GL tidak dikenali. Pastikan file memiliki kolom seperti "CoA No", "Branch", "Dr Amount", "Cr Amount" pada salah satu dari 15 baris pertama.'
    );
  }
  const { headerRow, columnMap, allHeaders } = detected;

  for (const field of REQUIRED_FIELDS) {
    if (!columnMap[field]) {
      throw new GLParseError(`Kolom wajib "${field}" tidak ditemukan di file GL.`);
    }
  }
  if (!columnMap.debit && !columnMap.credit && !columnMap.balance) {
    throw new GLParseError('File GL harus memiliki kolom nominal (Dr Amount / Cr Amount / Balance).');
  }

  const metadataLabel = detectPeriodLabelFromMetadata(worksheet, headerRow);
  const manualPeriodLabel = options.periodLabel && options.periodLabel.trim();

  // Transparansi metode hitung: kalau Dr/Cr Amount tidak terdeteksi, kita jatuh ke
  // kolom Balance (ambigu — bisa jadi net per-baris, bisa jadi saldo kumulatif).
  // Ini WAJIB ditampilkan ke admin di UI supaya bug seperti "Revenue minus" /
  // "nominal kelipatan aneh" langsung ketahuan sumbernya, bukan diam-diam salah.
  const calculationMethod = columnMap.debit || columnMap.credit ? 'debit-credit' : 'balance-fallback';

  const rows = [];
  const branchSet = new Set();
  const deptSet = new Set();
  const periodSet = new Set();
  const unclassifiedCoaSet = new Set();
  let minDate = null;
  let maxDate = null;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const coaNo = columnMap.coaNo ? cellToString(row.getCell(columnMap.coaNo)) : '';
    const branch = columnMap.branch ? cellToString(row.getCell(columnMap.branch)) : '';
    if (!coaNo && !branch) return; // baris kosong, lewati

    const date = columnMap.date ? cellToDate(row.getCell(columnMap.date)) : null;
    const period = periodKeyFromDate(date);
    const debit = columnMap.debit ? cellToNumber(row.getCell(columnMap.debit)) : 0;
    const credit = columnMap.credit ? cellToNumber(row.getCell(columnMap.credit)) : 0;
    const balance = columnMap.balance ? cellToNumber(row.getCell(columnMap.balance)) : null;
    const department = columnMap.department ? cellToString(row.getCell(columnMap.department)) : '';
    const coaDescription = columnMap.coaDescription ? cellToString(row.getCell(columnMap.coaDescription)) : '';

    const classification = classifyAccount(coaNo);
    const effectiveDebit = columnMap.debit || columnMap.credit ? debit : 0;
    const effectiveCredit = columnMap.debit || columnMap.credit ? credit : 0;
    const value =
      columnMap.debit || columnMap.credit
        ? rowValue(classification, effectiveDebit, effectiveCredit)
        : DEBIT_NORMAL_CLASSES.has(classification.class)
        ? balance
        : -balance;

    if (branch) branchSet.add(branch);
    if (department) deptSet.add(department);
    if (classification.class === 'other' && coaNo) unclassifiedCoaSet.add(coaNo);
    if (period) {
      periodSet.add(period);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }

    // Simpan SEMUA kolom asli apa adanya (raw) — dipakai export "GL Data Mentah"
    // supaya kolom yang tidak dipakai untuk kalkulasi (Reference Number, Created
    // By, Notes, Project, dst) tetap ikut ter-export persis seperti file asli.
    const raw = {};
    for (const h of allHeaders) {
      raw[h.text] = cellToRawValue(row.getCell(h.colNumber));
    }

    rows.push({
      date: date ? date.toISOString() : null,
      period,
      coaNo,
      coaDescription,
      branch: branch || '(Tanpa Cabang)',
      department: department || null,
      debit: effectiveDebit,
      credit: effectiveCredit,
      balance,
      classification: classification.class,
      sub: classification.sub,
      value,
      raw,
    });
  });

  if (rows.length === 0) {
    throw new GLParseError('Tidak ada baris transaksi yang terbaca dari file GL.');
  }

  const periodLabel = manualPeriodLabel || metadataLabel || (periodSet.size ? [...periodSet].sort().join(' s/d ') : 'YTD');

  return {
    meta: {
      periodLabel,
      periods: [...periodSet].sort(),
      hasDatePerRow: columnMap.date != null && periodSet.size > 0,
      dateRange: minDate && maxDate ? { min: minDate.toISOString().slice(0, 10), max: maxDate.toISOString().slice(0, 10) } : null,
      branches: [...branchSet].sort(),
      departments: [...deptSet].sort(),
      rowCount: rows.length,
      detectedColumns: Object.keys(columnMap),
      calculationMethod,
      unclassifiedCoaCount: unclassifiedCoaSet.size,
      unclassifiedCoaSample: [...unclassifiedCoaSet].slice(0, 10),
      headerRow,
    },
    rows,
  };
}

module.exports = { parseGLBuffer, classifyAccount, GLParseError };
