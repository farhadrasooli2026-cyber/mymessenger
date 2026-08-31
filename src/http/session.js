const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { ROOT_DIR, getSessionSecret } = require('../config');

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: ROOT_DIR }),
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

function wrapSession(middleware) {
  return (socket, next) => {
    middleware(socket.request, {}, next);
  };
}

module.exports = {
  sessionMiddleware,
  wrapSession,
};
