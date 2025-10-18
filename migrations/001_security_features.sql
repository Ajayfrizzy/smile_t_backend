-- Security Features Migration Script
-- Run this in Supabase SQL Editor

-- 1. Add columns to staff table for security features
ALTER TABLE staff
ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMP;

-- 2. Create login_attempts table for tracking
CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  staff_id TEXT NOT NULL,
  attempt_time TIMESTAMP DEFAULT NOW(),
  success BOOLEAN DEFAULT false,
  ip_address TEXT,
  user_agent TEXT
);

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_login_attempts_staff_id ON login_attempts(staff_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempt_time);

-- 4. Create function to clean old login attempts (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
RETURNS void AS $$
BEGIN
  DELETE FROM login_attempts
  WHERE attempt_time < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- 5. Create function to reset failed attempts after successful login
CREATE OR REPLACE FUNCTION reset_failed_login_attempts(p_staff_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE staff
  SET failed_login_attempts = 0,
      locked_until = NULL,
      last_failed_login = NULL
  WHERE staff_id = p_staff_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Add comment for documentation
COMMENT ON COLUMN staff.two_factor_secret IS 'Base32 encoded secret for TOTP 2FA';
COMMENT ON COLUMN staff.two_factor_enabled IS 'Whether 2FA is enabled for this staff member';
COMMENT ON COLUMN staff.password_changed_at IS 'When password was last changed';
COMMENT ON COLUMN staff.password_expires_at IS 'When password expires (30 days from last change)';
COMMENT ON COLUMN staff.failed_login_attempts IS 'Number of consecutive failed login attempts';
COMMENT ON COLUMN staff.locked_until IS 'Account locked until this timestamp (15 min lockout)';
COMMENT ON TABLE login_attempts IS 'Audit log of all login attempts (success and failures)';

-- 7. Update existing records to have password_changed_at
UPDATE staff
SET password_changed_at = NOW(),
    password_expires_at = NOW() + INTERVAL '30 days'
WHERE password_changed_at IS NULL;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Security features migration completed successfully!';
  RAISE NOTICE '📊 Tables updated: staff';
  RAISE NOTICE '📊 Tables created: login_attempts';
  RAISE NOTICE '🔧 Functions created: cleanup_old_login_attempts, reset_failed_login_attempts';
END $$;
