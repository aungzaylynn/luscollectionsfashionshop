// One-time secure Telegram webhook setup endpoint.
// Call POST /api/telegram/setup with Authorization: Bearer <TELEGRAM_SETUP_SECRET>
// Required: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_SETUP_SECRET
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const setupSecret = process.env.TELEGRAM_SETUP_SECRET;
  const auth = req.headers.authorization || '';
  if (!setupSecret || auth !== `Bearer ${setupSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookSecret) return res.status(500).json({ error: 'Missing Telegram environment variables' });
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}/api/telegram/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: webhookSecret, allowed_updates: ['message'] }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return res.status(502).json({ error: 'Telegram setWebhook failed', detail: data.description || 'Unknown error' });
  return res.status(200).json({ ok: true, message: 'Telegram webhook configured.' });
};
