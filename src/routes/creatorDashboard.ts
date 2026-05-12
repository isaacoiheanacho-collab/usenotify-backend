import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';

const router = Router();

// GET /api/creator/dashboard
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // 1) Fetch base user info
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

    // 2) Fetch role-specific data
    let roleData: any = null;
    let creatorId: string | null = null;

    if (role === 'creator') {
      const creatorResult = await pool.query(
        `SELECT user_id, membership_status, membership_expiry, monthly_boosts_used, 
                monthly_boosts_limit, referral_count, total_engagements_received, last_boost_at
         FROM creators WHERE user_id = $1`,
        [userId]
      );
      if (creatorResult.rows.length > 0) {
        roleData = creatorResult.rows[0];
        creatorId = creatorResult.rows[0].user_id;
      }
    } else if (role === 'follower') {
      const followerResult = await pool.query(
        `SELECT points, stars, lifetime_engagements, streak
         FROM followers WHERE user_id = $1`,
        [userId]
      );
      if (followerResult.rows.length > 0) roleData = followerResult.rows[0];
    }

    // 3) Boost metrics (user's boosts only)
    let boosts = { active: 0, queued: 0, completed: 0, last_submitted: null, total_engagements: 0 };
    if (creatorId) {
      const boostStatsResult = await pool.query(
        `SELECT 
            COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE status = 'queued') AS queued,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            MAX(submitted_at) AS last_submitted,
            COALESCE(SUM(engagement_count), 0) AS total_engagements
         FROM boosts WHERE creator_id = $1`,
        [creatorId]
      );
      boosts = boostStatsResult.rows[0];
    }

    // 4) Rewards summary
    const rewardsResult = await pool.query(
      `SELECT 
          COALESCE(SUM(amount_usd), 0) AS total_earned,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_claims,
          COUNT(*) FILTER (WHERE status = 'approved') AS approved_claims,
          COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_claims,
          COALESCE(SUM(stars_requested), 0) AS total_stars_requested,
          COALESCE(SUM(amount_usd) FILTER (WHERE status = 'approved'), 0) AS total_paid_out,
          COALESCE(SUM(amount_usd) FILTER (WHERE status = 'pending'), 0) AS total_pending_value
       FROM reward_claims WHERE user_id = $1`,
      [userId]
    );
    const rewards = rewardsResult.rows[0];

    // 5) Notifications
    const notificationsResult = await pool.query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    const unreadCountResult = await pool.query(
      `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    const notifications = {
      unread: parseInt(unreadCountResult.rows[0].unread, 10),
      items: notificationsResult.rows
    };

    // 6) Activity Feed
    let activity: any[] = [];
    if (creatorId) {
      const boostsActivity = await pool.query(
        `SELECT id, 'boost' AS type, status, submitted_at AS timestamp
         FROM boosts WHERE creator_id = $1 ORDER BY submitted_at DESC LIMIT 10`,
        [creatorId]
      );
      activity.push(...boostsActivity.rows);
    }
    if (creatorId) {
      const engagementsActivity = await pool.query(
        `SELECT e.id, 'engagement' AS type, e.engagement_type AS action, e.created_at AS timestamp
         FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 ORDER BY e.created_at DESC LIMIT 10`,
        [creatorId]
      );
      activity.push(...engagementsActivity.rows);
    }
    const rewardActivity = await pool.query(
      `SELECT id, 'reward_claim' AS type, status, requested_at AS timestamp
       FROM reward_claims WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId]
    );
    if (rewardActivity.rows.length) activity.push(rewardActivity.rows[0]);
    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 7) Earnings History
    const earningsHistoryResult = await pool.query(
      `SELECT id, amount_usd, stars_requested, status, requested_at, processed_at
       FROM reward_claims WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20`,
      [userId]
    );
    const earnings_history = earningsHistoryResult.rows;

    // 8) Referral Analytics (for dashboard)
    const referralTotals = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE referee_type = 'follower') AS fans,
         COUNT(*) FILTER (WHERE referee_type = 'creator') AS creators
       FROM referrals WHERE referrer_id = $1`,
      [userId]
    );
    const fansReferred = parseInt(referralTotals.rows[0].fans, 10);
    const creatorsReferred = parseInt(referralTotals.rows[0].creators, 10);

    const referralThisMonth = await pool.query(
      `SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = $1
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())`,
      [userId]
    );
    const referralToday = await pool.query(
      `SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = $1
       AND DATE(created_at) = CURRENT_DATE`,
      [userId]
    );

    const lastReferredUsers = await pool.query(
      `SELECT r.id, u.email, u.username, r.created_at AS referred_at, r.referee_type
       FROM referrals r JOIN users u ON u.id = r.referee_id
       WHERE r.referrer_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
      [userId]
    );

    const commissionResult = await pool.query(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_commission
       FROM transactions WHERE user_id = $1 AND type = 'referral_commission' AND status = 'success'`,
      [userId]
    );
    const totalCommissionUsd = parseFloat(commissionResult.rows[0].total_commission);

    const referral_analytics = {
      fans_referred: fansReferred,
      creators_referred: creatorsReferred,
      total_referrals: fansReferred + creatorsReferred,
      referrals_this_month: parseInt(referralThisMonth.rows[0].count, 10),
      referrals_today: parseInt(referralToday.rows[0].count, 10),
      last_referred_users: lastReferredUsers.rows,
      total_points_from_referrals: 0,
      total_stars_from_referrals: 0,
      total_commission_earned_usd: totalCommissionUsd
    };

    // 9) Follower Engagement Analytics
    let follower_engagement = {};
    if (creatorId) {
      const totalEngagements = await pool.query(
        `SELECT COUNT(*) AS total FROM engagements e JOIN boosts b ON b.id = e.boost_id WHERE b.creator_id = $1`,
        [creatorId]
      );
      const engagementsToday = await pool.query(
        `SELECT COUNT(*) AS count FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 AND DATE(e.created_at) = CURRENT_DATE`,
        [creatorId]
      );
      const engagementsThisWeek = await pool.query(
        `SELECT COUNT(*) AS count FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 AND DATE_TRUNC('week', e.created_at) = DATE_TRUNC('week', NOW())`,
        [creatorId]
      );
      const engagementsThisMonth = await pool.query(
        `SELECT COUNT(*) AS count FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', NOW())`,
        [creatorId]
      );
      const topBoosts = await pool.query(
        `SELECT b.id, b.original_url, b.platform,
                SUM(e.points_earned) AS total_engagement_value,
                COUNT(e.id) AS engagement_count
         FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 GROUP BY b.id ORDER BY engagement_count DESC LIMIT 5`,
        [creatorId]
      );
      const engagementBreakdown = await pool.query(
        `SELECT e.engagement_type, COUNT(*) AS count
         FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 GROUP BY e.engagement_type`,
        [creatorId]
      );
      const lastEngagements = await pool.query(
        `SELECT e.id, e.engagement_type, e.points_earned AS engagement_value,
                e.created_at, b.original_url, b.platform
         FROM engagements e JOIN boosts b ON b.id = e.boost_id
         WHERE b.creator_id = $1 ORDER BY e.created_at DESC LIMIT 20`,
        [creatorId]
      );

      follower_engagement = {
        total_engagements: parseInt(totalEngagements.rows[0].total, 10),
        engagements_today: parseInt(engagementsToday.rows[0].count, 10),
        engagements_this_week: parseInt(engagementsThisWeek.rows[0].count, 10),
        engagements_this_month: parseInt(engagementsThisMonth.rows[0].count, 10),
        top_boosts: topBoosts.rows,
        engagement_breakdown: engagementBreakdown.rows,
        last_engagements: lastEngagements.rows
      };
    }

    // Global queue count
    const globalQueueResult = await pool.query(
      `SELECT COUNT(*) AS total FROM boosts WHERE status = 'queued'`
    );
    const globalQueueCount = parseInt(globalQueueResult.rows[0].total, 10);

    // User's next boost position and estimated live time
    let boostPosition = null;
    let estimatedLiveTime = null;
    if (creatorId) {
      const userQueuedBoost = await pool.query(
        `SELECT id, referral_priority, submitted_at
         FROM boosts WHERE creator_id = $1 AND status = 'queued'
         ORDER BY referral_priority DESC, submitted_at ASC LIMIT 1`,
        [creatorId]
      );
      if (userQueuedBoost.rows.length > 0) {
        const priority = userQueuedBoost.rows[0].referral_priority;
        const submittedAt = userQueuedBoost.rows[0].submitted_at;
        const positionResult = await pool.query(
          `SELECT COUNT(*) AS pos FROM boosts WHERE status = 'queued' AND 
           (referral_priority > $1 OR (referral_priority = $1 AND submitted_at < $2))`,
          [priority, submittedAt]
        );
        boostPosition = parseInt(positionResult.rows[0].pos, 10) + 1;
        const hoursToWait = Math.ceil(boostPosition / 500);
        estimatedLiveTime = new Date(Date.now() + hoursToWait * 60 * 60 * 1000);
      }
    }

    // Platform engagement breakdown
    let platformEngagement = [];
    if (creatorId) {
      const platformEngResult = await pool.query(
        `SELECT b.platform, COALESCE(SUM(e.points_earned), 0) AS engagement_count
         FROM boosts b LEFT JOIN engagements e ON e.boost_id = b.id
         WHERE b.creator_id = $1 GROUP BY b.platform ORDER BY engagement_count DESC`,
        [creatorId]
      );
      platformEngagement = platformEngResult.rows;
    }

    res.json({
      user, roleData, boosts, rewards, notifications, activity, earnings_history,
      referral_analytics, follower_engagement, globalQueueCount, boostPosition,
      estimatedLiveTime, platformEngagement
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Reward Analytics Route ==========
router.get('/reward-analytics', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Total commission earned
    const commissionTotal = await pool.query(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total
       FROM transactions
       WHERE user_id = $1 AND type = 'referral_commission' AND status = 'success'`,
      [userId]
    );
    const totalCommission = parseFloat(commissionTotal.rows[0].total);

    // Fans referred (for priority points) and creators referred
    const fansResult = await pool.query(
      `SELECT COUNT(*) AS fans FROM referrals WHERE referrer_id = $1 AND referee_type = 'follower'`,
      [userId]
    );
    const creatorsResult = await pool.query(
      `SELECT COUNT(*) AS creators FROM referrals WHERE referrer_id = $1 AND referee_type = 'creator'`,
      [userId]
    );
    const fansReferred = parseInt(fansResult.rows[0].fans, 10);
    const creatorsReferred = parseInt(creatorsResult.rows[0].creators, 10);
    const totalFanPoints = fansReferred * 50;
    const totalStars = Math.floor(totalFanPoints / 100);

    // Commission history with region
    const historyQuery = `
      SELECT t.id, t.amount_usd, t.created_at,
             u.username AS referred_username,
             up.country,
             CASE
               WHEN up.country IN ('NG','ZA','KE','GH','EG','MA','TN','DZ','AO','CM','CI','ET','TZ','UG','ZM','ZW','SN','ML','BF','BJ','RW') THEN 'Africa'
               ELSE 'Global'
             END AS region
      FROM transactions t
      INNER JOIN referrals r ON r.referrer_id = t.user_id AND r.commission_paid = true
      INNER JOIN users u ON u.id = r.referee_id
      LEFT JOIN user_profiles up ON up.user_id = r.referee_id
      WHERE t.user_id = $1 AND t.type = 'referral_commission' AND t.status = 'success'
      ORDER BY t.created_at DESC
    `;
    const historyRes = await pool.query(historyQuery, [userId]);
    const commissionHistory = historyRes.rows;

    // Monthly commission breakdown
    const monthlyCommission = await pool.query(
      `SELECT DATE_TRUNC('month', created_at) AS month,
              COALESCE(SUM(amount_usd), 0) AS total
       FROM transactions
       WHERE user_id = $1 AND type = 'referral_commission' AND status = 'success'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC`,
      [userId]
    );
    const monthlyBreakdown = monthlyCommission.rows.map(row => ({
      month: row.month.toISOString().slice(0,7),
      total: parseFloat(row.total)
    }));

    // Monthly fan points
    const fanPointsMonthly = await pool.query(
      `SELECT DATE_TRUNC('month', created_at) AS month,
              COUNT(*) * 50 AS points
       FROM referrals
       WHERE referrer_id = $1 AND referee_type = 'follower'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC`,
      [userId]
    );
    const fanPointsBreakdown = fanPointsMonthly.rows.map(row => ({
      month: row.month.toISOString().slice(0,7),
      points: parseInt(row.points)
    }));

    // Region breakdown totals and percentages
    const regionBreakdown = await pool.query(`
      SELECT 
        CASE WHEN up.country IN ('NG','ZA','KE','GH','EG','MA','TN','DZ','AO','CM','CI','ET','TZ','UG','ZM','ZW','SN','ML','BF','BJ','RW') THEN 'Africa' ELSE 'Global' END AS region,
        COALESCE(SUM(t.amount_usd), 0) AS total,
        COALESCE(ROUND(SUM(t.amount_usd) / NULLIF($1, 0) * 100, 2), 0) AS percentage
      FROM transactions t
      INNER JOIN referrals r ON r.referrer_id = t.user_id AND r.commission_paid = true
      INNER JOIN users u ON u.id = r.referee_id
      LEFT JOIN user_profiles up ON up.user_id = r.referee_id
      WHERE t.user_id = $2 AND t.type = 'referral_commission' AND t.status = 'success'
      GROUP BY region
    `, [totalCommission, userId]);

    res.json({
      total_commission_earned_usd: totalCommission,
      fans_referred_total: fansReferred,
      creators_referred_total: creatorsReferred,
      total_fan_points: totalFanPoints,
      total_stars: totalStars,
      commission_history: commissionHistory,
      monthly_breakdown: monthlyBreakdown,
      fan_points_monthly: fanPointsBreakdown,
      region_breakdown: regionBreakdown.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Claim Rewards Route ==========
router.post('/claim-rewards', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { amount, paymentMethod } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!paymentMethod || !['paypal', 'bank', 'crypto'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    // Get total commission earned (available)
    const commissionResult = await pool.query(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_commission
       FROM transactions
       WHERE user_id = $1 AND type = 'referral_commission' AND status = 'success'`,
      [userId]
    );
    const totalCommission = parseFloat(commissionResult.rows[0].total_commission);

    // Get already claimed amounts from reward_claims (status 'approved' or 'pending')
    const claimedResult = await pool.query(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_claimed
       FROM reward_claims
       WHERE user_id = $1 AND status IN ('pending', 'approved')`,
      [userId]
    );
    const totalClaimed = parseFloat(claimedResult.rows[0].total_claimed);

    const available = totalCommission - totalClaimed;
    if (amount > available) {
      return res.status(400).json({ error: `Amount exceeds available commission. Available: $${available.toFixed(2)}` });
    }

    // Create reward claim record
    const result = await pool.query(
      `INSERT INTO reward_claims (user_id, amount_usd, stars_requested, status, payment_details, requested_at)
       VALUES ($1, $2, 0, 'pending', $3, NOW())
       RETURNING id, amount_usd, status, requested_at`,
      [userId, amount, JSON.stringify({ method: paymentMethod, requestedAt: new Date().toISOString() })]
    );

    res.json({
      message: 'Reward claim submitted successfully',
      claim: result.rows[0],
      available: available - amount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;