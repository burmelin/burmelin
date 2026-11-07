const https = require('https');

function supabaseGet(url, anonKey) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid response from Supabase')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Product photos are uploaded at full camera size (often 1-2 MB, 4000px+).
// Ask Cloudinary for a modern format, automatic quality and a sensible
// width instead, which cuts each image by roughly 90% with no visible loss.
// Only plain upload URLs are changed; one that already has transformations
// is left as it is.
const CLD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/)/;
const CLD_CHAIN = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)q_auto\/f_auto\/(v\d+\/)/;
function optimise(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(CLD_CHAIN, '$1f_auto,q_auto,w_1200/$2')
    .replace(CLD, '$1f_auto,q_auto,w_1200/$2');
}

function optimiseProduct(p) {
  if (!p || typeof p !== 'object') return p;
  const out = { ...p, img: optimise(p.img) };
  if (Array.isArray(p.colors)) {
    out.colors = p.colors.map(c => (c && typeof c === 'object') ? { ...c, img: optimise(c.img) } : c);
  }
  return out;
}

exports.handler = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Supabase env vars not set' }),
    };
  }

  try {
    const data = await supabaseGet(
      url + '/rest/v1/products?active=eq.true&order=created_at.desc',
      key
    );
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify(Array.isArray(data) ? data.map(optimiseProduct) : data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
