const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade','host']);
module.exports = async function handler(req, res) {
  const base = process.env.SUPABASE_URL;
  if (!base) return res.status(500).json({ error: 'Vercel environment variable SUPABASE_URL is not set.' });
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const prefix = '/api/supabase';
  const path = requestUrl.pathname.startsWith(prefix) ? requestUrl.pathname.slice(prefix.length) : requestUrl.pathname;
  const upstream = new URL(base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path));
  const forwardedSearch = new URLSearchParams(requestUrl.search);
forwardedSearch.delete('path');
forwardedSearch.delete('__path');

const queryString = forwardedSearch.toString();
upstream.search = queryString ? `?${queryString}` : '';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === 'content-length') continue;
    headers.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  let body;
  if (!['GET','HEAD'].includes(req.method)) {
    const chunks=[]; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
    if (chunks.length) body=Buffer.concat(chunks);
  }
  try {
    const upstreamResponse = await fetch(upstream, { method:req.method, headers, body, redirect:'manual' });
    res.statusCode = upstreamResponse.status;
    upstreamResponse.headers.forEach((value,key)=>{ if(!HOP_BY_HOP.has(key.toLowerCase()) && !['content-encoding','content-length'].includes(key.toLowerCase())) res.setHeader(key,value); });
    const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
    return res.end(bytes);
  } catch (error) {
    return res.status(502).json({ error:'Supabase proxy connection failed', detail:error.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
