async function api(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (isForm) {
    delete headers['Content-Type'];
    delete headers['content-type'];
  } else if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_e) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || 'خطا در ارتباط با سرور.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeText(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value.endsWith('Z') || value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) return '';
    return fallback.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}
