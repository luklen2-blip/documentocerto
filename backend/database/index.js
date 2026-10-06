import { JsonDB } from './json_db.js';

export const organizationsDb = new JsonDB('organizations');
export const usersDb = new JsonDB('users');
export const checklistsDb = new JsonDB('checklists');
export const processesDb = new JsonDB('processes');
export const documentsDb = new JsonDB('documents');
export const auditDb = new JsonDB('audit_logs');

// Coleções da Fase 2 (Conferência Inteligente & OCR)
export const analysisJobsDb = new JsonDB('analysis_jobs');
export const extractedTextDb = new JsonDB('extracted_text');
export const extractedFieldsDb = new JsonDB('extracted_fields');
export const findingsDb = new JsonDB('findings');
export const aiAnalysisDb = new JsonDB('ai_analysis');

// Inicializa modelos padrão de checklist se o banco estiver vazio
export function seedDefaultChecklists() {
  const existing = checklistsDb.findAll(c => c.isSystemTemplate);
  if (existing.length === 0) {
    const templates = [
      {
        id: 'chk_admissao_default',
        tenantId: 'system',
        isSystemTemplate: true,
        nome: 'Admissão de Colaborador (CLT / Estágio)',
        descricao: 'Checklist para conferência documental completa no processo de admissão funcional.',
        categoria: 'Recursos Humanos',
        ativo: true,
        itens: [
          { id: 'item_adm_1', nome: 'Documento de identificação (RG / CNH válida)', tipo: 'identificacao', obrigatorio: true, orientacoes: 'Verificar nitidez, validade e ausência de rasuras.' },
          { id: 'item_adm_2', nome: 'Comprovante de CPF regular', tipo: 'identificacao', obrigatorio: true, orientacoes: 'Pode estar inserido no RG/CNH ou certidão da Receita Federal.' },
          { id: 'item_adm_3', nome: 'Comprovante de residência atualizado', tipo: 'comprovante', obrigatorio: true, orientacoes: 'Emitido nos últimos 90 dias em nome do colaborador ou declaração.' },
          { id: 'item_adm_4', nome: 'Dados bancários (conta corrente/salário)', tipo: 'dados_bancarios', obrigatorio: true, orientacoes: 'Extrato ou cartão comprovando agência, conta e titularidade.' },
          { id: 'item_adm_5', nome: 'Formulários admissionais preenchidos', tipo: 'formulario', obrigatorio: true, orientacoes: 'Ficha cadastral preenchida sem campos em branco.' },
          { id: 'item_adm_6', nome: 'Contrato de trabalho assinado', tipo: 'assinatura', obrigatorio: true, orientacoes: 'Verificar se constam assinaturas válidas das partes.' },
          { id: 'item_adm_7', nome: 'Carteira de Trabalho Digital (espelho)', tipo: 'comprovante', obrigatorio: false, orientacoes: 'Extrato do aplicativo Carteira de Trabalho Digital.' },
          { id: 'item_adm_8', nome: 'Certidão de nascimento / casamento', tipo: 'certidao', obrigatorio: false, orientacoes: 'Necessário quando houver dependentes cadastrados.' }
        ]
      },
      {
        id: 'chk_fornecedor_default',
        tenantId: 'system',
        isSystemTemplate: true,
        nome: 'Cadastro de Fornecedor e Parceiro',
        descricao: 'Conferência de idoneidade e habilitação jurídica para homologação de fornecedores.',
        categoria: 'Compras e Contratos',
        ativo: true,
        itens: [
          { id: 'item_forn_1', nome: 'Documento empresarial (Contrato Social / CCMEI / Estatuto)', tipo: 'juridico', obrigatorio: true, orientacoes: 'Última alteração consolidada registrada na Junta Comercial.' },
          { id: 'item_forn_2', nome: 'Cartão CNPJ ativo na Receita Federal', tipo: 'fiscal', obrigatorio: true, orientacoes: 'Emitido nos últimos 30 dias com situação cadastral ATIVA.' },
          { id: 'item_forn_3', nome: 'Dados bancários da Pessoa Jurídica', tipo: 'dados_bancarios', obrigatorio: true, orientacoes: 'Conta bancária com mesmo CNPJ do contrato social.' },
          { id: 'item_forn_4', nome: 'Certidões negativas exigidas (CND Federal / FGTS)', tipo: 'certidao', obrigatorio: true, orientacoes: 'CND conjunta da Receita/PGFN e CRF do FGTS dentro do prazo de validade.' },
          { id: 'item_forn_5', nome: 'Contrato ou formulário de homologação', tipo: 'formulario', obrigatorio: true, orientacoes: 'Preenchido e assinado pelo representante legal.' },
          { id: 'item_forn_6', nome: 'Documento de identificação dos sócios administradores', tipo: 'identificacao', obrigatorio: false, orientacoes: 'RG/CNH dos sócios com poderes de representação.' }
        ]
      },
      {
        id: 'chk_servico_default',
        tenantId: 'system',
        isSystemTemplate: true,
        nome: 'Contratação de Serviço e Prestadores',
        descricao: 'Organização e conferência prévia para formalização de prestação de serviços.',
        categoria: 'Administrativo e Jurídico',
        ativo: true,
        itens: [
          { id: 'item_serv_1', nome: 'Identificação do contratado ou responsável legal', tipo: 'identificacao', obrigatorio: true, orientacoes: 'Documento oficial com foto e assinatura compatível.' },
          { id: 'item_serv_2', nome: 'Proposta comercial ou orçamento detalhado', tipo: 'proposta', obrigatorio: true, orientacoes: 'Escopo bem definido, cronograma e valores estipulados.' },
          { id: 'item_serv_3', nome: 'Dados bancários para faturamento', tipo: 'dados_bancarios', obrigatorio: true, orientacoes: 'Dados compatíveis com o emissor da fatura/nota.' },
          { id: 'item_serv_4', nome: 'Contrato de prestação de serviços', tipo: 'contrato', obrigatorio: true, orientacoes: 'Minuta com cláusulas de confidencialidade e prazos.' },
          { id: 'item_serv_5', nome: 'Assinaturas de ambas as partes', tipo: 'assinatura', obrigatorio: true, orientacoes: 'Assinatura digital válida (ICP-Brasil/Gov.br) ou manuscrita autenticada.' },
          { id: 'item_serv_6', nome: 'Inscrição Municipal / Regime de Tributação', tipo: 'fiscal', obrigatorio: false, orientacoes: 'Para retenção correta de ISS quando aplicável.' }
        ]
      }
    ];

    templates.forEach(t => checklistsDb.insert(t));
    console.log('[Checklists] Modelos padrão de sistema inicializados com sucesso.');
  }
}
