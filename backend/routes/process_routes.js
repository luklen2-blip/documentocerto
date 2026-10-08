import { Router } from 'express';
import { ProcessController } from '../controllers/process_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, requireRole, enforceActiveTrialOrPlan } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', ProcessController.list);
router.get('/:id', ProcessController.getById);
router.post('/', enforceActiveTrialOrPlan, ProcessController.create);
router.patch('/:id/itens/:itemId', ProcessController.updateItem);
router.patch('/:id/workflow', ProcessController.updateWorkflowStatus);
router.delete('/:id', requireRole('ADMIN'), ProcessController.delete);

export default router;
