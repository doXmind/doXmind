"""LLM Service for interacting with Claude API."""

import logging
from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic

from config import get_settings

logger = logging.getLogger(__name__)


class LLMService:
    """Service for LLM interactions."""

    def __init__(self, model: str | None = None):
        settings = get_settings()
        api_key = settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set in environment or .env file")
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model or settings.default_model
        self.max_tokens = settings.max_output_tokens

    async def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        stop: list[str] | None = None,
    ) -> str:
        """Generate a completion."""
        try:
            message = await self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                system=system or "You are a helpful AI writing assistant.",
                messages=[{"role": "user", "content": prompt}],
                stop_sequences=stop,
            )
            return message.content[0].text
        except Exception as e:
            logger.error(f"LLM completion error: {e}")
            raise

    async def stream(
        self,
        user: str,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """Stream a completion."""
        try:
            async with self.client.messages.stream(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                system=system or "You are a helpful AI writing assistant.",
                messages=[{"role": "user", "content": user}],
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as e:
            logger.error(f"LLM streaming error: {e}")
            raise

    async def chat(
        self,
        messages: list[dict],
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """Stream a chat completion with message history."""
        try:
            # Convert messages to Anthropic format
            anthropic_messages = []
            for msg in messages:
                anthropic_messages.append({"role": msg["role"], "content": msg["content"]})

            async with self.client.messages.stream(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                system=system or "You are a helpful AI writing assistant.",
                messages=anthropic_messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            raise

    async def json_complete(
        self,
        prompt: str,
        json_schema: dict,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
    ) -> dict:
        """Generate a structured JSON completion using Claude's JSON mode."""
        try:
            message = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                system=system or "You are a helpful AI writing assistant.",
                messages=[{"role": "user", "content": prompt}],
                betas=["structured-outputs-2025-11-13"],
                output_format={"type": "json_schema", "schema": json_schema},
            )
            import json

            return json.loads(message.content[0].text)
        except Exception as e:
            logger.error(f"LLM JSON completion error: {e}")
            raise
