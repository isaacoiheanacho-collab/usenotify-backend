import dotenv from 'dotenv';
import pool from '../db';

dotenv.config();

const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW'];

async function checkMonthlyMaintenance() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running monthly maintenance check...');

    // Select active creators who are not from Africa and have a valid membership_expiry (i.e., paid at least once)
    const query = `
      SELECT u.id AS user_id, u.email, c.membership_expiry, c.last_maintenance_paid
      FROM users u
      JOIN creators c ON u.id = c.user_id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.role = 'creator'
        AND c.membership_status = 'active'
        AND c.membership_expiry IS NOT NULL
        AND (up.country IS NULL OR up.country NOT IN (${africaCountries.map(c => `'${c}'`).join(',')}))
    `;
    const result = await client.query(query);
    const now = new Date();

    for (const row of result.rows) {
      // First payment date = membership_expiry - 1 year
      const firstPaymentDate = new Date(row.membership_expiry);
      firstPaymentDate.setFullYear(firstPaymentDate.getFullYear() - 1);

      // The free 6‑month period ends 6 months after first payment
      const sixMonthsAfterFirstPayment = new Date(firstPaymentDate);
      sixMonthsAfterFirstPayment.setMonth(sixMonthsAfterFirstPayment.getMonth() + 6);

      let lastPaid = row.last_maintenance_paid ? new Date(row.last_maintenance_paid) : null;
      let nextDueDate: Date;
      if (!lastPaid) {
        nextDueDate = sixMonthsAfterFirstPayment;
      } else {
        nextDueDate = new Date(lastPaid);
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      }

      if (now >= nextDueDate) {
        const overdueDays = Math.floor((now.getTime() - nextDueDate.getTime()) / (1000 * 3600 * 24));
        console.log(`❌ Maintenance due for creator ${row.user_id} (${row.email}). Next due: ${nextDueDate}, overdue: ${overdueDays} days`);
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

if (require.main === module) {
  checkMonthlyMaintenance()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default checkMonthlyMaintenance;