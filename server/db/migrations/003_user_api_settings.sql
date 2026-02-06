-- Migration: Add User API Settings table
-- Date: 2026-02-06
-- Description: Stores user's encrypted Anthropic API keys and model preferences
--              for the "Bring Your Own Key" (BYOK) feature.

CREATE TABLE IF NOT EXISTS user_api_settings (
    user_id VARCHAR(36) PRIMARY KEY REFERENCES users(id),
    encrypted_anthropic_key TEXT,
    preferred_model VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
