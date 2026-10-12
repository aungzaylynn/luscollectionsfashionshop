// Lu's Collections Telegram bot webhook (Vercel serverless function).
// Required Vercel environment variables:
// TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID, TELEGRAM_WEBHOOK_SECRET,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const crypto = require('crypto');

const tgApi = (token, method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
});

async function sendMessage(token, chatId, text) {
  return tgApi(token, 'sendMessage', { chat_id: chatId, text });
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || `product-${Date.now()}`;
}

function parseCaption(caption) {
  // Expected one field per line, e.g.:
  // Name: Linen Blouse
  // Price: 25000
  // Category: Top & Blouse
  // Description: Soft and comfortable
  // Stock: 5
  // Sizes: S, M, L
  // Colors: Black, White
  const fields = {};
  for (const line of String(caption || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(name|price|category|description|stock|old_price|badge|sizes|colors|featured)\s*:\s*(.*?)\s*$/i);
    if (match) fields[match[1].toLowerCase()] = match[2];
  }
  return fields;
}

async function supabaseRequest(base, serviceKey, path, options = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerId = String(process.env.TELEGRAM_OWNER_ID || '');
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !ownerId || !webhookSecret) {
    return res.status(500).json({ error: 'Telegram environment variables are not configured.' });
  }

  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!incomingSecret || incomingSecret.length !== webhookSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(incomingSecret), Buffer.from(webhookSecret))) {
    return res.status(401).json({ error: 'Unauthorized webhook request.' });
  }

  try {
    const update = req.body || {};
    const message = update.message;
    if (!message || !message.chat || !message.from) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const fromId = String(message.from.id);
    if (fromId !== ownerId) {
      await sendMessage(token, chatId, 'ဒီ Bot ကို ခွင့်ပြုထားတဲ့ Admin သာ အသုံးပြုနိုင်ပါတယ်။');
      return res.status(200).json({ ok: true });
    }

    const text = String(message.text || message.caption || '').trim();
    if (text === '/start' || text === '/help') {
      await sendMessage(token, chatId,
        'မင်္ဂလာပါ။ Lu’s Collections Shop Bot အသင့်ဖြစ်ပါပြီ။\\n\\nProduct တင်ရန် ဓာတ်ပုံတစ်ပုံပို့ပြီး Caption ကို ဒီပုံစံနဲ့ ဖြည့်ပါ။\\n\\nName: Linen Blouse\\nPrice: 25000\\nCategory: Top & Blouse\\nDescription: ပေါ့ပါးနူးညံ့သော အင်္ကျီ\\nStock: 5\\nSizes: S, M, L\\nColors: Black, White\\nOld_price: 30000\\nBadge: NEW\\nFeatured: false\\n\\nPrice ကို ကျပ်ငွေ ဂဏန်းသက်သက်ရေးပါ။ ပုံနဲ့ Caption ကို တစ်ခါတည်း ပို့ပါ။');
      return res.status(200).json({ ok: true });
    }

    if (!message.photo || !message.photo.length) {
      await sendMessage(token, chatId, 'Product တင်ရန် ဓာတ်ပုံတစ်ပုံကို Caption နဲ့အတူ ပို့ပါ။ /help ကိုနှိပ်ပြီး ပုံစံကြည့်နိုင်ပါတယ်။');
      return res.status(200).json({ ok: true });
    }

    const fields = parseCaption(message.caption);
    const name = String(fields.name || '').trim();
    const category = String(fields.category || '').trim();
    const price = Number(fields.price);
    if (!name || !category || !Number.isSafeInteger(price) || price < 0) {
      await sendMessage(token, chatId, 'အချက်အလက်မပြည့်စုံပါ။ Name, Price, Category ကို Caption ထဲမှာ ဖြည့်ပါ။ /help ကိုကြည့်ပါ။');
      return res.status(200).json({ ok: true });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      await sendMessage(token, chatId, 'Server Setup မပြီးသေးပါ။ Vercel မှာ SUPABASE_URL နဲ့ SUPABASE_SERVICE_ROLE_KEY ကို စစ်ဆေးပါ။');
      return res.status(200).json({ ok: true });
    }

    const photo = message.photo[message.photo.length - 1];
    const fileResponse = await tgApi(token, 'getFile', { file_id: photo.file_id });
    const fileData = await fileResponse.json();
    if (!fileResponse.ok || !fileData.ok || !fileData.result.file_path) throw new Error('Could not retrieve Telegram photo.');
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
    if (!imageResponse.ok) throw new Error('Could not download Telegram photo.');
    const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
    const ext = (fileData.result.file_path.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const fileName = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    const storagePath = `telegram/${fileName}`;
    const uploadResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/product-images/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': imageResponse.headers.get('content-type') || 'image/jpeg',
        'x-upsert': 'false',
      },
      body: imageBytes,
    });
    if (!uploadResponse.ok) throw new Error(`Image upload failed (${uploadResponse.status}): ${(await uploadResponse.text()).slice(0, 300)}`);
    const publicImage = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/product-images/${storagePath}`;

    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const parseList = (v) => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    const product = {
      name, slug, category, price,
      old_price: fields.old_price && Number.isFinite(Number(fields.old_price)) ? Number(fields.old_price) : null,
      badge: fields.badge || '',
      image: publicImage,
      description: fields.description || '',
      sizes: parseList(fields.sizes),
      colors: parseList(fields.colors),
      stock: Number.isSafeInteger(Number(fields.stock)) && Number(fields.stock) >= 0 ? Number(fields.stock) : 0,
      is_active: true,
      is_featured: String(fields.featured || '').toLowerCase() === 'true',
    };
    await supabaseRequest(supabaseUrl, serviceKey, '/rest/v1/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(product),
    });
    await sendMessage(token, chatId, `✅ Product Website မှာ တင်ပြီးပါပြီ။\\nအမည်: ${name}\\nဈေးနှုန်း: ${price.toLocaleString('en-US')} ကျပ်\\nအမျိုးအစား: ${category}`);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    try {
      await sendMessage(token, req.body?.message?.chat?.id, 'လုပ်ဆောင်မှု မအောင်မြင်ပါ။ Vercel Functions Logs ကို စစ်ဆေးပါ။ အချက်အလက်: ' + String(error.message || 'unknown error').slice(0, 250));
    } catch (_) {}
    return res.status(200).json({ ok: true });
  }
};

module.exports.config = { api: { bodyParser: true } };
