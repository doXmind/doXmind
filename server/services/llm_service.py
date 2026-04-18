"""LLM Service — role-based resolution on top of the multi-provider layer.

Callers either pass an explicit ``model`` (for legacy code paths where the
model is already resolved upstream) or a ``role`` that we resolve via
``provider.registry`` to the active provider's configured model.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, cast

from config import get_settings
from provider.registry import (
    ProviderUnconfiguredError,
    active_provider_id,
    build_client,
    provider_api_key,
    resolve_role,
    role_model,
)

logger = logging.getLogger(__name__)


class LLMService:
    """Service for LLM interactions via the active provider's OpenAI-compatible API.

    Construction paths:
      - ``LLMService(role="chat")`` — resolve everything from the active provider.
      - ``LLMService(model="gpt-5.1")`` — caller supplies the model; provider
        / api key still come from the active provider.
      - ``LLMService(model=..., api_key=...)`` — both supplied (per-request BYOK).
    """

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        role: str = "chat",
    ):
        settings = get_settings()

        provider_id = active_provider_id()
        if provider_id is None:
            raise ValueError(
                "No LLM provider configured. Open the Settings page in the app and add an API key."
            )

        effective_api_key = (
            api_key or provider_api_key(provider_id) or settings.env_api_key_for(provider_id)
        )
        if not effective_api_key:
            raise ValueError(
                f"Active provider '{provider_id}' has no API key. "
                "Open the Settings page and paste your key."
            )

        effective_model = model or role_model(role, provider_id)
        if not effective_model:
            raise ValueError(f"No model configured for role '{role}' on provider '{provider_id}'.")

        self.provider_id = provider_id
        self.client = build_client(effective_api_key, provider_id)
        self.model = effective_model
        self.max_tokens = settings.max_output_tokens
        self.last_usage: dict | None = None

    def _build_extra_body(self, extra_body: dict | None = None) -> dict | None:
        """Hook for provider-specific extra_body params. No-op for now."""
        return extra_body or None

    async def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float = 0.7,
        stop: list[str] | None = None,
        extra_body: dict | None = None,
    ) -> str:
        """Generate a completion."""
        try:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            else:
                messages.append(
                    {"role": "system", "content": "You are a helpful AI writing assistant."}
                )
            messages.append({"role": "user", "content": prompt})

            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens or self.max_tokens,
                "temperature": temperature,
                "messages": messages,
                "stop": stop,
            }
            merged_extra = self._build_extra_body(extra_body)
            if merged_extra:
                kwargs["extra_body"] = merged_extra

            response = await self.client.chat.completions.create(**kwargs)
            from services.usage_tracker import extract_usage

            self.last_usage = extract_usage(response)
            return response.choices[0].message.content or ""
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
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            else:
                messages.append(
                    {"role": "system", "content": "You are a helpful AI writing assistant."}
                )
            messages.append({"role": "user", "content": user})

            self.last_usage = None
            stream = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                extra_body=self._build_extra_body(),
            )
            async for chunk in stream:
                if chunk.usage:
                    cost = None
                    if hasattr(chunk.usage, "cost"):
                        cost = chunk.usage.cost
                    elif hasattr(chunk.usage, "model_extra") and chunk.usage.model_extra:
                        cost = chunk.usage.model_extra.get("cost")
                    self.last_usage = {
                        "input_tokens": chunk.usage.prompt_tokens or 0,
                        "output_tokens": chunk.usage.completion_tokens or 0,
                        "cost": cost,
                    }
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
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
            openai_messages = []
            if system:
                openai_messages.append({"role": "system", "content": system})
            else:
                openai_messages.append(
                    {"role": "system", "content": "You are a helpful AI writing assistant."}
                )
            for msg in messages:
                openai_messages.append({"role": msg["role"], "content": msg["content"]})

            self.last_usage = None
            stream = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                messages=openai_messages,
                stream=True,
                stream_options={"include_usage": True},
                extra_body=self._build_extra_body(),
            )
            async for chunk in stream:
                if chunk.usage:
                    cost = None
                    if hasattr(chunk.usage, "cost"):
                        cost = chunk.usage.cost
                    elif hasattr(chunk.usage, "model_extra") and chunk.usage.model_extra:
                        cost = chunk.usage.model_extra.get("cost")
                    self.last_usage = {
                        "input_tokens": chunk.usage.prompt_tokens or 0,
                        "output_tokens": chunk.usage.completion_tokens or 0,
                        "cost": cost,
                    }
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
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
        """Generate a structured JSON completion."""
        json_system = (system or "You are a helpful AI writing assistant.") + (
            "\n\nIMPORTANT: You MUST respond with valid JSON only. "
            "No markdown, no explanations, no code fences. Just raw JSON."
        )

        if "name" in json_schema and "schema" in json_schema:
            strict_schema = {
                **json_schema,
                "strict": json_schema.get("strict", True),
            }
        else:
            strict_schema = {
                "name": "structured_response",
                "strict": True,
                "schema": json_schema,
            }

        text = ""
        try:
            messages = [
                {"role": "system", "content": json_system},
                {"role": "user", "content": prompt},
            ]
            response_format: dict[str, Any] = {"type": "json_schema", "json_schema": strict_schema}
            response = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                messages=cast(Any, messages),
                response_format=cast(Any, response_format),
            )
            from services.usage_tracker import extract_usage

            self.last_usage = extract_usage(response)

            content = response.choices[0].message.content
            text = content.strip() if isinstance(content, str) else str(content or "").strip()

            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3].strip()

            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"LLM JSON parse error: {e}. Raw content: {text[:500]}")
            raise
        except Exception as e:
            logger.error(f"LLM JSON completion error: {e}")
            raise


__all__ = [
    "LLMService",
    "ProviderUnconfiguredError",
    "resolve_role",
    "role_model",
]
