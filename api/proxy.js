export const config = { runtime: 'edge' };

const ANTHROPIC_KEY = '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';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: body
  });

  // Stream the response back
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
