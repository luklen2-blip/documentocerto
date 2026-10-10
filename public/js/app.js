/**
 * DocumentoCerto - Frontend SPA Controller
 * Lógica pura, determinística, sem IA simulada.
 */

class DocumentoCertoApp {
  constructor() {
    this.token = localStorage.getItem('dc_token') || null;
    this.user = null;
    this.organization = null;
    this.currentProcess = null;
    this.checklists = [];
    this.authMode = 'login'; // 'login' ou 'register'

    this.init();
  }

  async init() {
    this.setupIcons();
    this.loadPlans();

    if (this.token) {
      const ok = await this.fetchCurrentUser();
      if (ok) {
        this.navigate('dashboard');
      } else {
        this.logout();
      }
    } else {
      this.navigate('home');
    }
  }

  setupIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // ================= API CLIENT =================
  async api(endpoint, options = {}) {
    const headers = options.headers || {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(endpoint, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.code === 'TRIAL_EXPIRED') {
          if (this.organization) {
            this.organization.trialExpirado = true;
            this.organization.statusComercial = 'TRIAL_EXPIRADO';
            this.updateNavState();
          }
        }
        throw new Error(data.error?.message || data.message || 'Erro ao processar requisição.');
      }
      return data;
    } catch (err) {
      this.toast(err.message, 'error');
      throw err;
    }
  }

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const colors = {
      success: 'bg-emerald-600 text-white border-emerald-700',
      error: 'bg-rose-600 text-white border-rose-700',
      warning: 'bg-amber-600 text-white border-amber-700',
      info: 'bg-slate-800 text-white border-slate-900'
    };

    const icons = {
      success: 'check-circle-2',
      error: 'alert-circle',
      warning: 'alert-triangle',
      info: 'info'
    };

    const toast = document.createElement('div');
    toast.className = `p-3.5 rounded-xl shadow-lg border text-xs font-semibold flex items-center justify-between gap-3 pointer-events-auto fade-in ${colors[type] || colors.info}`;
    toast.innerHTML = `
      <div class="flex items-center gap-2">
        <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 shrink-0"></i>
        <span>${message}</span>
      </div>
      <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100">&times;</button>
    `;

    container.appendChild(toast);
    this.setupIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  // ================= AUTENTICAÇÃO =================
  async fetchCurrentUser() {
    try {
      const res = await this.api('/api/auth/me');
      if (res.success && res.data) {
        this.user = res.data.user;
        this.organization = res.data.organization;
        this.updateNavState();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  updateNavState() {
    const navGuest = document.getElementById('nav-guest');
    const navAuth = document.getElementById('nav-auth');
    const subnav = document.getElementById('app-subnav');

    if (this.token && this.user) {
      navGuest.classList.add('hidden');
      navAuth.classList.remove('hidden');
      subnav.classList.remove('hidden');

      document.getElementById('nav-tenant-name').textContent = this.organization?.nome || 'Organização';
      document.getElementById('nav-user-name').textContent = this.user.nome;
      document.getElementById('nav-user-role').textContent = this.user.papel;

      // Controla abas restritas
      const isAdm = this.user.papel === 'ADMIN';
      const tabMembers = document.getElementById('tab-members');
      const tabAudit = document.getElementById('tab-audit');
      if (tabMembers) tabMembers.style.display = isAdm ? 'flex' : 'none';
      if (tabAudit) tabAudit.style.display = isAdm ? 'flex' : 'none';

      // Atualiza banner de período de teste de 1 dia (controlado exclusivamente pelo backend)
      const trialBanner = document.getElementById('trial-banner');
      const trialText = document.getElementById('trial-banner-text');
      if (trialBanner && this.organization) {
        if (this.organization.plano === 'VITALICIO') {
          trialBanner.style.display = 'none';
        } else if (this.organization.trialExpirado) {
          trialBanner.style.display = 'flex';
          trialBanner.className = 'mt-4 p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs';
          if (trialText) {
            trialText.innerHTML = '<span class="font-bold text-amber-900">Seu período de teste de 24 horas encerrou.</span> Para continuar criando processos, enviando documentos e realizando novas conferências, garanta o seu Plano Vitalício.';
          }
        } else if (this.organization.trialAtivo) {
          trialBanner.style.display = 'flex';
          trialBanner.className = 'mt-4 p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-amber-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs';
          const horas = this.organization.trialHorasRestantes ?? 24;
          if (trialText) {
            trialText.textContent = `Você tem ${horas} hora(s) de período de teste com acesso total liberado. Aproveite!`;
          }
        }
      }
    } else {
      navGuest.classList.remove('hidden');
      navAuth.classList.add('hidden');
      subnav.classList.add('hidden');
    }
    this.setupIcons();
  }

  openAuthModal(mode = 'login') {
    this.authMode = mode;
    const modal = document.getElementById('modal-auth');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleText = document.getElementById('auth-toggle-text');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    const fieldName = document.getElementById('auth-field-name');
    const fieldCompany = document.getElementById('auth-field-company');
    const fieldLgpd = document.getElementById('auth-lgpd-consent');

    if (mode === 'register') {
      title.textContent = 'Criar Conta no DocumentoCerto';
      subtitle.textContent = 'Comece gratuitamente com sua empresa em segundos.';
      submitBtn.textContent = 'Criar Organização e Começar';
      toggleText.textContent = 'Já possui uma conta?';
      toggleBtn.textContent = 'Fazer Login';
      fieldName.classList.remove('hidden');
      fieldCompany.classList.remove('hidden');
      fieldLgpd.classList.remove('hidden');
    } else {
      title.textContent = 'Acessar DocumentoCerto';
      subtitle.textContent = 'Entre com suas credenciais de acesso corporativo.';
      submitBtn.textContent = 'Entrar';
      toggleText.textContent = 'Ainda não tem conta?';
      toggleBtn.textContent = 'Criar conta grátis';
      fieldName.classList.add('hidden');
      fieldCompany.classList.add('hidden');
      fieldLgpd.classList.add('hidden');
    }

    modal.classList.remove('hidden');
  }

  toggleAuthMode() {
    this.openAuthModal(this.authMode === 'login' ? 'register' : 'login');
  }

  async handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-input-email').value;
    const senha = document.getElementById('auth-input-password').value;

    if (this.authMode === 'register') {
      const nome = document.getElementById('auth-input-name').value;
      const nomeEmpresa = document.getElementById('auth-input-company').value;
      const consent = document.getElementById('auth-input-lgpd').checked;

      if (!consent) {
        this.toast('Você deve concordar com os Termos de Uso e Política de Privacidade.', 'warning');
        return;
      }

      const res = await this.api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ nome, email, senha, nomeEmpresa })
      });

      if (res.success) {
        this.token = res.data.token;
        this.user = res.data.user;
        this.organization = res.data.organization;
        localStorage.setItem('dc_token', this.token);
        this.closeModal('modal-auth');
        this.updateNavState();
        this.navigate('dashboard');
        this.toast('Organização criada com sucesso!', 'success');
      }
    } else {
      const res = await this.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha })
      });

      if (res.success) {
        this.token = res.data.token;
        this.user = res.data.user;
        this.organization = res.data.organization;
        localStorage.setItem('dc_token', this.token);
        this.closeModal('modal-auth');
        this.updateNavState();
        this.navigate('dashboard');
        this.toast('Login realizado com sucesso!', 'success');
      }
    }
  }

  logout() {
    this.token = null;
    this.user = null;
    this.organization = null;
    localStorage.removeItem('dc_token');
    this.updateNavState();
    this.navigate('home');
    this.toast('Sessão encerrada com segurança.', 'info');
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
  }

  // ================= NAVEGAÇÃO SPA =================
  navigate(viewId, params = null) {
    document.querySelectorAll('.view-panel').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.subnav-btn').forEach(b => {
      b.classList.remove('bg-emerald-50', 'text-emerald-700', 'font-semibold');
      b.classList.add('text-slate-600', 'font-medium');
    });

    if (viewId === 'home') {
      document.getElementById('view-landing').classList.remove('hidden');
    } else if (viewId === 'dashboard') {
      document.getElementById('view-dashboard').classList.remove('hidden');
      this.setActiveSubnav('tab-dashboard');
      this.loadDashboard();
    } else if (viewId === 'processes') {
      document.getElementById('view-processes').classList.remove('hidden');
      this.setActiveSubnav('tab-processes');
      this.loadAllProcesses();
    } else if (viewId === 'process-detail') {
      document.getElementById('view-process-detail').classList.remove('hidden');
      this.loadProcessDetail(params);
    } else if (viewId === 'checklists') {
      document.getElementById('view-checklists').classList.remove('hidden');
      this.setActiveSubnav('tab-checklists');
      this.loadChecklistsView();
    } else if (viewId === 'members') {
      document.getElementById('view-members').classList.remove('hidden');
      this.setActiveSubnav('tab-members');
      this.loadMembersView();
    } else if (viewId === 'audit') {
      document.getElementById('view-audit').classList.remove('hidden');
      this.setActiveSubnav('tab-audit');
      this.loadGlobalAuditView();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.setupIcons();
  }

  setActiveSubnav(tabId) {
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.classList.remove('text-slate-600', 'font-medium');
      tab.classList.add('bg-emerald-50', 'text-emerald-700', 'font-semibold');
    }
  }

  // ================= DASHBOARD =================
  async loadDashboard() {
    try {
      const res = await this.api('/api/dashboard/summary');
      if (!res.success) return;

      const m = res.data.metrics;
      document.getElementById('kpi-total').textContent = m.totalProcessos;
      document.getElementById('kpi-completos').textContent = m.completos;
      document.getElementById('kpi-analise').textContent = m.comAtencao;
      document.getElementById('kpi-pendentes').textContent = m.pendentes;

      const tbody = document.getElementById('dashboard-recent-tbody');
      tbody.innerHTML = '';

      if (!res.data.recentes || res.data.recentes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400 text-xs">Nenhum processo cadastrado. Clique em "+ Novo Processo" para começar.</td></tr>`;
        return;
      }

      res.data.recentes.forEach(proc => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition cursor-pointer';
        tr.onclick = () => this.navigate('process-detail', proc.id);

        const statusClass = proc.statusColor?.badgeClass || 'bg-slate-100 text-slate-700 border-slate-200';
        const icon = proc.statusColor?.icon || '⚪';

        tr.innerHTML = `
          <td class="px-6 py-4 font-bold text-slate-900">${proc.nome}</td>
          <td class="px-6 py-4 text-slate-500 text-xs">${proc.tipo}</td>
          <td class="px-6 py-4 text-slate-700 text-xs">${proc.responsavelNome}</td>
          <td class="px-6 py-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusClass}">
              ${icon} ${proc.statusDeterminístico}
            </span>
          </td>
          <td class="px-6 py-4 text-xs font-medium text-slate-600">
            ${proc.obrigatoriosPresentes}/${proc.obrigatoriosTotais} obrigatórios (${proc.taxaCompletude}%)
          </td>
          <td class="px-6 py-4 text-right">
            <button onclick="event.stopPropagation(); window.app.navigate('process-detail', '${proc.id}')" class="px-3 py-1 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 rounded text-xs font-semibold text-slate-600">
              Conferir &rarr;
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  // ================= LISTA COMPLETA DE PROCESSOS =================
  async loadAllProcesses() {
    try {
      const res = await this.api('/api/processes');
      if (!res.success) return;

      const tbody = document.getElementById('all-processes-tbody');
      tbody.innerHTML = '';

      if (res.data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-8 text-center text-slate-400 text-xs">Nenhum processo cadastrado.</td></tr>`;
        return;
      }

      res.data.forEach(proc => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition';

        const colorInfo = proc.statusInfo?.colorInfo || {};
        const badgeClass = colorInfo.badgeClass || 'bg-slate-100 text-slate-700 border-slate-200';
        const icon = colorInfo.icon || '⚪';

        const isAdm = this.user?.papel === 'ADMIN';

        tr.innerHTML = `
          <td class="px-6 py-4 font-bold text-slate-900">${proc.nome}</td>
          <td class="px-6 py-4 text-slate-500 text-xs">${proc.checklistNome || '--'}</td>
          <td class="px-6 py-4 text-slate-700 text-xs">${proc.responsavelNome}</td>
          <td class="px-6 py-4 text-slate-500 text-xs">${proc.prazo || 'Não estipulado'}</td>
          <td class="px-6 py-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${badgeClass}">
              ${icon} ${proc.statusDeterminístico}
            </span>
          </td>
          <td class="px-6 py-4 text-right space-x-2">
            <button onclick="window.app.navigate('process-detail', '${proc.id}')" class="px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-bold">
              Conferir
            </button>
            ${isAdm ? `<button onclick="window.app.deleteProcess('${proc.id}')" class="px-2.5 py-1 text-slate-400 hover:text-rose-600 rounded text-xs font-semibold">Excluir</button>` : ''}
          </td>
        `;
        tbody.appendChild(tr);
      });
      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  // ================= NOVO PROCESSO =================
  async openNewProcessModal() {
    try {
      const res = await this.api('/api/checklists');
      if (res.success) {
        this.checklists = res.data;
        const select = document.getElementById('proc-checklist-select');
        select.innerHTML = '<option value="">Selecione um checklist...</option>';
        res.data.forEach(chk => {
          const opt = document.createElement('option');
          opt.value = chk.id;
          opt.textContent = `${chk.nome} (${chk.itens?.length || 0} itens)`;
          select.appendChild(opt);
        });
      }
      document.getElementById('proc-responsavel').value = this.user?.nome || '';
      document.getElementById('modal-new-process').classList.remove('hidden');
    } catch (err) {
      console.error(err);
    }
  }

  async handleCreateProcess(e) {
    e.preventDefault();
    const nome = document.getElementById('proc-nome').value;
    const tipo = document.getElementById('proc-tipo').value;
    const prazo = document.getElementById('proc-prazo').value;
    const checklistId = document.getElementById('proc-checklist-select').value;
    const responsavelNome = document.getElementById('proc-responsavel').value;
    const observacoes = document.getElementById('proc-obs').value;

    try {
      const res = await this.api('/api/processes', {
        method: 'POST',
        body: JSON.stringify({ nome, tipo, prazo, checklistId, responsavelNome, observacoes })
      });

      if (res.success) {
        this.closeModal('modal-new-process');
        this.toast('Processo criado com sucesso!', 'success');
        this.navigate('process-detail', res.data.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ================= TELA DE DETALHES DO PROCESSO (CONFERÊNCIA) =================
  async loadProcessDetail(processId) {
    try {
      const res = await this.api(`/api/processes/${processId}`);
      if (!res.success) return;

      const p = res.data;
      this.currentProcess = p;

      // Cabeçalho
      document.getElementById('detail-nome').textContent = p.nome;
      document.getElementById('detail-tipo-badge').textContent = p.tipo;
      document.getElementById('detail-created-at').textContent = new Date(p.createdAt).toLocaleDateString('pt-BR');
      document.getElementById('detail-responsavel').textContent = p.responsavelNome;
      document.getElementById('detail-prazo').textContent = p.prazo ? new Date(p.prazo).toLocaleDateString('pt-BR') : 'Não estipulado';
      document.getElementById('detail-checklist').textContent = p.checklistNome;

      // Status Card
      const sInfo = p.statusInfo;
      const statusCard = document.getElementById('detail-status-card');
      const statusIcon = document.getElementById('detail-status-icon');
      const statusText = document.getElementById('detail-status-text');

      statusIcon.textContent = sInfo.colorInfo?.icon || '⚪';
      statusText.textContent = sInfo.status;
      statusCard.className = `px-4 py-3 rounded-xl border flex items-center gap-3 ${sInfo.colorInfo?.badgeClass || 'bg-slate-50'}`;

      // Contadores e Listas dos 3 grupos
      document.getElementById('badge-count-encontrados').textContent = sInfo.documentosEncontrados.length;
      document.getElementById('badge-count-faltantes').textContent = sInfo.documentosFaltantes.length;
      document.getElementById('badge-count-conferencia').textContent = sInfo.itensParaConferencia.length;

      // 1. Encontrados
      const ulEnc = document.getElementById('list-encontrados');
      ulEnc.innerHTML = sInfo.documentosEncontrados.length === 0 ? '<li class="text-slate-400 italic">Nenhum documento anexado ainda.</li>' : '';
      sInfo.documentosEncontrados.forEach(it => {
        const li = document.createElement('li');
        li.className = 'p-1.5 rounded bg-emerald-50/60 border border-emerald-100 flex items-center justify-between';
        li.innerHTML = `<span class="truncate">✅ ${it.nome}</span>`;
        ulEnc.appendChild(li);
      });

      // 2. Faltantes
      const ulFalt = document.getElementById('list-faltantes');
      ulFalt.innerHTML = sInfo.documentosFaltantes.length === 0 ? '<li class="text-emerald-600 font-semibold">Nenhum documento faltante!</li>' : '';
      sInfo.documentosFaltantes.forEach(it => {
        const li = document.createElement('li');
        li.className = `p-1.5 rounded border flex items-center justify-between ${it.obrigatorio ? 'bg-rose-50/60 border-rose-100 text-rose-900 font-medium' : 'bg-slate-50 border-slate-200'}`;
        li.innerHTML = `<span class="truncate">${it.rotulo}: ${it.nome}</span>`;
        ulFalt.appendChild(li);
      });

      // 3. Para Conferência
      const ulConf = document.getElementById('list-conferencia');
      ulConf.innerHTML = sInfo.itensParaConferencia.length === 0 ? '<li class="text-slate-400 italic">Nenhuma inconsistência assinalada.</li>' : '';
      sInfo.itensParaConferencia.forEach(it => {
        const li = document.createElement('li');
        li.className = 'p-1.5 rounded bg-amber-50/60 border border-amber-100 flex flex-col gap-0.5 text-amber-900';
        li.innerHTML = `
          <div class="font-semibold truncate">⚠️ ${it.nome}</div>
          <div class="text-[11px] text-amber-700">${it.observacoes}</div>
        `;
        ulConf.appendChild(li);
      });

      // Renderiza itens detalhados com área de upload
      this.renderProcessChecklistItems(p);

      // Renderiza histórico
      this.renderProcessAudit(p.historico || []);

      // Carrega Análise Inteligente da Fase 2
      this.loadIntelligentAnalysis(p.id);

      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  renderProcessChecklistItems(process) {
    const container = document.getElementById('process-checklist-items-container');
    container.innerHTML = '';

    const itens = process.itens || [];
    itens.forEach((it, idx) => {
      const div = document.createElement('div');
      div.className = 'p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 hover:bg-slate-50/60 transition';

      const hasDoc = Boolean(it.documentoId && it.documento);
      const isObrigatorio = Boolean(it.obrigatorio);
      const isConferir = it.statusItem === 'conferir' || (it.observacoes && it.observacoes.length > 0);

      let statusBadge = '';
      if (hasDoc && !isConferir) {
        statusBadge = '<span class="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">✅ Presente</span>';
      } else if (isConferir) {
        statusBadge = '<span class="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">⚠️ Recomenda-se verificar</span>';
      } else {
        statusBadge = isObrigatorio
          ? '<span class="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">❌ Documento aparentemente ausente</span>'
          : '<span class="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">⚪ Opcional ausente</span>';
      }

      div.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-mono text-slate-400">#${idx + 1}</span>
            <h3 class="text-sm font-bold text-slate-900">${it.nome}</h3>
            ${isObrigatorio ? '<span class="text-[10px] font-bold uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">Obrigatório</span>' : '<span class="text-[10px] font-semibold text-slate-400">Opcional</span>'}
            ${statusBadge}
          </div>
          <p class="text-xs text-slate-500 mt-1">${it.orientacoes || 'Verificar conformidade.'}</p>

          ${hasDoc ? `
            <div class="mt-2.5 p-2 bg-slate-100/80 rounded-lg flex items-center justify-between gap-3 text-xs border border-slate-200 max-w-xl">
              <div class="flex items-center gap-2 truncate">
                <i data-lucide="file" class="w-4 h-4 text-emerald-600 shrink-0"></i>
                <span class="font-medium text-slate-800 truncate">${it.documento.originalName}</span>
                <span class="text-[11px] text-slate-400">(${(it.documento.sizeBytes / 1024).toFixed(1)} KB)</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <a href="/api/documents/${it.documento.id}/file" target="_blank" class="px-2 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded border border-slate-300 font-semibold text-[11px]">
                  Visualizar / Baixar
                </a>
                <button onclick="window.app.deleteDocument('${it.documento.id}')" class="text-slate-400 hover:text-rose-600 text-[11px] font-semibold">
                  Excluir
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Campo de Observação / Conferência -->
          <div class="mt-2 flex items-center gap-2 max-w-xl">
            <input type="text" id="obs-input-${it.id}" value="${it.observacoes || ''}" placeholder="Adicionar nota de conferência (ex: assinatura ilegível)..." class="text-xs px-2.5 py-1.5 rounded border border-slate-200 flex-1 outline-none focus:border-amber-400">
            <button onclick="window.app.saveItemNote('${it.id}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold">
              Salvar Nota
            </button>
          </div>
        </div>

        <!-- Ação de Upload -->
        <div class="shrink-0 flex items-center gap-2">
          <label class="cursor-pointer px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs">
            <i data-lucide="upload" class="w-3.5 h-3.5"></i>
            <span>${hasDoc ? 'Substituir Documento' : 'Enviar Documento'}</span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" class="hidden" onchange="window.app.handleUpload('${it.id}', this.files[0])">
          </label>
        </div>
      `;

      container.appendChild(div);
    });
  }

  renderProcessAudit(logs) {
    const timeline = document.getElementById('process-audit-timeline');
    timeline.innerHTML = '';

    if (!logs || logs.length === 0) {
      timeline.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum evento registrado ainda.</p>';
      return;
    }

    logs.forEach(l => {
      const div = document.createElement('div');
      div.className = 'text-xs border-l-2 border-emerald-500 pl-3 py-1';
      const dataStr = new Date(l.timestamp).toLocaleString('pt-BR');
      div.innerHTML = `
        <div class="font-bold text-slate-800">${l.action} <span class="text-slate-400 font-normal">por ${l.userName} em ${dataStr}</span></div>
        <div class="text-slate-500 text-[11px] mt-0.5">${typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}</div>
      `;
      timeline.appendChild(div);
    });
  }

  async handleUpload(itemId, file) {
    if (!file) return;

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.type)) {
      this.toast('Tipo de arquivo não permitido. Apenas PDF, JPG e PNG são aceitos.', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.toast('Arquivo excede o limite máximo de 10MB.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('processId', this.currentProcess.id);
    formData.append('itemId', itemId);

    try {
      this.toast('Enviando documento de forma segura...', 'info');
      const res = await this.api('/api/documents/upload', {
        method: 'POST',
        body: formData
      });

      if (res.success) {
        this.toast(res.message, 'success');
        this.loadProcessDetail(this.currentProcess.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async deleteDocument(docId) {
    if (!confirm('Deseja realmente remover este documento?')) return;

    try {
      const res = await this.api(`/api/documents/${docId}`, { method: 'DELETE' });
      if (res.success) {
        this.toast(res.message, 'success');
        this.loadProcessDetail(this.currentProcess.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async saveItemNote(itemId) {
    const input = document.getElementById(`obs-input-${itemId}`);
    if (!input) return;
    const obs = input.value;

    try {
      const statusItem = obs.trim().length > 0 ? 'conferir' : 'ausente';
      const res = await this.api(`/api/processes/${this.currentProcess.id}/itens/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ observacoes: obs, statusItem })
      });

      if (res.success) {
        this.toast('Nota de conferência atualizada.', 'success');
        this.loadProcessDetail(this.currentProcess.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async finalizarConferencia() {
    if (!this.currentProcess) return;

    const sInfo = this.currentProcess.statusInfo;
    if (sInfo.status === 'INCOMPLETO') {
      this.toast('Não é possível finalizar enquanto houver documentos obrigatórios faltantes.', 'warning');
      return;
    }

    try {
      const res = await this.api(`/api/processes/${this.currentProcess.id}/workflow`, {
        method: 'PATCH',
        body: JSON.stringify({ statusWorkflow: 'COMPLETO' })
      });

      if (res.success) {
        this.toast('Conferência finalizada com sucesso!', 'success');
        this.loadProcessDetail(this.currentProcess.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async deleteProcess(processId) {
    if (!confirm('Deseja excluir este processo e todos os seus documentos? Esta ação é irreversível.')) return;

    try {
      const res = await this.api(`/api/processes/${processId}`, { method: 'DELETE' });
      if (res.success) {
        this.toast(res.message, 'success');
        this.loadAllProcesses();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ================= MODELOS DE CHECKLIST =================
  async loadChecklistsView() {
    try {
      const res = await this.api('/api/checklists');
      if (!res.success) return;

      const grid = document.getElementById('checklists-grid');
      grid.innerHTML = '';

      res.data.forEach(chk => {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between';

        const isSystem = Boolean(chk.isSystemTemplate);

        div.innerHTML = `
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase ${isSystem ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-800'} px-2 py-0.5 rounded">
                ${isSystem ? 'Modelo do Sistema' : 'Customizado'}
              </span>
              <span class="text-xs text-slate-400">${chk.categoria}</span>
            </div>
            <h3 class="text-base font-bold text-slate-900">${chk.nome}</h3>
            <p class="text-xs text-slate-500 mt-1">${chk.descricao}</p>

            <div class="mt-4 border-t border-slate-100 pt-3">
              <span class="text-xs font-semibold text-slate-700">Requisitos inclusos (${chk.itens?.length || 0}):</span>
              <ul class="mt-2 space-y-1 text-xs text-slate-600">
                ${(chk.itens || []).slice(0, 4).map(i => `<li class="truncate">• ${i.nome} ${i.obrigatorio ? '<span class="text-rose-500 font-bold">*</span>' : ''}</li>`).join('')}
                ${(chk.itens || []).length > 4 ? `<li class="text-[11px] text-slate-400 italic">+ ${(chk.itens || []).length - 4} outros itens...</li>` : ''}
              </ul>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span class="text-[11px] text-slate-400">* = Obrigatório</span>
            <button onclick="window.app.createProcessWithChecklist('${chk.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs">
              Usar Checklist
            </button>
          </div>
        `;

        grid.appendChild(div);
      });
      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  createProcessWithChecklist(checklistId) {
    this.openNewProcessModal();
    const select = document.getElementById('proc-checklist-select');
    if (select) select.value = checklistId;
  }

  openNewChecklistModal() {
    this.toast('Criação rápida: Para customizar o checklist, envie a especificação para seu administrador.', 'info');
  }

  // ================= GESTÃO DE MEMBROS =================
  async loadMembersView() {
    try {
      const res = await this.api('/api/tenants/users');
      if (!res.success) return;

      const tbody = document.getElementById('members-tbody');
      tbody.innerHTML = '';

      res.data.forEach(u => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition';
        tr.innerHTML = `
          <td class="px-6 py-4 font-bold text-slate-900">${u.nome}</td>
          <td class="px-6 py-4 text-slate-500 text-xs">${u.email}</td>
          <td class="px-6 py-4">
            <span class="text-xs font-bold px-2 py-0.5 rounded ${u.papel === 'ADMIN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">
              ${u.papel}
            </span>
          </td>
          <td class="px-6 py-4 text-xs font-semibold text-emerald-600">Ativo</td>
          <td class="px-6 py-4 text-right">
            ${u.id !== this.user.id ? `
              <button onclick="window.app.toggleMemberRole('${u.id}', '${u.papel === 'ADMIN' ? 'MEMBRO' : 'ADMIN'}')" class="text-xs font-semibold text-slate-500 hover:text-emerald-700">
                Alternar para ${u.papel === 'ADMIN' ? 'MEMBRO' : 'ADMIN'}
              </button>
            ` : '<span class="text-xs text-slate-400">Você</span>'}
          </td>
        `;
        tbody.appendChild(tr);
      });
      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  async toggleMemberRole(userId, newRole) {
    try {
      const res = await this.api(`/api/tenants/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ papel: newRole })
      });
      if (res.success) {
        this.toast(`Papel atualizado para ${newRole}.`, 'success');
        this.loadMembersView();
      }
    } catch (err) {
      console.error(err);
    }
  }

  openNewMemberModal() {
    const nome = prompt('Nome do novo membro:');
    if (!nome) return;
    const email = prompt('E-mail corporativo do membro:');
    if (!email) return;
    const senha = prompt('Senha temporária inicial (mínimo 6 caracteres):');
    if (!senha) return;

    this.api('/api/tenants/users', {
      method: 'POST',
      body: JSON.stringify({ nome, email, senha, papel: 'MEMBRO' })
    }).then(res => {
      if (res.success) {
        this.toast('Membro adicionado com sucesso!', 'success');
        this.loadMembersView();
      }
    }).catch(console.error);
  }

  // ================= AUDITORIA GLOBAL =================
  async loadGlobalAuditView() {
    try {
      const res = await this.api('/api/audit');
      if (!res.success) return;

      const list = document.getElementById('global-audit-list');
      list.innerHTML = '';

      if (res.data.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400 italic">Nenhum evento registrado ainda.</p>';
        return;
      }

      res.data.forEach(l => {
        const div = document.createElement('div');
        div.className = 'p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-col gap-1';
        const dataStr = new Date(l.timestamp).toLocaleString('pt-BR');
        div.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">${l.action}</span>
            <span class="text-slate-400">${dataStr}</span>
          </div>
          <div class="text-slate-600">Usuário: <strong>${l.userName}</strong></div>
          <div class="text-[11px] font-mono text-slate-500 bg-white p-2 rounded border border-slate-100">${typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}</div>
        `;
        list.appendChild(div);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ================= PLANOS E PIX =================
  async loadPlans() {
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      if (!data.success) return;

      const container = document.getElementById('plans-container');
      if (!container) return;
      container.innerHTML = '';

      data.data.forEach(p => {
        const isVitalicio = p.id === 'vitalicio';
        const card = document.createElement('div');
        card.className = `rounded-2xl p-6 border flex flex-col justify-between ${
          p.destaque ? 'bg-white border-emerald-500 shadow-xl shadow-emerald-100 ring-2 ring-emerald-500/20 relative' : 'bg-white border-slate-200 shadow-xs'
        }`;

        card.innerHTML = `
          <div>
            ${p.destaque ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] uppercase font-black tracking-wider px-3.5 py-1 rounded-full shadow-sm">${p.badge || 'Mais Escolhido • Vitalício'}</span>` : ''}
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-bold text-slate-900">${p.nome}</h3>
              ${p.trialDias ? `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">${p.trialDias} dia de teste</span>` : ''}
            </div>
            <p class="text-xs text-slate-500 mt-1">${p.descricao}</p>
            <div class="mt-4">
              <span class="text-3xl font-extrabold text-slate-900">${p.precoFormatado}</span>
              <span class="text-xs text-slate-400 ml-1 font-medium">${p.tipoCobranca || ''}</span>
            </div>
            <ul class="mt-6 space-y-2.5 text-xs text-slate-600">
              ${p.recursos.map(r => `<li class="flex items-center gap-2"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600 shrink-0"></i> <span>${r}</span></li>`).join('')}
            </ul>
          </div>

          <div class="mt-8 space-y-2">
            ${isVitalicio ? `
              <a href="${p.kiwifyUrl || 'https://pay.kiwify.com.br/ueLjXAd'}" target="_blank" rel="noopener noreferrer" class="w-full py-3 rounded-xl font-bold text-xs transition bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 flex items-center justify-center gap-1.5">
                <i data-lucide="shield-check" class="w-4 h-4"></i> ${p.cta}
              </a>
              <button onclick="window.app.openAuthModal('register')" class="w-full py-2 rounded-xl font-bold text-xs transition bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200">
                Experimentar 1 Dia Grátis
              </button>
            ` : `
              <button onclick="window.app.handleSelectPlan('${p.id}')" class="w-full py-2.5 rounded-xl font-bold text-xs transition ${p.destaque ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}">
                ${p.cta}
              </button>
            `}
          </div>
        `;

        container.appendChild(card);
      });
      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  async handleSelectPlan(planId) {
    if (planId === 'gratis') {
      this.openAuthModal('register');
      return;
    }

    try {
      const res = await fetch('/api/plans/pix-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planoId: planId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Erro ao obter dados do plano.');

      const p = data.data.plano;
      const pix = data.data.pix;
      const kiwifyUrl = data.data.kiwifyUrl || 'https://pay.kiwify.com.br/ueLjXAd';

      document.getElementById('pix-plano-titulo').textContent = `Assinatura ${p.nome}`;
      document.getElementById('pix-plano-valor').textContent = p.precoFormatado;
      document.getElementById('pix-qrcode-img').src = pix.qrCodeUrl;
      document.getElementById('pix-copiacola-input').value = pix.emvCopiaECola;

      const kiwifyLink = document.getElementById('pix-kiwify-link');
      if (kiwifyLink) kiwifyLink.href = kiwifyUrl;

      document.getElementById('modal-pix').classList.remove('hidden');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  }

  copyPixCode() {
    const input = document.getElementById('pix-copiacola-input');
    input.select();
    navigator.clipboard.writeText(input.value);
    this.toast('Código PIX copiado com sucesso!', 'success');
  }

  // ================= FASE 2: ANÁLISE INTELIGENTE & DIAGNÓSTICO =================
  async triggerIntelligentAnalysis(isReanalysis = false) {
    if (!this.currentProcess) return;

    const btn = document.getElementById('btn-run-analysis');
    const btnText = document.getElementById('btn-run-analysis-text');
    const progressCard = document.getElementById('analysis-progress-card');

    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-75');
    }
    if (btnText) btnText.textContent = isReanalysis ? 'Reanalisando...' : 'Analisando...';
    if (progressCard) progressCard.classList.remove('hidden');

    try {
      const res = await this.api(`/api/analysis/process/${this.currentProcess.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ isReanalysis })
      });

      if (!res.success || !res.data) throw new Error('Falha ao iniciar análise.');

      const jobId = res.data.id;
      this.pollAnalysisJob(jobId, this.currentProcess.id);
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-75');
      }
      if (btnText) btnText.textContent = 'Executar Análise Inteligente';
      if (progressCard) progressCard.classList.add('hidden');
      console.error(err);
    }
  }

  async pollAnalysisJob(jobId, processId) {
    const stageText = document.getElementById('analysis-stage-text');
    const percentText = document.getElementById('analysis-progress-percent');
    const progressBar = document.getElementById('analysis-progress-bar');
    const btn = document.getElementById('btn-run-analysis');
    const btnText = document.getElementById('btn-run-analysis-text');
    const progressCard = document.getElementById('analysis-progress-card');

    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 30) {
        clearInterval(interval);
        if (progressCard) progressCard.classList.add('hidden');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-75');
        }
        if (btnText) btnText.textContent = 'Executar Análise Inteligente';
        this.toast('Tempo limite de análise excedido. Tente novamente.', 'warning');
        return;
      }

      try {
        const res = await this.api(`/api/analysis/job/${jobId}`);
        if (!res.success || !res.data) return;

        const job = res.data;
        if (stageText) stageText.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-ping"></span> ${job.stage || 'Processando...'}`;
        if (percentText) percentText.textContent = `${job.progress || 0}%`;
        if (progressBar) progressBar.style.width = `${job.progress || 0}%`;

        if (['COMPLETED', 'NEEDS_REVIEW', 'FAILED'].includes(job.status)) {
          clearInterval(interval);
          if (progressCard) progressCard.classList.add('hidden');
          if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75');
          }
          if (btnText) btnText.textContent = 'Analisar Novamente';

          if (job.status === 'FAILED') {
            this.toast(job.stage || 'Falha na análise automática.', 'error');
          } else {
            this.toast('Análise inteligente concluída com sucesso!', 'success');
            await this.loadIntelligentAnalysis(processId);
          }
        }
      } catch (err) {
        clearInterval(interval);
        if (progressCard) progressCard.classList.add('hidden');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('opacity-75');
        }
        if (btnText) btnText.textContent = 'Executar Análise Inteligente';
      }
    }, 900);
  }

  async loadIntelligentAnalysis(processId) {
    try {
      const res = await this.api(`/api/analysis/process/${processId}/latest`);
      const panel = document.getElementById('analysis-results-panel');
      if (!res.success || !res.data || !res.data.result) {
        if (panel) panel.classList.add('hidden');
        return;
      }

      const job = res.data;
      const r = job.result;
      if (panel) panel.classList.remove('hidden');

      // Status Card
      const cardStatus = document.getElementById('card-analysis-status');
      const badgeStatus = document.getElementById('analysis-status-badge');
      const summaryText = document.getElementById('analysis-summary-text');
      const versionBadge = document.getElementById('analysis-version-badge');

      if (versionBadge) versionBadge.textContent = `v${job.version || 1}`;
      if (summaryText) summaryText.textContent = r.aiSummary || r.status;

      let statusIcon = '🟢';
      let borderClass = 'border-emerald-200 bg-emerald-50/40 text-emerald-900';
      if (r.status === 'POSSÍVEL PROBLEMA') {
        statusIcon = '🔴';
        borderClass = 'border-rose-200 bg-rose-50/40 text-rose-900';
      } else if (r.status === 'REQUER ATENÇÃO') {
        statusIcon = '🟡';
        borderClass = 'border-amber-200 bg-amber-50/40 text-amber-900';
      } else if (r.status === 'NÃO CONCLUÍDO') {
        statusIcon = '⚪';
        borderClass = 'border-slate-200 bg-slate-50/40 text-slate-800';
      }

      if (cardStatus) cardStatus.className = `p-5 rounded-xl border flex flex-col justify-between ${borderClass}`;
      if (badgeStatus) badgeStatus.innerHTML = `<span>${statusIcon}</span> ${r.status}`;

      // Score
      const scoreNum = document.getElementById('analysis-score-number');
      const scoreBar = document.getElementById('analysis-score-bar');
      if (scoreNum) scoreNum.textContent = r.score;
      if (scoreBar) {
        scoreBar.style.width = `${r.score}%`;
        if (r.score >= 90) {
          scoreBar.className = 'h-2 rounded-full bg-emerald-500 transition-all duration-500';
        } else if (r.score >= 70) {
          scoreBar.className = 'h-2 rounded-full bg-amber-500 transition-all duration-500';
        } else {
          scoreBar.className = 'h-2 rounded-full bg-rose-500 transition-all duration-500';
        }
      }

      // Deduções
      const deductionsList = document.getElementById('analysis-deductions-list');
      if (deductionsList) {
        deductionsList.innerHTML = '';
        if (!r.deductions || r.deductions.length === 0) {
          deductionsList.innerHTML = '<li class="text-slate-400 italic">Nenhuma penalidade aplicada (100% íntegro).</li>';
        } else {
          r.deductions.forEach(d => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between text-xs text-slate-700';
            li.innerHTML = `<span>• ${d.factor}</span> <strong class="text-rose-600">-${d.points} pts</strong>`;
            deductionsList.appendChild(li);
          });
        }
      }

      const docsCount = document.getElementById('analysis-docs-count');
      if (docsCount) docsCount.textContent = r.analyzedDocuments?.length || 0;

      const findingsCountBadge = document.getElementById('analysis-findings-count-badge');
      if (findingsCountBadge) findingsCountBadge.textContent = `${r.findings?.length || 0} achados`;

      // Renderiza achados detalhados
      this.renderAnalysisFindings(r.findings || []);

      this.setupIcons();
    } catch (err) {
      console.error(err);
    }
  }

  renderAnalysisFindings(findings = []) {
    const container = document.getElementById('analysis-findings-container');
    if (!container) return;
    container.innerHTML = '';

    if (findings.length === 0) {
      container.innerHTML = `
        <div class="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i>
          Nenhuma inconsistência, duplicidade ou divergência encontrada entre os documentos.
        </div>
      `;
      return;
    }

    findings.forEach(f => {
      const card = document.createElement('div');
      const isHigh = f.severity === 'HIGH';
      const isMedium = f.severity === 'MEDIUM';

      const borderClass = isHigh ? 'border-rose-200 bg-rose-50/50' : (isMedium ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50/50');
      const badgeIcon = isHigh ? '🔴' : (isMedium ? '🟡' : '⚪');
      const badgeTitle = isHigh ? 'POSSÍVEL PROBLEMA' : (isMedium ? 'REQUER ATENÇÃO' : 'INFORMATIVO');

      let comparisonHtml = '';
      if (f.comparison) {
        if (f.comparison.docA && f.comparison.docB) {
          comparisonHtml = `
            <div class="mt-3 p-3 bg-white rounded-lg border border-slate-200 text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div class="p-2 rounded bg-slate-50">
                <span class="text-[10px] font-bold text-slate-400 uppercase">Documento 1</span>
                <div class="font-semibold text-slate-800 truncate">${f.comparison.docA.name}</div>
                <div class="text-[11px] font-mono text-emerald-700 mt-1">Valor: ${f.comparison.docA.value}</div>
              </div>
              <div class="p-2 rounded bg-slate-50">
                <span class="text-[10px] font-bold text-slate-400 uppercase">Documento 2</span>
                <div class="font-semibold text-slate-800 truncate">${f.comparison.docB.name}</div>
                <div class="text-[11px] font-mono text-rose-700 mt-1">Valor: ${f.comparison.docB.value}</div>
              </div>
            </div>
          `;
        } else if (f.comparison.duplicatedWith) {
          comparisonHtml = `
            <div class="mt-2 text-xs text-slate-600 bg-white p-2 rounded border border-slate-200">
              Arquivo idêntico ao: <strong>${f.comparison.duplicatedWith}</strong>
            </div>
          `;
        }
      }

      card.className = `p-4 rounded-xl border ${borderClass} flex flex-col gap-2`;
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold">${badgeIcon} ${badgeTitle}</span>
            <span class="text-xs font-mono text-slate-400">[${f.code}]</span>
          </div>
          ${f.document_name ? `<span class="text-xs text-slate-500 font-medium truncate max-w-xs">${f.document_name} ${f.page ? `(pág. ${f.page})` : ''}</span>` : ''}
        </div>
        <h4 class="text-sm font-bold text-slate-900">${f.title}</h4>
        <p class="text-xs text-slate-700">${f.message}</p>
        ${comparisonHtml}
        ${f.recommendation ? `
          <div class="mt-1 text-[11px] text-slate-500 flex items-start gap-1.5">
            <strong class="text-slate-700">Recomendação:</strong>
            <span>${f.recommendation}</span>
          </div>
        ` : ''}
      `;

      container.appendChild(card);
    });
  }

  // ================= ANALYTICS E FUNIL COMERCIAL (ADMIN) =================
  openAdminMetricsModal() {
    this.openModal('modal-admin-metrics');
    this.loadAdminMetrics();
  }

  async loadAdminMetrics() {
    try {
      const res = await this.api('/api/admin/metrics');
      if (!res.success) {
        this.toast(res.error?.message || 'Falha ao carregar métricas administrativas.', 'error');
        return;
      }

      const m = res.data;
      if (!m) return;

      const engineEl = document.getElementById('metrics-storage-engine');
      if (engineEl) engineEl.textContent = m.storageEngine || 'PostgreSQL';

      const totalCad = document.getElementById('metric-total-cadastros');
      if (totalCad) totalCad.textContent = m.funil.totalCadastros || 0;

      const cadHoje = document.getElementById('metric-cadastros-hoje');
      if (cadHoje) cadHoje.textContent = m.crescimento.cadastrosHoje || 0;

      const cad7d = document.getElementById('metric-cadastros-7d');
      if (cad7d) cad7d.textContent = m.crescimento.cadastrosUltimos7Dias || 0;

      const trialsAtivos = document.getElementById('metric-trials-ativos');
      if (trialsAtivos) trialsAtivos.textContent = m.funil.trialsAtivos || 0;

      const trialsExp = document.getElementById('metric-trials-expirados');
      if (trialsExp) trialsExp.textContent = m.funil.trialsExpirados || 0;

      const vitalicios = document.getElementById('metric-vitalicios-ativos');
      if (vitalicios) vitalicios.textContent = m.funil.vitaliciosAtivos || 0;

      const taxaConv = document.getElementById('metric-taxa-conversao');
      if (taxaConv) taxaConv.textContent = m.funil.taxaConversao || '0.0%';

      const receitaEl = document.getElementById('metric-receita-total');
      if (receitaEl) receitaEl.textContent = m.financeiro.receitaFormatada || 'R$ 0,00';

      const procsEl = document.getElementById('metric-total-processos');
      if (procsEl) procsEl.textContent = m.operacional.totalProcessos || 0;

      const docsEl = document.getElementById('metric-total-documentos');
      if (docsEl) docsEl.textContent = m.operacional.totalDocumentos || 0;

      const confsEl = document.getElementById('metric-total-conferencias');
      if (confsEl) confsEl.textContent = m.operacional.totalConferenciasInteligentes || 0;

      const total = m.funil.totalCadastros || 1;
      const trialPct = Math.min(100, Math.round(((m.funil.trialsAtivos || 0) / total) * 100));
      const vitPct = Math.min(100, Math.round(((m.funil.vitaliciosAtivos || 0) / total) * 100));

      const step2Count = document.getElementById('funil-step2-count');
      if (step2Count) step2Count.textContent = `${m.funil.trialsAtivos || 0} (${trialPct}%)`;

      const step2Bar = document.getElementById('funil-step2-bar');
      if (step2Bar) step2Bar.style.width = `${Math.max(5, trialPct)}%`;

      const step3Count = document.getElementById('funil-step3-count');
      if (step3Count) step3Count.textContent = `${m.funil.vitaliciosAtivos || 0} (${m.funil.taxaConversao})`;

      const step3Bar = document.getElementById('funil-step3-bar');
      if (step3Bar) step3Bar.style.width = `${Math.max(5, vitPct)}%`;

      const tbody = document.getElementById('metrics-transactions-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        if (!m.ultimasTransacoes || m.ultimasTransacoes.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="py-3 text-center text-slate-400">Nenhuma transação registrada ainda.</td></tr>';
        } else {
          m.ultimasTransacoes.forEach(t => {
            const tr = document.createElement('tr');
            tr.className = 'border-b border-slate-100 hover:bg-slate-50 transition';
            const valFmt = `R$ ${(parseFloat(t.valor_pago || t.valorPago || 19.90)).toFixed(2)}`;
            const dateFmt = t.created_at || t.createdAt ? new Date(t.created_at || t.createdAt).toLocaleDateString('pt-BR') : '-';
            const statusBadge = (t.status === 'PAID')
              ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">PAGO</span>'
              : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">PENDENTE RESGATE</span>';

            tr.innerHTML = `
              <td class="py-2.5 px-2.5 font-mono text-[11px] text-slate-700">${t.order_id || t.orderId || '-'}</td>
              <td class="py-2.5 px-2.5 text-slate-800 font-medium">${t.customer_email || t.customerEmail || '-'}</td>
              <td class="py-2.5 px-2.5 font-bold text-emerald-600">${valFmt}</td>
              <td class="py-2.5 px-2.5">${statusBadge}</td>
              <td class="py-2.5 px-2.5 text-slate-500">${dateFmt}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      }

      this.setupIcons();
    } catch (err) {
      console.error('[loadAdminMetrics Error]:', err);
      this.toast('Erro ao buscar métricas: ' + err.message, 'error');
    }
  }

  // ================= MODAIS JURÍDICOS (LGPD & TERMOS) =================
  openTermsModal() {
    document.getElementById('legal-title').textContent = 'Termos de Uso e Condições de Serviço';
    document.getElementById('legal-content').innerHTML = `
      <p><strong>1. Natureza Auxiliar do Serviço:</strong> O DocumentoCerto é um software de produtividade, organização de requisitos e conferência preliminar de arquivos. <em>Os resultados apresentados pelo DocumentoCerto são estritamente auxiliares e não substituem análise profissional, jurídica, contábil ou administrativa regulamentada.</em></p>
      <p><strong>2. Ausência de Garantia Governamental:</strong> O sistema não garante aceitação, homologação ou aprovação perante órgãos públicos, tribunais ou instituições reguladoras.</p>
      <p><strong>3. Responsabilidade do Usuário:</strong> Cabe integralmente ao usuário ou organização contratante verificar a autenticidade, vigência e veracidade das informações e documentos anexados.</p>
      <p><strong>4. Faixa Etária e Capacidade:</strong> O uso da plataforma é recomendado para maiores de 16 anos. Contratações pagas devem ser realizadas por maiores de 18 anos ou formalmente autorizados por seus representantes legais.</p>
      <p><strong>5. Foro:</strong> Aplica-se a legislação da República Federativa do Brasil.</p>
    `;
    document.getElementById('modal-legal').classList.remove('hidden');
  }

  openPrivacyModal() {
    document.getElementById('legal-title').textContent = 'Política de Privacidade e Conformidade LGPD';
    document.getElementById('legal-content').innerHTML = `
      <p><strong>1. Conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018):</strong> Esta aplicação foi projetada sob o princípio do <em>Privacy by Design</em> e minimização de dados (Art. 6º da LGPD).</p>
      <p><strong>2. Armazenamento Seguro e Isolamento Multi-Tenant:</strong> Documentos anexados são mantidos em diretórios privados protegidos no servidor, nunca expostos por links públicos sem autenticação.</p>
      <p><strong>3. Direitos do Titular (Art. 18 LGPD):</strong> Você pode solicitar a qualquer momento a visualização, correção, revogação ou exclusão definitiva de seus dados e documentos através do painel de administração.</p>
      <p><strong>4. Não Comercialização:</strong> Seus dados ou documentos corporativos jamais serão vendidos ou compartilhados com terceiros para fins publicitários.</p>
      <p><strong>5. Contato do Encarregado (DPO):</strong> Para requisições LGPD, contate privacidade@documentocerto.com.br.</p>
    `;
    document.getElementById('modal-legal').classList.remove('hidden');
  }
}

// Inicializa a aplicação quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DocumentoCertoApp();
});
