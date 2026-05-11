import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middlewares/authMiddleware';
import pool from '../db';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const router = Router();

let uploadMiddleware: multer.Multer | null = null;

function getUploadMiddleware() {
  if (uploadMiddleware) return uploadMiddleware;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req: AuthRequest, file: Express.Multer.File) => ({
      folder: 'usenotify/avatars',
      public_id: `avatar-${req.user?.id || 'unknown'}-${Date.now()}`,
      format: 'jpg',  // ✅ changed from 'auto' to 'jpg'
      transformation: [{ width: 400, height: 400, crop: 'fill' }],
    }),
  });

  uploadMiddleware = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req: AuthRequest, file: Express.Multer.File, cb: any) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images (jpeg, jpg, png, webp) are allowed'));
    },
  });

  return uploadMiddleware;
}

// ---------- GET /api/profile ----------
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  // ... (keep exactly as before, unchanged)
});

// ---------- POST /api/profile (update profile) ----------
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  // ... unchanged
});

// ---------- POST /api/profile/upload-avatar ----------
router.post('/upload-avatar', authenticateToken, async (req: any, res: Response) => {
  const upload = getUploadMiddleware();
  upload.single('avatar')(req, res, async (err: any) => {
    if (err) {
      console.error('Multer/Cloudinary error:', err);
      return res.status(500).json({
        error: err.message || 'Upload failed',
        details: err.toString(),
      });
    }
    try {
      const userId = req.user!.id;
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }
      const avatarUrl = req.file.path;
      await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
      res.json({ message: 'Avatar uploaded successfully', avatar_url: avatarUrl });
    } catch (error: any) {
      console.error('Database update error:', error);
      res.status(500).json({
        error: error.message || 'Failed to save avatar URL',
        details: error.toString(),
      });
    }
  });
});

// ---------- GET /api/profile/referral-stats ----------
router.get('/referral-stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  // ... unchanged
});

export default router;