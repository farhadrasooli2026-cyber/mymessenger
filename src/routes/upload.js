const express = require('express');

const { requireAuth } = require('../http/auth');
const { upload, uploadLimiter } = require('../http/upload');

const router = express.Router();

router.post('/api/upload', requireAuth, uploadLimiter, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.message === 'نوع فایل مجاز نیست.' ? err.message : 'آپلود ناموفق بود. حجم حداکثر ۸ مگابایت.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد.' });
    const url = `/uploads/${req.file.filename}`;
    const kind = req.file.mimetype.startsWith('audio/') ? 'audio' : 'image';
    res.json({ success: true, url, type: kind, mime: req.file.mimetype });
  });
});

module.exports = router;
