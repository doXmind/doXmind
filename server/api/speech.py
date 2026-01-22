"""Speech-to-Text API endpoints using OpenAI Whisper."""

import logging
from io import BytesIO

from fastapi import APIRouter, File, HTTPException, UploadFile
from openai import AsyncOpenAI

from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


# Supported audio formats for Whisper API
SUPPORTED_FORMATS = {
    "audio/webm",
    "audio/mp3",
    "audio/mp4",
    "audio/mpeg",
    "audio/mpga",
    "audio/m4a",
    "audio/x-m4a",
    "audio/wav",
    "audio/ogg",
    "audio/flac",
}

# Max file size: 25MB (Whisper API limit)
MAX_FILE_SIZE = 25 * 1024 * 1024


@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    language: str | None = None,
):
    """
    Transcribe audio to text using OpenAI Whisper API.

    Args:
        audio: Audio file (webm, mp3, wav, m4a, etc.)
        language: Optional language code (e.g., "zh", "en")
                  If not specified, Whisper will auto-detect.

    Returns:
        { "text": "transcribed text", "language": "detected language" }
    """
    settings = get_settings()

    # Validate content type (strip codecs parameter for validation)
    content_type = audio.content_type or "audio/webm"
    base_content_type = content_type.split(";")[0].strip()
    if base_content_type not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {content_type}. "
                   f"Supported formats: {', '.join(SUPPORTED_FORMATS)}"
        )

    # Read file content
    try:
        content = await audio.read()
    except Exception as e:
        logger.error(f"Failed to read audio file: {e}")
        raise HTTPException(status_code=400, detail="Failed to read audio file")

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB"
        )

    # Validate file is not empty
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    try:
        # Initialize OpenAI client
        client = AsyncOpenAI(api_key=settings.openai_api_key)

        # Determine file extension from content type
        # Strip codecs parameter (e.g., "audio/webm;codecs=opus" -> "audio/webm")
        base_content_type = content_type.split(";")[0].strip()

        ext_map = {
            "audio/webm": "webm",
            "audio/mp3": "mp3",
            "audio/mpeg": "mp3",
            "audio/mpga": "mp3",
            "audio/mp4": "mp4",
            "audio/m4a": "m4a",
            "audio/x-m4a": "m4a",
            "audio/wav": "wav",
            "audio/ogg": "ogg",
            "audio/flac": "flac",
        }
        file_ext = ext_map.get(base_content_type, "webm")

        logger.info(f"Processing audio: content_type={content_type}, base={base_content_type}, ext={file_ext}, size={len(content)}")

        # Create a file-like object for the API
        audio_file = BytesIO(content)
        audio_file.name = f"audio.{file_ext}"

        # Call Whisper API
        transcription_args = {
            "model": "whisper-1",
            "file": audio_file,
            "response_format": "verbose_json",  # Get language detection info
        }

        # Add language hint if provided
        if language:
            transcription_args["language"] = language

        transcription = await client.audio.transcriptions.create(**transcription_args)

        # Extract text and detected language
        text = transcription.text if hasattr(transcription, "text") else str(transcription)
        detected_language = getattr(transcription, "language", language or "unknown")

        logger.info(
            f"Transcription successful: {len(text)} chars, language={detected_language}"
        )

        return {
            "text": text,
            "language": detected_language,
        }

    except Exception as e:
        logger.error(f"Whisper API error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}"
        )
