import dotenv from 'dotenv';
import pool from '../db';

dotenv.config();

// List of African country codes (used to skip)
const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW'];

async function checkMonthlyMaintenance() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running monthly maintenance check...');

    // Find active creators who are not from Africa
    const query = `
      SELECT u.id AS user_id, u.email, u.created_at, c.last_maintenance_paid
      FROM users u
      JOIN creators c ON u.id = c.user_id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.role = 'creator'
        AND c.membership_status = 'active'
        AND (up.country IS NULL OR up.country NOT IN (${africaCountries.map(c => `'${c}'`).join(',')}))
    `;
    const result = await client.query(query);

    const now = new Date();

    for (const row of result.rows) {
      const createdAt = new Date(row.created_at);
      let lastPaid = row.last_maintenance_paid ? new Date(row.last_maintenance_paid) : null;

      // Determine the start of the 6‑month free period
      const sixMonthsAfterCreation = new Date(createdAt);
      sixMonthsAfterCreation.setMonth(sixMonthsAfterCreation.getMonth() + 6);

      // If last_paid is null, the first due date is 6 months after creation
      let nextDueDate: Date;
      if (!lastPaid) {
        nextDueDate = sixMonthsAfterCreation;
      } else {
        nextDueDate = new Date(lastPaid);
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      }

      // If current date is after or equal to next due date, then maintenance is overdue
      if (now >= nextDueDate) {
        // Here we can either:
        // - Create a pending maintenance transaction (to be paid via Stripe)
        // - Mark the creator as `suspended` until payment
        // - Send an email reminder (not implemented yet)

        console.log(`❌ Maintenance due for creator ${row.user_id} (${row.email}). Last paid: ${lastPaid}, next due: ${nextDueDate}`);

        // For now, we simply update the status to 'suspended' if overdue by more than 30 days (grace period)
        const overdueDays = Math.floor((now.getTime() - nextDueDate.getTime()) / (1000 * 3600 * 24));
        if (overdueDays > 30) {
          await client.query(
            `UPDATE creators SET membership_status = 'suspended', updated_at = NOW() WHERE user_id = $1`,
            [row.user_id]
          );
          console.log(`🔴 Suspended creator ${row.user_id} due to overdue maintenance.`);
        } else {
          console.log(`⚠️ Maintenance overdue for ${row.user_id} (${overdueDays} days). Grace period not exceeded.`);
        }
      } else {
        console.log(`✅ Creator ${row.user_id} is up to date. Next due: ${nextDueDate}`);
      }
    }

    console.log('✅ Monthly maintenance check completed');
  } catch (error) {
    console.error('❌ Monthly maintenance check failed:', error);
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  checkMonthlyMaintenance()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default checkMonthlyMaintenance;