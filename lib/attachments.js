const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
const useBlob = Boolean(blobToken);

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
