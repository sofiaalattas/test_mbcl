const express = require('express');
const multer = require('multer');
const path = require('path');

const store = require('./lib/store');
const attachments = require('./lib/attachments');
const auth = require('./lib/auth');
const { parseGLBuffer, GLParseError } = require('./lib/excel-parser');
const calc = require('./lib/calculations');
const { buildReportWorkbookBuffer, buildCombinedWorkbookBuffer } = require('./lib/excel-export');

const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Ukuran file maksimal ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB.` });
    }
    return res.status(400).json({ error: 'Gagal mengunggah file.' });
  });
}

const REPORT_BUILDERS = {
  overview: (rows, q) => calc.computeOverview(rows, q),
  pnl: (rows, q) => calc.computePnL(rows, q),
  balance: (rows, q) => calc.computeBalanceSheet(rows, q),
  cashflow: (rows, q) => calc.computeCashFlow(rows, q),
  branch: (rows, q) => calc.computeBranchPerformance(rows, q),
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(attachments.UPLOAD_DIR));

// ---- Auth ----
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ error: 'Password salah.' });
  }
  const { token, expiresAt } = auth.createToken();
  res.json({ token, expiresAt });
});

// Semua route /api/* di bawah ini butuh sesi valid.
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/health') return next();
  return auth.requireAuth(req, res, next);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- FEATURE 1: Upload & Processing ----
app.post('/api/upload', handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File GL (.xlsx) wajib diunggah.' });
    }
    const originalName = req.file.originalname || '';
    if (!/\.xlsx$/i.test(originalName)) {
      return res.status(400).json({ error: 'File harus berformat .xlsx.' });
    }

    let parsed;
    try {
      parsed = await parseGLBuffer(req.file.buffer, { periodLabel: req.body && req.body.periodLabel });
    } catch (err) {
      if (err instanceof GLParseError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // Ganti file lama (jika ada) dengan yang baru — simpan file asli sebagai arsip.
    const previous = await store.getGL();
    let sourceAttachment = null;
    try {
      sourceAttachment = await attachments.saveAttachment(req.file);
      if (previous && previous.sourceAttachment) {
        await attachments.deleteAttachment(previous.sourceAttachment);
      }
    } catch (err) {
      // Kalau penyimpanan arsip file asli gagal, tetap lanjut — data hasil parse tetap valid.
      console.error('Gagal menyimpan arsip file GL asli:', err.message);
    }

    const glData = {
      meta: { ...parsed.meta, uploadedAt: new Date().toISOString(), filename: originalName },
      rows: parsed.rows,
      sourceAttachment,
    };
    try {
      await store.setGL(glData);
    } catch (err) {
      if (err instanceof store.GLDataTooLargeError) {
        return res.status(413).json({ error: err.message });
      }
      throw err;
    }

    res.json({ success: true, meta: glData.meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses file GL.' });
  }
});

app.get('/api/gl/meta', async (req, res) => {
  try {
    const gl = await store.getGL();
    if (!gl) return res.status(404).json({ error: 'Belum ada data GL yang diunggah.' });
    res.json({ meta: gl.meta });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca data GL.' });
  }
});

// Baris GL mentah (sudah difilter) — dipakai tombol Export Excel di tab Upload GL.
// Sengaja tidak digabung ke /api/gl/meta supaya payload normal (meta saja) tetap
// ringan; baris lengkap (termasuk `raw` semua kolom asli) hanya diambil saat
// admin benar-benar klik export.
app.get('/api/gl/rows', async (req, res) => {
  try {
    const gl = await store.getGL();
    if (!gl) return res.status(404).json({ error: 'Belum ada data GL yang diunggah.' });

    const { period, branch, dept, dateFrom, dateTo } = req.query;
    const rows = calc.filterRows(gl.rows, { period, branch, department: dept, dateFrom, dateTo });
    res.json({ meta: gl.meta, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membaca baris GL.' });
  }
});

// ---- FEATURE 2-6: Reports ----
app.get('/api/reports/:type', async (req, res) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'Tipe laporan tidak dikenal.' });

    const gl = await store.getGL();
    if (!gl) return res.status(404).json({ error: 'Belum ada data GL yang diunggah.' });

    const { period, branch, dept, dateFrom, dateTo } = req.query;
    const data = builder(gl.rows, { period, branch, department: dept, dateFrom, dateTo });
    res.json({ meta: gl.meta, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghitung laporan.' });
  }
});

// ---- FEATURE 7: Export to Excel (semua laporan sekaligus, 1 file 5 sheet) ----
// Didaftarkan SEBELUM /api/export/:type supaya path literal "/all" tidak
// ketangkap sebagai parameter :type oleh route generik di bawahnya.
app.get('/api/export/all', async (req, res) => {
  try {
    const gl = await store.getGL();
    if (!gl) return res.status(404).json({ error: 'Belum ada data GL yang diunggah.' });

    const { period, branch, dept, dateFrom, dateTo } = req.query;
    const filters = { period, branch, department: dept, dateFrom, dateTo };
    const buffer = await buildCombinedWorkbookBuffer(
      {
        pnl: calc.computePnL(gl.rows, filters),
        balance: calc.computeBalanceSheet(gl.rows, filters),
        cashflow: calc.computeCashFlow(gl.rows, filters),
        branch: calc.computeBranchPerformance(gl.rows, filters),
        glRows: gl.rows,
      },
      gl.meta
    );

    const periodPart = (period && period !== 'ALL' ? period : gl.meta.periodLabel || 'YTD').replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `Laporan_Keuangan_Lengkap_${periodPart}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat file Excel gabungan.' });
  }
});

// ---- FEATURE 7: Export to Excel ----
app.get('/api/export/:type', async (req, res) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'Tipe laporan tidak dikenal.' });

    const gl = await store.getGL();
    if (!gl) return res.status(404).json({ error: 'Belum ada data GL yang diunggah.' });

    const { period, branch, dept, dateFrom, dateTo } = req.query;
    const data = builder(gl.rows, { period, branch, department: dept, dateFrom, dateTo });
    const buffer = await buildReportWorkbookBuffer(req.params.type, data, gl.meta);

    const periodPart = (period && period !== 'ALL' ? period : gl.meta.periodLabel || 'YTD').replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `${req.params.type}_${periodPart}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat file Excel.' });
  }
});

app.listen(PORT, () => {
  console.log(
    `Financial Dashboard jalan di http://localhost:${PORT} (data: ${store.useKv ? 'Redis' : 'file lokal'}, file: ${attachments.useBlob ? 'Vercel Blob' : 'file lokal'})`
  );
});
