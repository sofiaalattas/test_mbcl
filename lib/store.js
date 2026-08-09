const fs = require('fs');
const os = require('os');
const path = require('path');

const GL_KEY = 'financial-dashboard:gl-data';

const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = Boolean(kvUrl && kvToken);

let redis = null;
if (useKv) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: kvUrl, token: kvToken });
}

// Direktori "data/" di dalam project tidak writable di serverless (mis. Vercel
// tanpa KV_REST_API_URL/TOKEN di-set — deployment bundle-nya read-only). Kalau
// itu terjadi, jatuh ke os.tmpdir() supaya app tidak crash, walau data hanya
// bertahan sebentar (per-invocation). Ini SATU-SATUNYA jalan lewat kalau Redis
// belum dikonfigurasi di production — bukan pengganti setup Redis yang benar.
function resolveDataDir() {
  const preferred = path.join(__dirname, '..', 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch (err) {
    const fallback = path.join(os.tmpdir(), 'financial-dashboard-data');
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(
      `[store] Direktori "data/" tidak writable (${err.code}), memakai ${fallback} sebagai fallback sementara. ` +
        'Data TIDAK akan tersimpan permanen — set KV_REST_API_URL & KV_REST_API_TOKEN (Upstash Redis) di environment variables production.'
    );
    return fallback;
  }
}

const GL_FILE = useKv ? null : path.join(resolveDataDir(), 'gl-data.json');

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
