import { Router } from 'express';
import { generatePixPayload, getPixQrCodeUrl } from '../utils/pix_utils.js';

const router = Router();

export const PLANS = [
  {
    id: 'vitalicio',
    nome: 'Plano Vitalício',
    valorMensal: 19.90,
    valorUnico: 19.90,
    precoFormatado: 'R$ 19,90',
    tipoCobranca: 'Pagamento Único Vitalício',
    kiwifyUrl: 'https://pay.kiwify.com.br/ueLjXAd',
    trialDias: 1,
    descricao: 'Acesso vitalício irrestrito com 1 dia de teste gratuito sem compromisso.',
    recursos: [
      '⚡ 1 Dia de Teste Grátis com Acesso Total',
      'Acesso Vitalício sem cobranças recorrentes',
      'Processos e conferências ilimitadas',
      'Validação Matemática (CPF/CNPJ) e Legibilidade',
      'Conferência Cruzada Inteligente entre Documentos',
      'Checklists customizados e auditoria para compliance',
      'Checkout seguro Kiwify com liberação instantânea'
    ],
    destaque: true,
    badge: '🔥 OFERTA VITALÍCIA • 1 DIA DE TESTE',
    cta: 'Comprar Vitalício (Kiwify)'
  },
  {
    id: 'gratis',
    nome: 'Teste de 1 Dia',
    valorMensal: 0,
    precoFormatado: 'R$ 0,00',
    tipoCobranca: 'Período de Teste',
    trialDias: 1,
    descricao: 'Experimente todas as funcionalidades por 24 horas sem colocar cartão.',
    recursos: [
      '1 dia de teste irrestrito',
      'Conferência de até 5 processos',
      'Checklists essenciais inclusos',
      'Cálculo determinístico de pendências',
      'Suporte comunitário'
    ],
    destaque: false,
    cta: 'Começar Teste de 1 Dia'
  },
  {
    id: 'profissional',
    nome: 'Profissional',
    valorMensal: 29.90,
    precoFormatado: 'R$ 29,90/mês',
    tipoCobranca: 'Mensal',
    trialDias: 1,
    descricao: 'Para autônomos, consultores e pequenos prestadores de serviços.',
    recursos: [
      '1 dia de teste grátis incluído',
      'Até 50 processos por mês',
      'Checklists customizados ilimitados',
      'Armazenamento seguro de 10GB',
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
    tipoCobranca: 'Mensal',
    trialDias: 1,
    descricao: 'A melhor opção para departamentos de RH, contabilidade e imobiliárias.',
    recursos: [
      '1 dia de teste grátis para equipe',
      'Até 250 processos por mês',
      'Múltiplos membros e gestão de papéis',
      'Checklists customizados com orientações',
      'Auditoria completa para conformidade'
    ],
    destaque: false,
    cta: 'Escolher Empresa'
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
      kiwifyUrl: plano.kiwifyUrl || 'https://pay.kiwify.com.br/ueLjXAd',
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

// Informações diretas de checkout Kiwify
router.get('/kiwify', (req, res) => {
  const vitalicio = PLANS.find(p => p.id === 'vitalicio');
  res.status(200).json({
    success: true,
    data: {
      kiwifyUrl: vitalicio.kiwifyUrl,
      plano: vitalicio.nome,
      precoFormatado: vitalicio.precoFormatado,
      trialDias: vitalicio.trialDias,
      descricao: vitalicio.descricao
    }
  });
});

export default router;
