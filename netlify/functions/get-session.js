const https = require('https');

function stripeGet(secretKey, sessionId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.stripe.com',
      path: '/v1/checkout/sessions/' + sessionId + '?expand[]=customer_details',
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

async function saveToSupabase(supabaseUrl, serviceKey, orderId, customer) {
  const body = JSON.stringify({
    customer_name: customer.name || 'Stripe Customer',
    email:   customer.email || '',
    phone:   customer.phone || '',
    address: customer.address || ''
  });

  return new Promise((resolve, reject) => {
    const url = new URL(supabaseUrl + '/rest/v1/orders?order_id=eq.' + encodeURIComponent(orderId));
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'PATCH',
      headers: {
        'apikey':        serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
  if (!sessionId || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid session_id' }) };
  }

  const secretKey    = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

  if (!secretKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not set' }) };

  try {
    const session  = await stripeGet(secretKey, sessionId);
    if (session.error) throw new Error(session.error.message);

    const customer = session.customer_details || {};
    const orderId  = session.metadata && session.metadata.order_id;
    // Where the parcel goes. Newer Stripe API versions keep it under
    // collected_information; older ones under shipping_details. Only fall
    // back to the billing address when neither exists, because a gift can
    // be paid by one person and shipped to another.
    const shipping = (session.collected_information && session.collected_information.shipping_details)
                  || session.shipping_details
                  || {};
    const addr     = shipping.address || customer.address || {};
    const recipient = shipping.name && shipping.name !== customer.name ? shipping.name : '';

    const result = {
      name:    customer.name || '',
      email:   customer.email || '',
      phone:   customer.phone || '',
      address: [recipient && 'Ship to: ' + recipient, addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join(', '),
      orderId: orderId || '',
      // Lets the success page tell a confirmed payment from a pending
      // PromptPay one, and report the real total to analytics.
      paid:    session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
      total:   (session.amount_total || 0) / 100
    };

    if (orderId && supabaseUrl && serviceKey) {
      await saveToSupabase(supabaseUrl, serviceKey, orderId, { ...customer, address: result.address });
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch(err) {
    console.error('get-session error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not load order' }) };
  }
};
