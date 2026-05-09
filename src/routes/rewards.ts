import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';

const router = Router();

// GET /api/rewards/balance
router.get('/balance', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Verify user is a follower
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userCheck.rows[0]?.role !== 'follower') {
      return res.status(403).json({ error: 'Only followers can access rewards' });
    }

    const result = await pool.query(
      `SELECT points, stars, lifetime_engagements, streak
       FROM followers WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Follower profile not found' });
    }

    const { points, stars, lifetime_engagements, streak } = result.rows[0];
    const remainder = points % 100;
    const nextStarAt = remainder === 0 ? 100 : 100 - remainder;

    res.json({
      points: parseInt(points),
      stars: parseFloat(stars),
      lifetime_engagements: parseInt(lifetime_engagements),
      streak: parseInt(streak),
      next_star_points_needed: nextStarAt,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/rewards/claim (course reward)
router.post('/claim', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Verify user is a follower
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userCheck.rows[0]?.role !== 'follower') {
      return res.status(403).json({ error: 'Only followers can claim rewards' });
    }

    // Get follower's stars
    const followerResult = await pool.query(
      `SELECT stars FROM followers WHERE user_id = $1`,
      [userId]
    );
    if (followerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Follower profile not found' });
    }

    const { stars } = followerResult.rows[0];
    const starsNum = parseFloat(stars);

    if (starsNum < 50) {
      return res.status(400).json({ error: 'You need at least 50 stars to claim a course reward' });
    }

    // Insert claim (course reward, no payment details needed)
    const result = await pool.query(
      `INSERT INTO reward_claims (user_id, stars_requested, amount_usd, reward_type, payment_details, status)
       VALUES ($1, $2, $3, 'course', NULL, 'pending')
       RETURNING id, stars_requested, reward_type, status, requested_at`,
      [userId, starsNum, 0] // amount_usd set to 0
    );

    res.json({
      message: 'Course reward claim submitted successfully',
      claim: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;