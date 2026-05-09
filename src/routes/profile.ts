import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';
import multer from 'multer';
import { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// --- MULTER CONFIGURATION ---
const uploadDir = 'uploads/avatars/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req: AuthRequest, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        cb(null, uploadDir);
    },
    filename: (req: AuthRequest, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        const userId = req.user?.id || 'unknown';
        cb(null, `avatar-${userId}-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req: AuthRequest, file: Express.Multer.File, cb: FileFilterCallback) => {
        const filetypes = /jpeg|jpg|png|webp/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only images (jpeg, jpg, png, webp) are allowed'));
        }
    }
});

// --- ROUTES ---

// GET /api/profile
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const userResult = await pool.query(
      `SELECT id, email, username, avatar_url, role, referral_code, status, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const role = user.role;

    let roleData = null;
    if (role === 'creator') {
      const creatorResult = await pool.query(
        `SELECT membership_status, membership_expiry, last_maintenance_paid,
                monthly_boosts_used, monthly_boosts_limit, referral_count, total_engagements_received
         FROM creators WHERE user_id = $1`,
        [userId]
      );
      if (creatorResult.rows.length > 0) roleData = creatorResult.rows[0];
    } else if (role === 'follower') {
      const followerResult = await pool.query(
        `SELECT points, stars, lifetime_engagements, streak
         FROM followers WHERE user_id = $1`,
        [userId]
      );
      if (followerResult.rows.length > 0) roleData = followerResult.rows[0];
    }

    const profileResult = await pool.query(
      `SELECT phone, country, currency, timezone, social_links, notification_preferences
       FROM user_profiles WHERE user_id = $1`,
      [userId]
    );
    const profile = profileResult.rows[0] || {};

    res.json({ user, roleData, profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profile (Sync Identity & Socials)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user!.id;
    const { username, phone, country, currency, timezone, social_links } = req.body;

    await client.query('BEGIN');

    if (username) {
      await client.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId]);
    }

    await client.query(
      `INSERT INTO user_profiles (user_id, phone, country, currency, timezone, social_links)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         phone = COALESCE(EXCLUDED.phone, user_profiles.phone),
         country = COALESCE(EXCLUDED.country, user_profiles.country),
         currency = COALESCE(EXCLUDED.currency, user_profiles.currency),
         timezone = COALESCE(EXCLUDED.timezone, user_profiles.timezone),
         social_links = COALESCE(EXCLUDED.social_links, user_profiles.social_links),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, phone, country, currency, timezone, JSON.stringify(social_links)]
    );

    await client.query('COMMIT');

    const updated = await client.query(
      `SELECT up.*, u.username FROM user_profiles up 
       JOIN users u ON u.id = up.user_id WHERE up.user_id = $1`,
      [userId]
    );

    res.json({ message: 'Profile updated successfully', profile: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * We use 'any' for the route handler specifically to let Multer 
 * inject the 'file' property without TypeScript complaining.
 */
router.post('/upload-avatar', authenticateToken, upload.single('avatar'), async (req: any, res: Response) => {
    try {
        const userId = req.user!.id;
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        await pool.query(
            'UPDATE users SET avatar_url = $1 WHERE id = $2',
            [avatarUrl, userId]
        );

        res.json({ 
            message: 'Avatar uploaded successfully', 
            avatar_url: avatarUrl 
        });
    } catch (error) {
        console.error("Upload Route Error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/profile/referral-stats
router.get('/referral-stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const userResult = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
    const referralCode = userResult.rows[0]?.referral_code;

    const referredResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE referred_by = $1', [userId]);
    const referredCount = parseInt(referredResult.rows[0].count);

    res.json({ referral_code: referralCode, referred_users_count: referredCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;