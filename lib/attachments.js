const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const useBlob = Boolean(blobToken);

const LOCAL_UPLOAD_BASE = path.join(__dirname, '..', 'data', 'uploads');

// Sama seperti lib/store.js: "data/uploads" di project bisa read-only di
// serverless (mis. Vercel tanpa BLOB_READ_WRITE_TOKEN di-set). Jatuh ke
// os.tmpdir() supaya tidak crash — tapi ini bukan pengganti setup Vercel Blob
// yang benar untuk production (file di tmpdir tidak permanen).
function resolveUploadDir() {
  try {
    fs.mkdirSync(LOCAL_UPLOAD_BASE, { recursive: true });
    fs.accessSync(LOCAL_UPLOAD_BASE, fs.constants.W_OK);
    return LOCAL_UPLOAD_BASE;
  } catch (err) {
    const fallback = path.join(os.tmpdir(), 'financial-dashboard-uploads');
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(
      `[attachments] Direktori "data/uploads" tidak writable (${err.code}), memakai ${fallback} sebagai fallback sementara. ` +
        'File TIDAK akan tersimpan permanen — set BLOB_READ_WRITE_TOKEN (Vercel Blob) di environment variables production.'
    );
    return fallback;
  }
}

// Dipakai juga oleh server.js untuk mount express.static('/uploads', UPLOAD_DIR).
// Kalau useBlob aktif, path ini tidak pernah dibaca (URL attachment langsung ke
// Blob), jadi cukup default ke LOCAL_UPLOAD_BASE tanpa perlu writable-check di sini.
const UPLOAD_DIR = useBlob ? LOCAL_UPLOAD_BASE : resolveUploadDir();

function sanitizeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-100);
}

function uniqueStorageKey(originalName) {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sanitizeFilename(originalName)}`;
}

// file: { buffer, originalname, mimetype, size } dari multer (memoryStorage).
async function saveAttachment(file) {
  const storageKey = uniqueStorageKey(file.originalname);

  if (useBlob) {
    const { put } = require('@vercel/blob');
    const blob = await put(`lampiran/${storageKey}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      token: blobToken,
    });
    return {
      name: file.originalname,
      url: blob.url,
      size: file.size,
      type: file.mimetype,
      storageKey: blob.pathname,
    };
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), file.buffer);
  return {
    name: file.originalname,
    url: `/uploads/${storageKey}`,
    size: file.size,
    type: file.mimetype,
    storageKey,
  };
}

// Best-effort: kalau gagal hapus (mis. sudah terhapus), diamkan saja, jangan sampai gagalkan request.
async function deleteAttachment(attachment) {
  if (!attachment || !attachment.storageKey) return;

  try {
    if (useBlob) {
      const { del } = require('@vercel/blob');
      await del(attachment.storageKey, { token: blobToken });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, attachment.storageKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    // abaikan - penghapusan lampiran lama bersifat best-effort
  }
}

module.exports = { saveAttachment, deleteAttachment, useBlob, UPLOAD_DIR };
