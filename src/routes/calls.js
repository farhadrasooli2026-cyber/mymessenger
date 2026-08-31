const express = require('express');

const { dbAll } = require('../db');
const { requireAuth } = require('../http/auth');

const router = express.Router();

router.get('/api/calls', requireAuth, async (req, res) => {
  const me = req.session.user.username;
  const rows = await dbAll(
    `SELECT callId, caller, callee, video, status, startedAt, endedAt
     FROM calls
     WHERE caller = ? OR callee = ?
     ORDER BY id DESC
     LIMIT 80`,
    [me, me]
  );
  res.json(rows || []);
});

module.exports = router;
