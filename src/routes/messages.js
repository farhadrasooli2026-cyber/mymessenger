const express = require('express');

const { USERNAME_RE } = require('../config');
const { dbAll } = require('../db');
const { sanitizeText } = require('../helpers');
const { requireAuth } = require('../http/auth');

const router = express.Router();

router.get('/api/messages/:other', requireAuth, async (req, res) => {
  const me = req.session.user.username;
  const other = sanitizeText(req.params.other, 32);
  if (!USERNAME_RE.test(other)) return res.status(400).json({ error: 'کاربر نامعتبر است.' });
  const rows = await dbAll(
    `SELECT id, sender, receiver, message, type, caption, timestamp
     FROM messages
     WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
     ORDER BY timestamp ASC, id ASC
     LIMIT 500`,
    [me, other, other, me]
  );
  res.json(rows);
});

module.exports = router;
