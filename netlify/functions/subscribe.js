const https = require('https');

// Newsletter signup from the home page.
//
// Saves the address in the `subscribers` table (see supabase-schema.sql).
// Until that table exists, or if the database is down, it emails the
// address to the shop owner instead, so no signup is ever lost.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY (fallback).

const OWNER_EMAIL = 'burmelinco@gmail.com';
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,24}$/;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

function post(hostname, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Request timed out')));
    req.write(bodyStr);
    req.end();
  });
}

async function saveToDb(email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;
  const u = new URL(url + '/rest/v1/subscribers?on_conflict=email');
  const res = await post(u.hostname, u.pathname + u.search, {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    // Signing up twice is fine: the second time changes nothing.
    'Prefer': 'resolution=ignore-duplicates,return=minimal',
  }, JSON.stringify({ email, source: 'website' }));
  if (res.status >= 200 && res.status < 300) return true;
  console.error('subscribe: database insert failed', res.status, res.body.slice(0, 200));
  return false;
}

async function emailOwner(email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await post('api.resend.com', '/emails', { 'Authorization': 'Bearer ' + key }, JSON.stringify({
    from: 'BURMELIN <orders@burmelin.com>',
    to: [OWNER_EMAIL],
    subject: 'New newsletter signup',
    text: 'New newsletter signup from burmelin.com: ' + email,
  }));
  return res.status >= 200 && res.status < 300;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if ((event.body || '').length > 1000) return json(413, { error: 'Too large' });

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { error: 'Invalid request' });
  }
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'Please enter a valid email address.' });

  try {
    if (await saveToDb(email)) return json(200, { ok: true });
    if (await emailOwner(email)) return json(200, { ok: true });
  } catch (e) {
    console.error('subscribe error:', e.message);
  }
  return json(503, { error: 'Sorry, we could not sign you up right now. Please try again later.' });
};
