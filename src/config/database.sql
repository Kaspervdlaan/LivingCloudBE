-- Create enum type for file type (if not exists)
DO $$ BEGIN
    CREATE TYPE file_type AS ENUM ('file', 'folder');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create files table
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type file_type NOT NULL,
    parent_id UUID REFERENCES files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    size BIGINT,
    mime_type VARCHAR(100),
    extension VARCHAR(10),
    file_path VARCHAR(500),
    thumbnail_path VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on parent_id for faster queries
CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);

-- Create index on type for filtering
CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);

-- Create index on user_id for faster user-specific queries
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create enum type for user role (if not exists)
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    google_id VARCHAR(255) UNIQUE,
    avatar_url VARCHAR(500),
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Create index on google_id for OAuth lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Create trigger to automatically update updated_at for users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

