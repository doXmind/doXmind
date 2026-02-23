"""Speech-to-Text API endpoints using Whisper via OpenRouter."""

import logging
from io import BytesIO

from fastapi import APIRouter, Depends, File, UploadFile
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import get_db
from dependencies import resolve_user_api_key
from exceptions import (
    BadRequestError,
    ExternalServiceError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from services.auth_service import TokenData, require_auth

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
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """
    Transcribe audio to text using Whisper via OpenRouter.

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
        raise UnsupportedFileTypeError(
            file_type=base_content_type, allowed_types=list(SUPPORTED_FORMATS)
        )

    # Read file content
    try:
        content = await audio.read()
    except Exception as e:
        logger.error(f"Failed to read audio file: {e}")
        raise BadRequestError(message="Failed to read audio file")

    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        raise FileTooLargeError(max_size=MAX_FILE_SIZE, actual_size=len(content))

    # Validate file is not empty
    if len(content) == 0:
        raise BadRequestError(message="Audio file is empty")

    try:
        # Resolve user API key, fall back to server key
        user_api_key = await resolve_user_api_key(auth.sub, db)
        effective_key = user_api_key or settings.openrouter_api_key

        client = AsyncOpenAI(
            api_key=effective_key,
            base_url=settings.openrouter_base_url,
        )

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

        logger.info(
            f"Processing audio: content_type={content_type}, base={base_content_type}, "
            f"ext={file_ext}, size={len(content)}"
        )

        # Create a file-like object for the API
        audio_file = BytesIO(content)
        audio_file.name = f"audio.{file_ext}"

        # Call Whisper API via OpenRouter
        transcription_args = {
            "model": settings.stt_model,
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

        # Track STT usage (Whisper doesn't return token counts)
        import asyncio

        from services.usage_tracker import track_usage

        asyncio.create_task(
            track_usage(
                service="stt",
                model=settings.stt_model,
                user_id=auth.sub,
                is_byok=bool(user_api_key),
            )
        )

        logger.info(f"Transcription successful: {len(text)} chars, language={detected_language}")

        return {
            "text": text,
            "language": detected_language,
        }

    except Exception as e:
        logger.error(f"Whisper API error: {e}")
        raise ExternalServiceError(service="whisper", message=f"Transcription failed: {str(e)}")
