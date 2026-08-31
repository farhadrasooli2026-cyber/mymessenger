const path = require('path');
const express = require('express');

const { publicDir } = require('../config');
const { requirePageAuth } = require('../http/auth');

function sendPage(file) {
  return (_req, res) => res.sendFile(path.join(publicDir, file));
}

const router = express.Router();

router.get('/', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/chat.html');
  res.sendFile(path.join(publicDir, 'login.html'));
});
router.get('/chat.html', requirePageAuth, sendPage('chat.html'));
router.get('/profile.html', requirePageAuth, sendPage('profile.html'));
router.get('/login.html', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/chat.html');
  res.sendFile(path.join(publicDir, 'login.html'));
});

module.exports = router;
