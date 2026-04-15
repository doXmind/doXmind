"""Usage tracker stub — local desktop edition does not track usage/cost."""

from typing import Any


def extract_usage(response: Any) -> dict[str, Any]:
    """Best-effort extraction of token usage from an OpenRouter / OpenAI response."""
    try:
        usage = getattr(response, "usage", None) or (
            response.get("usage") if isinstance(response, dict) else None
        )
        if not usage:
            return {}
        if isinstance(usage, dict):
            return {
                "input_tokens": usage.get("prompt_tokens"),
                "output_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
                "cost": usage.get("cost"),
            }
        return {
            "input_tokens": getattr(usage, "prompt_tokens", None),
            "output_tokens": getattr(usage, "completion_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
            "cost": getattr(usage, "cost", None),
        }
    except Exception:
        return {}


async def track_usage(*args: Any, **kwargs: Any) -> None:  # noqa: ARG001
    return None
