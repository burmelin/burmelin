const https = require('https');

// /sitemap.xml - the shop's pages plus one entry per active product, read
// live from the catalogue so new products appear without a deploy.
// Served through a redirect in netlify.toml. Env: SUPABASE_URL, SUPABASE_ANON_KEY.

const SITE = 'https://burmelin.com';
// The blog-*.html pages are left out while they are "Coming Soon" placeholders
// (they also carry noindex). Add them back once they have real articles.
const PAGES = ['', 'products.html', 'about.html', 'stores.html',
  'privacy.html', 'terms.html'];

function getJson(url, key) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

exports.handler = async () => {
  const urls = PAGES.map(p => ({ loc: SITE + '/' + p }));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const rows = await getJson(url + '/rest/v1/products?select=id,created_at&active=eq.true', key);
      if (Array.isArray(rows)) {
        rows.forEach(r => urls.push({
          loc: SITE + '/product.html?id=' + encodeURIComponent(r.id),
          lastmod: r.created_at ? String(r.created_at).slice(0, 10) : null,
        }));
      }
    } catch (e) {
      console.error('sitemap: product list failed', e.message);
    }
  }
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + xmlEsc(u.loc) + '</loc>' +
      (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '</url>').join('\n') +
    '\n</urlset>\n';
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    body,
  };
};
