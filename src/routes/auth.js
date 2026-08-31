const bcrypt = require('bcryptjs');
const express = require('express');

const { BCRYPT_ROUNDS, USERNAME_RE } = require('../config');
const { db, dbRun, dbGet } = require('../db');
const { publicUser, sanitizeText } = require('../helpers');
const { authLimiter } = require('../http/auth');

function createAuthRouter(userSockets) {
  const router = express.Router();

  router.post('/api/register', authLimiter, async (req, res) => {
    try {
      const username = sanitizeText(req.body.username, 32);
      const email = sanitizeText(req.body.email, 80);
      const phone = sanitizeText(req.body.phone, 20);
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const gender = req.body.gender === 'مرد' ? 'مرد' : 'زن';

      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'نام کاربری باید ۳ تا ۳۲ کاراکتر، حروف، عدد یا نقطه باشد.' });
      }
      if (password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await dbRun(
        'INSERT INTO users (username, email, phone, password, password_hash, gender, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, email || null, phone || null, null, passwordHash, gender, 'offline']
      );

      const user = publicUser({ username, gender, profilePic: '', bio: '', status: 'offline' });
      req.session.user = { username };
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: 'خطا در ایجاد نشست.' });
        res.json({ success: true, user });
      });
    } catch (err) {
      if (err && err.message && err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
      }
      res.status(500).json({ error: 'خطا در ثبت‌نام.' });
    }
  });

  router.post('/api/login', authLimiter, async (req, res) => {
    try {
      const username = sanitizeText(req.body.username, 32);
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const row = await dbGet(
        'SELECT username, gender, profilePic, bio, status, lastSeen, password, password_hash FROM users WHERE username = ?',
        [username]
      );
      if (!row) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      let ok = false;
      if (row.password_hash) {
        ok = await bcrypt.compare(password, row.password_hash);
      } else if (row.password && row.password === password) {
        ok = true;
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await dbRun('UPDATE users SET password_hash = ?, password = NULL WHERE username = ?', [hash, username]);
      }
      if (!ok) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      req.session.user = { username: row.username };
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: 'خطا در ایجاد نشست.' });
        res.json({ success: true, user: publicUser(row) });
      });
    } catch (_err) {
      res.status(500).json({ error: 'خطا در ورود.' });
    }
  });

  router.post('/api/logout', (req, res) => {
    const username = req.session && req.session.user && req.session.user.username;
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      if (username && !userSockets.has(username)) {
        const now = new Date().toISOString();
        db.run('UPDATE users SET status = ?, lastSeen = ? WHERE username = ?', ['offline', now, username]);
      }
      res.json({ success: true });
    });
  });

  return router;
}

module.exports = { createAuthRouter };
