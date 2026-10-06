import { Router } from 'express';
import { generatePixPayload, getPixQrCodeUrl } from '../utils/pix_utils.js';

const router = Router();

export const PLANS = [
  {
    id: 'gratis',
    nome: 'Grátis',
    valorMensal: 0,
    precoFormatado: 'R$ 0,00',
    descricao: 'Ideal para experimentar e pequenos testes documentais.',
    recursos: [
      'Até 5 processos/análises por mês',
      'Checklists essenciais inclusos',
      'Cálculo determinístico de pendências',
      'Histórico básico de conferência',
      'Suporte comunitário'
    ],
    destaque: false,
    cta: 'Plano Atual / Começar Grátis'
  },
  {
    id: 'profissional',
    nome: 'Profissional',
    valorMensal: 29.90,
    precoFormatado: 'R$ 29,90/mês',
    descricao: 'Para autônomos, consultores e pequenos prestadores de serviços.',
    recursos: [
      'Até 50 processos por mês',
      'Checklists customizados ilimitados',
      'Armazenamento seguro de 10GB',
      'Histórico completo auditável',
      'Suporte prioritário por e-mail'
    ],
    destaque: false,
    cta: 'Assinar Profissional'
  },
  {
    id: 'empresa',
    nome: 'Empresa',
    valorMensal: 79.90,
    precoFormatado: 'R$ 79,90/mês',
    descricao: 'A melhor opção para departamentos de RH, contabilidade e imobiliárias.',
    recursos: [
      'Até 250 processos por mês',
      'Múltiplos membros e gestão de papéis',
      'Checklists customizados com orientações',
      'Auditoria completa para conformidade',
      'Exportação de relatórios de conferência'
    ],
    destaque: true,
    cta: 'Escolher Mais Popular'
  },
  {
    id: 'empresa_plus',
    nome: 'Empresa Plus',
    valorMensal: 149.90,
    precoFormatado: 'R$ 149,90/mês',
    descricao: 'Para operações de alto volume e conformidade contínua.',
    recursos: [
      'Processos ilimitados',
      'Armazenamento escalável dedicado',
      'SLA de suporte prioritário',
      'Acesso antecipado aos recursos inteligentes (Fase 2)',
      'Gestor de conta dedicado'
    ],
    destaque: false,
    cta: 'Contratar Plus'
  }
];

// Rota pública para listar planos comerciais
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    data: PLANS
  });
});

// Gera simulação oficial de PIX EMV para o plano
router.post('/pix-quote', (req, res) => {
  const { planoId } = req.body;
  const plano = PLANS.find(p => p.id === planoId);

  if (!plano) {
    return res.status(404).json({
      success: false,
      error: { code: 'PLAN_NOT_FOUND', message: 'Plano não encontrado.' }
    });
  }

  if (plano.valorMensal === 0) {
    return res.status(200).json({
      success: true,
      data: {
        plano,
        gratuito: true,
        message: 'O plano Grátis não necessita de pagamento.'
      }
    });
  }

  const pixKey = process.env.PIX_KEY || 'financeiro@documentocerto.com.br';
  const merchantName = process.env.PIX_NAME || 'DocumentoCerto SaaS';
  const merchantCity = process.env.PIX_CITY || 'SAO PAULO';

  const emvPayload = generatePixPayload({
    pixKey,
    name: merchantName,
    city: merchantCity,
    amount: plano.valorMensal,
    txId: `DOC${Date.now().toString(36).toUpperCase().slice(-8)}`
  });

  const qrCodeUrl = getPixQrCodeUrl(emvPayload);

  res.status(200).json({
    success: true,
    data: {
      plano,
      pix: {
        chave: pixKey,
        valor: plano.valorMensal,
        emvCopiaECola: emvPayload,
        qrCodeUrl
      },
      instrucoes: 'Copie o código PIX acima ou aponte a câmera do aplicativo do seu banco.'
    }
  });
});

export default router;
