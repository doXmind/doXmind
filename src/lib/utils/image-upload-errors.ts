/**
 * Parse upload errors and return user-friendly error messages
 */
export function parseUploadError(error: unknown): string {
  // Handle Error objects
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connection")
    ) {
      return "Upload failed - check your connection and try again";
    }

    // Timeout errors
    if (message.includes("timeout") || message.includes("timed out")) {
      return "Upload timed out - check your connection";
    }

    // File size errors
    if (
      message.includes("too large") ||
      message.includes("file size") ||
      message.includes("10mb")
    ) {
      return "Image too large (max 10MB)";
    }

    // Format errors
    if (message.includes("format") || message.includes("type") || message.includes("unsupported")) {
      return "Unsupported image format (use PNG, JPG, GIF, WebP, or SVG)";
    }

    // Server errors
    if (message.includes("server") || message.includes("500")) {
      return "Upload failed - please try again later";
    }

    // Return the error message if it's already user-friendly
    if (error.message && error.message.length < 100) {
      return error.message;
    }
  }

  // Default fallback message
  return "Upload failed - please try again";
}
