import { getPool, initializeDatabase, closePool } from '../config/database';
import { hashPassword } from '../utils/auth';
import dotenv from 'dotenv';

dotenv.config();

async function createTestAccount() {
  try {
    await initializeDatabase();

    const pool = getPool();
    const email = 'test@test.com';
    const password = 'password';
    const name = 'Test User';

    // Check if test account already exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (existingUser.rows.length > 0) {
      console.log('✅ Test account already exists');
      console.log(`   Email: ${email}`);
      console.log(`   Password: ${password}`);
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create test user
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, passwordHash, name]
    );

    console.log('✅ Test account created successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   User ID: ${result.rows[0].id}`);
  } catch (error) {
    console.error('❌ Error creating test account:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

createTestAccount();

