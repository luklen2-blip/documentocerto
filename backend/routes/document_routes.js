import { Router } from 'express';
import { DocumentController } from '../controllers/document_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, enforceActiveTrialOrPlan } from '../middleware/tenant_middleware.js';
import { documentUpload } from '../middleware/upload_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.post('/upload', enforceActiveTrialOrPlan, documentUpload.single('file'), DocumentController.upload);
router.get('/:id/file', DocumentController.getFile);
router.delete('/:id', DocumentController.delete);

export default router;
