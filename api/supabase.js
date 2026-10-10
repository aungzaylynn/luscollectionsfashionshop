const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade','host']);
module.exports = async function handler(req, res) {
  const base = process.env.SUPABASE_URL;
  if (!base) return res.status(500).json({ error: 'Vercel environment variable SUPABASE_URL is not set.' });
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const rawPath = typeof req.query?.__path === 'string' ? req.query.__path : '';
  const safePath = rawPath.split('/').filter(Boolean).join('/');
  const upstream = new URL(base.replace(/\/$/, '') + (safePath ? '/' + safePath : '/'));
  for (const [key, value] of requestUrl.searchParams.entries()) if (key !== '__path') upstream.searchParams.append(key, value);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === 'content-length') continue;
    headers.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  let body;
  if (!['GET','HEAD'].includes(req.method)) {
    if (req.body !== undefined && req.body !== null) {
      body = Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    } else { const chunks=[]; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)); if (chunks.length) body=Buffer.concat(chunks); }
  }
  try {
    const upstreamResponse = await fetch(upstream, { method:req.method, headers, body, redirect:'manual' });
    res.statusCode = upstreamResponse.status;
    upstreamResponse.headers.forEach((value,key)=>{ if(!HOP_BY_HOP.has(key.toLowerCase()) && !['content-encoding','content-length'].includes(key.toLowerCase())) res.setHeader(key,value); });
    return res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch (err) { return res.status(502).json({ error: 'Vercel could not reach Supabase.', detail: String(err && err.message || err) }); }
};
