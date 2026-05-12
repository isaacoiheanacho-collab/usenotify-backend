import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';
import { cleanUrl } from '../utils/urlCleaner';

const router = Router();

// POST /api/boosts
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { original_url, platform, category, notes } = req.body;

    // Basic validation
    if (!original_url || !platform) {
      return res.status(400).json({ error: 'original_url and platform are required' });
    }

    // 1. Verify user is a creator
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userCheck.rows[0]?.role !== 'creator') {
      return res.status(403).json({ error: 'Only creators can submit boosts' });
    }

    // 2. Check membership status and expiry
    const creatorCheck = await pool.query(
      `SELECT membership_status, membership_expiry, last_boost_at 
       FROM creators WHERE user_id = $1`,
      [userId]
    );
    if (creatorCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Creator profile not found' });
    }
    const creator = creatorCheck.rows[0];
    if (creator.membership_status !== 'active') {
      return res.status(403).json({ error: 'Membership is not active' });
    }
    const now = new Date();
    const expiry = new Date(creator.membership_expiry);
    if (expiry < now) {
      return res.status(403).json({ error: 'Membership has expired' });
    }

    // 3. Daily limit check: last boost must be more than 24 hours ago
    if (creator.last_boost_at) {
      const lastBoost = new Date(creator.last_boost_at);
      const hoursSinceLastBoost = (now.getTime() - lastBoost.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastBoost < 24) {
        return res.status(429).json({ error: 'You can only submit one boost per day. Please wait.' });
      }
    }

    // 4. Get creator's referral count for priority
    const referralCountResult = await pool.query(
      'SELECT referral_count FROM creators WHERE user_id = $1',
      [userId]
    );
    const referralPriority = referralCountResult.rows[0]?.referral_count || 0;

    // Clean the URL
    const clean_url = cleanUrl(original_url);

    // Insert boost with status 'queued' and referral_priority
    const result = await pool.query(
      `INSERT INTO boosts (creator_id, original_url, clean_url, platform, category, notes, status, referral_priority)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
       RETURNING id, creator_id, clean_url, platform, category, status, submitted_at, referral_priority`,
      [userId, original_url, clean_url, platform, category || null, notes || null, referralPriority]
    );

    // ➕ Increment monthly_boosts_used for the creator
    await pool.query(
      `UPDATE creators SET monthly_boosts_used = monthly_boosts_used + 1
       WHERE user_id = $1`,
      [userId]
    );

    // Update last_boost_at in creators table
    await pool.query(
      `UPDATE creators SET last_boost_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    res.status(201).json({ message: 'Boost submitted successfully', boost: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boosts?status=queued&limit=10&offset=0
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { status, limit = 10, offset = 0 } = req.query;

    // Verify user is a creator
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userCheck.rows[0]?.role !== 'creator') {
      return res.status(403).json({ error: 'Only creators can view their boosts' });
    }

    let query = `
      SELECT id, original_url, clean_url, platform, category, notes,
             status, referral_priority, engagement_count, submitted_at,
             active_from, active_until
      FROM boosts
      WHERE creator_id = $1
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY submitted_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ boosts: result.rows, limit: Number(limit), offset: Number(offset) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boosts/active - for followers
router.get('/active', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const followerId = req.user!.id;

    // Verify user is a follower
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [followerId]);
    if (userCheck.rows[0]?.role !== 'follower') {
      return res.status(403).json({ error: 'Only followers can access active boosts' });
    }

    // Get active boosts not yet engaged by this follower
    const result = await pool.query(`
      SELECT b.id, b.clean_url, b.platform, b.category, b.engagement_count
      FROM boosts b
      WHERE b.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM engagements e
          WHERE e.boost_id = b.id AND e.follower_id = $1
        )
      ORDER BY b.referral_priority DESC, b.submitted_at ASC
      LIMIT 500
    `, [followerId]);

    res.json({ boosts: result.rows, count: result.rows.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boosts/engagements - follower confirms engagement
router.post('/engagements', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const followerId = req.user!.id;
    const { boost_id, engagement_type } = req.body;

    // Basic validation
    if (!boost_id || !engagement_type) {
      return res.status(400).json({ error: 'boost_id and engagement_type are required' });
    }
    const validTypes = ['view', 'like', 'comment', 'share'];
    if (!validTypes.includes(engagement_type)) {
      return res.status(400).json({ error: 'engagement_type must be one of: view, like, comment, share' });
    }

    // 1. Verify user is a follower
    const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [followerId]);
    if (userCheck.rows[0]?.role !== 'follower') {
      return res.status(403).json({ error: 'Only followers can engage boosts' });
    }

    // 2. Check boost exists and is active
    const boostCheck = await pool.query(
      'SELECT id, status FROM boosts WHERE id = $1',
      [boost_id]
    );
    if (boostCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Boost not found' });
    }
    if (boostCheck.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Boost is not active' });
    }

    // 3. Check if follower already engaged this boost
    const existing = await pool.query(
      'SELECT id FROM engagements WHERE boost_id = $1 AND follower_id = $2',
      [boost_id, followerId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You have already engaged this boost' });
    }

    // 4. Insert engagement and update points/boost count in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert engagement
      const engagementResult = await client.query(
        `INSERT INTO engagements (boost_id, follower_id, engagement_type, points_earned, verified_at)
         VALUES ($1, $2, $3, 1, NOW())
         RETURNING id, points_earned`,
        [boost_id, followerId, engagement_type]
      );

      // Increment follower's points and engagement counts
      await client.query(
        `UPDATE followers
         SET points = points + 1,
             lifetime_engagements = lifetime_engagements + 1,
             last_engagement_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1`,
        [followerId]
      );

      // Recalculate stars based on new points
      await client.query(
        `UPDATE followers
         SET stars = floor(points / 100)::numeric
         WHERE user_id = $1`,
        [followerId]
      );

      // Update boost engagement count
      await client.query(
        `UPDATE boosts
         SET engagement_count = engagement_count + 1,
            updated_at = NOW()
         WHERE id = $1`,
        [boost_id]
      );

      await client.query('COMMIT');

      res.json({
        message: 'Engagement recorded',
        points_earned: 1,
        engagement_id: engagementResult.rows[0].id,
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

export default router;