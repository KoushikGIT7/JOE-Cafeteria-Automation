import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { 
  registerSchema, 
  loginSchema, 
  updateProfileSchema 
} from '../middleware/validation';

const router = Router();

// Public routes
router.post('/register', validateBody(registerSchema), authController.register);
router.post('/login', validateBody(loginSchema), authController.login);
router.post('/refresh-token', authController.refresh);

// Protected routes
router.use(authMiddleware);

router.get('/me', authController.getMe);
router.patch('/profile', validateBody(updateProfileSchema), authController.updateProfile);

export default router;
