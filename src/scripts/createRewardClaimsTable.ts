import dotenv from 'dotenv';
import pool from '../db';

dotenv.config();

async function createRewardClaimsTable() {
  try {
    console.log('🔄 Creating reward_claims table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reward_claims (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stars_requested DECIMAL(10,2) NOT NULL,
        amount_usd DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
        payment_details JSONB,  -- snapshot of payment info at claim time
        admin_notes TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ reward_claims table created');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

createRewardClaimsTable();