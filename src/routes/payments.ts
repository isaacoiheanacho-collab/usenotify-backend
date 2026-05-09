import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import Stripe from 'stripe';
import pool from '../db';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// POST /api/payments/create-checkout-session (yearly membership)
router.post('/create-checkout-session', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user's role and country (from profile)
    const userResult = await pool.query(
      `SELECT u.role, up.country
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const { role, country } = userResult.rows[0];
    if (role !== 'creator') return res.status(403).json({ error: 'Only creators can purchase membership' });

    // Determine region and price (USD)
    const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW', 'UG', 'ZM'];
    const isAfrica = africaCountries.includes(country);
    const amountUsd = isAfrica ? 50 : 100;
    const currency = 'usd';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currency,
          product_data: {
            name: `UseNotify Creator Membership (${isAfrica ? 'Africa' : 'Standard'} Plan)`,
            description: 'Yearly access to submit boosts',
          },
          unit_amount: amountUsd * 100, // cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-cancel`,
      metadata: {
        userId,
        type: 'yearly_membership',
        amountUsd,
        country: country || 'unknown',
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/maintenance
router.post('/maintenance', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user's role and country
    const userResult = await pool.query(
      `SELECT u.role, up.country
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const { role, country } = userResult.rows[0];
    if (role !== 'creator') return res.status(403).json({ error: 'Only creators can pay maintenance' });

    // Africa creators have no monthly fee
    const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW'];
    if (africaCountries.includes(country)) {
      return res.status(400).json({ error: 'Monthly maintenance fee does not apply to African creators' });
    }

    const amountUsd = 10; // $10 USD
    const currency = 'usd';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currency,
          product_data: {
            name: `UseNotify Creator Maintenance (Monthly)`,
            description: 'Extend your creator membership by one month',
          },
          unit_amount: amountUsd * 100, // cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-cancel`,
      metadata: {
        userId,
        type: 'maintenance',
        amountUsd,
        country: country || 'unknown',
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create maintenance checkout session' });
  }
});

export default router;