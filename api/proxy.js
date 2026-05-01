export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'No API key configured' } });
  }

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

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
    if (req.body && req.body.stream) {
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
