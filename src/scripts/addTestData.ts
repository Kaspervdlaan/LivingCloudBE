import { getPool, initializeDatabase } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

async function addTestData() {
  try {
    // Get database pool (database should already be initialized)
    const pool = getPool();
    const now = new Date().toISOString();
    
    // Create a test folder
    const folderResult = await pool.query(
      `INSERT INTO files (id, name, type, parent_id, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [uuidv4(), 'Test Folder', 'folder', null, now, now]
    );
    
    const folder = folderResult.rows[0];
    console.log('✅ Created test folder:', folder.name, '(ID:', folder.id + ')');
    
    // Create a test file in the folder
    const uploadDir = process.env.UPLOAD_DIR || './storage/uploads';
    await fs.mkdir(uploadDir, { recursive: true });
    
    // Create a simple test file
    const testFileName = `test-file-${Date.now()}.txt`;
    const testFilePath = path.join(uploadDir, testFileName);
    const testFileContent = 'This is a test file created for the Drive application.\nCreated at: ' + new Date().toISOString();
    
    await fs.writeFile(testFilePath, testFileContent, 'utf8');
    console.log('✅ Created test file on filesystem:', testFilePath);
    
    // Insert file record into database
    const fileResult = await pool.query(
      `INSERT INTO files (id, name, type, parent_id, size, mime_type, extension, file_path, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        uuidv4(),
        'test-file.txt',
        'file',
        folder.id,
        Buffer.byteLength(testFileContent, 'utf8'),
        'text/plain',
        'txt',
        testFilePath,
        now,
        now
      ]
    );
    
    const file = fileResult.rows[0];
    console.log('✅ Created test file in database:', file.name, '(ID:', file.id + ')');
    
    // Also create a file in the root (no parent)
    const rootFileResult = await pool.query(
      `INSERT INTO files (id, name, type, parent_id, size, mime_type, extension, file_path, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        uuidv4(),
        'root-file.txt',
        'file',
        null,
        Buffer.byteLength('Root level test file', 'utf8'),
        'text/plain',
        'txt',
        path.join(uploadDir, `root-file-${Date.now()}.txt`),
        now,
        now
      ]
    );
    
    const rootFile = rootFileResult.rows[0];
    await fs.writeFile(rootFile.file_path, 'Root level test file', 'utf8');
    console.log('✅ Created root level file:', rootFile.name, '(ID:', rootFile.id + ')');
    
    console.log('\n🎉 Test data added successfully!');
    console.log('\nYou can now test the API:');
    console.log('  curl http://localhost:3001/api/files');
    console.log('  curl http://localhost:3001/api/files?parentId=' + folder.id);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding test data:', error);
    process.exit(1);
  }
}

addTestData();

