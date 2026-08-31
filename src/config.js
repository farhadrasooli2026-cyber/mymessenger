const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 12;
const USERNAME_RE = /^[\w\u0600-\u06FF.]{3,32}$/;
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
};

const publicDir = path.join(ROOT_DIR, 'public');
const uploadDir = path.join(publicDir, 'uploads');

function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const secretFile = path.join(ROOT_DIR, '.session-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

module.exports = {
  ROOT_DIR,
  PORT,
  BCRYPT_ROUNDS,
  USERNAME_RE,
  ALLOWED_MIME,
  publicDir,
  uploadDir,
  getSessionSecret,
};
