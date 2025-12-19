import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = {
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'drive_db',
      user: process.env.DB_USER || 'drive_user',
      password: process.env.DB_PASSWORD || 'drive_password',
    };

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
    
    await client.query(sql);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
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

