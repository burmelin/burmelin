// Server-side data layer for the admin panel.
//
// The panel used to talk to Supabase directly, which meant shipping the
// database URL, a database key and the admin password inside admin.html -
// a file anyone can read. This function keeps all three on the server: the
// browser sends only the password the user typed, and never sees a
// database credential.
//
// Requires two Netlify environment variables:
//   ADMIN_PASSWORD           - the admin panel login
//   SUPABASE_SERVICE_KEY     - the service_role key (bypasses RLS)

const https  = require('https');
const crypto = require('crypto');

// Only these tables may be reached, and only with a PostgREST query string.
// Anything else - rpc endpoints, other tables, path traversal - is refused.
const ALLOWED_PATH   = /^(products|orders)(\?[A-Za-z0-9_.,=&*()%\-:+']*)?$/;
const ALLOWED_METHOD = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

function timingSafeEqual(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual throws on length mismatch, so compare digests instead -
  // equal length regardless of input, and still constant time.
  const ha = crypto.createHash('sha256').update(A).digest();
  const hb = crypto.createHash('sha256').update(B).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function supabaseRequest(url, key, method, bodyStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── LOGIN THROTTLE ────────────────────────────────────────────────────
//
// Slows password guessing. Every wrong password costs the caller a fixed
// delay, and an address that keeps failing is locked out for a while.
//
// The counter lives in the function's memory, so it only holds while the
// same instance stays warm and is not shared between instances. It makes
// guessing slow, not impossible: the real protection is a long, random
// ADMIN_PASSWORD (16+ characters).
const FAIL_DELAY_MS   = 1500;
const MAX_FAILS       = 5;
const LOCKOUT_MS      = 15 * 60 * 1000;
const failures        = new Map();   // ip -> { count, until }

const sleep = ms => new Promise(r => setTimeout(r, ms));

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] ||
         String(h['x-forwarded-for'] || '').split(',')[0].trim() ||
         'unknown';
}

function isLockedOut(ip) {
  const f = failures.get(ip);
  return !!(f && f.until && f.until > Date.now());
}

function recordFailure(ip) {
  const now = Date.now();
  const f = failures.get(ip) || { count: 0, until: 0 };
  if (f.until && f.until <= now) { f.count = 0; f.until = 0; }
  f.count += 1;
  if (f.count >= MAX_FAILS) f.until = now + LOCKOUT_MS;
  failures.set(ip, f);
  // Keep the map from growing without bound on a long-lived instance.
  if (failures.size > 5000) failures.clear();
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_KEY;

  if (!adminPassword || !supabaseUrl || !serviceKey) {
    // Never say which one is missing.
    console.error('admin-api misconfigured:',
      { hasPassword: !!adminPassword, hasUrl: !!supabaseUrl, hasKey: !!serviceKey });
    return json(500, { error: 'Admin API is not configured.' });
  }

  const ip = clientIp(event);
  if (isLockedOut(ip)) {
    await sleep(FAIL_DELAY_MS);
    return json(429, { error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const supplied = event.headers['x-admin-key'] || event.headers['X-Admin-Key'] || '';
  if (!timingSafeEqual(supplied, adminPassword)) {
    recordFailure(ip);
    console.warn('admin-api: failed login from', ip);
    await sleep(FAIL_DELAY_MS);
    return json(401, { error: 'Unauthorized' });
  }
  failures.delete(ip);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const path   = String(payload.path || '');
  const method = String(payload.method || 'GET').toUpperCase();

  if (!ALLOWED_METHOD.has(method)) {
    return json(400, { error: 'Method not allowed: ' + method });
  }
  if (!ALLOWED_PATH.test(path)) {
    return json(400, { error: 'Path not allowed' });
  }

  try {
    const bodyStr = payload.body ? JSON.stringify(payload.body) : null;
    const result  = await supabaseRequest(
      supabaseUrl + '/rest/v1/' + path, serviceKey, method, bodyStr
    );

    return {
      statusCode: result.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: result.body || '[]',
    };
  } catch (err) {
    console.error('admin-api error:', err.message);
    return json(502, { error: 'Database request failed' });
  }
};
