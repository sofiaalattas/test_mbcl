const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const GL_KEY = 'financial-dashboard:gl-data';

// Upstash (paket gratis/Hobby) menolak SET dengan payload > 10 MB
// ("ERR max request size exceeded"). Data GL yang sudah di-parse (rows +
// kolom "raw" asli per baris) bisa jauh melebihi itu untuk file berisi
// puluhan ribu baris. Gzip JSON-nya sebelum dikirim ke Redis — teksnya
// sangat repetitif (key yang sama diulang di tiap baris) jadi rasio
// kompresinya besar (~15-20x), dan sisakan margin aman di bawah limit asli
// supaya masih ada ruang untuk overhead base64 + command lain.
const KV_SAFE_LIMIT_BYTES = 9 * 1024 * 1024;

class GLDataTooLargeError extends Error {
  constructor(sizeBytes) {
    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
    const limitMb = (KV_SAFE_LIMIT_BYTES / 1024 / 1024).toFixed(0);
    super(
      `Data GL terlalu besar untuk disimpan (${sizeMb} MB setelah dikompres, batas ${limitMb} MB). ` +
        'Coba upload dengan rentang periode yang lebih pendek atau kurangi jumlah baris, lalu upload sisanya secara terpisah.'
    );
    this.name = 'GLDataTooLargeError';
    this.code = 'GL_DATA_TOO_LARGE';
  }
}

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
    const stored = await redis.get(GL_KEY);
    if (!stored) return null;
    // Data lama (sebelum fix kompresi ini) tersimpan sebagai object biasa
    // (auto-serialize bawaan client @upstash/redis) — deteksi & tetap
    // dukung supaya tidak crash saat baca dataset yang diupload sebelum
    // update ini di-deploy.
    if (typeof stored !== 'string') return stored;
    try {
      const json = zlib.gunzipSync(Buffer.from(stored, 'base64')).toString('utf8');
      return JSON.parse(json);
    } catch (err) {
      console.error('[store] Gagal decompress data GL dari Redis:', err.message);
      return null;
    }
  }
  return readFileGL();
}

async function setGL(data) {
  if (useKv) {
    const json = JSON.stringify(data);
    const compressed = zlib.gzipSync(json).toString('base64');
    const sizeBytes = Buffer.byteLength(compressed, 'utf8');
    if (sizeBytes > KV_SAFE_LIMIT_BYTES) {
      throw new GLDataTooLargeError(sizeBytes);
    }
    await redis.set(GL_KEY, compressed);
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

module.exports = { getGL, setGL, clearGL, useKv, GLDataTooLargeError };
