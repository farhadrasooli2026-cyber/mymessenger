const express = require('express');

const { dbRun, dbGet, dbAll } = require('../db');
const { publicUser, sanitizeText, isSafeUploadUrl } = require('../helpers');
const { requireAuth } = require('../http/auth');

const router = express.Router();

router.get('/api/me', requireAuth, async (req, res) => {
  const row = await dbGet(
    'SELECT username, gender, profilePic, bio, status, lastSeen FROM users WHERE username = ?',
    [req.session.user.username]
  );
  if (!row) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'کاربر یافت نشد.' });
  }
  res.json({ success: true, user: publicUser(row) });
});

router.post('/api/update-profile', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const bio = sanitizeText(req.body.bio, 280);
    let profilePic = sanitizeText(req.body.profilePic, 80);
    if (profilePic && !isSafeUploadUrl(profilePic) && profilePic !== '/girl.svg' && profilePic !== '/boy.svg') {
      profilePic = '';
    }
    await dbRun('UPDATE users SET profilePic = ?, bio = ? WHERE username = ?', [profilePic, bio, username]);
    const row = await dbGet(
      'SELECT username, gender, profilePic, bio, status, lastSeen FROM users WHERE username = ?',
      [username]
    );
    res.json({ success: true, user: publicUser(row) });
  } catch (_err) {
    res.status(500).json({ error: 'خطا در ذخیره پروفایل.' });
  }
});

router.get('/api/users', requireAuth, async (req, res) => {
  const rows = await dbAll(
    'SELECT username, gender, profilePic, bio, status, lastSeen FROM users ORDER BY username COLLATE NOCASE'
  );
  res.json(rows.map(publicUser));
});

module.exports = router;
