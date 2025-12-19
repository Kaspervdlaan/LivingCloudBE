import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // In production, require all database environment variables
    if (isProduction) {
      const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        throw new Error(
          `Missing required database environment variables in production: ${missingVars.join(', ')}`
        );
      }
    }
    
    const config = {
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'drive_db',
      user: process.env.DB_USER || 'drive_user',
      password: process.env.DB_PASSWORD || 'drive_password',
    };
    
    // Warn if using default credentials in production
    if (isProduction && (config.password === 'drive_password' || config.user === 'drive_user')) {
      console.warn('⚠️  WARNING: Using default database credentials in production is insecure!');
    }

    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });
  }

  return pool;
}

export async function initializeDatabase(): Promise<void> {
  const client = await getPool().connect();
  
  try {
    // Read and execute SQL schema
    // In Docker, the SQL file is copied to dist/config/database.sql
    // For local dev, it might be in src/config/database.sql
    let sqlPath = path.join(__dirname, 'database.sql');
    if (!fs.existsSync(sqlPath)) {
      // Try src directory (for local development)
      sqlPath = path.join(__dirname, '../src/config/database.sql');
    }
    
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute SQL - errors for existing objects are handled in the SQL itself
    await client.query(sql);
    
    // Add user_id column to files table if it doesn't exist (migration for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'files' AND column_name = 'user_id'
        ) THEN
          -- Add column as nullable first
          ALTER TABLE files ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
          CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
          
          -- If table is empty, make it NOT NULL (matches schema)
          IF (SELECT COUNT(*) FROM files) = 0 THEN
            ALTER TABLE files ALTER COLUMN user_id SET NOT NULL;
          END IF;
        END IF;
      END $$;
    `);
    
    // Add role enum type if it doesn't exist
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('user', 'admin');
        END IF;
      END $$;
    `);
    
    // Add role column to users table if it doesn't exist (migration for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'role'
        ) THEN
          ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'user';
        END IF;
      END $$;
    `);
    
    console.log('Database schema initialized successfully');
  } catch (error: any) {
    // If it's a "already exists" error, that's okay - schema is already initialized
    if (error.code === '42710' || error.code === '42P07') {
      console.log('Database schema already exists, skipping initialization');
    } else {
      console.error('Error initializing database:', error);
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

