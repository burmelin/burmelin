const https  = require('https');
const crypto = require('crypto');

function stripeGet(secretKey, sessionId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions/' + sessionId + '?expand[]=line_items&expand[]=customer_details',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + secretKey }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function sendEmailNotification(resendKey, order) {
  return new Promise((resolve, reject) => {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f5f1;padding:32px;border-radius:12px">
        <div style="background:#0054A5;padding:20px 28px;border-radius:8px;margin-bottom:24px">
          <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px">BURMELIN</h1>
          <p style="color:rgba(255,255,255,.6);margin:4px 0 0;font-size:12px">New Order Received</p>
        </div>
        <div style="background:#fff;padding:24px;border-radius:8px;margin-bottom:16px">
          <h2 style="color:#111;margin:0 0 16px;font-size:16px">🛍️ New Order — ฿${esc(order.amount)}</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#666;width:140px">Order ID</td><td style="padding:8px 0;font-weight:600">${esc(order.orderId)}</td></tr>
            <tr style="border-top:1px solid #eee"><td style="padding:8px 0;color:#666">Customer</td><td style="padding:8px 0;font-weight:600">${esc(order.name)}</td></tr>
            <tr style="border-top:1px solid #eee"><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0">${esc(order.email)}</td></tr>
            <tr style="border-top:1px solid #eee"><td style="padding:8px 0;color:#666">Phone</td><td style="padding:8px 0">${esc(order.phone)}</td></tr>
            <tr style="border-top:1px solid #eee"><td style="padding:8px 0;color:#666">Shipping To</td><td style="padding:8px 0">${esc(order.address)}</td></tr>
            <tr style="border-top:1px solid #eee"><td style="padding:8px 0;color:#666">Amount Paid</td><td style="padding:8px 0;font-weight:700;color:#0054A5;font-size:16px">฿${esc(order.amount)}</td></tr>
          </table>
        </div>
        <div style="text-align:center;margin-top:20px">
          <a href="https://burmelin.com/admin.html" style="background:#0054A5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">View in Admin Panel</a>
        </div>
        <p style="color:#999;font-size:11px;text-align:center;margin-top:20px">BURMELIN · Bangkok, Thailand</p>
      </div>`;

    const body = JSON.stringify({
      from: 'BURMELIN Orders <orders@burmelin.com>',
      to: ['burmelinco@gmail.com'],
      subject: `New Order ฿${order.amount} — ${order.name}`,
      html
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendCustomerEmail(resendKey, order) {
  return new Promise((resolve, reject) => {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f5f1">

        <!-- Header -->
        <div style="background:#0054A5;padding:28px 32px 24px">
          <div style="font-size:26px;font-weight:700;letter-spacing:4px;color:#fff">BURMELIN</div>
          <div style="width:40px;height:2px;background:#C9A96E;margin:10px 0 0"></div>
        </div>

        <!-- Hero -->
        <div style="background:#fff;padding:36px 32px 28px;border-bottom:3px solid #C9A96E">
          <div style="font-size:13px;letter-spacing:3px;color:#C9A96E;text-transform:uppercase;margin-bottom:12px">Order Confirmed</div>
          <h1 style="margin:0 0 12px;font-size:24px;color:#111118;font-weight:700">Thank you, ${esc(String(order.name).split(' ')[0])}.</h1>
          <p style="margin:0;color:#555;font-size:15px;line-height:1.6">Your order has been received and is being prepared with care. We will have it ready and dispatched within <strong>1–3 business days</strong>.</p>
        </div>

        <!-- Order Summary -->
        <div style="background:#fff;margin-top:2px;padding:28px 32px">
          <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:16px">Order Summary</div>
          <table style="width:100%;border-collapse:collapse">
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:12px 0;color:#111;font-size:14px">${esc(order.items)}</td>
              <td style="padding:12px 0;color:#0054A5;font-size:14px;font-weight:700;text-align:right">฿${esc(order.amount)}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;color:#999;font-size:13px">Receipt</td>
              <td style="padding:12px 0;color:#555;font-size:13px;text-align:right">#${esc(order.receiptId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#999;font-size:13px">Shipping to</td>
              <td style="padding:4px 0;color:#555;font-size:13px;text-align:right">${esc(order.address || 'Address on file')}</td>
            </tr>
          </table>
        </div>

        <!-- What happens next -->
        <div style="background:#0054A5;margin:2px 0;padding:28px 32px">
          <div style="font-size:11px;letter-spacing:2px;color:#C9A96E;text-transform:uppercase;margin-bottom:20px">What Happens Next</div>
          <div style="display:flex;margin-bottom:16px">
            <div style="width:28px;height:28px;border-radius:50%;background:#C9A96E;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;flex-shrink:0;margin-right:14px">1</div>
            <div style="color:rgba(255,255,255,.85);font-size:14px;padding-top:4px">Our team carefully prepares and quality-checks your item.</div>
          </div>
          <div style="display:flex;margin-bottom:16px">
            <div style="width:28px;height:28px;border-radius:50%;background:#C9A96E;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;flex-shrink:0;margin-right:14px">2</div>
            <div style="color:rgba(255,255,255,.85);font-size:14px;padding-top:4px">Your order is dispatched within 1–3 business days.</div>
          </div>
          <div style="display:flex">
            <div style="width:28px;height:28px;border-radius:50%;background:#C9A96E;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:28px;flex-shrink:0;margin-right:14px">3</div>
            <div style="color:rgba(255,255,255,.85);font-size:14px;padding-top:4px">We'll notify you with tracking details once shipped.</div>
          </div>
        </div>

        <!-- Contact -->
        <div style="background:#fff;margin-top:2px;padding:28px 32px">
          <div style="font-size:11px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:14px">Need Help?</div>
          <p style="color:#555;font-size:14px;margin:0 0 10px">We're here for you — reach out anytime.</p>
          <a href="https://wa.me/66642071080" style="display:inline-block;background:#25D366;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-right:10px">WhatsApp Us</a>
          <a href="mailto:burmelinco@gmail.com" style="display:inline-block;background:#f0f0f0;color:#333;padding:10px 22px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Email Us</a>
        </div>

        <!-- Footer -->
        <div style="padding:20px 32px;text-align:center">
          <div style="font-size:13px;letter-spacing:3px;color:#0054A5;font-weight:700;margin-bottom:4px">BURMELIN</div>
          <div style="font-size:11px;color:#aaa">Bangkok, Thailand · burmelin.com</div>
          <div style="font-size:11px;color:#ccc;margin-top:12px">This email confirms your order. For payment queries, refer to your Stripe receipt.</div>
        </div>

      </div>`;

    const body = JSON.stringify({
      from: 'BURMELIN <orders@burmelin.com>',
      to: [order.email],
      subject: `Your BURMELIN order is confirmed — ฿${order.amount}`,
      html
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Plain Supabase REST call; resolves to the parsed JSON body.
function supabaseCall(supabaseUrl, serviceKey, method, path, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const url = new URL(supabaseUrl + '/rest/v1/' + path);
    const headers = {
      'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json', 'Prefer': 'return=representation',
    };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase ' + method + ' failed with ' + res.statusCode));
        }
        try { resolve(JSON.parse(data || 'null')); } catch (e) { resolve(null); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// PATCH the order and return the rows that actually changed. `filter` is
// an extra PostgREST condition, used so the "paid" transition happens once.
function updateOrder(supabaseUrl, serviceKey, orderId, filter, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(supabaseUrl + '/rest/v1/orders?order_id=eq.' +
      encodeURIComponent(orderId) + (filter ? '&' + filter : ''));
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'PATCH',
      headers: {
        'apikey':         serviceKey,
        'Authorization':  'Bearer ' + serviceKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer':         'return=representation',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase PATCH failed with ' + res.statusCode + ': ' + data.slice(0, 200)));
        }
        try { resolve(JSON.parse(data || '[]')); } catch (e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── SIGNATURE ─────────────────────────────────────────────────────────
//
// Stripe signs `${timestamp}.${rawBody}` with the endpoint secret. The
// header can carry several v1 signatures (during secret rotation), and the
// timestamp must be recent so an old captured event cannot be replayed.
const TOLERANCE_SECONDS = 300;

function verifySignature(rawBody, header, secret) {
  if (!header) return false;
  let timestamp = null;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') timestamp = v;
    if (k === 'v1') sigs.push(v);
  }
  if (!timestamp || !sigs.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody, 'utf8').digest();
  return sigs.some(s => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// ── EVENTS ────────────────────────────────────────────────────────────
//
// checkout.session.completed fires when the customer finishes the Stripe
// page. For cards the money is in by then (payment_status 'paid'). For
// PromptPay and other delayed methods it can still be 'unpaid': the money
// arrives later as checkout.session.async_payment_succeeded, or never
// (checkout.session.async_payment_failed). An order is only marked
// Processing, and only gets its emails, once the payment is confirmed.
//
// The Stripe webhook endpoint must be subscribed to all three events.
const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

// Statuses an order can be in before it is paid. The paid transition only
// applies from one of these, so a retried event never re-sends emails and
// never undoes Shipped/Delivered set in the admin panel.
const UNPAID_FILTER = 'status=in.(Pending,"Awaiting payment")';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secretKey     = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const resendKey     = process.env.RESEND_API_KEY;

  // Refuse to run unverified: without the secret anyone could post events.
  if (!secretKey || !webhookSecret) {
    console.error('stripe-webhook misconfigured:', { stripe: !!secretKey, secret: !!webhookSecret });
    return { statusCode: 500, body: 'Webhook not configured' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  if (!verifySignature(rawBody, event.headers['stripe-signature'], webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!HANDLED.has(stripeEvent.type)) {
    return { statusCode: 200, body: 'Ignored event: ' + stripeEvent.type };
  }

  try {
    // Re-read the session from Stripe rather than trusting the event body.
    const session  = await stripeGet(secretKey, stripeEvent.data.object.id);
    if (session.error) throw new Error(session.error.message);

    const customer = session.customer_details || {};
    // Where the parcel goes. Newer Stripe API versions keep it under
    // collected_information; older ones under shipping_details. Only fall
    // back to the billing address when neither exists, because a gift can
    // be paid by one person and shipped to another.
    const shipping = (session.collected_information && session.collected_information.shipping_details)
                  || session.shipping_details
                  || {};
    const addr     = shipping.address || customer.address || {};
    const recipient = shipping.name && shipping.name !== customer.name ? shipping.name : '';
    const orderId  = (session.metadata && session.metadata.order_id) || session.client_reference_id;

    const fullAddress = [
      recipient && 'Ship to: ' + recipient,
      addr.line1, addr.line2, addr.city,
      addr.state, addr.postal_code, addr.country
    ].filter(Boolean).join(', ');

    const contact = {
      customer_name: customer.name || shipping.name || 'Stripe Customer',
      email:         customer.email || '',
      phone:         customer.phone || '',
      address:       fullAddress,
    };

    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';

    if (!orderId || !supabaseUrl || !serviceKey) {
      // Nothing to update, but still tell the owner so a payment is never lost.
      console.error('Webhook: no order to update', { orderId, hasDb: !!(supabaseUrl && serviceKey) });
    }

    if (stripeEvent.type === 'checkout.session.async_payment_failed') {
      if (orderId && supabaseUrl && serviceKey) {
        await updateOrder(supabaseUrl, serviceKey, orderId, UNPAID_FILTER,
          { ...contact, status: 'Payment failed' });
      }
      console.log(`Order ${orderId} payment failed`);
      return { statusCode: 200, body: JSON.stringify({ received: true, orderId, paid: false }) };
    }

    if (!paid) {
      // Finished the Stripe page but the money has not arrived (PromptPay
      // pending). Record who it is, but do not confirm anything yet.
      if (orderId && supabaseUrl && serviceKey) {
        await updateOrder(supabaseUrl, serviceKey, orderId, UNPAID_FILTER,
          { ...contact, status: 'Awaiting payment' });
      }
      console.log(`Order ${orderId} awaiting payment (${session.payment_status})`);
      return { statusCode: 200, body: JSON.stringify({ received: true, orderId, paid: false }) };
    }

    // Paid. Move the order to Processing exactly once; emails go out only
    // on that first transition, so Stripe's retries do not duplicate them.
    let firstTime = true;
    if (orderId && supabaseUrl && serviceKey) {
      const changed = await updateOrder(supabaseUrl, serviceKey, orderId, UNPAID_FILTER,
        { ...contact, status: 'Processing' });
      firstTime = changed.length > 0;
      if (!firstTime) {
        // Either already processed (a retry) or the row was never created.
        // In the second case write it now, so a paid order is never missing.
        const existing = await supabaseCall(supabaseUrl, serviceKey, 'GET',
          'orders?select=id&order_id=eq.' + encodeURIComponent(orderId));
        if (Array.isArray(existing) && existing.length === 0) {
          const items = session.line_items && session.line_items.data
            ? session.line_items.data.map(i => ({
                name: i.description, qty: i.quantity, price: (i.price && i.price.unit_amount || 0) / 100 }))
            : [];
          await supabaseCall(supabaseUrl, serviceKey, 'POST', 'orders', {
            order_id: orderId, items, total: (session.amount_total || 0) / 100,
            date: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }),
            ...contact, status: 'Processing',
          });
          firstTime = true;
        }
      }
    }
    if (!firstTime) {
      return { statusCode: 200, body: JSON.stringify({ received: true, orderId, duplicate: true }) };
    }

    const amountPaid = ((session.amount_total || 0) / 100).toLocaleString();

    if (resendKey) {
      try {
        await sendEmailNotification(resendKey, {
          orderId: orderId || 'N/A',
          name:    contact.customer_name,
          email:   contact.email || '—',
          phone:   contact.phone || '—',
          address: fullAddress || '—',
          amount:  amountPaid
        });
      } catch (e) {
        console.error('Owner email failed:', e.message);
      }

      if (contact.email) {
        try {
          const lineItems = session.line_items && session.line_items.data
            ? session.line_items.data.map(i => `${i.description} × ${i.quantity}`).join(', ')
            : 'Your order';
          await sendCustomerEmail(resendKey, {
            name:      contact.customer_name,
            email:     contact.email,
            address:   fullAddress || '',
            amount:    amountPaid,
            receiptId: orderId || session.id,
            items:     lineItems
          });
        } catch (e) {
          console.error('Customer email failed:', e.message);
        }
      }
    }

    console.log(`Order ${orderId} paid — ฿${amountPaid}`);
    return { statusCode: 200, body: JSON.stringify({ received: true, orderId, paid: true }) };
  } catch (err) {
    // 500 makes Stripe retry, which is what we want for a database hiccup.
    console.error('Webhook error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook processing failed' }) };
  }
};

exports._verifySignature = verifySignature;
