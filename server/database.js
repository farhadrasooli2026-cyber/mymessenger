const Database = require("better-sqlite3");

const db = new Database("mymessenger.db");

// ساخت جدول کاربران
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        password TEXT NOT NULL,
        gender TEXT DEFAULT 'female',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// ساخت جدول پیام‌ها
db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id)
    )
`).run();

module.exports = db;