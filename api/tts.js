// Proxies Google Cloud Text-to-Speech so the API key stays server-side.
// The key was previously embedded in the client where anyone could lift it.

// Fixed-window rate limiter. Per serverless instance (resets on cold start),
// so it's a soft cap against gross abuse, not a hard guarantee. A single
// story narration fires ~10-30 parallel synthesis requests, so the window
// must comfortably fit a few stories.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 120;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count++;
  return rec.count > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'No TTS key configured' } });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: { message: 'Too many requests - please wait a minute' } });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    // Forward only the fields the app uses - nothing else reaches Google
    const payload = JSON.stringify({
      input: body.input,
      voice: body.voice,
      audioConfig: body.audioConfig
    });
    if (payload.length > 20000) {
      return res.status(413).json({ error: { message: 'Request too large' } });
    }

    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(response.status).send(text);
  } catch (err) {
    return res.status(500).json({ error: { message: 'TTS proxy error: ' + err.message } });
  }
}
