/**
 * Next.js API Route for streaming inline AI responses.
 * Proxies backend SSE to avoid buffering.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authHeader) headers["Authorization"] = authHeader;
  if (apiKeyHeader) headers["X-API-Key"] = apiKeyHeader;

  try {
    const response = await fetch(`${backendUrl}/api/inline/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Backend error: ${response.status}` }), {
        status: response.status,
      });
    }

    const { readable, writable } = new TransformStream();
    const reader = response.body?.getReader();
    const writer = writable.getWriter();

    if (!reader) {
      return new Response(JSON.stringify({ error: "No response body from backend" }), {
        status: 500,
      });
    }

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
        await writer.abort(error);
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to connect to backend" }), { status: 500 });
  }
}
