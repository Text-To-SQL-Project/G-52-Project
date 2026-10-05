-- Google sign-in (POST /auth/google) links a Google account to an EXISTING
-- user by email. Nothing is auto-created: a user's role and student/faculty
-- link drive Row Level Security, so only an administrator can attach an
-- email to an account (Admin screen -> Google sign-in).
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS email TEXT;

-- Stored lowercased by the app; unique case-insensitively so one Google
-- address can never resolve to two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
    ON app.users (lower(email)) WHERE email IS NOT NULL;
