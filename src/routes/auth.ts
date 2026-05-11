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

      if (role === 'creator') {
        const membershipExpiry = new Date();
        membershipExpiry.setFullYear(membershipExpiry.getFullYear() + 1);
        await client.query(
          `INSERT INTO creators (user_id, membership_expiry)
           VALUES ($1, $2)`,
          [newUser.id, membershipExpiry]
        );
      }
      if (role === 'follower') {
        await client.query(
          `INSERT INTO followers (user_id)
           VALUES ($1)`,
          [newUser.id]
        );
      }

      // Handle referral reward
      if (referralCode && referredBy && referrerRole) {
        const refereeRole = role;

        // Always insert referral record
        await client.query(
          `INSERT INTO referrals (referrer_id, referee_id, referrer_type, referee_type, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [referredBy, newUser.id, referrerRole, refereeRole]
        );

        // Apply rewards based on referrer and referee roles
        if (referrerRole === 'creator' && refereeRole === 'follower') {
          // Creator gets +1 referral count (queue priority)
          await client.query(
            `UPDATE creators
             SET referral_count = referral_count + 1,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          // Update queued boosts priority
          await client.query(
            `UPDATE boosts
             SET referral_priority = (SELECT referral_count FROM creators WHERE user_id = $1)
             WHERE creator_id = $1 AND status = 'queued'`,
            [referredBy]
          );
        } 
        else if (referrerRole === 'follower' && refereeRole === 'follower') {
          // Award 50 points (not 10)
          await client.query(
            `UPDATE followers
             SET points = points + 50,
                 updated_at = NOW()
             WHERE user_id = $1`,
            [referredBy]
          );
          // Recalculate stars: 1 star per 100 points
          await client.query(
            `UPDATE followers
             SET stars = floor(points / 100)::numeric
             WHERE user_id = $1`,
            [referredBy]
          );
        }
        // For referrer=creator->creator or referrer=follower->creator,
        // commission will be handled in payment webhook.
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