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

