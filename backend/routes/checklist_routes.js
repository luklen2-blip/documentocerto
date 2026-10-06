import { Router } from 'express';
import { ChecklistController } from '../controllers/checklist_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, requireRole } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', ChecklistController.list);
router.get('/:id', ChecklistController.getById);
router.post('/', requireRole('ADMIN'), ChecklistController.create);
router.delete('/:id', requireRole('ADMIN'), ChecklistController.delete);

export default router;
