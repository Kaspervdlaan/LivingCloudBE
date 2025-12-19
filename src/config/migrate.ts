import { initializeDatabase, closePool } from './database';

async function migrate() {
  try {
    console.log('Starting database migration...');
    await initializeDatabase();
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

migrate();

