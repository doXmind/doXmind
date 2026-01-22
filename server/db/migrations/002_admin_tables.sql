-- Migration: Add Telemetry and Admin Dashboard tables
-- Date: 2026-01-21

-- ============================================================================
-- Part 1: Telemetry Tables (required for main app telemetry feature)
-- ============================================================================

-- Telemetry Events table
CREATE TABLE IF NOT EXISTS telemetry_events (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    chosen_content TEXT,
    rejected_content TEXT,
    context TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_user_id ON telemetry_events(user_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created ON telemetry_events(created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_user_type ON telemetry_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_type_created ON telemetry_events(event_type, created_at);

-- User Telemetry Settings table
CREATE TABLE IF NOT EXISTS user_telemetry_settings (
    user_id VARCHAR(36) PRIMARY KEY REFERENCES users(id),
    product_improvement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    collect_edit_feedback BOOLEAN NOT NULL DEFAULT TRUE,
    collect_chat_feedback BOOLEAN NOT NULL DEFAULT TRUE,
    collect_autocomplete_stats BOOLEAN NOT NULL DEFAULT TRUE,
    collect_usage_stats BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Part 2: Admin Dashboard Tables
-- ============================================================================

-- Admin Users table (separate from regular users)
CREATE TABLE IF NOT EXISTS admin_users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- Admin Audit Logs table
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    admin_user_id VARCHAR(36) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(36),
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_user ON admin_audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at);

-- Export Jobs table (for RLHF data export)
CREATE TABLE IF NOT EXISTS export_jobs (
    id VARCHAR(36) PRIMARY KEY,
    admin_user_id VARCHAR(36) NOT NULL,
    export_type VARCHAR(50) NOT NULL,
    format VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    file_path VARCHAR(500),
    file_size_bytes VARCHAR(20),
    record_count VARCHAR(20),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs(admin_user_id);

-- ============================================================================
-- Part 3: Add indexes to existing tables for admin dashboard queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
