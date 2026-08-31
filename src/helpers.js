function publicUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    gender: row.gender || 'زن',
    profilePic: row.profilePic || '',
    bio: row.bio || '',
    status: row.status || 'offline',
    lastSeen: row.lastSeen || null,
  };
}

function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLen);
}

function isSafeUploadUrl(url) {
  return typeof url === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(url);
}

module.exports = {
  publicUser,
  sanitizeText,
  isSafeUploadUrl,
};
