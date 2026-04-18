"""Static catalog of supported LLM providers.

Each provider defines:
- base_url / default_headers for its OpenAI-compatible endpoint
- a curated list of models with capability flags and pricing hints
- a role → model default mapping (chat / thinking / fast / review / file_conversion)

The user picks ONE active provider at a time. All features use that
provider's models; if the provider has no reasoning model, the thinking
toggle is hidden in the UI.
"""

from __future__ import annotations

from dataclasses import dataclass, field

ROLES: tuple[str, ...] = ("chat", "thinking", "fast", "review", "file_conversion")


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    context_length: int
    supports_vision: bool = True
    supports_reasoning: bool = False
    # Display-only pricing (USD per 1M tokens). None = unknown.
    prompt_price_per_m: float | None = None
    completion_price_per_m: float | None = None


@dataclass(frozen=True)
class ProviderDef:
    id: str
    name: str
    base_url: str
    docs_url: str
    api_key_hint: str
    models: tuple[ModelSpec, ...]
    role_defaults: dict[str, str]
    default_headers: dict[str, str] = field(default_factory=dict)

    def model_by_id(self, model_id: str) -> ModelSpec | None:
        for m in self.models:
            if m.id == model_id:
                return m
        return None

    def has_reasoning_model(self) -> bool:
        return any(m.supports_reasoning for m in self.models)


CATALOG: dict[str, ProviderDef] = {
    "openai": ProviderDef(
        id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        docs_url="https://platform.openai.com/api-keys",
        api_key_hint="sk-...",
        models=(
            ModelSpec(
                id="gpt-5.1",
                name="GPT-5.1",
                context_length=400_000,
                prompt_price_per_m=2.50,
                completion_price_per_m=10.00,
            ),
            ModelSpec(
                id="gpt-5.3-chat",
                name="GPT-5.3",
                context_length=400_000,
                prompt_price_per_m=3.00,
                completion_price_per_m=12.00,
            ),
            ModelSpec(
                id="gpt-5-mini",
                name="GPT-5 mini",
                context_length=200_000,
                prompt_price_per_m=0.25,
                completion_price_per_m=1.00,
            ),
            ModelSpec(
                id="o3",
                name="o3",
                context_length=200_000,
                supports_reasoning=True,
                prompt_price_per_m=15.00,
                completion_price_per_m=60.00,
            ),
            ModelSpec(
                id="o3-mini",
                name="o3-mini",
                context_length=200_000,
                supports_reasoning=True,
                prompt_price_per_m=3.00,
                completion_price_per_m=12.00,
            ),
        ),
        role_defaults={
            "chat": "gpt-5.1",
            "thinking": "o3-mini",
            "fast": "gpt-5-mini",
            "review": "gpt-5.1",
            "file_conversion": "gpt-5-mini",
        },
    ),
    "anthropic": ProviderDef(
        id="anthropic",
        name="Anthropic",
        # Anthropic ships an OpenAI-compatible endpoint at /v1/ (beta)
        # that accepts the standard Chat Completions shape.
        base_url="https://api.anthropic.com/v1",
        docs_url="https://console.anthropic.com/settings/keys",
        api_key_hint="sk-ant-...",
        models=(
            ModelSpec(
                id="claude-opus-4-6",
                name="Claude Opus 4.6",
                context_length=200_000,
                supports_reasoning=True,
                prompt_price_per_m=15.00,
                completion_price_per_m=75.00,
            ),
            ModelSpec(
                id="claude-sonnet-4-6",
                name="Claude Sonnet 4.6",
                context_length=1_000_000,
                prompt_price_per_m=3.00,
                completion_price_per_m=15.00,
            ),
            ModelSpec(
                id="claude-haiku-4-5",
                name="Claude Haiku 4.5",
                context_length=200_000,
                prompt_price_per_m=1.00,
                completion_price_per_m=5.00,
            ),
        ),
        role_defaults={
            "chat": "claude-sonnet-4-6",
            "thinking": "claude-opus-4-6",
            "fast": "claude-haiku-4-5",
            "review": "claude-sonnet-4-6",
            "file_conversion": "claude-haiku-4-5",
        },
    ),
    "google": ProviderDef(
        id="google",
        name="Google Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        docs_url="https://aistudio.google.com/apikey",
        api_key_hint="AIza...",
        models=(
            ModelSpec(
                id="gemini-3.1-pro-preview",
                name="Gemini 3.1 Pro",
                context_length=2_000_000,
                supports_reasoning=True,
                prompt_price_per_m=1.25,
                completion_price_per_m=10.00,
            ),
            ModelSpec(
                id="gemini-3.1-flash-lite-preview",
                name="Gemini 3.1 Flash Lite",
                context_length=1_000_000,
                prompt_price_per_m=0.075,
                completion_price_per_m=0.30,
            ),
            ModelSpec(
                id="gemini-2.5-pro",
                name="Gemini 2.5 Pro",
                context_length=1_000_000,
                supports_reasoning=True,
                prompt_price_per_m=1.25,
                completion_price_per_m=10.00,
            ),
            ModelSpec(
                id="gemini-2.5-flash-lite",
                name="Gemini 2.5 Flash Lite",
                context_length=1_000_000,
                prompt_price_per_m=0.10,
                completion_price_per_m=0.40,
            ),
        ),
        role_defaults={
            "chat": "gemini-3.1-pro-preview",
            "thinking": "gemini-3.1-pro-preview",
            "fast": "gemini-3.1-flash-lite-preview",
            "review": "gemini-3.1-pro-preview",
            "file_conversion": "gemini-3.1-flash-lite-preview",
        },
    ),
}


PROVIDER_IDS: tuple[str, ...] = tuple(CATALOG.keys())
