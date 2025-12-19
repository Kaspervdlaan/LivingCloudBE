/**
 * Script to set a user as admin
 * Usage: 
 *   Inside Docker: docker-compose exec backend npm run set-admin user@example.com
 *   Locally: npm run set-admin user@example.com (requires DB_HOST=localhost in .env)
 * 
 * Note: When running locally (outside Docker), the script will automatically
 * use 'localhost' instead of 'postgres' as the database host.
 */

import * as dotenv from 'dotenv';
import { getPool } from '../config/database';

// Load environment variables from .env file
dotenv.config();

async function setAdminUser(email: string): Promise<void> {
  // If DB_HOST is not set or is 'postgres', we might be running locally
  // Default to 'localhost' for local execution (when not in Docker)
  // The script will work in Docker if DB_HOST is explicitly set to 'postgres'
  // For local execution, either set DB_HOST=localhost in .env, or it will default here
  if (!process.env.DB_HOST) {
    // Not set, default to localhost for local execution
    process.env.DB_HOST = 'localhost';
  }
  // Note: If DB_HOST is explicitly set to 'postgres', it will be used (for Docker)
  
  const pool = getPool();
  
  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE email = $2 RETURNING id, email, name, role',
      ['admin', email]
    );
    
    if (result.rows.length === 0) {
      console.error(`❌ User with email "${email}" not found`);
      process.exit(1);
    }
    
    const user = result.rows[0];
    console.log(`✅ User "${user.name}" (${user.email}) is now an admin`);
    console.log(`   User ID: ${user.id}`);
  } catch (error) {
    console.error('❌ Error setting admin user:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address');
  console.log('Usage: ts-node setAdminUser.ts kaspervdlaan@gmail.com');
  process.exit(1);
}

setAdminUser(email);

