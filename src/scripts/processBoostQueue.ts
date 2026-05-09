import dotenv from 'dotenv';
import pool from '../db';

dotenv.config();

async function processBoostQueue() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Expire old active boosts (set to 'completed')
    const expireResult = await client.query(`
      UPDATE boosts
      SET status = 'completed', updated_at = NOW()
      WHERE status = 'active' AND active_until < NOW()
      RETURNING id
    `);
    console.log(`Expired ${expireResult.rowCount} active boosts`);

    // 2. Get up to 500 queued boosts ordered by referral_priority DESC, then submitted_at ASC
    const queuedResult = await client.query(`
      SELECT id, referral_priority
      FROM boosts
      WHERE status = 'queued'
      ORDER BY referral_priority DESC, submitted_at ASC
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    `);
    const boostIds = queuedResult.rows.map(row => row.id);
    if (boostIds.length === 0) {
      console.log('No queued boosts to activate');
      await client.query('COMMIT');
      return;
    }

    // 3. Activate them
    const activateResult = await client.query(`
      UPDATE boosts
      SET status = 'active',
          active_from = NOW(),
          active_until = NOW() + INTERVAL '2 days',
          updated_at = NOW()
      WHERE id = ANY($1)
      RETURNING id
    `, [boostIds]);
    console.log(`Activated ${activateResult.rowCount} boosts (max 500 per hour)`);

    await client.query('COMMIT');
    console.log('Boost queue processed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing boost queue:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  processBoostQueue()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default processBoostQueue;