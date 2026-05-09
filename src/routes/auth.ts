import { Router, Request, Response } from 'express';
import { hashPassword } from '../utils/password';
import { generateReferralCode } from '../utils/referral';
import { login } from '../controllers/authController';
import pool from '../db';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, username, role, referralCode } = req.body;

    // Basic validation
    if (!email || !password || !username || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['creator', 'follower'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Generate unique referral code for this user
    const userReferralCode = generateReferralCode();

    // Optional: find referrer
    let referredBy: string | null = null;
    if (referralCode) {
      const referrerResult = await pool.query(
        'SELECT id, role FROM users WHERE referral_code = $1',
        [referralCode]
      );
      if (referrerResult.rows.length > 0) {
        referredBy = referrerResult.rows[0].id;
      }
    }

    // Insert user (start a transaction because we may update multiple tables)
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

      // If role is creator, create entry in creators table with membership expiry 1 year from now
      if (role === 'creator') {
        const membershipExpiry = new Date();
        membershipExpiry.setFullYear(membershipExpiry.getFullYear() + 1);
        await client.query(
          `INSERT INTO creators (user_id, membership_expiry)
           VALUES ($1, $2)`,
          [newUser.id, membershipExpiry]
        );
      }

      // If role is follower, create entry in followers table
      if (role === 'follower') {
        await client.query(
          `INSERT INTO followers (user_id)
           VALUES ($1)`,
          [newUser.id]
        );
      }

      // Handle referral bonus based on referrer role
      if (referralCode && referredBy) {
        const referrerRoleResult = await client.query(
          'SELECT role FROM users WHERE id = $1',
          [referredBy]
        );
        const referrerRole = referrerRoleResult.rows[0]?.role;
        if (referrerRole === 'creator') {
          // Increment creator's referral_count and update queued boosts priority
          await client.query(
            `UPDATE creators
             SET referral_count = referral_count + 1,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          // Update referral_priority for all queued boosts of this creator
          await client.query(
            `UPDATE boosts
             SET referral_priority = (SELECT referral_count FROM creators WHERE user_id = $1)
             WHERE creator_id = $1 AND status = 'queued'`,
            [referredBy]
          );
        } else if (referrerRole === 'follower') {
          // Add 10 points to follower referrer
          await client.query(
            `UPDATE followers
             SET points = points + 10,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          // Recalculate stars based on new points
          await client.query(
            `UPDATE followers
             SET stars = floor(points / 100)::numeric
             WHERE user_id = $1`,
            [referredBy]
          );
          // Insert referral record with reward claimed (points already given)
          await client.query(
            `INSERT INTO referrals (referrer_id, referee_id, referrer_type, reward_claimed, reward_amount, claimed_at)
             VALUES ($1, $2, 'follower', true, 10, NOW())`,
            [referredBy, newUser.id]
          );
        }
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

export default router;