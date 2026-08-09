const fs = require('fs');
const path = require('path');

const GL_FILE = path.join(__dirname, '..', 'data', 'gl-data.json');
const GL_KEY = 'financial-dashboard:gl-data';

const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = Boolean(kvUrl && kvToken);

let redis = null;
if (useKv) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: kvUrl, token: kvToken });
}

function readFileGL() {
  if (!fs.existsSync(GL_FILE)) return null;
  const raw = fs.readFileSync(GL_FILE, 'utf8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function writeFileGL(data) {
  fs.mkdirSync(path.dirname(GL_FILE), { recursive: true });
  const tmpFile = `${GL_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, GL_FILE);
}

// Dataset GL saat ini: { meta, rows, sourceAttachment }. Selalu 1 dataset aktif —
// upload baru menggantikan (replace) yang lama, sesuai spec "file replacement".
async function getGL() {
  if (useKv) {
    const data = await redis.get(GL_KEY);
    return data || null;
  }
  return readFileGL();
}

async function setGL(data) {
  if (useKv) {
    await redis.set(GL_KEY, data);
    return;
  }
  writeFileGL(data);
}

async function clearGL() {
  if (useKv) {
    await redis.del(GL_KEY);
    return;
  }
  if (fs.existsSync(GL_FILE)) fs.unlinkSync(GL_FILE);
}

module.exports = { getGL, setGL, clearGL, useKv };
