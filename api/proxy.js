// Fixed-window rate limiter (per serverless instance; soft cap against abuse).
// Story generation is one request per user click, so the cap can be low.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;
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
  // Same-origin only: no Access-Control-Allow-Origin header means other
  // websites can't call this proxy from a browser and burn the API budget.

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'No API key configured' } });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: { message: 'Too many requests - please wait a minute' } });
  }

  try {
    // req.body may arrive already parsed (object) or raw (string) depending on
    // how the platform delivers it. Normalise so the `stream` flag is detected
    // reliably either way; the forwarded body is left byte-identical.
    let parsedBody = req.body;
    if (typeof parsedBody === 'string') {
      try { parsedBody = JSON.parse(parsedBody); } catch (e) { parsedBody = {}; }
    }
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const wantsStream = !!(parsedBody && parsedBody.stream);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: body
    });

    // Streaming: pipe SSE events through to the client
    if (wantsStream) {
      // A streaming request can still fail before any SSE is produced (bad
      // request, rate limit, overload, auth/credit). Anthropic returns those
      // as a normal JSON error with a non-2xx status - NOT an event stream.
      // Forward them as JSON with the real status so the client shows an
      // actual error instead of silently rendering an empty story.
      if (!response.ok) {
        const errText = await response.text();
        try {
          return res.status(response.status).json(JSON.parse(errText));
        } catch (e) {
          return res.status(response.status).json({ error: { message: 'Story generation failed: ' + errText.substring(0, 200) } });
        }
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      return;
    }

    const text = await response.text();

    try {
      const data = JSON.parse(text);
      return res.status(response.status).json(data);
    } catch(e) {
      return res.status(500).json({ error: { message: 'Invalid response from Anthropic: ' + text.substring(0, 200) } });
    }

  } catch (err) {
    return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
}
