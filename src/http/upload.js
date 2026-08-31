const crypto = require('crypto');
const path = require('path');

const multer = require('multer');
const rateLimit = require('express-rate-limit');

const { ALLOWED_MIME, uploadDir } = require('../config');

const EXT_FROM_NAME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

function resolveMime(file) {
  const raw = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED_MIME[raw]) return raw === 'image/jpg' || raw === 'image/pjpeg' ? 'image/jpeg' : raw;

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (EXT_FROM_NAME[ext]) return EXT_FROM_NAME[ext];

  if (!raw || raw === 'application/octet-stream' || raw === 'application/x-download') {
    return '';
  }
  return '';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const mime = resolveMime(file) || file.mimetype;
    const ext = ALLOWED_MIME[mime] || ALLOWED_MIME[file.mimetype] || 'bin';
    cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = resolveMime(file);
    if (mime) {
      file.mimetype = mime;
      cb(null, true);
    } else cb(new Error('نوع فایل مجاز نیست.'));
  },
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد آپلود بیش از حد مجاز است.' },
});

module.exports = {
  upload,
  uploadLimiter,
};
