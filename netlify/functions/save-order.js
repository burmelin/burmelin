const https = require('https');

// Records a WhatsApp order enquiry so it shows in the admin panel.
//
// This endpoint is public (the shop calls it from the browser), so it trusts
// nothing it is sent:
//   * every row it writes is a WhatsApp enquiry with status Pending - a
//     caller cannot mark an order Paid, Processing or anything else
//   * only known products are recorded, at their database price
//   * the order id and date are set here
//
// Stripe orders are no longer written through here: create-checkout creates
// them itself with server-side prices.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (orders has no public policy).

const MAX_LINES = 30;
const MAX_QTY   = 20;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

function request(url, key, method, bodyStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    };
    if (bodyStr) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
      headers['Prefer'] = 'return=minimal';
    }
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase ' + method + ' failed with ' + res.statusCode));
        }
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { reject(new Error('Invalid response from Supabase')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Request timed out')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if ((event.body || '').length > 20000) {
    return json(413, { error: 'Too large' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return json(500, { error: 'Not configured' });
  }

  let items;
  try {
    ({ items } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }
  if (!Array.isArray(items) || !items.length || items.length > MAX_LINES) {
    return json(400, { error: 'Invalid cart' });
  }

  try {
    const products = await request(
      url + '/rest/v1/products?select=id,name,price,active', key, 'GET'
    );
    const active = products.filter(p => p.active !== false);
    const byId   = new Map(active.map(p => [String(p.id), p]));
    const byName = new Map(active.map(p => [String(p.name).trim().toLowerCase(), p]));

    const lines = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const p = (item.id && byId.get(String(item.id)))
             || byName.get(String(item.name || '').trim().toLowerCase());
      if (!p) continue;
      const qty = Math.min(Math.max(parseInt(item.qty, 10) || 1, 1), MAX_QTY);
      lines.push({
        id:    p.id,
        name:  p.name,
        color: cleanText(item.color, 40),
        size:  cleanText(item.size, 20),
        qty,
        price: Number(p.price) || 0,
      });
    }
    if (!lines.length) return json(400, { error: 'No known products in cart' });

    await request(url + '/rest/v1/orders', key, 'POST', JSON.stringify({
      order_id:      'WA-' + Date.now(),
      customer_name: 'WhatsApp',
      items:         lines,
      total:         lines.reduce((s, l) => s + l.price * l.qty, 0),
      status:        'Pending',
      date:          new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }),
    }));
    return json(200, { ok: true });
  } catch (err) {
    console.error('save-order error:', err.message);
    return json(500, { error: 'Could not save order' });
  }
};
