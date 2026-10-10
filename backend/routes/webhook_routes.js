import { Router } from 'express';
import { WebhookController } from '../controllers/webhook_controller.js';

const router = Router();

// Rota oficial de recebimento de Webhook Kiwify (POST /api/webhooks/kiwify)
router.post('/kiwify', WebhookController.handleKiwify);

// Alias para compatibilidade caso configurado no singular (/api/webhook/kiwify)
router.post('/', WebhookController.handleKiwify);

export default router;
