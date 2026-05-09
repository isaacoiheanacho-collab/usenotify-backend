import dotenv from 'dotenv';
import pool from '../db';

dotenv.config();

async function addLastBoostAt() {
  try {
    console.log('🔄 Adding last_boost_at column to creators table...');
    await pool.query(`
      ALTER TABLE creators 
      ADD COLUMN IF NOT EXISTS last_boost_at TIMESTAMP
    `);
    console.log('✅ Column added successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addLastBoostAt();