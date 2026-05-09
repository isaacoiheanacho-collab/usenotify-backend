import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import { getCurrencyForCountry } from '../utils/currency';
import { getExchangeRate } from '../utils/fxService';

const router = Router();

// GET /api/fx/currency?country=USA
router.get('/currency', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { country } = req.query;
    if (!country || typeof country !== 'string') {
      return res.status(400).json({ error: 'Country code is required (e.g., NG, US, GB)' });
    }
    const currencyInfo = getCurrencyForCountry(country);
    res.json({
      country,
      currency: currencyInfo.currency,
      margin: currencyInfo.margin,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fx/rate
router.get('/rate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const from = (req.query.from as string) || 'USD';
    const to = req.query.to as string | undefined;
    const country = req.query.country as string | undefined;
    let amount = parseFloat(req.query.amount as string);
    if (isNaN(amount)) amount = 1;

    let targetCurrency = to;
    let margin = 0;

    if (country) {
      const currencyInfo = getCurrencyForCountry(country);
      targetCurrency = currencyInfo.currency;
      margin = currencyInfo.margin;
    } else if (!targetCurrency) {
      return res.status(400).json({ error: 'Either "to" currency or "country" is required' });
    }

    // Get real exchange rate
    let rate: number;
    try {
      rate = await getExchangeRate(from, targetCurrency);
    } catch (err) {
      console.error('FX rate fetch failed:', err);
      return res.status(500).json({ error: 'Failed to fetch exchange rate' });
    }

    const localAmount = amount * rate * (1 + margin / 100);

    res.json({
      from,
      to: targetCurrency,
      rate,
      margin,
      originalAmount: amount,
      convertedAmount: parseFloat(localAmount.toFixed(2)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;