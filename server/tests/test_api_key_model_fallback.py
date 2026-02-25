"""Test that model preference only works when user has API key.

When a user removes their API key, they should fall back to the server's default model.
"""

import pytest

from services.api_key_service import APIKeyService


@pytest.mark.asyncio
async def test_model_preference_requires_api_key(db_session, test_user):
    """Test that preferred_model is only used when user has API key."""
    service = APIKeyService(db_session)
    user_id = test_user.id

    # Initially: no settings
    settings = await service.get_user_settings(user_id)
    assert settings is None

    # Save API key with model preference
    await service.save_api_key(user_id, "sk-or-test-key-123")
    await service.update_preferred_model(user_id, "anthropic/claude-opus-4.6")

    # Verify API key exists
    settings = await service.get_user_settings(user_id)
    assert service.has_api_key(settings) is True
    assert settings.preferred_model == "anthropic/claude-opus-4.6"

    # Delete API key
    await service.delete_api_key(user_id)

    # After deletion: should reset to default model
    settings = await service.get_user_settings(user_id)
    assert service.has_api_key(settings) is False
    # Should be reset to server default
    from config import get_settings

    assert settings.preferred_model == get_settings().default_model


@pytest.mark.asyncio
async def test_chat_api_respects_api_key_requirement(db_session, test_user):
    """Test that chat API only uses user model when API key is present."""
    from datetime import datetime, timedelta

    from api.chat import _resolve_user_api_settings
    from services.auth_service import TokenData

    service = APIKeyService(db_session)
    user_id = test_user.id
    auth = TokenData(sub=user_id, exp=datetime.utcnow() + timedelta(hours=1), email=test_user.email)

    # Case 1: No API key -> should return None, None
    api_key, model = await _resolve_user_api_settings(auth, db_session)
    assert api_key is None
    assert model is None

    # Case 2: Save API key and model -> should return user's settings
    await service.save_api_key(user_id, "sk-or-test-key-456")
    await service.update_preferred_model(user_id, "anthropic/claude-sonnet-4.5")

    api_key, model = await _resolve_user_api_settings(auth, db_session)
    assert api_key == "sk-or-test-key-456"
    assert model == "anthropic/claude-sonnet-4.5"

    # Case 3: Delete API key -> should return None, None again
    await service.delete_api_key(user_id)

    api_key, model = await _resolve_user_api_settings(auth, db_session)
    assert api_key is None
    assert model is None


@pytest.mark.asyncio
async def test_update_model_without_api_key_allowed_but_not_used(db_session, test_user):
    """Test that users can set preferred_model without API key, but it won't be used.

    This is allowed for UX reasons (user can choose model before adding key),
    but the model preference will only take effect once they provide an API key.
    """
    from datetime import datetime, timedelta

    service = APIKeyService(db_session)
    user_id = test_user.id

    # User can update model preference even without API key
    await service.update_preferred_model(user_id, "anthropic/claude-opus-4.6")

    settings = await service.get_user_settings(user_id)
    assert settings.preferred_model == "anthropic/claude-opus-4.6"

    # But has_api_key should still return False
    assert service.has_api_key(settings) is False

    # And chat API should return None, None
    from api.chat import _resolve_user_api_settings
    from services.auth_service import TokenData

    auth = TokenData(sub=user_id, exp=datetime.utcnow() + timedelta(hours=1), email=test_user.email)
    api_key, model = await _resolve_user_api_settings(auth, db_session)
    assert api_key is None
    assert model is None  # Model preference is ignored without API key
