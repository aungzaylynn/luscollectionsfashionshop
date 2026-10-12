const TELEGRAM_API = 'https://api.telegram.org';

async function supabaseRequest(base, key, path, options = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return { response, data };
}

async function sendTelegram(token, chatId, text) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description || response.status}`);
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = process.env.TELEGRAM_OWNER_ID;
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!token || !ownerId || !base || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Telegram/Supabase server environment variables are missing.' });
  }

  const orderNo = String(req.body?.orderNo || '').trim();
  if (!orderNo || orderNo.length > 80) {
    return res.status(400).json({ ok: false, error: 'A valid orderNo is required.' });
  }

  try {
    const filter = `order_no=eq.${encodeURIComponent(orderNo)}&select=id,order_no,customer_name,phone,email,address,note,payment_method,payment_reference,payment_status,order_status,subtotal,delivery_fee,total,created_at,telegram_notified_at`;
    const orderResult = await supabaseRequest(base, serviceKey, `/rest/v1/orders?${filter}`);
    const orders = orderResult.data;
    if (!Array.isArray(orders) || !orders.length) {
      return res.status(404).json({ ok: false, error: 'Order not found.' });
    }
    const order = orders[0];

    if (order.telegram_notified_at) {
      return res.status(200).json({ ok: true, alreadyNotified: true });
    }

    const itemsResult = await supabaseRequest(
      base,
      serviceKey,
      `/rest/v1/order_items?order_id=eq.${order.id}&select=product_name,price,qty,size,color`
    );
    const items = Array.isArray(itemsResult.data) ? itemsResult.data : [];

    // Atomically claim this order's notification so duplicate requests do not send duplicate messages.
    const claimed = await supabaseRequest(
      base,
      serviceKey,
      `/rest/v1/orders?id=eq.${order.id}&telegram_notified_at=is.null&select=id`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ telegram_notified_at: new Date().toISOString() }),
      }
    );
    if (!Array.isArray(claimed.data) || !claimed.data.length) {
      return res.status(200).json({ ok: true, alreadyNotified: true });
    }

    const fmt = (value) => Number(value || 0).toLocaleString('en-US');
    const itemLines = items.map((item, i) => {
      const options = [item.size && `Size ${item.size}`, item.color && `Color ${item.color}`].filter(Boolean).join(', ');
      return `${i + 1}. ${item.product_name} × ${item.qty}${options ? ` (${options})` : ''} — ${fmt(item.price * item.qty)} ကျပ်`;
    });
    const message = [
      '🛍️ Lu’s Collections — Order အသစ်',
      `Order No: ${order.order_no}`,
      `Status: ${order.order_status || 'pending'}`,
      '',
      `Customer: ${order.customer_name}`,
      `Phone: ${order.phone}`,
      order.email ? `Email: ${order.email}` : null,
      `Address: ${order.address}`,
      order.note ? `Note: ${order.note}` : null,
      '',
      'ပစ္စည်းများ:',
      ...(itemLines.length ? itemLines : ['Order items မတွေ့ပါ']),
      '',
      `Subtotal: ${fmt(order.subtotal)} ကျပ်`,
      `Delivery: ${fmt(order.delivery_fee)} ကျပ်`,
      `Total: ${fmt(order.total)} ကျပ်`,
      `Payment: ${order.payment_method}`,
      `Payment status: ${order.payment_status || 'pending'}`,
      order.payment_reference ? `Payment reference: ${order.payment_reference}` : null,
    ].filter((line) => line !== null).join('\n');

    try {
      await sendTelegram(token, ownerId, message);
    } catch (sendError) {
      // Allow a later retry if Telegram delivery fails.
      await supabaseRequest(
        base,
        serviceKey,
        `/rest/v1/orders?id=eq.${order.id}&telegram_notified_at=not.is.null`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ telegram_notified_at: null }),
        }
      ).catch(() => {});
      throw sendError;
    }

    return res.status(200).json({ ok: true, notified: true });
  } catch (error) {
    console.error('Telegram order notification error:', error);
    return res.status(500).json({ ok: false, error: 'Could not send Telegram order notification.' });
  }
};

module.exports.config = { api: { bodyParser: true } };
