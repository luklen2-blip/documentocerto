import { Router } from 'express';
import { AuthController } from '../controllers/auth_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant } from '../middleware/tenant_middleware.js';
import { authLimiter } from '../middleware/security_middleware.js';

const router = Router();

router.post('/register', authLimiter, AuthController.register);
router.post('/login', authLimiter, AuthController.login);
router.get('/me', authenticate, requireTenant, AuthController.me);

export default router;
