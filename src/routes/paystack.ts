import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import axios from 'axios';
import pool from '../db';
import { getCurrencyForCountry } from '../utils/currency';
import { getExchangeRate } from '../utils/fxService';

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

    // Determine region and price (USD)
    const africaCountries = ['NG', 'ZA', 'KE', 'GH', 'EG', 'MA', 'TN', 'DZ', 'AO', 'CM', 'CI', 'ET', 'TZ', 'UG', 'ZM', 'ZW', 'SN', 'ML', 'BF', 'BJ', 'RW'];
    const isAfrica = africaCountries.includes(country);
    if (!isAfrica) {
      return res.status(400).json({ error: 'Paystack is only available for African countries. Please use Stripe.' });
    }

    const amountUsd = 50; // Africa pricing: $50

    // Get local currency and margin
    const { currency: localCurrency, margin } = getCurrencyForCountry(country);
    let rate = 1;
    if (localCurrency !== 'USD') {
      try {
        rate = await getExchangeRate('USD', localCurrency);
      } catch (err) {
        console.error('FX rate fetch failed:', err);
        return res.status(500).json({ error: 'Failed to fetch exchange rate' });
      }
    }
    const localAmount = amountUsd * rate * (1 + margin / 100);
    // Paystack expects amount in the smallest currency unit (kobo for NGN, cents for others)
    const amountInSmallestUnit = Math.round(localAmount * 100);

    const email = req.user!.email;

    // Initialize Paystack transaction
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amountInSmallestUnit,
        currency: localCurrency,
        callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success`,
        metadata: {
          userId,
          type: 'yearly_membership',
          amountUsd,
          country,
          localAmount: parseFloat(localAmount.toFixed(2)),
          localCurrency,
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
  } catch (error: any) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to initialize Paystack payment' });
  }
});

export default router;