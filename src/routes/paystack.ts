import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import axios from 'axios';
import pool from '../db';

const router = Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// POST /api/payments/paystack/initialize
router.post('/initialize', authenticateToken, async (req: AuthRequest, res) => {
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
    if (role !== 'creator') return res.status(403).json({ error: 'Only creators can purchase membership' });

    // Determine if Africa (simplified list)
    const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW'];
    const isAfrica = africaCountries.includes(country);
    if (!isAfrica) {
      return res.status(400).json({ error: 'Paystack is only available for African countries. Please use Stripe.' });
    }

    const amountUsd = 50; // Africa pricing: $50
    const amountLocal = amountUsd * 1500; // rough NGN conversion; actual will be via FX later
    const email = req.user!.email;

    // Initialize Paystack transaction
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amountLocal * 100, // in kobo
        currency: 'NGN', // temporary; we'll derive from country later
        callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
        metadata: {
          userId,
          type: 'yearly_membership',
          amountUsd,
          country,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.status) {
      res.json({
        authorizationUrl: response.data.data.authorization_url,
        reference: response.data.data.reference,
      });
    } else {
      throw new Error('Paystack initialization failed');
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to initialize Paystack payment' });
  }
});

export default router;