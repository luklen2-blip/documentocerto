import { verifyToken } from '../utils/crypto_utils.js';
import { usersDb } from '../database/index.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Acesso não autorizado. Faça login para continuar.'
      }
    });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);

  if (!payload || !payload.userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_INVALID',
        message: 'Sessão inválida ou expirada. Efetue login novamente.'
      }
    });
  }

  const user = usersDb.findById(payload.userId);
  if (!user || !user.ativo) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'USER_INACTIVE',
        message: 'Usuário não encontrado ou inativo.'
      }
    });
  }

  req.user = user;
  req.tenantId = user.tenantId;
  next();
}
