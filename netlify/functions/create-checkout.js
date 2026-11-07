const https  = require('https');
const crypto = require('crypto');

// Creates the Stripe Checkout session AND the order row, both from data the
// server trusts.
//
// The browser sends only what the customer picked: product id (or name),
// colour, size and quantity. Everything that decides how much money changes
// hands - which product it is, its name and its price - comes from the
// database. A cart line that does not match an active product is refused,
// and if the database cannot be reached checkout stops rather than trusting
// the browser's prices.
//
// Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
// (SUPABASE_ANON_KEY is accepted for the read, but the order insert needs
// the service key because `orders` has no public policy). URL is set by
// Netlify to the site's primary address.

// ── SHIPPING ───────────────────────────────────────────
//
// Thailand only, shipping free.
//
// Deliberately not offering international. Hosted Checkout fixes the
// shipping options when the session is created and shows all of them to
// every customer, so a paid international option sitting next to a free
// domestic one is unenforceable - a buyer abroad would simply pick the free
// one. Charging for international requires knowing the destination before
// the session exists, which means collecting it in the cart first.
const SHIPPING_COUNTRIES = ['TH'];
const SHIPPING_OPTIONS = [
  { name: 'Free Shipping', min: 1, max: 3 },
];

const MAX_LINES = 30;     // Stripe allows 100; no real cart gets near 30
const MAX_QTY   = 20;

// Only images we host may be shown on the Stripe page.
const IMAGE_PREFIX = 'https://res.cloudinary.com/dtpvflgt1/';

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

// ── AVAILABILITY ──────────────────────────────────────────────────────
//
// Mirrors the `variants` map written by the admin panel:
//   { "Navy": { "S": false } }
// A missing key means AVAILABLE — only an explicit false is sold out.
function isAvailable(p, colorName, sizeName) {
  const v = p && p.variants;
  if (!v || typeof v !== 'object') return true;
  const row = v[colorName || ''];
  if (!row || typeof row !== 'object') return true;
  return row[sizeName || ''] !== false;
}

function request(opts, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Request timed out')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function supabase(url, key, method, bodyStr) {
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
  const res = await request({
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method,
    headers,
  }, bodyStr);
  if (res.status < 200 || res.status >= 300) {
    throw new Error('Supabase ' + method + ' failed with ' + res.status);
  }
  return res.body ? JSON.parse(res.body) : null;
}

async function stripeCreateSession(secretKey, bodyStr) {
  const res = await request({
    hostname: 'api.stripe.com',
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr),
    },
  }, bodyStr);
  const session = JSON.parse(res.body);
  if (session.error) throw new Error(session.error.message);
  return session;
}

// Short free text the customer chose (colour, size). Kept as text, but
// bounded so it cannot be used to stuff the Stripe page or the order.
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function cleanQty(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

// Matches every cart line to an active product row. Returns either
// { error } for the customer, or { lines } priced from the database.
function resolveCart(items, products) {
  const active = products.filter(p => p.active !== false);
  const byId   = new Map(active.map(p => [String(p.id), p]));
  const byName = new Map(active.map(p => [String(p.name).trim().toLowerCase(), p]));

  const lines   = [];
  const missing = [];
  const soldOut = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') { missing.push('an item'); continue; }

    // Carts saved before the id was added carry only a name, so fall back
    // to an exact (case-insensitive) name match.
    const p = (item.id && byId.get(String(item.id)))
           || byName.get(String(item.name || '').trim().toLowerCase());

    if (!p) { missing.push(cleanText(item.name, 60) || 'an item'); continue; }

    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) { missing.push(p.name); continue; }

    const color    = cleanText(item.color, 40);
    const hasSizes = Array.isArray(p.sizes) && p.sizes.length > 0;
    const size     = hasSizes ? cleanText(item.size, 20) : '';

    if (!isAvailable(p, color, size)) {
      soldOut.push([p.name, color, size].filter(Boolean).join(' · '));
      continue;
    }

    // Picture: the colour's own image from the catalogue, then the image
    // the cart carried if it is one of ours, then the product's main image.
    const colorRow = Array.isArray(p.colors)
      ? p.colors.find(c => c && c.name === color)
      : null;
    const candidates = [colorRow && colorRow.img, item.img, p.img];
    const img = candidates.find(u => typeof u === 'string' && u.startsWith(IMAGE_PREFIX)) || '';

    lines.push({
      id:    p.id,
      name:  p.name,
      color,
      size,
      qty:   cleanQty(item.qty || item.quantity),
      price,
      img,
    });
  }

  if (missing.length) {
    return { status: 400, error:
      'These items are no longer available: ' + missing.join(', ') +
      '. Please remove them from your cart and add them again.' };
  }
  if (soldOut.length) {
    return { status: 409, error:
      'Sold out: ' + soldOut.join(', ') + '. Please remove it from your cart and try again.',
      soldOut };
  }
  return { lines };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sbUrl     = process.env.SUPABASE_URL;
  const sbService = process.env.SUPABASE_SERVICE_KEY;
  const sbRead    = sbService || process.env.SUPABASE_ANON_KEY;

  if (!secretKey || !sbUrl || !sbService) {
    console.error('create-checkout misconfigured:',
      { stripe: !!secretKey, url: !!sbUrl, service: !!sbService });
    return json(500, { error: 'Checkout is not available right now. Please contact us on WhatsApp.' });
  }

  let items;
  try {
    ({ items } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { error: 'Invalid request' });
  }
  if (!Array.isArray(items) || !items.length) return json(400, { error: 'Cart is empty' });
  if (items.length > MAX_LINES) return json(400, { error: 'Too many items in one order' });

  // Prices come from here and nowhere else. If the database cannot be read,
  // refuse rather than fall back to what the browser sent.
  let products;
  try {
    products = await supabase(
      sbUrl + '/rest/v1/products?select=id,name,price,sizes,colors,variants,img,active', sbRead, 'GET'
    );
    if (!Array.isArray(products)) throw new Error('Unexpected products response');
  } catch (e) {
    console.error('Product lookup failed:', e.message);
    return json(503, { error: 'Checkout is temporarily unavailable. Please try again in a minute.' });
  }

  const resolved = resolveCart(items, products);
  if (resolved.error) {
    return json(resolved.status, { error: resolved.error, soldOut: resolved.soldOut });
  }
  const lines = resolved.lines;
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);

  // The order row is written here, server side, with the database prices,
  // so it exists for every checkout no matter which page started it.
  const orderId = 'ORD-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  try {
    await supabase(sbUrl + '/rest/v1/orders', sbService, 'POST', JSON.stringify({
      order_id:      orderId,
      customer_name: 'Stripe Checkout',
      items:         lines,
      total,
      status:        'Pending',
      date:          new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }),
    }));
  } catch (e) {
    console.error('Order insert failed:', e.message);
    return json(503, { error: 'Checkout is temporarily unavailable. Please try again in a minute.' });
  }

  // Never taken from the request: a caller-supplied origin would let anyone
  // use this Stripe account to send buyers to a site of their choosing.
  const baseUrl = (process.env.URL || 'https://burmelin.com').replace(/\/+$/, '');

  const params = {};
  params['mode'] = 'payment';
  params['success_url'] = baseUrl + '/success.html?session_id={CHECKOUT_SESSION_ID}';
  params['cancel_url'] = baseUrl + '/products.html';
  params['phone_number_collection[enabled]'] = 'true';
  params['client_reference_id'] = orderId;
  params['metadata[order_id]'] = orderId;
  params['payment_intent_data[metadata][order_id]'] = orderId;

  SHIPPING_COUNTRIES.forEach((c, i) => {
    params['shipping_address_collection[allowed_countries][' + i + ']'] = c;
  });

  SHIPPING_OPTIONS.forEach((opt, i) => {
    const k = 'shipping_options[' + i + '][shipping_rate_data]';
    params[k + '[type]']                     = 'fixed_amount';
    params[k + '[fixed_amount][amount]']     = '0';
    params[k + '[fixed_amount][currency]']   = 'thb';
    params[k + '[display_name]']             = opt.name;
    params[k + '[delivery_estimate][minimum][unit]']  = 'business_day';
    params[k + '[delivery_estimate][minimum][value]'] = String(opt.min);
    params[k + '[delivery_estimate][maximum][unit]']  = 'business_day';
    params[k + '[delivery_estimate][maximum][value]'] = String(opt.max);
  });

  lines.forEach((l, i) => {
    const k = 'line_items[' + i + ']';
    params[k + '[price_data][currency]'] = 'thb';
    params[k + '[price_data][product_data][name]'] = l.name;
    const desc = [l.color && 'Color: ' + l.color, l.size && 'Size: ' + l.size].filter(Boolean).join(' | ');
    if (desc) params[k + '[price_data][product_data][description]'] = desc;
    params[k + '[price_data][unit_amount]'] = String(Math.round(l.price * 100));
    params[k + '[quantity]'] = String(l.qty);
    if (l.img) params[k + '[price_data][product_data][images][0]'] = l.img;
  });

  const encode = obj => Object.entries(obj)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  try {
    const session = await stripeCreateSession(secretKey, encode(params));
    return json(200, { url: session.url, orderId });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return json(502, { error: 'Could not start checkout. Please try again.' });
  }
};

// Exposed for local tests only.
exports._resolveCart = resolveCart;
