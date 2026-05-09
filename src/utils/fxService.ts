import axios from 'axios';
import pool from '../db';

const UNIRATE_API_KEY = process.env.UNIRATE_API_KEY;
const CACHE_HOURS = 12;

export async function getExchangeRate(
  baseCurrency: string,
  targetCurrency: string
): Promise<number> {
  if (baseCurrency === targetCurrency) return 1;

  // 1. Check cache
  const cached = await pool.query(
    `SELECT rate, expires_at FROM fx_rates
     WHERE base_currency = $1 AND target_currency = $2
     AND expires_at > NOW()`,
    [baseCurrency, targetCurrency]
  );
  if (cached.rows.length > 0) {
    return parseFloat(cached.rows[0].rate);
  }

  // 2. Fetch from UniRateAPI – correct endpoint and parameter name
  if (!UNIRATE_API_KEY) {
    throw new Error('UNIRATE_API_KEY not configured');
  }

  // ✅ The API wants the key as "api_key" (with an underscore)
  const url = `https://api.unirateapi.com/api/rates?api_key=${UNIRATE_API_KEY}&from=${baseCurrency}`;
  const response = await axios.get(url);

  // The response contains a "rates" object
  const rate = response.data.rates?.[targetCurrency];
  if (typeof rate !== 'number') {
    throw new Error(`Rate not found for ${targetCurrency}`);
  }

  // 3. Cache the result
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + CACHE_HOURS);

  await pool.query(
    `INSERT INTO fx_rates (base_currency, target_currency, rate, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (base_currency, target_currency) DO UPDATE
     SET rate = EXCLUDED.rate, expires_at = EXCLUDED.expires_at`,
    [baseCurrency, targetCurrency, rate, expiresAt]
  );

  return rate;
}