const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { ROOT_DIR } = require('./config');

const db = new sqlite3.Database(path.join(ROOT_DIR, 'database.db'));

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function addColumnIfMissing(table, column, definition) {
  const cols = await dbAll(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT,
    phone TEXT,
    password TEXT,
    gender TEXT,
    profilePic TEXT,
    bio TEXT,
    status TEXT DEFAULT 'offline',
    lastSeen DATETIME
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    receiver TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumnIfMissing('users', 'password_hash', 'TEXT');
  await addColumnIfMissing('messages', 'type', "TEXT DEFAULT 'text'");
  await addColumnIfMissing('messages', 'caption', 'TEXT');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender, receiver, timestamp)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)');
  await dbRun(`CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    callId TEXT UNIQUE,
    caller TEXT,
    callee TEXT,
    video INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ringing',
    startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    endedAt DATETIME
  )`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_calls_users ON calls (caller, callee, id)');
}

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  initDb,
};
