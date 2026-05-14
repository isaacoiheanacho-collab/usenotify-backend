import { Request, Response } from 'express';
import axios from 'axios';
import pool from '../db';

export const handlePaystackWebhook = async (req: Request, res: Response) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  let event;
  try {
    const rawBody = (req as any).rawBody || req.body;
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error('Invalid Paystack webhook payload');
    return res.status(400).send('Invalid payload');
  }

  if (event.event === 'charge.success') {
    const transactionReference = event.data.reference;
    const metadata = event.data.metadata; // contains userId, amountUsd, type, country

    if (metadata?.userId && metadata?.amountUsd) {
      const userId = metadata.userId;
      const amountUsd = parseFloat(metadata.amountUsd);
      const type = metadata.type; // 'yearly_membership' or 'maintenance'

      try {
        // Verify the transaction with Paystack
        const verifyRes = await axios.get(
          `https://api.paystack.co/transaction/verify/${transactionReference}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );

        if (verifyRes.data.data.status === 'success') {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            if (type === 'yearly_membership') {
              const membershipExpiry = new Date();
              membershipExpiry.setFullYear(membershipExpiry.getFullYear() + 1);
              await client.query(
                `UPDATE creators
                 SET membership_status = 'active',
                     membership_expiry = $1,
                     updated_at = NOW()
                 WHERE user_id = $2`,
                [membershipExpiry, userId]
              );

              // Extract local payment details
              const amountPaid = verifyRes.data.data.amount / 100; // amount in kobo -> NGN
              const currency = verifyRes.data.data.currency;
              const fxRate = amountPaid / amountUsd;

              await client.query(
                `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at)
                 VALUES ($1, 'membership', $2, $3, $4, $5, 0, 'paystack', $6, 'success', NOW())`,
                [userId, amountUsd, amountPaid, currency, fxRate, transactionReference]
              );

              // Handle referral commission
              const referrerResult = await client.query(
                `SELECT referred_by FROM users WHERE id = $1`,
                [userId]
              );
              const referredBy = referrerResult.rows[0]?.referred_by;
              if (referredBy) {
                const referrerRoleResult = await client.query(
                  `SELECT role FROM users WHERE id = $1`,
                  [referredBy]
                );
                const referrerRole = referrerRoleResult.rows[0]?.role;
                if (referrerRole && (referrerRole === 'creator' || referrerRole === 'follower')) {
                  const commission = amountUsd * 0.10; // 10%
                  // Update referrals table
                  await client.query(
                    `UPDATE referrals
                     SET commission_earned = commission_earned + $1,
                         commission_paid = true
                     WHERE referrer_id = $2 AND referee_id = $3`,
                    [commission, referredBy, userId]
                  );
                  // Insert commission transaction with metadata
                  await client.query(
                    `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at, metadata)
                     VALUES ($1, 'referral_commission', $2, $2, 'usd', 1, 0, 'paystack', $3, 'success', NOW(), $4)`,
                    [referredBy, commission, transactionReference, JSON.stringify({ referee_id: userId })]
                  );
                }
              }
            } else if (type === 'maintenance') {
              await client.query(
                `UPDATE creators
                 SET membership_expiry = membership_expiry + INTERVAL '1 month',
                     last_maintenance_paid = NOW(),
                     updated_at = NOW()
                 WHERE user_id = $1`,
                [userId]
              );
              await client.query(
                `UPDATE creators SET membership_status = 'active' WHERE user_id = $1 AND membership_status = 'suspended'`,
                [userId]
              );
              // Optional: record maintenance transaction
              await client.query(
                `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at)
                 VALUES ($1, 'maintenance', $2, $2, 'usd', 1, 0, 'paystack', $3, 'success', NOW())`,
                [userId, amountUsd, transactionReference]
              );
            }

            await client.query('COMMIT');
            console.log(`Paystack payment successful for user ${userId}`);
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
          } finally {
            client.release();
          }
        }
      } catch (error) {
        console.error('Paystack verification failed:', error);
      }
    }
  }

  res.json({ received: true });
};