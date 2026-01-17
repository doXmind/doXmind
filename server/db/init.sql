-- PostgreSQL initialization script
-- Tables are created by SQLAlchemy on application startup
-- This file only contains PostgreSQL-specific setup

-- Function to update updated_at timestamp (used by triggers)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';
