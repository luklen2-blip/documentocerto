import crypto from 'crypto';
import {
  usersDb,
  organizationsDb,
  auditDb,
  kiwifyWebhookEventsDb,
  kiwifyTransactionsDb
} from '../database/index.js';

export class WebhookController {
  /**
   * Valida a autenticidade da notificação Kiwify
   */
  static validateAuthentication(req) {
    const configuredToken = process.env.KIWIFY_WEBHOOK_TOKEN;
    if (!configuredToken) {
      // Se não há token configurado no ambiente, permite processamento com aviso em log
      console.warn('[Kiwify Webhook Warning]: KIWIFY_WEBHOOK_TOKEN não configurado no ambiente.');
      return { valid: true };
    }

    // 1. Token via Query Param (?token=...)
    const queryToken = req.query.token;
    if (queryToken && queryToken === configuredToken) {
      return { valid: true, method: 'query_token' };
    }

    // 2. Token via Header (x-kiwify-token ou x-webhook-token)
    const headerToken = req.headers['x-kiwify-token'] || req.headers['x-webhook-token'];
    if (headerToken && headerToken === configuredToken) {
      return { valid: true, method: 'header_token' };
    }

    // 3. Token via Authorization Bearer
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      if (bearerToken === configuredToken) {
        return { valid: true, method: 'bearer_token' };
      }
    }

    // 4. Token dentro do body (campo token ou webhook_token)
    if (req.body && (req.body.token === configuredToken || req.body.webhook_token === configuredToken)) {
      return { valid: true, method: 'body_token' };
    }

    return { valid: false, reason: 'Token de autenticação ausente ou inválido.' };
  }

  /**
   * Extrai e normaliza os dados do webhook suportando formatos clássico e v1.0
   */
  static normalizeWebhookPayload(body) {
    const isEnvelope = Boolean(body.data && typeof body.data === 'object');
    const source = isEnvelope ? body.data : body;

    const orderId = source.order_id || body.id || source.id || null;
    const orderRef = source.order_ref || null;
    const orderStatus = (source.order_status || body.type || '').toLowerCase();
    const eventType = (body.type || (orderStatus === 'paid' ? 'order_approved' : orderStatus)).toLowerCase();

    const customerObj = source.Customer || source.customer || {};
    const customerEmail = (customerObj.email || '').toLowerCase().trim();
    const customerName = customerObj.full_name || customerObj.name || '';
    const customerCpf = customerObj.CPF || customerObj.cpf || '';

    const productObj = source.Product || source.product || {};
    const productId = productObj.product_id || null;
    const productName = productObj.product_name || 'DocumentoCerto Plano Vitalício';

    const paymentMethod = source.payment_method || 'unknown';
    const amount = parseFloat(source.charge_amount || source.amount || source.net_amount || '19.90');

    return {
      orderId,
      orderRef,
      orderStatus,
      eventType,
      customerEmail,
      customerName,
      customerCpf,
      productId,
      productName,
      paymentMethod,
      amount,
      rawBody: body
    };
  }

  /**
   * Manipulador principal do webhook Kiwify
   */
  static async handleKiwify(req, res) {
    const startTime = Date.now();
    try {
      // 1. Validação de Autenticidade
      const authResult = WebhookController.validateAuthentication(req);
      if (!authResult.valid) {
        console.warn(`[Kiwify Webhook 401]: Tentativa de chamada não autorizada: ${authResult.reason}`);
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED_WEBHOOK',
            message: 'Acesso negado: token do webhook inválido ou ausente.'
          }
        });
      }

      // 2. Extração e Normalização do Payload
      const payload = WebhookController.normalizeWebhookPayload(req.body || {});

      if (!payload.orderId || !payload.customerEmail) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Campos obrigatórios ausentes: order_id e Customer.email são mandatórios.'
          }
        });
      }

      // 3. Verificação de IDEMPOTÊNCIA Rigorosa
      const existingEvent = kiwifyWebhookEventsDb.findOne(
        e => e.orderId === payload.orderId && e.eventType === payload.eventType && e.status === 'PROCESSED'
      );

      if (existingEvent) {
        console.log(`[Kiwify Webhook Idempotency]: Evento repetido detectado para pedido ${payload.orderId}. Resposta 200 sem duplicar ativação.`);
        return res.status(200).json({
          success: true,
          message: 'Evento já processado anteriormente com sucesso (idempotente).',
          order_id: payload.orderId,
          idempotente: true
        });
      }

      // 4. Determinação do Tipo de Evento
      const isPaid = payload.orderStatus === 'paid' ||
                     payload.eventType === 'order_approved' ||
                     payload.eventType === 'compra_aprovada';

      const isRefundOrChargeback = payload.orderStatus === 'refunded' ||
                                   payload.orderStatus === 'chargedback' ||
                                   payload.eventType === 'refunded' ||
                                   payload.eventType === 'chargedback';

      // 5. PROCESSAMENTO DE PAGAMENTO APROVADO
      if (isPaid) {
        // 5.1 Busca usuário correspondente ao e-mail comprador
        const user = usersDb.findOne(u => u.email === payload.customerEmail);

        let tenantId = null;
        let userId = null;
        let activationStatus = 'PAID_ACTIVE';

        if (user) {
          tenantId = user.tenantId;
          userId = user.id;

          // Localiza a organização e ativa o plano VITALICIO
          const org = organizationsDb.findById(tenantId);
          if (org) {
            organizationsDb.update(org.id, {
              plano: 'VITALICIO',
              ativo: true,
              trialAtivo: false,
              trialExpiraEm: null, // Remove restrição de expiração
              limiteProcessosMes: 999999, // Ilimitado
              updatedAt: new Date().toISOString()
            });

            // Registro na trilha de auditoria
            auditDb.insert({
              tenantId: org.id,
              userId: user.id,
              userName: user.nome,
              action: 'KIWIFY_ORDER_APPROVED',
              details: {
                orderId: payload.orderId,
                orderRef: payload.orderRef,
                plano: 'VITALICIO',
                valor: payload.amount,
                paymentMethod: payload.paymentMethod,
                productName: payload.productName
              },
              timestamp: new Date().toISOString()
            });

            console.log(`[Kiwify Webhook]: ✅ Organização ${org.id} (${org.nome}) atualizada para PLANO VITALÍCIO! Pedido: ${payload.orderId}`);
          }
        } else {
          // Comprador efetuou a compra antes de criar a conta ou com e-mail corporativo diferente
          activationStatus = 'PAID_PENDING_CLAIM';
          console.log(`[Kiwify Webhook]: Pagamento aprovado para e-mail ${payload.customerEmail}, mas usuário ainda não existe. Gerando claim_token para resgate seguro.`);
        }

        // 5.2 Registra a transação comercial com claim_token único
        const claimToken = crypto.randomBytes(24).toString('hex');
        const transactionRecord = {
          orderId: payload.orderId,
          orderRef: payload.orderRef,
          tenantId,
          userId,
          customerEmail: payload.customerEmail,
          customerName: payload.customerName,
          customerCpf: payload.customerCpf,
          productId: payload.productId,
          productName: payload.productName,
          planoAtivado: 'VITALICIO',
          valorPago: payload.amount,
          paymentMethod: payload.paymentMethod,
          status: 'PAID',
          claimToken,
          claimedAt: user ? new Date().toISOString() : null
        };

        kiwifyTransactionsDb.insert(transactionRecord);

        // 5.3 Registra o evento de webhook processado (garantindo idempotência futura)
        kiwifyWebhookEventsDb.insert({
          orderId: payload.orderId,
          eventType: payload.eventType,
          status: 'PROCESSED',
          customerEmail: payload.customerEmail,
          productId: payload.productId,
          payload: req.body,
          processedAt: new Date().toISOString()
        });

        return res.status(200).json({
          success: true,
          message: user
            ? 'Pagamento aprovado confirmado e Plano Vitalício ativado com sucesso!'
            : 'Pagamento aprovado registrado. Aguardando associação à conta via claim_token.',
          data: {
            order_id: payload.orderId,
            status: activationStatus,
            email: payload.customerEmail,
            plano: 'VITALICIO',
            claim_token: user ? undefined : claimToken
          }
        });
      }

      // 6. PROCESSAMENTO DE REEMBOLSO / CHARGEBACK
      if (isRefundOrChargeback) {
        console.warn(`[Kiwify Webhook REEMBOLSO/CHARGEBACK]: Pedido ${payload.orderId} com status ${payload.orderStatus}.`);

        // Localiza transação anterior
        const tx = kiwifyTransactionsDb.findOne(t => t.orderId === payload.orderId);
        if (tx) {
          kiwifyTransactionsDb.update(tx.id, {
            status: payload.orderStatus.toUpperCase(),
            updatedAt: new Date().toISOString()
          });

          if (tx.tenantId) {
            auditDb.insert({
              tenantId: tx.tenantId,
              userId: tx.userId,
              action: 'KIWIFY_ORDER_REFUNDED_WARNING',
              details: {
                orderId: payload.orderId,
                status: payload.orderStatus,
                alerta: 'REQUIRES_ADMIN_REVIEW'
              },
              timestamp: new Date().toISOString()
            });
          }
        }

        kiwifyWebhookEventsDb.insert({
          orderId: payload.orderId,
          eventType: payload.eventType,
          status: 'PROCESSED',
          customerEmail: payload.customerEmail,
          productId: payload.productId,
          payload: req.body,
          processedAt: new Date().toISOString()
        });

        return res.status(200).json({
          success: true,
          message: `Evento de ${payload.orderStatus} registrado para auditoria.`,
          order_id: payload.orderId
        });
      }

      // 7. Eventos Informativos ou Outros (Boleto gerado, Pix aguardando)
      kiwifyWebhookEventsDb.insert({
        orderId: payload.orderId,
        eventType: payload.eventType,
        status: 'IGNORED',
        customerEmail: payload.customerEmail,
        payload: req.body,
        processedAt: new Date().toISOString()
      });

      return res.status(200).json({
        success: true,
        message: `Evento ${payload.eventType} recebido e arquivado.`,
        order_id: payload.orderId
      });

    } catch (err) {
      console.error('[Kiwify Webhook Fatal Error]:', err);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_WEBHOOK_ERROR',
          message: 'Erro interno no processamento do webhook.'
        }
      });
    }
  }

  /**
   * Endpoint de resgate seguro de compra (Claim Purchase)
   * Permite que um usuário autenticado resgate uma compra aprovada usando o código do pedido Kiwify
   */
  static async claimPurchase(req, res) {
    try {
      const { orderId, claimToken } = req.body;
      const userTenantId = req.user.tenantId;
      const userId = req.user.id;

      if (!orderId && !claimToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Informe o número do pedido Kiwify ou o token de resgate recebido na compra.'
          }
        });
      }

      // Localiza a transação comercial paga
      const tx = kiwifyTransactionsDb.findOne(t =>
        (orderId && t.orderId === orderId.trim()) ||
        (claimToken && t.claimToken === claimToken.trim())
      );

      if (!tx || tx.status !== 'PAID') {
        return res.status(404).json({
          success: false,
          error: {
            code: 'PURCHASE_NOT_FOUND',
            message: 'Nenhum pagamento aprovado foi localizado com os dados informados.'
          }
        });
      }

      // Se já foi resgatada por outro tenant
      if (tx.tenantId && tx.tenantId !== userTenantId && tx.claimedAt) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PURCHASE_ALREADY_CLAIMED',
            message: 'Este pedido já foi resgatado por outra organização.'
          }
        });
      }

      // Ativa o plano VITALICIO para a organização solicitante
      organizationsDb.update(userTenantId, {
        plano: 'VITALICIO',
        ativo: true,
        trialAtivo: false,
        trialExpiraEm: null,
        limiteProcessosMes: 999999,
        updatedAt: new Date().toISOString()
      });

      // Vincula a transação
      kiwifyTransactionsDb.update(tx.id, {
        tenantId: userTenantId,
        userId: userId,
        claimedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Log de auditoria
      auditDb.insert({
        tenantId: userTenantId,
        userId: userId,
        userName: req.user.nome,
        action: 'PURCHASE_CLAIMED_SUCCESS',
        details: { orderId: tx.orderId, plano: 'VITALICIO' },
        timestamp: new Date().toISOString()
      });

      return res.status(200).json({
        success: true,
        message: 'Compra verificada com sucesso! Seu Plano Vitalício está 100% ativo.',
        data: {
          order_id: tx.orderId,
          plano: 'VITALICIO'
        }
      });
    } catch (err) {
      console.error('[Claim Purchase Error]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao resgatar compra.' }
      });
    }
  }
}
