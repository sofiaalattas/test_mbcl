const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const attachments = require('./lib/attachments');

const PORT = process.env.PORT || 3000;
const TEAM_FILE = path.join(__dirname, 'data', 'team.json');
const VALID_STATUSES = ['Belum Mulai', 'Dikerjakan', 'Selesai'];
const TASK_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 500;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
});

function handleUpload(req, res, next) {
  upload.single('attachment')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Ukuran lampiran maksimal ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB.` });
    }
    return res.status(400).json({ error: 'Gagal mengunggah lampiran.' });
  });
}

function readTeam() {
  const raw = fs.readFileSync(TEAM_FILE, 'utf8');
  const names = JSON.parse(raw);
  if (!Array.isArray(names)) throw new Error('data/team.json harus berupa daftar (array) nama');
  return names;
}

async function getBoard() {
  const team = readTeam();
  const statuses = await store.getAllStatuses(team);
  return team.map((name) => {
    const entry = statuses[name];
    return {
      name,
      status: entry ? entry.status : 'Belum Mulai',
      task: entry ? entry.task : '',
      description: entry ? entry.description || '' : '',
      attachment: entry ? entry.attachment || null : null,
      updatedAt: entry ? entry.updatedAt : null,
    };
  });
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(attachments.UPLOAD_DIR));

app.get('/api/team', async (req, res) => {
  try {
    res.json(await getBoard());
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca data tim.' });
  }
});

app.get('/api/export.csv', async (req, res) => {
  try {
    const board = await getBoard();
    const header = ['Nama', 'Status', 'Tugas Singkat'];
    const rows = board.map((a) => [a.name, a.status, a.task]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="papan-status-tim.csv"');
    res.send('﻿' + csv); // BOM supaya Excel membaca UTF-8 dengan benar
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat file CSV.' });
  }
});

app.post('/api/status', handleUpload, async (req, res) => {
  try {
    const { name, status, task, description, removeAttachment } = req.body || {};
    const team = readTeam();

    if (typeof name !== 'string' || !team.includes(name)) {
      return res.status(400).json({ error: 'Nama tidak dikenali.' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid.' });
    }
    const trimmedTask = typeof task === 'string' ? task.trim() : '';
    if (trimmedTask.length > TASK_MAX_LENGTH) {
      return res.status(400).json({ error: `Nama tugas maksimal ${TASK_MAX_LENGTH} karakter.` });
    }
    const trimmedDescription = typeof description === 'string' ? description.trim() : '';
    if (trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
      return res.status(400).json({ error: `Deskripsi maksimal ${DESCRIPTION_MAX_LENGTH} karakter.` });
    }

    const existing = (await store.getAllStatuses(team))[name];
    let attachment = existing ? existing.attachment || null : null;

    if (req.file) {
      const lampiranLama = attachment;
      attachment = await attachments.saveAttachment(req.file);
      if (lampiranLama) await attachments.deleteAttachment(lampiranLama);
    } else if (removeAttachment === 'true' && attachment) {
      await attachments.deleteAttachment(attachment);
      attachment = null;
    }

    await store.setStatus(name, {
      status,
      task: trimmedTask,
      description: trimmedDescription,
      attachment,
      updatedAt: new Date().toISOString(),
    });

    res.json(await getBoard());
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan status.' });
  }
});

app.listen(PORT, () => {
  console.log(`Papan Status Tim jalan di http://localhost:${PORT} (status: ${store.useKv ? 'Redis' : 'file lokal'}, lampiran: ${attachments.useBlob ? 'Vercel Blob' : 'file lokal'})`);
});
