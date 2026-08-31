const path = require('path');

const PORT = process.env.PORT || 10000;
const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const publicDir = path.join(__dirname, '../public');
const uploadDir = path.join(__dirname, '../public/uploads');

module.exports = {
  PORT,
  BCRYPT_ROUNDS,
  USERNAME_RE,
  publicDir,
  uploadDir
};