export function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

// In-memory rate limiter leve e resiliente
class SimpleRateLimiter {
  constructor(windowMs, maxRequests, message) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.message = message || 'Muitas requisições. Tente novamente mais tarde.';
    this.hits = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();
      const clientRecord = this.hits.get(ip) || { count: 0, resetTime: now + this.windowMs };

      if (now > clientRecord.resetTime) {
        clientRecord.count = 0;
        clientRecord.resetTime = now + this.windowMs;
      }

      clientRecord.count++;
      this.hits.set(ip, clientRecord);

      if (clientRecord.count > this.maxRequests) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: this.message
          }
        });
      }

      next();
    };
  }
}

export const globalLimiter = new SimpleRateLimiter(
  15 * 60 * 1000,
  1000,
  'Limite de requisições excedido para este IP.'
).middleware();

export const authLimiter = new SimpleRateLimiter(
  15 * 60 * 1000,
  30,
  'Muitas tentativas de autenticação. Por segurança, aguarde alguns minutos.'
).middleware();

// Middleware de tratamento de erro seguro (sem stack traces para o cliente)
export function errorHandler(err, req, res, next) {
  console.error('[Error Handler]:', err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.userMessage || 'Ocorreu um erro interno ao processar sua requisição.'
    },
    timestamp: new Date().toISOString()
  });
}
