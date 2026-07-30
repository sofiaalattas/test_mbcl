const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TEAM_FILE = path.join(__dirname, 'data', 'team.json');
const STATUS_FILE = path.join(__dirname, 'data', 'status.json');
const VALID_STATUSES = ['Belum Mulai', 'Dikerjakan', 'Selesai'];
const TASK_MAX_LENGTH = 60;

function readTeam() {
  const raw = fs.readFileSync(TEAM_FILE, 'utf8');
  const names = JSON.parse(raw);
  if (!Array.isArray(names)) throw new Error('data/team.json harus berupa daftar (array) nama');
  return names;
}

function readStatuses() {
  if (!fs.existsSync(STATUS_FILE)) return {};
  const raw = fs.readFileSync(STATUS_FILE, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function writeStatuses(statuses) {
  const tmpFile = `${STATUS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(statuses, null, 2));
  fs.renameSync(tmpFile, STATUS_FILE);
}

function getBoard() {
  const team = readTeam();
  const statuses = readStatuses();
  return team.map((name) => {
    const entry = statuses[name];
    return {
      name,
      status: entry ? entry.status : 'Belum Mulai',
      task: entry ? entry.task : '',
      updatedAt: entry ? entry.updatedAt : null,
    };
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/team', (req, res) => {
  try {
    res.json(getBoard());
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca data tim.' });
  }
});

app.post('/api/status', (req, res) => {
  try {
    const { name, status, task } = req.body || {};
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

    const statuses = readStatuses();
    statuses[name] = {
      status,
      task: trimmedTask,
      updatedAt: new Date().toISOString(),
    };
    writeStatuses(statuses);

    res.json(getBoard());
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan status.' });
  }
});

app.listen(PORT, () => {
  console.log(`Papan Status Tim jalan di http://localhost:${PORT}`);
});
