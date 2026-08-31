const rateLimit = require('express-rate-limit');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'لطفاً وارد حساب شوید.' });
  }
  next();
}

function requirePageAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کنید.' },
});

module.exports = {
  requireAuth,
  requirePageAuth,
  authLimiter,
};
