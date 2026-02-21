"""Embedding functions for the RAG system.

Provides text-to-vector embedding via OpenRouter (OpenAI-compatible API)
with batch processing, retry logic, and concurrency control.
"""

import asyncio
import logging

import openai

from config import get_settings
from services.token_utils import (
    SAFE_TOKEN_LIMIT,
    count_tokens,
    truncate_to_token_limit,
    validate_chunks_tokens,
)

logger = logging.getLogger(__name__)


async def get_embedding(text_content: str) -> list[float]:
    """Generate embedding vector for text via OpenRouter.

    Validates token count before sending to API and truncates if needed.
    """
    settings = get_settings()

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required for embeddings")

    # Validate token count before sending to API
    token_count = count_tokens(text_content)
    if token_count > SAFE_TOKEN_LIMIT:
        logger.warning(f"Text exceeds token limit ({token_count} > {SAFE_TOKEN_LIMIT}), truncating")
        text_content = truncate_to_token_limit(text_content)

    client = openai.AsyncOpenAI(
        api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url
    )
    response = await client.embeddings.create(model=settings.embedding_model, input=text_content)
    return response.data[0].embedding


async def _embed_single_batch_with_retry(
    client: openai.AsyncOpenAI,
    texts: list[str],
    batch_index: int,
    semaphore: asyncio.Semaphore,
    max_retries: int,
    retry_delay: float,
    retry_backoff: float,
) -> tuple[int, list[list[float]]]:
    """Embed a single batch with retry logic and concurrency control.

    Args:
        client: OpenAI async client
        texts: List of texts to embed
        batch_index: Index of this batch (for result ordering)
        semaphore: Concurrency limiter
        max_retries: Maximum retry attempts
        retry_delay: Initial delay between retries (seconds)
        retry_backoff: Exponential backoff multiplier

    Returns:
        Tuple of (batch_index, embeddings) for proper ordering

    Raises:
        RuntimeError: After all retries exhausted
    """
    async with semaphore:
        for attempt in range(max_retries):
            try:
                response = await client.embeddings.create(
                    model=get_settings().embedding_model, input=texts
                )
                return (batch_index, [item.embedding for item in response.data])

            except openai.RateLimitError as e:
                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff**attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} rate limited, "
                        f"retrying in {delay:.1f}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        f"Embedding batch {batch_index} failed after {max_retries} retries"
                    )
                    raise RuntimeError(f"Embedding rate limit exceeded: {e}") from e

            except openai.APIConnectionError as e:
                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff**attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} connection error, "
                        f"retrying in {delay:.1f}s (attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                else:
                    raise RuntimeError(f"Embedding connection failed: {e}") from e

            except openai.APIStatusError as e:
                # Don't retry on client errors (400-499 except rate limit)
                if 400 <= e.status_code < 500 and e.status_code != 429:
                    raise RuntimeError(f"Embedding API error: {e}") from e

                if attempt < max_retries - 1:
                    delay = retry_delay * (retry_backoff**attempt)
                    logger.warning(
                        f"Embedding batch {batch_index} API error ({e.status_code}), "
                        f"retrying in {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                else:
                    raise RuntimeError(f"Embedding API failed: {e}") from e

    # Should never reach here, but satisfy type checker
    raise RuntimeError("Unexpected error in embedding batch")


async def _batch_embeddings_parallel(
    client: openai.AsyncOpenAI,
    texts: list[str],
    batch_size: int,
    max_concurrent: int,
    max_retries: int,
    retry_delay: float,
    retry_backoff: float,
) -> list[list[float]]:
    """Process embeddings in parallel batches with concurrency control.

    Args:
        client: OpenAI async client
        texts: All texts to embed
        batch_size: Number of texts per API call
        max_concurrent: Maximum concurrent API calls
        max_retries: Maximum retry attempts per batch
        retry_delay: Initial retry delay (seconds)
        retry_backoff: Exponential backoff multiplier

    Returns:
        List of embeddings in same order as input texts
    """
    # Split texts into batches
    batches = [texts[i : i + batch_size] for i in range(0, len(texts), batch_size)]

    if len(batches) == 1:
        # Single batch: skip overhead of parallel processing
        _, embeddings = await _embed_single_batch_with_retry(
            client, batches[0], 0, asyncio.Semaphore(1), max_retries, retry_delay, retry_backoff
        )
        return embeddings

    logger.info(
        f"Processing {len(texts)} texts in {len(batches)} batches "
        f"(batch_size={batch_size}, max_concurrent={max_concurrent})"
    )

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(max_concurrent)

    # Create tasks for all batches
    tasks = [
        _embed_single_batch_with_retry(
            client, batch, i, semaphore, max_retries, retry_delay, retry_backoff
        )
        for i, batch in enumerate(batches)
    ]

    # Run all tasks concurrently (semaphore limits actual concurrency)
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Check for errors
    errors = [r for r in results if isinstance(r, Exception)]
    if errors:
        # Log all errors but raise the first one
        for e in errors:
            logger.error(f"Batch embedding error: {e}")
        raise errors[0]

    # Sort results by batch index and flatten
    sorted_results = sorted(results, key=lambda x: x[0])
    all_embeddings = []
    for _, embeddings in sorted_results:
        all_embeddings.extend(embeddings)

    return all_embeddings


async def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in parallel batches.

    Splits large text lists into smaller batches and processes them
    in parallel with concurrency control and retry logic.

    Validates token counts and splits oversized chunks before sending to API.

    Args:
        texts: List of texts to embed

    Returns:
        List of embeddings in same order as input texts
        Note: If chunks were split, the returned list may be longer than input

    Raises:
        RuntimeError: If OpenAI API key is missing or API calls fail
    """
    if not texts:
        return []

    settings = get_settings()

    if not settings.openrouter_api_key:
        raise RuntimeError("OPENROUTER_API_KEY required for embeddings")

    # Validate and fix oversized chunks before sending to API
    validated_texts, split_indices = validate_chunks_tokens(texts)

    if split_indices:
        logger.warning(
            f"Split {len(split_indices)} oversized chunks before embedding. "
            f"Original: {len(texts)}, After validation: {len(validated_texts)}"
        )

    client = openai.AsyncOpenAI(
        api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url
    )

    return await _batch_embeddings_parallel(
        client=client,
        texts=validated_texts,
        batch_size=settings.embedding_batch_size,
        max_concurrent=settings.embedding_max_concurrent,
        max_retries=settings.embedding_max_retries,
        retry_delay=settings.embedding_retry_delay,
        retry_backoff=settings.embedding_retry_backoff,
    )
