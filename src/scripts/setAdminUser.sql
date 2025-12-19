-- Script to set a user as admin
-- Usage: Replace 'user@example.com' with the email of the user you want to make admin
-- Then run: psql -U drive_user -d drive_db -f setAdminUser.sql

-- Option 1: Set admin by email
UPDATE users SET role = 'admin' WHERE email = 'user@example.com';

-- Option 2: Set admin by user ID (if you know the UUID)
-- UPDATE users SET role = 'admin' WHERE id = 'user-uuid-here';

-- Verify the change
SELECT id, email, name, role FROM users WHERE role = 'admin';

