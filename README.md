# DocumentoCerto (SaaS 2.0 - Fase 2)

> **"Antes de enviar, descubra se está tudo certo."**

O **DocumentoCerto** é um SaaS profissional de conferência inteligente e organização documental pré-protocolo. Ajuda empresas, escritórios jurídicos, setores de RH, contabilidade, imobiliárias e prestadores de serviços a identificar inconsistências, divergências entre documentos, documentos faltantes ou vencidos e problemas cadastrais antes que o processo seja enviado ou protocolado.

---

## 1. Visão do Produto & Princípio Ético

- **0% Fake AI / Sem Invenção de Informações:** Toda conclusão possui origem estritamente verificável (documento de origem, página, campo, valor, nível de confiança e trecho do texto). Se não for possível ler ou concluir algo: *"Não foi possível concluir com segurança"*.
- **Linguagem Responsável e Padronizada:**
  - 🟢 `APARENTEMENTE CONSISTENTE`
  - 🟡 `REQUER ATENÇÃO` (itens para conferência, baixa legibilidade)
  - 🔴 `POSSÍVEL PROBLEMA` (divergências entre documentos, CPF/CNPJ inválido, documento vencido)
  - ⚪ `NÃO CONCLUÍDO` (dados insuficientes)
- **Aviso Obrigatório de Conformidade:**
  > *"O DocumentoCerto auxilia na conferência prévia dos documentos. A análise automática é orientativa e não substitui a validação profissional, jurídica ou administrativa."*

---

## 2. Arquitetura do Sistema (Fase 1 + Fase 2)

```text
documentocerto/
├── backend/
│   ├── controllers/
│   │   ├── analysis_controller.js    # [Fase 2] Orquestrador HTTP da Análise Inteligente
│   │   ├── auth_controller.js        # Autenticação e cadastro
│   │   ├── checklist_controller.js   # Modelos e checklists
│   │   ├── document_controller.js    # Upload seguro e download autenticado
│   │   ├── process_controller.js     # Processos e status determinístico
│   │   └── tenant_controller.js      # Gestão do Tenant e membros
│   ├── database/                     # JsonDB Atômico com gravação segura ACID (.tmp -> renameSync)
│   ├── middleware/                   # JWT, Tenant Guard, Upload Guard, Security Headers
│   ├── ocr/                          # [Fase 2] Arquitetura Modular de OCR
│   │   ├── ocr_provider.js           # Interface base
│   │   ├── local_ocr_provider.js     # Extração de texto de PDFs e análise de imagens
│   │   ├── cloud_ocr_provider.js     # Adaptador para nuvem (Google Vision / Textract)
│   │   ├── mock_ocr_provider.js      # EXCLUSIVO para testes automatizados
│   │   └── index.js                  # Provider registry
│   ├── routes/                       # Rotas RESTful (/api/auth, /api/processes, /api/analysis, etc.)
│   ├── services/
│   │   ├── ai_analysis_provider.js   # [Fase 2] Síntese de IA com filtro anti-alucinação
│   │   ├── analysis_job_service.js   # [Fase 2] Gerenciador de jobs assíncronos
│   │   ├── audit_service.js          # Trilha de auditoria e conformidade
│   │   ├── extraction_service.js     # [Fase 2] Extração estruturada com evidências
│   │   ├── math_validator_service.js # [Fase 2] Validação matemática real (MOD 11) de CPF/CNPJ
│   │   ├── normalizer_service.js     # [Fase 2] Normalizadores canônicos (CPF, CNPJ, nomes, datas)
│   │   ├── status_service.js         # Status determinístico do checklist
│   │   └── validation_engine.js      # [Fase 2] Motor de regras determinísticas e pontuação
│   └── utils/                        # PBKDF2, tokens HMAC-SHA256, PIX EMV oficial (Bacen)
├── frontend/ & public/               # Shell SPA responsivo, Mobile-First, Tailwind CSS e Lucide Icons
├── storage/
│   └── private/                      # Armazenamento privado isolado por tenant (sem acesso público estático)
├── tests/
│   ├── run_all.js                    # Suíte com 26 testes automatizados (Fase 1 + Fase 2)
│   └── test_cloud_live.js            # Validador E2E de produção em nuvem
├── server.js                         # Servidor Express com /api/health e fallback SPA
├── render.yaml                       # Blueprint oficial para Render.com (deploy 24/7)
├── Dockerfile                        # Container universal Alpine com pré-validação de integridade
└── README.md
```

---

## 3. Funcionalidades da Fase 2 (Conferência Inteligente)

1. **OCR Real e Leitura de Conteúdo:**
   - PDFs com camada de texto: extração direta e veloz de conteúdo.
   - Detecção de PDFs digitalizados (scanned) e imagens de baixa resolução.
   - Validação de magic bytes em imagens (`PNG`, `JPEG`).
2. **Extração Estruturada e Evidência Auditável:**
   - Extrai: CPF, CNPJ, Nome Completo, RG, Número do Documento, Data de Nascimento, Data de Emissão, Data de Validade, CEP, E-mail, Órgão Emissor e Tipo de Documento.
   - Cada campo armazena `document_id`, `document_name`, `page`, `field`, `value`, `normalized_value`, `confidence`, `source` e o trecho de texto original (`snippet`).
3. **Validação Matemática Estrita (Módulo 11):**
   - Validação algorítmica real de CPF e CNPJ (rejeita dígitos incorretos e sequências repetidas).
4. **Conferência Cruzada entre Documentos (`CrossDocumentConsistencyRule`):**
   - Compara nomes completos entre documentos do mesmo processo e aponta 🔴 `NAME_MISMATCH`.
   - Compara CPFs entre documentos do mesmo processo e aponta 🔴 `CPF_MISMATCH`.
   - Compara CNPJs entre documentos societários e aponta 🔴 `CNPJ_MISMATCH`.
5. **Datas, Validades e Duplicidades:**
   - Detecta documentos vencidos (`EXPIRED_DOCUMENT`) e datas no futuro (`FUTURE_ISSUE_DATE`).
   - Detecta arquivos duplicados via hash criptográfico SHA-256 (`DUPLICATE_DOCUMENT`).
6. **Índice de Conferência (0 a 100):**
   - Indicador visual explicativo calculado a partir das penalidades das regras violadas.
7. **Camada de IA com Blindagem Anti-Alucinação:**
   - Executada estritamente após o motor determinístico.
   - Todo achado da IA deve apontar obrigatoriamente para evidências reais verificadas; conclusões sem evidência são sumariamente descartadas.
8. **Processamento Assíncrono:**
   - Estados: `QUEUED` ➔ `PROCESSING` ➔ `COMPLETED` / `NEEDS_REVIEW` / `FAILED`.
   - Permite reprocessamento (*"Analisar Novamente"*) com versionamento.

---

## 4. Execução Local e Testes

```bash
# 1. Instalar dependências
npm install

# 2. Executar a suíte completa de testes (26 testes automatizados)
npm test

# 3. Iniciar o servidor localmente
npm start
```

Acesse:
- Aplicação: `http://localhost:3000`
- Monitoramento: `http://localhost:3000/api/health`

---

## 5. Deploy Contínuo 24/7 na Nuvem

- **Render.com:** Conectar o repositório; o blueprint `render.yaml` executa automaticamente os testes de integridade e provisiona o serviço com health check em `/api/health`.
- **Docker:** `docker build -t documentocerto:latest .`
- **Validador Remoto Live Cloud:** `node tests/test_cloud_live.js <URL_PRODUCAO>`
