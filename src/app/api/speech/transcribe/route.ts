/**
 * Next.js API Route for speech-to-text transcription.
 *
 * Proxies audio files to the backend Whisper API endpoint.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  // Forward authorization header from client request
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");

  const headers: Record<string, string> = {};

  if (authHeader) {
    headers["Authorization"] = authHeader;
  }
  if (apiKeyHeader) {
    headers["X-API-Key"] = apiKeyHeader;
  }

  try {
    // Get the form data from the request
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const language = formData.get("language") as string | null;

    if (!audioFile) {
      return new Response(JSON.stringify({ error: "No audio file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create new FormData with proper file handling
    // This ensures the file is sent with correct content-type and filename
    const newFormData = new FormData();

    // Determine proper filename with extension
    const mimeToExt: Record<string, string> = {
      "audio/webm": "webm",
      "audio/mp4": "mp4",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/m4a": "m4a",
      "audio/flac": "flac",
    };
    // Strip codecs parameter from MIME type for lookup
    const baseMime = audioFile.type.split(";")[0].trim();
    const ext = mimeToExt[baseMime] || "webm";
    const filename = `audio.${ext}`;

    // Create a new Blob with explicit type to ensure content-type is preserved
    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: baseMime });
    newFormData.append("audio", audioBlob, filename);

    if (language) {
      newFormData.append("language", language);
    }

    // Forward to backend
    const response = await fetch(`${backendUrl}/api/speech/transcribe`, {
      method: "POST",
      headers,
      body: newFormData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return new Response(
        JSON.stringify({
          error: errorData.detail || `Backend error: ${response.status}`,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Speech transcribe proxy error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Transcription failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
