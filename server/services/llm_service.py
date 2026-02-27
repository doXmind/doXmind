"""LLM Service for interacting with LLM API via OpenRouter."""

import logging
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from config import get_settings

logger = logging.getLogger(__name__)


class LLMService:
    """Service for LLM interactions via OpenRouter (OpenAI-compatible)."""

    def __init__(self, model: str | None = None, api_key: str | None = None):
        settings = get_settings()
        effective_api_key = api_key or settings.openrouter_api_key
        if not effective_api_key:
            raise ValueError("OPENROUTER_API_KEY is not set in environment or .env file")
        self.client = AsyncOpenAI(
            api_key=effective_api_key,
            base_url=settings.openrouter_base_url,
            default_headers=settings.openrouter_headers,
        )
        self.model = model or settings.default_model
        self.max_tokens = settings.max_output_tokens
        self.last_usage: dict | None = None
        self._provider_sort = settings.openrouter_provider_sort

    def _build_extra_body(self, extra_body: dict | None = None) -> dict | None:
        """Merge provider sort config into extra_body."""
        if not self._provider_sort:
            return extra_body
        provider = {"sort": self._provider_sort}
        if extra_body and "provider" in extra_body:
            extra_body["provider"] = {**provider, **extra_body["provider"]}
            return extra_body
        if extra_body:
            extra_body["provider"] = provider
            return extra_body
        return {"provider": provider}

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
        """Generate a structured JSON completion.

        Uses prompt-based JSON enforcement since structured outputs
        may not be available through all OpenRouter providers.
        """
        import json

        # Build a system prompt that enforces JSON output
        json_system = (system or "You are a helpful AI writing assistant.") + (
            "\n\nIMPORTANT: You MUST respond with valid JSON only. "
            "No markdown, no explanations, no code fences. Just raw JSON."
        )

        # Include the schema in the user prompt for guidance
        enhanced_prompt = (
            f"{prompt}\n\n"
            f"Respond with JSON matching this schema:\n{json.dumps(json_schema, indent=2)}"
        )

        try:
            messages = [
                {"role": "system", "content": json_system},
                {"role": "user", "content": enhanced_prompt},
            ]
            response = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature,
                messages=messages,
                response_format={"type": "json_object"},
                extra_body=self._build_extra_body(
                    {
                        "provider": {
                            "require_parameters": True,
                        },
                    }
                ),
            )
            from services.usage_tracker import extract_usage

            self.last_usage = extract_usage(response)
            text = (response.choices[0].message.content or "").strip()
            # Strip markdown code fences if present (some models still add them)
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3].strip()
            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"LLM JSON parse error: {e}")
            raise
        except Exception as e:
            logger.error(f"LLM JSON completion error: {e}")
            raise
