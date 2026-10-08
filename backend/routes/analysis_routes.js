import { Router } from 'express';
import { AnalysisController } from '../controllers/analysis_controller.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, enforceActiveTrialOrPlan } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.post('/process/:processId/run', enforceActiveTrialOrPlan, AnalysisController.run);
router.get('/process/:processId/latest', AnalysisController.getLatest);
router.get('/process/:processId/history', AnalysisController.getHistory);
router.get('/job/:jobId', AnalysisController.getJobStatus);

export default router;
