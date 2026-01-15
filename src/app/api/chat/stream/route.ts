/**
 * Next.js API Route for streaming chat responses.
 *
 * This bypasses Next.js rewrite buffering by directly proxying
 * the SSE stream from the backend with proper streaming headers.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();

  const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';

  // Forward authorization header from client request
  const authHeader = request.headers.get('Authorization');
  const apiKeyHeader = request.headers.get('X-API-Key');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (apiKeyHeader) {
    headers['X-API-Key'] = apiKeyHeader;
  }

  try {
    const response = await fetch(`${backendUrl}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Backend error: ${response.status}` }),
        { status: response.status }
      );
    }

    // Create a TransformStream to pass through the SSE data
    const { readable, writable } = new TransformStream();

    // Pipe the backend response to our transform stream
    const reader = response.body?.getReader();
    const writer = writable.getWriter();

    if (!reader) {
      return new Response(
        JSON.stringify({ error: 'No response body from backend' }),
        { status: 500 }
      );
    }

    // Stream the data in the background
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            await writer.close();
            break;
          }
          await writer.write(value);
        }
      } catch (error) {
        console.error('Stream error:', error);
        await writer.abort(error);
      }
    })();

    // Return the readable stream with proper SSE headers
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Chat stream error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to connect to backend' }),
      { status: 500 }
    );
  }
}
