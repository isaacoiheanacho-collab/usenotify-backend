import { Router, Request, Response } from 'express';
import { hashPassword, comparePassword } from '../utils/password';
import { generateReferralCode } from '../utils/referral';
import { login } from '../controllers/authController';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, username, role, referralCode, country } = req.body;

    if (!email || !password || !username || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['creator', 'follower'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const hashedPassword = await hashPassword(password);
    const userReferralCode = generateReferralCode();

    let referredBy: string | null = null;
    let referrerRole: string | null = null;
    if (referralCode) {
      const referrerResult = await pool.query(
        'SELECT id, role FROM users WHERE referral_code = $1',
        [referralCode]
      );
      if (referrerResult.rows.length > 0) {
        referredBy = referrerResult.rows[0].id;
        referrerRole = referrerResult.rows[0].role;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO users (email, password_hash, username, role, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, username, role, referral_code`,
        [email, hashedPassword, username, role, userReferralCode, referredBy]
      );

      const newUser = result.rows[0];

      // Creator: pending membership, no expiry, 0/30 boosts
      if (role === 'creator') {
        await client.query(
          `INSERT INTO creators (user_id, membership_status, membership_expiry, monthly_boosts_used, monthly_boosts_limit)
           VALUES ($1, 'pending', NULL, 0, 30)`,
          [newUser.id]
        );
      }
      // Follower: create entry
      if (role === 'follower') {
        await client.query(
          `INSERT INTO followers (user_id)
           VALUES ($1)`,
          [newUser.id]
        );
      }

      // Store country in user_profiles if provided
      if (country) {
        await client.query(
          `INSERT INTO user_profiles (user_id, country)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET country = EXCLUDED.country`,
          [newUser.id, country]
        );
      }

      // Handle referral reward
      if (referralCode && referredBy && referrerRole) {
        const refereeRole = role;

        await client.query(
          `INSERT INTO referrals (referrer_id, referee_id, referrer_type, referee_type, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [referredBy, newUser.id, referrerRole, refereeRole]
        );

        if (referrerRole === 'creator' && refereeRole === 'follower') {
          await client.query(
            `UPDATE creators SET referral_count = referral_count + 1, updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          await client.query(
            `UPDATE boosts SET referral_priority = (SELECT referral_count FROM creators WHERE user_id = $1)
             WHERE creator_id = $1 AND status = 'queued'`,
            [referredBy]
          );
        } 
        else if (referrerRole === 'follower' && refereeRole === 'follower') {
          await client.query(
            `UPDATE followers SET points = points + 50, updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          await client.query(
            `UPDATE followers SET stars = floor(points / 100)::numeric
             WHERE user_id = $1`,
            [referredBy]
          );
        }
        // For referrer=creator->creator or referrer=follower->creator, commission handled in payment webhook.
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          role: newUser.role,
          referral_code: newUser.referral_code,
        },
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Get current password hash
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await comparePassword(currentPassword, userResult.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;