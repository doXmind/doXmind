/**
 * Next.js API Route for streaming notification events.
 *
 * Proxies the SSE stream from the backend to bypass
 * Next.js rewrite buffering, same pattern as chat/stream.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  const authHeader = request.headers.get("Authorization");
  const headers: Record<string, string> = {};

  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  try {
    const response = await fetch(`${backendUrl}/api/notifications/stream`, {
      method: "GET",
      headers,
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
        console.error("Notification stream error:", error);
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
  } catch (error) {
    console.error("Notification stream proxy error:", error);
    return new Response(JSON.stringify({ error: "Failed to connect to backend" }), { status: 500 });
  }
}
