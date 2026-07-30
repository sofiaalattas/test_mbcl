const fs = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'data', 'status.json');
const KEY_PREFIX = 'papan-status-tim:status:';

const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = Boolean(kvUrl && kvToken);

let redis = null;
if (useKv) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: kvUrl, token: kvToken });
}

function readFileStatuses() {
  if (!fs.existsSync(STATUS_FILE)) return {};
  const raw = fs.readFileSync(STATUS_FILE, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function writeFileStatus(name, data) {
  const statuses = readFileStatuses();
  statuses[name] = data;
  const tmpFile = `${STATUS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(statuses, null, 2));
  fs.renameSync(tmpFile, STATUS_FILE);
}

// names: daftar nama anggota tim, dipakai untuk tahu key mana yang perlu dibaca dari KV.
async function getAllStatuses(names) {
  if (useKv) {
    const values = await Promise.all(names.map((name) => redis.get(KEY_PREFIX + name)));
    const statuses = {};
    names.forEach((name, i) => {
      if (values[i]) statuses[name] = values[i];
    });
    return statuses;
  }
  return readFileStatuses();
}

async function setStatus(name, data) {
  if (useKv) {
    await redis.set(KEY_PREFIX + name, data);
    return;
  }
  writeFileStatus(name, data);
}

module.exports = { getAllStatuses, setStatus, useKv };
