const path = require('path');

const PORT = process.env.PORT || 10000;
const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const ROOT_DIR = path.join(__dirname, '..');
const publicDir = path.join(ROOT_DIR, 'public');
const uploadDir = path.join(publicDir, 'uploads');

const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
};

function getSessionSecret() {
  return process.env.SESSION_SECRET || 'mymessenger-dev-session-secret';
}

module.exports = {
  PORT,
  BCRYPT_ROUNDS,
  USERNAME_RE,
  ROOT_DIR,
  publicDir,
  uploadDir,
  ALLOWED_MIME,
  getSessionSecret,
};
