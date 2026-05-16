import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookieParser';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import pool from './db';

import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import fxRoutes from './routes/fx';
import boostRoutes from './routes/boosts';
import rewardsRoutes from './routes/rewards';
import paymentsRoutes from './routes/payments';
import paystackRoutes from './routes/paystack';
import adminRoutes from './routes/admin';
import creatorDashboardRoutes from './routes/creatorDashboard';

import { handleStripeWebhook } from './routes/webhooks';
import { handlePaystackWebhook } from './routes/paystackWebhook';

import processBoostQueue from './scripts/processBoostQueue';
import checkMonthlyMaintenance from './scripts/monthlyMaintenanceChecker';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// -----------------------------
// 1. RAW BODY FOR WEBHOOKS
// -----------------------------
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  (req as any).rawBody = req.body.toString();
  handleStripeWebhook(req, res);
});

app.post('/api/webhooks/paystack', express.raw({ type: 'application/json' }), (req, res) => {
  (req as any).rawBody = req.body.toString();
  handlePaystackWebhook(req, res);
});

// -----------------------------
// 2. STANDARD MIDDLEWARE
// -----------------------------
app.use(helmet({
  crossOriginResourcePolicy: false, // Required to allow images to load from your own server
}));

// ✅ CORS: allow both localhost and the Netlify domain (and optionally the Render backend itself)
const allowedOrigins = [
  'http://localhost:3000',
  'https://usenotify-f74d53.netlify.app'
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) – remove if not needed
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

// Serve Static Files (The Avatar Uploads)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// -----------------------------
// 3. ROUTES
// -----------------------------
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api/boosts', boostRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/payments/paystack', paystackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/creator/dashboard', creatorDashboardRoutes);

// -----------------------------
// 4. HEALTH CHECK
// -----------------------------
app.get('/health', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

// -----------------------------
// 5. START SERVER
// -----------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// -----------------------------
// 6. CRON JOBS
// -----------------------------
cron.schedule('0 * * * *', async () => {
  try {
    await processBoostQueue();
  } catch (error) {
    console.error('Boost queue failed:', error);
  }
});

cron.schedule('0 2 * * *', async () => {
  try {
    await checkMonthlyMaintenance();
  } catch (error) {
    console.error('Maintenance check failed:', error);
  }
});