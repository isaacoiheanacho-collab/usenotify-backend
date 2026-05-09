import { Request, Response } from 'express';
import Stripe from 'stripe';
import pool from '../db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).send('Webhook secret not configured');
  }

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      (req as any).rawBody,
      sig,
      webhookSecret
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const amountUsd = parseFloat(session.metadata?.amountUsd);
    const type = session.metadata?.type; // 'yearly_membership' or 'maintenance'

    if (userId && amountUsd) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (type === 'yearly_membership') {
          // Activate creator membership
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

          // Record transaction for the creator
          await client.query(
            `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at)
             VALUES ($1, 'membership', $2, $2, 'usd', 1, 0, 'stripe', $3, 'success', NOW())`,
            [userId, amountUsd, session.id]
          );

          // Handle referral commission
          // Check if this user was referred
          const referrerResult = await client.query(
            `SELECT u.referred_by, u.role
             FROM users u
             WHERE u.id = $1`,
            [userId]
          );
          const referredBy = referrerResult.rows[0]?.referred_by;
          if (referredBy) {
            // Get the referrer's role
            const referrerRoleResult = await client.query(
              `SELECT role FROM users WHERE id = $1`,
              [referredBy]
            );
            const referrerRole = referrerRoleResult.rows[0]?.role;
            // Only give commission if referrer is creator or follower (and referee is creator)
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
              // Insert transaction for the referrer
              await client.query(
                `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at)
                 VALUES ($1, 'referral_commission', $2, $2, 'usd', 1, 0, 'stripe', $3, 'success', NOW())`,
                [referredBy, commission, session.id]
              );
              console.log(`Commission ${commission} credited to ${referredBy} for referring ${userId}`);
            }
          }
        } else if (type === 'maintenance') {
          // Extend membership by 1 month, update last_maintenance_paid
          await client.query(
            `UPDATE creators
             SET membership_expiry = membership_expiry + INTERVAL '1 month',
                 last_maintenance_paid = NOW(),
                 updated_at = NOW()
             WHERE user_id = $1`,
            [userId]
          );
          // Reactivate if suspended
          await client.query(
            `UPDATE creators SET membership_status = 'active' WHERE user_id = $1 AND membership_status = 'suspended'`,
            [userId]
          );
          await client.query(
            `INSERT INTO transactions (user_id, type, amount_usd, amount_local, currency, fx_rate, margin, gateway, gateway_tx_id, status, completed_at)
             VALUES ($1, 'maintenance', $2, $2, 'usd', 1, 0, 'stripe', $3, 'success', NOW())`,
            [userId, amountUsd, session.id]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        throw err;
      } finally {
        client.release();
      }
    }
  }

  res.json({ received: true });
};