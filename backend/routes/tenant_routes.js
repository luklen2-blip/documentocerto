import { Router } from 'express';
import { TenantController } from '../controllers/tenant_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, requireRole } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/current', TenantController.getCurrent);
router.get('/users', TenantController.listUsers);
router.post('/users', requireRole('ADMIN'), TenantController.addUser);
router.patch('/users/:id/role', requireRole('ADMIN'), TenantController.updateRole);

export default router;
