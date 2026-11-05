// Estado global da aplicação
let currentUser = null;
let currentView = 'inicio';
let rebanhoData = [];
let rebanhoResumo = null;
let allUnits = [];
let allEmbarques = [];
let allEstoques = [];
let allTransferenciasInsumos = [];
let chartTipoInstance = null;
let chartEvolucaoInstance = null;
let pendingImportLots = [];
let supabaseConfig = null;
let supabaseClient = null;

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  await initSupabaseClient();
  checkAuthCallback();
  checkSession();
  lucide.createIcons();
});

async function initSupabaseClient() {
  try {
    const res = await fetch('/api/config');
    supabaseConfig = await res.json();
    if (supabaseConfig.supabaseConfigured && supabaseConfig.supabaseUrl && supabaseConfig.supabaseAnonKey && window.supabase) {
      supabaseClient = window.supabase.createClient(supabaseConfig.supabaseUrl, supabaseConfig.supabaseAnonKey);
    }
  } catch (err) {
    console.warn('Configuração do Supabase indisponível:', err);
  }
}

async function checkAuthCallback() {
  const hash = window.location.hash;
  if (!hash) return;
  if (hash.includes('access_token=') || hash.includes('type=recovery') || hash.includes('type=invite') || hash.includes('type=signup')) {
    setAuthMode('newPassword');
    navigateTo('login');
    const alertBox = document.getElementById('authStatusAlert');
    alertBox.className = 'mt-3 p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 block';
    alertBox.innerHTML = `
      <div class="font-bold mb-1">E-mail verificado com sucesso!</div>
      Digite sua nova senha abaixo para ativar seu acesso definitivo.
    `;
  }
}

// -------------------------------------------------------------
// SESSÃO, PERMISSÕES E VISIBILIDADE DE MÓDULOS
// -------------------------------------------------------------
async function checkSession() {
  const savedUser = localStorage.getItem('conf_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    applyUserPermissions();
  } else {
    try {
      const res = await fetch('/api/users/stats');
      const stats = await res.json();
      if (!stats.hasAdmin) {
        setAuthMode('register');
        document.getElementById('firstUserAlert').classList.remove('hidden');
      } else {
        setAuthMode('login');
      }
    } catch (e) {
      setAuthMode('login');
    }
    navigateTo('login');
  }
}

function applyUserPermissions() {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  renderUserArea();

  // Usuário pendente (sem permissão aprovada pelo admin):
  // Visualiza apenas tela inicial sem módulos liberados
  if (currentUser.role === 'pendente') {
    navigateTo('pendente');
    return;
  }

  // Admin tem acesso a todos os módulos
  const isSuperAdmin = currentUser.role === 'admin';
  const userMods = currentUser.modulos || [];

  const modButtons = {
    'rebanho': document.getElementById('nav-rebanho'),
    'embarque': document.getElementById('nav-embarque'),
    'transferencia-insumos': document.getElementById('nav-transferencia-insumos'),
    'estoque': document.getElementById('nav-estoque'),
    'dashboard': document.getElementById('nav-dashboard'),
    'admin': document.getElementById('nav-admin')
  };

  const cardAccess = {
    'rebanho': document.getElementById('card-acc-rebanho'),
    'embarque': document.getElementById('card-acc-embarque'),
    'transferencia-insumos': document.getElementById('card-acc-insumos'),
    'dashboard': document.getElementById('card-acc-dashboard')
  };

  Object.keys(modButtons).forEach(m => {
    const btn = modButtons[m];
    const hasAccess = isSuperAdmin || userMods.includes(m);
    if (btn) {
      if (hasAccess) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    }
  });

  Object.keys(cardAccess).forEach(m => {
    const card = cardAccess[m];
    const hasAccess = isSuperAdmin || userMods.includes(m);
    if (card) {
      if (hasAccess) card.classList.remove('hidden');
      else card.classList.add('hidden');
    }
  });

  navigateTo('inicio');
}

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const nameGroup = document.getElementById('fieldNameGroup');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const toggleAuthBtn = document.getElementById('toggleAuthBtn');
  const passHint = document.getElementById('passwordHint');
  const labelPassword = document.getElementById('labelPassword');

  if (mode === 'register') {
    nameGroup.classList.remove('hidden');
    document.getElementById('authName').required = true;
    passHint.classList.remove('hidden');
    authTitle.textContent = 'Cadastrar Novo Usuário';
    authSubtitle.textContent = 'Insira seus dados para receber o link de confirmação por e-mail';
    authSubmitBtn.querySelector('span').textContent = 'Cadastrar e Enviar Link';
    toggleAuthBtn.textContent = 'Já possui conta confirmada? Fazer login.';
    labelPassword.textContent = 'Senha Desejada';
  } else if (mode === 'newPassword') {
    nameGroup.classList.add('hidden');
    passHint.classList.add('hidden');
    authTitle.textContent = 'Definir Senha de Acesso';
    authSubtitle.textContent = 'Crie sua senha definitiva para acessar a plataforma';
    authSubmitBtn.querySelector('span').textContent = 'Salvar Senha e Entrar';
    toggleAuthBtn.textContent = 'Voltar para Login';
    labelPassword.textContent = 'Nova Senha';
  } else {
    nameGroup.classList.add('hidden');
    passHint.classList.add('hidden');
    document.getElementById('authName').required = false;
    authTitle.textContent = 'Acesse sua Conta';
    authSubtitle.textContent = 'Gestão de Dados de Confinamento';
    authSubmitBtn.querySelector('span').textContent = 'Entrar';
    toggleAuthBtn.textContent = 'Primeiro acesso? Crie a conta do Administrador aqui.';
    labelPassword.textContent = 'Senha';
  }
}

function toggleAuthMode() {
  if (authMode === 'register' || authMode === 'newPassword') {
    setAuthMode('login');
  } else {
    setAuthMode('register');
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value;
  const alertBox = document.getElementById('authStatusAlert');

  if (authMode === 'newPassword') {
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        alert('Erro ao atualizar senha: ' + error.message);
        return;
      }
      alert('Senha definida com sucesso!');
      window.location.hash = '';
      checkSession();
      return;
    }
  }

  try {
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = authMode === 'register' ? { name, email, password } : { email, password };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao processar autenticação.');
      return;
    }

    if (authMode === 'register' && data.isSupabase) {
      alertBox.className = 'mt-3 p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 block';
      alertBox.innerHTML = `
        <div class="font-bold flex items-center gap-1.5 mb-1 text-emerald-400">
          <i data-lucide="mail-check" class="w-4 h-4"></i> Link de confirmação enviado!
        </div>
        Enviamos um e-mail para <strong>${email}</strong> com o link para confirmar sua conta.
      `;
      lucide.createIcons();
      return;
    }

    currentUser = data.user;
    localStorage.setItem('conf_user', JSON.stringify(currentUser));
    applyUserPermissions();
  } catch (err) {
    alert('Erro de conexão com o servidor.');
  }
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  localStorage.removeItem('conf_user');
  currentUser = null;
  renderUserArea();
  navigateTo('login');
}

function renderUserArea() {
  const userArea = document.getElementById('userArea');
  const navMenu = document.getElementById('navMenu');

  if (!currentUser) {
    userArea.innerHTML = '';
    navMenu.classList.add('hidden');
    return;
  }

  navMenu.classList.remove('hidden');

  const initials = (currentUser.name || 'US')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');

  const roleLabels = {
    'admin': 'Administrador',
    'gestor': 'Gestor',
    'supervisor': 'Supervisor (Titular)',
    'observador': 'Observador',
    'pendente': 'Aguardando Aprovação'
  };

  userArea.innerHTML = `
    <div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#121915] border border-[#1e2a22] rounded-xl text-xs text-gray-300">
      <i data-lucide="layers" class="w-3.5 h-3.5 text-emerald-400"></i>
      <span id="topBarLotCount" class="font-semibold text-gray-200">41 lotes na base</span>
    </div>

    <div class="flex items-center gap-3 pl-2 border-l border-[#1d2722]">
      <div class="text-right hidden sm:block">
        <div class="text-xs font-bold text-white uppercase tracking-wider">${currentUser.name}</div>
        <div class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">${roleLabels[currentUser.role] || currentUser.role}</div>
      </div>
      <div class="w-9 h-9 rounded-full bg-[#16211b] border border-[#233229] flex items-center justify-center text-xs font-bold text-emerald-400 shadow-sm">
        ${initials || 'US'}
      </div>
      <button onclick="logout()" title="Sair do sistema" class="p-2 text-gray-400 hover:text-red-400 transition">
        <i data-lucide="log-out" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  lucide.createIcons();
}

// -------------------------------------------------------------
// NAVEGAÇÃO SPA
// -------------------------------------------------------------
function navigateTo(viewId) {
  if (!currentUser && viewId !== 'login') viewId = 'login';
  currentView = viewId;

  ['login', 'pendente', 'inicio', 'rebanho', 'embarque', 'transferencia-insumos', 'estoque', 'importar', 'dashboard', 'admin'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.add('hidden');
  });

  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.className = 'nav-btn flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white hover:bg-[#18221c] transition-colors';
  });
  const activeBtn = document.getElementById('nav-' + viewId);
  if (activeBtn) {
    activeBtn.className = 'nav-btn flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-black shadow-sm';
  }

  if (viewId === 'inicio') loadInicioData();
  else if (viewId === 'rebanho') loadRebanhoData();
  else if (viewId === 'embarque') loadEmbarquesData();
  else if (viewId === 'transferencia-insumos') loadTransferenciasInsumosData();
  else if (viewId === 'estoque') loadEstoquesData();
  else if (viewId === 'dashboard') loadDashboardData();
  else if (viewId === 'admin') loadAdminData();

  lucide.createIcons();
}

// -------------------------------------------------------------
// VIEW 1: INÍCIO (COM NOTIFICAÇÕES & CONTAGEM REGRESSIVA)
// -------------------------------------------------------------
async function loadInicioData() {
  try {
    const [resRebanho, resUnits, resEmbarques, resInsumos] = await Promise.all([
      fetch('/api/rebanho'),
      fetch('/api/units'),
      fetch('/api/embarques'),
      fetch('/api/transferencias-insumos')
    ]);

    const data = await resRebanho.json();
    allUnits = await resUnits.json();
    allEmbarques = await resEmbarques.json();
    allTransferenciasInsumos = await resInsumos.json();

    rebanhoData = data.baias || [];
    rebanhoResumo = data.resumo;

    // Atualizar Unidade do Usuário
    const userUnit = allUnits.find(u => u.id === currentUser?.unitId);
    document.getElementById('userUnitName').textContent = userUnit ? userUnit.name : 'Geral / Todas Unidades';

    // Saudação
    const firstName = currentUser ? currentUser.name.split(' ')[0].toUpperCase() : 'USUÁRIO';
    document.getElementById('userNameGreeting').textContent = firstName;
    
    const totalAnimaisFmt = Number(rebanhoResumo.totalAnimais || 0).toLocaleString('pt-BR');
    document.getElementById('userSubtitleGreeting').textContent = 
      `${totalAnimaisFmt} animais em ${rebanhoResumo.curraisOcupados} currais. ${rebanhoResumo.prontosEmbarque} lotes prontos para embarque.`;

    document.getElementById('kpiAnimaisAtivos').textContent = totalAnimaisFmt;
    document.getElementById('kpiCurraisOcupados').textContent = rebanhoResumo.curraisOcupados;
    document.getElementById('kpiProntosEmbarque').textContent = rebanhoResumo.prontosEmbarque;

    if (rebanhoResumo.lastUpdate) {
      const dt = new Date(rebanhoResumo.lastUpdate);
      document.getElementById('kpiUltimaAtualizacao').textContent = dt.toLocaleDateString('pt-BR');
      document.getElementById('posicaoDataLabel').textContent = 'POSIÇÃO DE ' + dt.toLocaleDateString('pt-BR');
    }

    const topLotCount = document.getElementById('topBarLotCount');
    if (topLotCount) topLotCount.textContent = `${rebanhoResumo.totalLotes} lotes na base`;

    document.getElementById('cardRebanhoSummary').textContent = `${rebanhoResumo.curraisOcupados} LOTES • ${totalAnimaisFmt} ANIMAIS`;
    document.getElementById('cardEmbarqueSummary').textContent = `${allEmbarques.filter(e => e.status === 'PROGRAMADO').length} EMBARQUES AGENDADOS`;
    
    const cardInsumosSum = document.getElementById('cardInsumosSummary');
    if (cardInsumosSum) {
      const ativas = allTransferenciasInsumos.filter(t => t.status === 'PENDENTE' || t.status === 'CONFIRMADA' || t.status === 'APROVADA' || t.status === 'ENVIADA').length;
      cardInsumosSum.textContent = `${ativas} TRANSFERÊNCIAS ATIVAS`;
    }

    // Renderizar Notificações de Embarque e de Solicitações/Respostas de Insumos
    renderAlertasEmbarqueInicio();
    renderAlertasInsumosInicio();
  } catch (err) {
    console.error('Erro ao carregar início:', err);
  }
}

function renderAlertasInsumosInicio() {
  const alertArea = document.getElementById('alertInsumosArea');
  if (!alertArea) return;

  const isGestorOuAdmin = currentUser.role === 'admin' || currentUser.role === 'gestor';
  const myUnitId = currentUser.unitId;

  // 1. Notificação para Unidade Remetente ou Gestor: Novas solicitações pendentes de resposta
  const solicitacoesParaRemetente = allTransferenciasInsumos.filter(t => {
    if (t.status !== 'PENDENTE') return false;
    return isGestorOuAdmin || t.remetenteUnitId === myUnitId;
  });

  // 2. Notificação para Unidade Solicitante: Respostas, Envio e Pendências de Recebimento
  const respostasParaSolicitante = allTransferenciasInsumos.filter(t => {
    if (t.status !== 'CONFIRMADA' && t.status !== 'APROVADA' && t.status !== 'REJEITADA' && t.status !== 'ENVIADA') return false;
    return isGestorOuAdmin || t.solicitanteUnitId === myUnitId;
  });

  // 3. Notificação para Unidade Remetente: Confirmadas aguardando envio
  const confirmadasAguardandoEnvio = allTransferenciasInsumos.filter(t => {
    if (t.status !== 'CONFIRMADA' && t.status !== 'APROVADA') return false;
    return isGestorOuAdmin || t.remetenteUnitId === myUnitId;
  });

  if (solicitacoesParaRemetente.length === 0 && respostasParaSolicitante.length === 0 && confirmadasAguardandoEnvio.length === 0) {
    alertArea.classList.add('hidden');
    return;
  }

  alertArea.classList.remove('hidden');
  let html = '';

  // Cards de solicitação recebida (para o remetente confirmar resposta)
  solicitacoesParaRemetente.forEach(sol => {
    html += `
      <div class="bg-[#121915] border border-blue-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
            <i data-lucide="bell-ring" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white uppercase tracking-wide">Solicitação de Insumo Recebida</span>
              <span class="px-2 py-0.5 bg-blue-500/20 text-blue-300 font-mono font-bold rounded text-[11px]">${sol.numero}</span>
            </div>
            <div class="text-xs text-gray-300 mt-1">
              <strong>${sol.solicitanteUnitNome}</strong> solicita <strong>${sol.volumeSolicitado} ${sol.unidadeMedida}</strong> de <span class="text-emerald-400 font-bold">${sol.material}</span>.
              <span class="text-gray-400 block sm:inline sm:ml-2">Data da Necessidade: <strong>${sol.dataNecessidade}</strong></span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="abrirModalRespostaSol('${sol.id}')" class="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
            <i data-lucide="check-square" class="w-3.5 h-3.5"></i> Confirmar Resposta
          </button>
        </div>
      </div>
    `;
  });

  // Cards para o Remetente: Transferência Confirmada -> Pronto para Enviar
  confirmadasAguardandoEnvio.forEach(sol => {
    html += `
      <div class="bg-[#121915] border border-emerald-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
            <i data-lucide="truck" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white uppercase tracking-wide">${sol.numero} • Transferência Confirmada</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">PRONTO P/ ENVIO</span>
            </div>
            <div class="text-xs text-gray-300 mt-1">
              Transferência de <strong>${sol.volumeAprovado} ${sol.unidadeMedida}</strong> de <strong class="text-emerald-400">${sol.material}</strong> para <strong>${sol.solicitanteUnitNome}</strong>.
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="abrirModalEnvioInsumo('${sol.id}')" class="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
            <i data-lucide="truck" class="w-3.5 h-3.5"></i> Confirmar Envio
          </button>
        </div>
      </div>
    `;
  });

  // Cards de resposta recebida pelo solicitante (Confirmada, Pendente de Recebimento ou Rejeitada)
  respostasParaSolicitante.slice(0, 3).forEach(sol => {
    let statusBadge = '';
    let statusText = '';
    let acaoHtml = '';

    if (sol.status === 'CONFIRMADA' || sol.status === 'APROVADA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">TRANSFERÊNCIA CONFIRMADA</span>`;
      statusText = `O remetente <strong>${sol.remetenteUnitNome}</strong> confirmou a transferência de <strong>${sol.volumeAprovado} ${sol.unidadeMedida}</strong> para envio em <strong>${sol.dataPrevisaoEnvio}</strong>.`;
      acaoHtml = `
        <button onclick="navigateTo('transferencia-insumos')" class="px-3 py-1.5 bg-[#17221c] hover:bg-[#202e26] text-gray-200 font-medium rounded-xl text-xs flex items-center gap-1.5 border border-[#25362c]">
          <i data-lucide="eye" class="w-3.5 h-3.5 text-blue-400"></i> Ver Detalhes
        </button>
      `;
    } else if (sol.status === 'ENVIADA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">PENDENTE DE RECEBIMENTO</span>`;
      statusText = `Material enviado com motorista <strong>${sol.dadosEnvio?.motorista || 'Designado'}</strong> ${sol.dadosEnvio?.numeroNF ? `(NF: ${sol.dadosEnvio.numeroNF})` : ''}. Confirme o recebimento assim que for entregue.`;
      acaoHtml = `
        <button onclick="confirmarRecebimentoInsumo('${sol.id}')" class="px-3.5 py-1.5 bg-purple-500 hover:bg-purple-400 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
          <i data-lucide="package-check" class="w-3.5 h-3.5"></i> Confirmar Recebimento
        </button>
      `;
    } else if (sol.status === 'REJEITADA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">REJEITADA</span>`;
      statusText = `Solicitação rejeitada por <strong>${sol.remetenteUnitNome}</strong>. Motivo: "${sol.justificativaRejeicao || 'Sem justificativa'}".`;
      acaoHtml = `
        <button onclick="navigateTo('transferencia-insumos')" class="px-3 py-1.5 bg-[#17221c] hover:bg-[#202e26] text-gray-200 font-medium rounded-xl text-xs flex items-center gap-1.5 border border-[#25362c]">
          <i data-lucide="eye" class="w-3.5 h-3.5 text-blue-400"></i> Ver Detalhes
        </button>
      `;
    }

    html += `
      <div class="bg-[#121915] border border-[#202c25] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-gray-500/10 border border-gray-500/20 flex items-center justify-center text-gray-300 flex-shrink-0">
            <i data-lucide="arrow-left-right" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white">${sol.numero} • Status de Insumos</span>
              ${statusBadge}
            </div>
            <div class="text-xs text-gray-300 mt-1">${statusText}</div>
          </div>
        </div>

        ${acaoHtml}
      </div>
    `;
  });

  alertArea.innerHTML = html;
  lucide.createIcons();
}

function renderAlertasEmbarqueInicio() {
  const alertArea = document.getElementById('alertEmbarquesArea');
  if (!alertArea) return;

  // Filtrar embarques onde o usuário está envolvido (Titular da Origem, Titular do Destino, Gestor ou Admin)
  const isGestorOuAdmin = currentUser.role === 'admin' || currentUser.role === 'gestor';
  const myUnitId = currentUser.unitId;

  const embarquesEnvolvidos = allEmbarques.filter(e => {
    if (e.status !== 'PROGRAMADO') return false;
    if (isGestorOuAdmin) return true;
    return e.origemUnidadeId === myUnitId || e.destinoUnidadeId === myUnitId;
  });

  if (embarquesEnvolvidos.length === 0) {
    alertArea.classList.add('hidden');
    return;
  }

  alertArea.classList.remove('hidden');
  alertArea.innerHTML = embarquesEnvolvidos.map(emb => {
    // Cálculo da contagem regressiva
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dataEmb = new Date(emb.dataEmbarque + 'T00:00:00');
    const diffTime = dataEmb.getTime() - hoje.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let countdownBadge = '';
    if (diffDays > 1) {
      countdownBadge = `<span class="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold rounded-lg text-xs animate-pulse">Embarque em ${diffDays} dias</span>`;
    } else if (diffDays === 1) {
      countdownBadge = `<span class="px-2.5 py-1 bg-amber-500 text-black font-extrabold rounded-lg text-xs animate-bounce">Embarque Amanhã!</span>`;
    } else if (diffDays === 0) {
      countdownBadge = `<span class="px-2.5 py-1 bg-red-500 text-white font-extrabold rounded-lg text-xs animate-pulse">EMBARQUE HOJE!</span>`;
    } else {
      countdownBadge = `<span class="px-2.5 py-1 bg-red-950/60 text-red-400 border border-red-500/30 font-bold rounded-lg text-xs">Atrasado há ${Math.abs(diffDays)} dias</span>`;
    }

    return `
      <div class="bg-[#121915] border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
            <i data-lucide="truck" class="w-5 h-5"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white uppercase tracking-wide">Programação de Embarque</span>
              ${countdownBadge}
            </div>
            <div class="text-xs text-gray-300 mt-1">
              <strong>${emb.qtdCabecas} cabeças</strong> (${emb.categoria || 'Gado'}) • 
              De: <span class="text-emerald-400 font-semibold">${emb.origemUnidadeNome}</span> 
              ➔ Para: <span class="text-emerald-400 font-semibold">${emb.destinoUnidadeNome}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="navigateTo('embarque')" class="px-3 py-1.5 bg-[#17221c] hover:bg-[#202e26] text-gray-200 font-medium rounded-xl text-xs flex items-center gap-1.5 border border-[#25362c]">
            <i data-lucide="eye" class="w-3.5 h-3.5 text-amber-400"></i> Ver Detalhes & Documentos
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// -------------------------------------------------------------
// VIEW 2: REBANHO (Tabela Modelo Relatório _reb_)
// -------------------------------------------------------------
let rebanhoSortCol = 'baia';
let rebanhoSortAsc = true;
let rebanhoQuickFilter = 'TODOS'; // 'TODOS' | 'PRONTOS' | 'ENTRADA' | 'SAIDA'

function isBaiaPronta(b) {
  if (!b || !b.qtdAnimais || Number(b.qtdAnimais) <= 0) return false;
  const pesoHoje = Number(b.pesoEstimadoHoje) || 0;
  const pesoPrev = Number(b.pesoAbatePrev) || 0;
  const dias = Number(b.diasConfin) || 0;
  return (pesoPrev > 0 && pesoHoje >= pesoPrev) || dias >= 90;
}

function isBaiaEntrada(b) {
  if (!b || !b.qtdAnimais || Number(b.qtdAnimais) <= 0) return false;
  const dieta = String(b.dieta || '').toUpperCase();
  const dias = Number(b.diasConfin) || 0;
  const obs = String(b.obs || '').toLowerCase();
  return dieta.includes('ADAP') || dieta.includes('TRANS') || dias <= 30 || obs.includes('recepção') || obs.includes('entrada');
}

function isBaiaSaida(b) {
  if (!b || !b.qtdAnimais || Number(b.qtdAnimais) <= 0) return false;
  const obs = String(b.obs || '').toLowerCase();
  const dtEmb = b.dataEstimadaEmbarque;
  return isBaiaPronta(b) || Boolean(dtEmb) || obs.includes('abate') || obs.includes('embarq') || obs.includes('refugo');
}

function sortRebanhoBy(col) {
  if (rebanhoSortCol === col) {
    rebanhoSortAsc = !rebanhoSortAsc;
  } else {
    rebanhoSortCol = col;
    rebanhoSortAsc = true;
  }
  applyRebanhoFilters();
}

function setRebanhoQuickFilter(filter) {
  rebanhoQuickFilter = filter;
  applyRebanhoFilters();
}

function clearRebanhoFilters() {
  const searchInput = document.getElementById('rebanhoSearch');
  if (searchInput) searchInput.value = '';
  const selBaia = document.getElementById('rebanhoBaiaSelect');
  if (selBaia) selBaia.value = 'TODAS';
  rebanhoQuickFilter = 'TODOS';
  rebanhoSortCol = 'baia';
  rebanhoSortAsc = true;
  applyRebanhoFilters();
}

function populateRebanhoBaiaSelect() {
  const sel = document.getElementById('rebanhoBaiaSelect');
  if (!sel) return;
  const currentVal = sel.value;
  const baiasUnicas = [...new Set(rebanhoData.map(b => b.baia).filter(Boolean))].sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    if (!isNaN(numA)) return -1;
    if (!isNaN(numB)) return 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });

  sel.innerHTML = '<option value="TODAS" class="bg-[#111814] text-white">Todas as Baias (' + baiasUnicas.length + ')</option>' +
    baiasUnicas.map(b => {
      const item = rebanhoData.find(x => x.baia === b);
      const qtd = item ? (item.qtdAnimais || 0) : 0;
      return `<option value="${b}" class="bg-[#111814] text-white">Baia ${b} (${qtd} cab)</option>`;
    }).join('');

  if (currentVal && (currentVal === 'TODAS' || baiasUnicas.includes(currentVal))) {
    sel.value = currentVal;
  }
}

function applyRebanhoFilters() {
  const searchInput = document.getElementById('rebanhoSearch');
  const q = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';
  const selBaia = document.getElementById('rebanhoBaiaSelect');
  const baiaFiltro = selBaia ? selBaia.value : 'TODAS';

  // 1. Atualizar estilos dos botões de filtro rápido
  const quickBtns = [
    { id: 'btnFiltroRebanhoTodos', key: 'TODOS' },
    { id: 'btnFiltroRebanhoProntos', key: 'PRONTOS' },
    { id: 'btnFiltroRebanhoEntrada', key: 'ENTRADA' },
    { id: 'btnFiltroRebanhoSaida', key: 'SAIDA' }
  ];

  quickBtns.forEach(btnInfo => {
    const btn = document.getElementById(btnInfo.id);
    if (!btn) return;
    if (rebanhoQuickFilter === btnInfo.key) {
      btn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-black shadow-md transition flex items-center gap-1.5';
    } else {
      btn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#16211a] border border-[#233128] text-gray-300 hover:text-white hover:bg-[#1d2c22] transition flex items-center gap-1.5';
    }
  });

  // Atualizar contadores
  const countTodos = rebanhoData.length;
  const countProntos = rebanhoData.filter(isBaiaPronta).length;
  const countEntrada = rebanhoData.filter(isBaiaEntrada).length;
  const countSaida = rebanhoData.filter(isBaiaSaida).length;

  const elTodos = document.getElementById('countRebanhoTodos');
  if (elTodos) elTodos.textContent = countTodos;
  const elProntos = document.getElementById('countRebanhoProntos');
  if (elProntos) elProntos.textContent = countProntos;
  const elEntrada = document.getElementById('countRebanhoEntrada');
  if (elEntrada) elEntrada.textContent = countEntrada;
  const elSaida = document.getElementById('countRebanhoSaida');
  if (elSaida) elSaida.textContent = countSaida;

  // 2. Filtrar
  let filtered = rebanhoData.filter(b => {
    // Filtro rápido
    if (rebanhoQuickFilter === 'PRONTOS' && !isBaiaPronta(b)) return false;
    if (rebanhoQuickFilter === 'ENTRADA' && !isBaiaEntrada(b)) return false;
    if (rebanhoQuickFilter === 'SAIDA' && !isBaiaSaida(b)) return false;

    // Filtro por baia específica
    if (baiaFiltro && baiaFiltro !== 'TODAS' && b.baia !== baiaFiltro) return false;

    // Busca textual por Lote, Raça, Baia, Categoria, Dieta
    if (q) {
      const matchLote = String(b.lote || '').toLowerCase().includes(q);
      const matchRaca = String(b.raca || '').toLowerCase().includes(q);
      const matchBaia = String(b.baia || '').toLowerCase().includes(q);
      const matchCat = String(b.categoria || '').toLowerCase().includes(q);
      const matchDieta = String(b.dieta || '').toLowerCase().includes(q);
      const matchObs = String(b.obs || '').toLowerCase().includes(q);
      if (!matchLote && !matchRaca && !matchBaia && !matchCat && !matchDieta && !matchObs) {
        return false;
      }
    }

    return true;
  });

  // 3. Ordenar
  filtered.sort((a, b) => {
    let valA = a[rebanhoSortCol];
    let valB = b[rebanhoSortCol];

    if (rebanhoSortCol === 'baia') {
      const numA = parseInt(valA, 10);
      const numB = parseInt(valB, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return rebanhoSortAsc ? (numA - numB) : (numB - numA);
      }
      if (!isNaN(numA)) return rebanhoSortAsc ? -1 : 1;
      if (!isNaN(numB)) return rebanhoSortAsc ? 1 : -1;
      return rebanhoSortAsc ? String(valA || '').localeCompare(String(valB || ''), undefined, { numeric: true }) : String(valB || '').localeCompare(String(valA || ''), undefined, { numeric: true });
    }

    const numericCols = ['qtdAnimais', 'pesoEntrada', 'diasConfin', 'gpd', 'pesoAbatePrev', 'pesoEstimadoHoje'];
    if (numericCols.includes(rebanhoSortCol)) {
      const nA = Number(valA) || 0;
      const nB = Number(valB) || 0;
      return rebanhoSortAsc ? (nA - nB) : (nB - nA);
    }

    const strA = String(valA || '').toLowerCase();
    const strB = String(valB || '').toLowerCase();
    return rebanhoSortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });

  // 4. Atualizar ícones de ordenação nas colunas
  const sortColumns = [
    'baia', 'lote', 'raca', 'categoria', 'qtdAnimais',
    'dataEntrada', 'pesoEntrada', 'dieta', 'diasConfin',
    'gpd', 'pesoAbatePrev', 'pesoEstimadoHoje', 'dataEstimadaEmbarque'
  ];

  sortColumns.forEach(col => {
    const icon = document.getElementById('sortIcon-' + col);
    if (!icon) return;
    if (col === rebanhoSortCol) {
      icon.textContent = rebanhoSortAsc ? '▲' : '▼';
      icon.className = 'text-emerald-400 font-bold';
    } else {
      icon.textContent = '↕';
      icon.className = 'text-gray-500 font-normal';
    }
  });

  // 5. Atualizar resumo
  const totalAnimaisFiltrados = filtered.reduce((acc, b) => acc + (Number(b.qtdAnimais) || 0), 0);
  const elTotalAnimais = document.getElementById('rebanhoTotalFiltradoAnimais');
  if (elTotalAnimais) elTotalAnimais.textContent = totalAnimaisFiltrados.toLocaleString('pt-BR');
  const elTotalBaias = document.getElementById('rebanhoTotalFiltradoBaias');
  if (elTotalBaias) elTotalBaias.textContent = filtered.length;

  renderRebanhoTable(filtered);
  if (window.lucide) window.lucide.createIcons();
}

function filterRebanhoTable() {
  applyRebanhoFilters();
}

async function loadRebanhoData() {
  try {
    const res = await fetch('/api/rebanho');
    const data = await res.json();
    rebanhoData = data.baias || [];
    populateRebanhoBaiaSelect();
    applyRebanhoFilters();
  } catch (err) {
    console.error(err);
  }
}

function renderRebanhoTable(list) {
  const tbody = document.getElementById('rebanhoTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="15" class="py-8 text-center text-gray-500 text-xs">Nenhum lote localizado.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(b => {
    const isPronto = b.pesoAbatePrev && b.pesoEstimadoHoje && b.pesoEstimadoHoje >= b.pesoAbatePrev;
    const badgeEmbarque = isPronto 
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">PRONTO</span>` 
      : `<span class="text-gray-400">${b.dataEstimadaEmbarque || '-'}</span>`;

    const lotacaoM2 = b.lotacaoSpecs && b.lotacaoSpecs.areaM2 ? (b.lotacaoSpecs.areaM2 + ' m²') : '-';

    return `
      <tr class="hover:bg-[#121915] transition-colors border-b border-[#141d18]">
        <td class="py-2.5 px-3 font-bold text-white">${b.baia || '-'}</td>
        <td class="py-2.5 px-3 text-emerald-400 font-semibold">${b.lote || '-'}</td>
        <td class="py-2.5 px-3">${b.raca || 'NE'}</td>
        <td class="py-2.5 px-3">${b.categoria || 'Macho'}</td>
        <td class="py-2.5 px-3 text-right font-bold text-white">${Number(b.qtdAnimais || 0).toLocaleString('pt-BR')}</td>
        <td class="py-2.5 px-3 text-gray-400">${b.dataEntrada || '-'}</td>
        <td class="py-2.5 px-3 text-right">${b.pesoEntrada ? Number(b.pesoEntrada).toFixed(1) : '-'}</td>
        <td class="py-2.5 px-3 text-xs text-gray-300">${b.dieta || '-'}</td>
        <td class="py-2.5 px-3 text-right">${b.diasConfin || 0}</td>
        <td class="py-2.5 px-3 text-right text-emerald-400 font-semibold">${b.gpd ? Number(b.gpd).toFixed(2) : '1.40'}</td>
        <td class="py-2.5 px-3 text-right text-gray-400">${b.pesoAbatePrev ? Number(b.pesoAbatePrev).toFixed(1) : '-'}</td>
        <td class="py-2.5 px-3 text-right font-bold text-white">${b.pesoEstimadoHoje ? Number(b.pesoEstimadoHoje).toFixed(1) : '-'}</td>
        <td class="py-2.5 px-3">${badgeEmbarque}</td>
        <td class="py-2.5 px-3 text-gray-400 text-xs">${lotacaoM2}</td>
        <td class="py-2.5 px-3 text-[11px] text-gray-400 max-w-xs truncate" title="${b.obs || ''}">${b.obs || '-'}</td>
      </tr>
    `;
  }).join('');
}

function exportRebanhoPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  doc.setFontSize(14);
  doc.setTextColor(34, 197, 94);
  doc.text("Gestão de Dados de Confinamento - Relatório de Rebanho Atual", 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} • Total de Lotes: ${rebanhoData.length}`, 14, 21);

  const head = [['Baia', 'Lote', 'Raça', 'Cat.', 'Nº Anm', 'Dt Entr', 'Peso Entr', 'Dieta', 'Dias Conf', 'GPD', 'Peso Prev', 'Peso Hoje', 'Previsão Emb.']];
  const body = rebanhoData.map(b => [
    b.baia || '',
    b.lote || '',
    b.raca || 'NE',
    b.categoria || 'Macho',
    b.qtdAnimais || 0,
    b.dataEntrada || '',
    b.pesoEntrada ? Number(b.pesoEntrada).toFixed(1) : '',
    b.dieta || '',
    b.diasConfin || 0,
    b.gpd ? Number(b.gpd).toFixed(2) : '1.40',
    b.pesoAbatePrev ? Number(b.pesoAbatePrev).toFixed(1) : '',
    b.pesoEstimadoHoje ? Number(b.pesoEstimadoHoje).toFixed(1) : '',
    b.dataEstimadaEmbarque || ''
  ]);

  doc.autoTable({
    head: head,
    body: body,
    startY: 25,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [18, 26, 21], textColor: [34, 197, 94] }
  });

  doc.save(`relatorio_rebanho_${Date.now()}.pdf`);
}

// -------------------------------------------------------------
// VIEW: TRANSFERÊNCIA DE INSUMOS & SOLICITAÇÕES
// -------------------------------------------------------------
let currentInsumosTab = 'TODAS'; // 'TODAS' | 'ANDAMENTO' | 'ARQUIVADAS'

function setInsumosTab(tab) {
  currentInsumosTab = tab;
  ['Todas', 'Andamento', 'Arquivadas'].forEach(t => {
    const btn = document.getElementById('tabInsumos' + t);
    if (!btn) return;
    if (t.toUpperCase() === tab) {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-500/20 text-blue-300 border border-blue-500/30';
    } else {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-white transition';
    }
  });
  renderTransferenciasInsumosCards();
}

async function loadTransferenciasInsumosData() {
  try {
    const [resTransf, resUnits, resEst] = await Promise.all([
      fetch('/api/transferencias-insumos'),
      fetch('/api/units'),
      fetch('/api/estoques')
    ]);
    allTransferenciasInsumos = await resTransf.json();
    allUnits = await resUnits.json();
    allEstoques = await resEst.json();

    // Atualizar contadores das abas
    const cTodas = document.getElementById('countInsumosTodas');
    const cAndamento = document.getElementById('countInsumosAndamento');
    const cArquivadas = document.getElementById('countInsumosArquivadas');

    if (cTodas) cTodas.textContent = allTransferenciasInsumos.length;
    if (cAndamento) {
      const andamento = allTransferenciasInsumos.filter(t => 
        t.status === 'PENDENTE' || t.status === 'CONFIRMADA' || t.status === 'APROVADA' || t.status === 'ENVIADA'
      ).length;
      cAndamento.textContent = andamento;
    }
    if (cArquivadas) {
      const arq = allTransferenciasInsumos.filter(t => t.status === 'ARQUIVADA' || t.status === 'RECEBIDA').length;
      cArquivadas.textContent = arq;
    }

    // Controle do botão solicitar: Apenas supervisor ou gestor/admin
    const canRequest = currentUser.role === 'admin' || currentUser.role === 'gestor' || currentUser.role === 'supervisor';
    const btnNova = document.getElementById('btnNovaSolInsumo');
    if (btnNova) {
      if (canRequest) btnNova.classList.remove('hidden');
      else btnNova.classList.add('hidden');
    }

    renderTransferenciasInsumosCards();
  } catch (err) {
    console.error(err);
  }
}

function renderTransferenciasInsumosCards() {
  const container = document.getElementById('insumosCardsList');
  if (!container) return;

  if (allTransferenciasInsumos.length === 0) {
    container.innerHTML = `<div class="col-span-2 py-12 text-center text-gray-500 text-xs">Nenhuma transferência de insumos registrada.</div>`;
    return;
  }

  const isGestorOuAdmin = currentUser.role === 'admin' || currentUser.role === 'gestor';
  const myUnitId = currentUser.unitId;
  const busca = (document.getElementById('insumosSearchInput')?.value || '').toLowerCase().trim();

  // Filtragem por aba
  let list = allTransferenciasInsumos.slice();
  if (currentInsumosTab === 'ANDAMENTO') {
    list = list.filter(t => t.status === 'PENDENTE' || t.status === 'CONFIRMADA' || t.status === 'APROVADA' || t.status === 'ENVIADA');
  } else if (currentInsumosTab === 'ARQUIVADAS') {
    list = list.filter(t => t.status === 'ARQUIVADA' || t.status === 'RECEBIDA');
  }

  // Filtragem por busca
  if (busca) {
    list = list.filter(t => 
      (t.numero && t.numero.toLowerCase().includes(busca)) ||
      (t.material && t.material.toLowerCase().includes(busca)) ||
      (t.remetenteUnitNome && t.remetenteUnitNome.toLowerCase().includes(busca)) ||
      (t.solicitanteUnitNome && t.solicitanteUnitNome.toLowerCase().includes(busca)) ||
      (t.dadosEnvio?.motorista && t.dadosEnvio.motorista.toLowerCase().includes(busca))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="col-span-2 py-12 text-center text-gray-500 text-xs">Nenhuma transferência encontrada com os filtros selecionados.</div>`;
    return;
  }

  container.innerHTML = list.map(t => {
    // Cálculo da contagem regressiva para envio (se confirmada)
    let countdownBadge = '';
    if ((t.status === 'CONFIRMADA' || t.status === 'APROVADA') && t.dataPrevisaoEnvio) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const dataPrev = new Date(t.dataPrevisaoEnvio + 'T00:00:00');
      const diffDays = Math.ceil((dataPrev.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 1) {
        countdownBadge = `<span class="px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold rounded-lg text-xs">Envio em ${diffDays} dias</span>`;
      } else if (diffDays === 1) {
        countdownBadge = `<span class="px-2.5 py-1 bg-amber-500 text-black font-extrabold rounded-lg text-xs animate-bounce">Envio Amanhã!</span>`;
      } else if (diffDays === 0) {
        countdownBadge = `<span class="px-2.5 py-1 bg-red-500 text-white font-extrabold rounded-lg text-xs animate-pulse">ENVIO HOJE!</span>`;
      } else {
        countdownBadge = `<span class="px-2 py-0.5 bg-red-950/60 text-red-400 border border-red-500/30 rounded text-xs font-bold">Envio Atrasado</span>`;
      }
    }

    // Permissões e papéis
    const isRemetente = myUnitId === t.remetenteUnitId;
    const isSolicitante = myUnitId === t.solicitanteUnitId;

    let statusPill = '';
    let statusDescricaoBox = '';

    if (t.status === 'PENDENTE') {
      statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">PENDENTE DE RESPOSTA</span>`;
    } else if (t.status === 'CONFIRMADA' || t.status === 'APROVADA') {
      statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">TRANSFERÊNCIA CONFIRMADA</span>`;
    } else if (t.status === 'ENVIADA') {
      if (isRemetente && !isSolicitante) {
        statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-600/30 text-slate-300 border border-slate-500/30">FINALIZADA (ENVIADA)</span>`;
        statusDescricaoBox = `
          <div class="p-2.5 bg-[#121915] border border-gray-500/30 rounded-xl text-xs text-gray-300 flex items-center gap-2">
            <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i>
            <span>Solicitação finalizada pelo remetente e saldo baixado do estoque. Aguardando confirmação de recebimento no destino (<strong>${t.solicitanteUnitNome}</strong>).</span>
          </div>`;
      } else if (isSolicitante && !isRemetente) {
        statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">PENDENTE DE RECEBIMENTO</span>`;
        statusDescricaoBox = `
          <div class="p-2.5 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
            <i data-lucide="truck" class="w-4 h-4 text-amber-400 flex-shrink-0 animate-bounce"></i>
            <span>Material em trânsito com o motorista <strong>${t.dadosEnvio?.motorista || 'Designado'}</strong>. Confirme o recebimento assim que for descarregado na sua unidade.</span>
          </div>`;
      } else {
        statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse">PENDENTE DE RECEBIMENTO (EM TRÂNSITO)</span>`;
      }
    } else if (t.status === 'ARQUIVADA' || t.status === 'RECEBIDA') {
      statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">TRANSFERÊNCIA ARQUIVADA</span>`;
      statusDescricaoBox = `
        <div class="p-2.5 bg-purple-950/20 border border-purple-500/30 rounded-xl text-xs text-purple-300 flex items-center gap-2">
          <i data-lucide="archive" class="w-4 h-4 text-purple-400 flex-shrink-0"></i>
          <span>Transferência arquivada e concluída. Saldo somado ao estoque de <strong>${t.solicitanteUnitNome}</strong> em ${t.dadosRecebimento?.dataRecebimento || '-'}.</span>
        </div>`;
    } else if (t.status === 'REJEITADA') {
      statusPill = `<span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">REJEITADA</span>`;
    }

    // Regras de botões de ação:
    // 1. Responder: enquanto PENDENTE
    const canResponder = (isRemetente || isGestorOuAdmin) && t.status === 'PENDENTE';
    // 2. Enviar: após confirmada a resposta, o botão muda para Confirmar Envio!
    const canEnviar = (isRemetente || isGestorOuAdmin) && (t.status === 'CONFIRMADA' || t.status === 'APROVADA');
    // 3. Receber: quando ENVIADA, o destinatário (ou gestor/admin) pode confirmar recebimento
    const canReceber = (isSolicitante || isGestorOuAdmin) && t.status === 'ENVIADA';

    const docsHtml = (t.documentos || []).map(d => `
      <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#16211b] border border-[#233229] text-[11px] text-gray-300">
        <i data-lucide="file-check" class="w-3.5 h-3.5 text-blue-400"></i>
        <strong>${d.tipo}:</strong> ${d.nome}
      </span>
    `).join('') || '<span class="text-xs text-gray-500">Nenhum documento anexado.</span>';

    return `
      <div class="bg-[#0e1411] border border-[#1b2520] rounded-2xl p-5 space-y-4 shadow-xl">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-white text-sm">${t.numero}</span>
              ${statusPill}
              ${countdownBadge}
            </div>
            <div class="text-xs text-gray-300 mt-1">
              De: <span class="text-white font-semibold">${t.remetenteUnitNome}</span> 
              ➔ Para: <span class="text-white font-semibold">${t.solicitanteUnitNome}</span>
            </div>
          </div>
          <div class="text-[11px] text-gray-400">Criado em: ${t.dataCriacao}</div>
        </div>

        <div class="grid grid-cols-3 gap-2 p-3 bg-[#121915] rounded-xl border border-[#1a251f] text-xs">
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Material</div>
            <div class="font-bold text-emerald-400">${t.material}</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Volume Solicitado</div>
            <div class="font-bold text-white">${t.volumeSolicitado} ${t.unidadeMedida}</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Data Necessidade</div>
            <div class="text-gray-300">${t.dataNecessidade}</div>
          </div>
        </div>

        ${t.status === 'CONFIRMADA' || t.status === 'APROVADA' || t.status === 'ENVIADA' || t.status === 'ARQUIVADA' || t.status === 'RECEBIDA' ? `
          <div class="p-3 bg-[#131d18] border border-emerald-500/20 rounded-xl text-xs space-y-1 text-gray-300">
            <div>Volume Aprovado: <strong class="text-emerald-400">${t.volumeAprovado} ${t.unidadeMedida}</strong></div>
            <div>Previsão de Envio: <strong class="text-white">${t.dataPrevisaoEnvio}</strong></div>
            ${t.dadosEnvio ? `
              <div class="pt-1 mt-1 border-t border-[#1e2e25] text-gray-400">
                Transporte: Motorista <strong class="text-gray-200">${t.dadosEnvio.motorista}</strong> ${t.dadosEnvio.numeroNF ? `• NF: <strong class="text-gray-200">${t.dadosEnvio.numeroNF}</strong>` : ''} em ${t.dadosEnvio.dataEnvio}
              </div>
            ` : ''}
            ${t.dadosRecebimento ? `
              <div class="text-emerald-400 font-semibold pt-1 border-t border-[#1e2e25]">
                ✓ Recebido por ${t.dadosRecebimento.recebidoPor} em ${t.dadosRecebimento.dataRecebimento}
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${statusDescricaoBox}

        ${t.status === 'REJEITADA' ? `
          <div class="p-3 bg-red-950/20 border border-red-500/30 rounded-xl text-xs text-red-300">
            <strong>Justificativa da Rejeição:</strong> ${t.justificativaRejeicao}
          </div>
        ` : ''}

        <!-- Botões de Ação do Fluxo -->
        <div class="pt-2 border-t border-[#17201b] flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${canResponder ? `
              <button onclick="abrirModalRespostaSol('${t.id}')" class="px-3.5 py-1.5 bg-blue-500 hover:bg-blue-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
                <i data-lucide="check-square" class="w-3.5 h-3.5"></i> Confirmar Resposta
              </button>
            ` : ''}

            ${canEnviar ? `
              <button onclick="abrirModalEnvioInsumo('${t.id}')" class="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
                <i data-lucide="truck" class="w-3.5 h-3.5"></i> Confirmar Envio
              </button>
            ` : ''}

            ${canReceber ? `
              <button onclick="confirmarRecebimentoInsumo('${t.id}')" class="px-4 py-2 bg-purple-500 hover:bg-purple-400 text-white font-extrabold rounded-xl text-xs flex items-center gap-2 shadow-lg animate-pulse">
                <i data-lucide="package-check" class="w-4 h-4"></i> Confirmar Recebimento
              </button>
            ` : ''}
          </div>

          <button onclick="openDocInsumoModal('${t.id}')" class="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1">
            <i data-lucide="paperclip" class="w-3.5 h-3.5"></i> Anexar NF / Doc
          </button>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">${docsHtml}</div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// -------------------------------------------------------------
// FLUXO DE SOLICITAÇÃO & MODAIS DE INSUMOS
// -------------------------------------------------------------
function openNovaSolicitacaoInsumoModal() {
  const optRemetentes = allUnits.map(u => `<option value="${u.id}">${u.name} (${u.type || 'Geral'})</option>`).join('');
  document.getElementById('solRemetente').innerHTML = optRemetentes;

  const optDestinos = allUnits.map(u => `<option value="${u.id}" ${u.id === currentUser.unitId ? 'selected' : ''}>${u.name}</option>`).join('');
  document.getElementById('solDestino').innerHTML = optDestinos;

  document.getElementById('solVolume').value = '';
  document.getElementById('solDataNecessidade').value = '';

  if (allUnits.length > 0) {
    handleRemetenteChanged(allUnits[0].id);
  }

  document.getElementById('solInsumoModal').classList.remove('hidden');
}

function closeNovaSolicitacaoInsumoModal() {
  document.getElementById('solInsumoModal').classList.add('hidden');
}

function handleRemetenteChanged(remetenteUnitId) {
  // Filtrar estoques disponíveis na unidade remetente selecionada
  const estoquesRemetente = allEstoques.filter(e => e.unitId === remetenteUnitId);
  const selectMaterial = document.getElementById('solMaterialSelect');

  if (estoquesRemetente.length === 0) {
    selectMaterial.innerHTML = `<option value="">Nenhum estoque cadastrado no remetente</option>`;
    document.getElementById('saldoRemetenteInfo').textContent = '0 disponível';
    document.getElementById('solMedida').value = '';
    return;
  }

  selectMaterial.innerHTML = estoquesRemetente.map(e => 
    `<option value="${e.item}" data-qtd="${e.quantidade}" data-medida="${e.unidadeMedida}">${e.item} (${e.quantidade} ${e.unidadeMedida})</option>`
  ).join('');

  handleMaterialSelected(selectMaterial.value);
}

function handleMaterialSelected(materialName) {
  const select = document.getElementById('solMaterialSelect');
  const opt = select.selectedOptions[0];
  if (!opt) return;

  const qtd = opt.getAttribute('data-qtd') || '0';
  const medida = opt.getAttribute('data-medida') || 'Un';

  document.getElementById('saldoRemetenteInfo').textContent = `${Number(qtd).toLocaleString('pt-BR')} ${medida}`;
  document.getElementById('solMedida').value = medida;
}

async function handleSalvarSolInsumo(e) {
  e.preventDefault();
  const remetenteUnitId = document.getElementById('solRemetente').value;
  const solicitanteUnitId = document.getElementById('solDestino').value;
  const material = document.getElementById('solMaterialSelect').value;
  const volumeSolicitado = document.getElementById('solVolume').value;
  const unidadeMedida = document.getElementById('solMedida').value;
  const dataNecessidade = document.getElementById('solDataNecessidade').value;

  if (remetenteUnitId === solicitanteUnitId) {
    alert('A unidade solicitante deve ser diferente da unidade remetente.');
    return;
  }

  try {
    const res = await fetch('/api/transferencias-insumos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        solicitanteUnitId,
        remetenteUnitId,
        material,
        volumeSolicitado,
        unidadeMedida,
        dataNecessidade,
        usuarioId: currentUser.id,
        usuarioNome: currentUser.name,
        usuarioRole: currentUser.role,
        usuarioUnitId: currentUser.unitId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao enviar solicitação.');
      return;
    }

    closeNovaSolicitacaoInsumoModal();
    loadTransferenciasInsumosData();
    alert(`Solicitação ${data.numero} enviada com sucesso! A unidade remetente foi notificada.`);
  } catch (err) {
    alert('Erro de conexão ao enviar solicitação.');
  }
}

// Abrir modal de resposta (Aceitar / Rejeitar)
function abrirModalRespostaSol(id) {
  const sol = allTransferenciasInsumos.find(t => t.id === id);
  if (!sol) return;

  document.getElementById('respSolId').value = sol.id;
  document.getElementById('respDecisao').value = 'ACEITAR';
  handleDecisaoChanged('ACEITAR');

  document.getElementById('responderSolDetalhes').innerHTML = `
    <div><strong>${sol.numero}</strong> • Solicitado por: <strong>${sol.solicitanteUnitNome}</strong></div>
    <div>Material: <strong class="text-emerald-400">${sol.material}</strong></div>
    <div>Volume Solicitado: <strong>${sol.volumeSolicitado} ${sol.unidadeMedida}</strong></div>
    <div>Data da Necessidade: <strong>${sol.dataNecessidade}</strong></div>
  `;

  document.getElementById('respVolumeAprovado').value = sol.volumeSolicitado;
  document.getElementById('respDataEnvio').value = sol.dataNecessidade;
  document.getElementById('respJustificativa').value = '';

  document.getElementById('responderSolModal').classList.remove('hidden');
}

function closeResponderSolModal() {
  document.getElementById('responderSolModal').classList.add('hidden');
}

function handleDecisaoChanged(decisao) {
  const camposAceite = document.getElementById('camposAceite');
  const camposRejeicao = document.getElementById('camposRejeicao');

  if (decisao === 'ACEITAR') {
    camposAceite.classList.remove('hidden');
    camposRejeicao.classList.add('hidden');
  } else {
    camposAceite.classList.add('hidden');
    camposRejeicao.classList.remove('hidden');
  }
}

async function handleSalvarRespostaSol(e) {
  e.preventDefault();
  const id = document.getElementById('respSolId').value;
  const decisao = document.getElementById('respDecisao').value;
  const volumeAprovado = document.getElementById('respVolumeAprovado').value;
  const dataPrevisaoEnvio = document.getElementById('respDataEnvio').value;
  const justificativaRejeicao = document.getElementById('respJustificativa').value;

  const sol = allTransferenciasInsumos.find(t => t.id === id);
  const decisaoTexto = decisao === 'ACEITAR' ? 'CONFIRMAR A TRANSFERÊNCIA' : 'REJEITAR A SOLICITAÇÃO';
  if (!confirm(`CONFIRMAÇÃO DE RESPOSTA:\n\nDeseja realmente ${decisaoTexto} do insumo "${sol ? sol.material : ''}" para ${sol ? sol.solicitanteUnitNome : 'o destinatário'}?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/transferencias-insumos/${id}/responder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisao,
        volumeAprovado,
        dataPrevisaoEnvio,
        justificativaRejeicao,
        usuarioId: currentUser.id,
        usuarioNome: currentUser.name,
        usuarioRole: currentUser.role,
        usuarioUnitId: currentUser.unitId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao responder solicitação.');
      return;
    }

    closeResponderSolModal();
    loadTransferenciasInsumosData();
    if (decisao === 'ACEITAR') {
      alert(`Transferência confirmada com sucesso! O status foi alterado para 'TRANSFERÊNCIA CONFIRMADA' e o botão agora permite 'Confirmar Envio'.`);
    } else {
      alert(`Solicitação rejeitada com sucesso.`);
    }
  } catch (err) {
    alert('Erro de conexão ao salvar resposta.');
  }
}

// Abrir modal de envio de insumo (Remetente)
function abrirModalEnvioInsumo(id) {
  document.getElementById('envioSolId').value = id;
  document.getElementById('envioMotorista').value = '';
  document.getElementById('envioNumeroNF').value = '';
  document.getElementById('enviarInsumoModal').classList.remove('hidden');
}

function closeEnviarInsumoModal() {
  document.getElementById('enviarInsumoModal').classList.add('hidden');
}

async function handleSalvarEnvioInsumo(e) {
  e.preventDefault();
  const id = document.getElementById('envioSolId').value;
  const motorista = document.getElementById('envioMotorista').value;
  const numeroNF = document.getElementById('envioNumeroNF').value;

  const sol = allTransferenciasInsumos.find(t => t.id === id);
  const volume = sol ? (sol.volumeAprovado || sol.volumeSolicitado) : '';
  const mat = sol ? sol.material : '';
  const unMed = sol ? sol.unidadeMedida : '';
  const remNome = sol ? sol.remetenteUnitNome : '';
  const destNome = sol ? sol.solicitanteUnitNome : '';

  const confirmar = confirm(
    `CONFIRMAÇÃO DE ENVIO E BAIXA NO ESTOQUE:\n\n` +
    `Deseja confirmar o envio de ${volume} ${unMed} de "${mat}"?\n\n` +
    `• De: ${remNome} ➔ Para: ${destNome}\n` +
    `• Motorista: ${motorista}\n` +
    `• NF: ${numeroNF || 'Não informada'}\n\n` +
    `ATENÇÃO: O saldo de ${volume} ${unMed} será BAIXADO IMEDIATAMENTE do estoque da sua unidade. A solicitação ficará como FINALIZADA para você e PENDENTE DE RECEBIMENTO para o destinatário.\n\n` +
    `Clique em 'OK' para confirmar o envio.`
  );
  if (!confirmar) return;

  try {
    const res = await fetch(`/api/transferencias-insumos/${id}/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        motorista,
        numeroNF,
        usuarioUnitId: currentUser.unitId,
        usuarioRole: currentUser.role,
        usuarioNome: currentUser.name
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao confirmar envio.');
      return;
    }

    closeEnviarInsumoModal();
    loadTransferenciasInsumosData();
    alert(`Envio confirmado com sucesso! O saldo foi baixado do seu estoque. Para você, a solicitação aparece como finalizada e, para o destinatário (${destNome}), como pendente de recebimento.`);
  } catch (err) {
    alert('Erro ao enviar material.');
  }
}

// Confirmar recebimento de insumo (Solicitante)
async function confirmarRecebimentoInsumo(id) {
  const sol = allTransferenciasInsumos.find(t => t.id === id);
  const volume = sol ? (sol.volumeAprovado || sol.volumeSolicitado) : '';
  const mat = sol ? sol.material : '';
  const unMed = sol ? sol.unidadeMedida : '';
  const destNome = sol ? sol.solicitanteUnitNome : 'sua unidade';

  const confirmar = confirm(
    `CONFIRMAÇÃO DE RECEBIMENTO E ENTRADA NO ESTOQUE:\n\n` +
    `Confirma o recebimento e conferência de ${volume} ${unMed} de "${mat}" na unidade "${destNome}"?\n\n` +
    `• O saldo será AUTOMATICAMENTE SOMADO ao estoque da sua unidade.\n` +
    `• A transferência será ARQUIVADA e ficará disponível no histórico e no Dashboard.\n\n` +
    `Clique em 'OK' para confirmar o recebimento.`
  );
  if (!confirmar) return;

  try {
    const res = await fetch(`/api/transferencias-insumos/${id}/receber`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuarioUnitId: currentUser.unitId,
        usuarioRole: currentUser.role,
        usuarioNome: currentUser.name
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao confirmar recebimento.');
      return;
    }

    loadTransferenciasInsumosData();
    alert(data.message || `Recebimento confirmado! Saldo incorporado ao estoque e transferência arquivada com sucesso.`);
  } catch (err) {
    alert('Erro ao confirmar recebimento.');
  }
}

// Anexo de Documentos (NF / Comprovantes) na Transferência de Insumos
function openDocInsumoModal(id) {
  document.getElementById('modalDocInsumoId').value = id;
  document.getElementById('docInsumoFile').value = '';
  document.getElementById('docInsumoModal').classList.remove('hidden');
}

function closeDocInsumoModal() {
  document.getElementById('docInsumoModal').classList.add('hidden');
}

async function handleSalvarDocInsumo(e) {
  e.preventDefault();
  const id = document.getElementById('modalDocInsumoId').value;
  const tipoDoc = document.getElementById('docInsumoTipo').value;
  const file = document.getElementById('docInsumoFile').files[0];

  if (!file) return;

  const formData = new FormData();
  formData.append('documento', file);
  formData.append('tipoDoc', tipoDoc);
  formData.append('usuarioNome', currentUser.name);

  try {
    const res = await fetch(`/api/transferencias-insumos/${id}/documentos`, {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      closeDocInsumoModal();
      loadTransferenciasInsumosData();
      alert('Documento anexado com sucesso à transferência!');
    }
  } catch (err) {
    alert('Erro ao anexar documento.');
  }
}
async function loadEmbarquesData() {
  try {
    const [resEmb, resUnits] = await Promise.all([
      fetch('/api/embarques'),
      fetch('/api/units')
    ]);
    allEmbarques = await resEmb.json();
    allUnits = await resUnits.json();

    // Controle de exibição do botão novo embarque:
    // Apenas supervisor da unidade, gestor ou admin podem programar
    const canCreate = currentUser.role === 'admin' || currentUser.role === 'gestor' || currentUser.role === 'supervisor';
    const btnNovo = document.getElementById('btnNovoEmbarque');
    if (btnNovo) {
      if (canCreate) btnNovo.classList.remove('hidden');
      else btnNovo.classList.add('hidden');
    }

    renderEmbarquesList();
  } catch (err) {
    console.error(err);
  }
}

function renderEmbarquesList() {
  const container = document.getElementById('embarquesCardsList');
  if (!container) return;

  if (allEmbarques.length === 0) {
    container.innerHTML = `<div class="col-span-2 py-12 text-center text-gray-500 text-xs">Nenhum embarque programado no momento.</div>`;
    return;
  }

  container.innerHTML = allEmbarques.map(emb => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dataEmb = new Date(emb.dataEmbarque + 'T00:00:00');
    const diffDays = Math.ceil((dataEmb.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

    let countdownHtml = '';
    if (emb.status === 'CANCELADO') {
      countdownHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">CANCELADO</span>`;
    } else if (emb.status === 'CONCLUIDO') {
      countdownHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">CONCLUÍDO</span>`;
    } else if (diffDays > 0) {
      countdownHtml = `<span class="px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold rounded-lg text-xs">Faltam ${diffDays} dias</span>`;
    } else if (diffDays === 0) {
      countdownHtml = `<span class="px-2.5 py-1 bg-red-500 text-white font-extrabold rounded-lg text-xs animate-pulse">HOJE!</span>`;
    } else {
      countdownHtml = `<span class="px-2 py-0.5 bg-red-950/60 text-red-400 border border-red-500/30 rounded text-xs font-bold">Atrasado</span>`;
    }

    // Apenas quem programou ou Gestor/Admin pode editar
    const canEdit = currentUser.role === 'admin' || currentUser.role === 'gestor' || emb.criadoPorUserId === currentUser.id;

    // Documentos anexados
    const docsHtml = (emb.documentos || []).map(d => `
      <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#16211b] border border-[#233229] text-[11px] text-gray-300">
        <i data-lucide="file-check" class="w-3.5 h-3.5 text-emerald-400"></i>
        <strong>${d.tipo}:</strong> ${d.nome}
      </span>
    `).join('') || '<span class="text-xs text-gray-500">Nenhum documento anexado ainda.</span>';

    return `
      <div class="bg-[#0e1411] border border-[#1b2520] rounded-2xl p-5 space-y-4 shadow-xl">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-white">${emb.origemUnidadeNome} ➔ ${emb.destinoUnidadeNome}</span>
              ${countdownHtml}
            </div>
            <div class="text-xs text-gray-400 mt-1">Data Agendada: <strong class="text-white">${emb.dataEmbarque}</strong></div>
          </div>
          
          ${canEdit ? `
            <div class="flex items-center gap-1">
              <button onclick="editarEmbarque('${emb.id}')" class="p-1.5 text-gray-400 hover:text-emerald-400" title="Editar Programação">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button onclick="alterarStatusEmbarque('${emb.id}', 'CANCELADO')" class="p-1.5 text-gray-400 hover:text-red-400" title="Cancelar Embarque">
                <i data-lucide="x-circle" class="w-4 h-4"></i>
              </button>
            </div>
          ` : ''}
        </div>

        <div class="grid grid-cols-3 gap-2 p-3 bg-[#121915] rounded-xl border border-[#1a251f] text-xs">
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Carga</div>
            <div class="font-bold text-emerald-400">${emb.qtdCabecas} cab (${emb.tipoCarga || 'Gado'})</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Categoria</div>
            <div class="text-gray-200">${emb.categoria || '-'}</div>
          </div>
          <div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">Programado Por</div>
            <div class="text-gray-300 truncate">${emb.criadoPorNome || 'Sistema'}</div>
          </div>
        </div>

        ${emb.observacoes ? `<div class="text-xs text-gray-400 italic bg-[#101613] p-2.5 rounded-lg border border-[#19221c]">${emb.observacoes}</div>` : ''}

        <!-- Seção de Documentos (Todos os envolvidos podem anexar) -->
        <div class="pt-2 border-t border-[#17201b]">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Documentos (NF / GTA)</span>
            <button onclick="openDocModal('${emb.id}')" class="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1">
              <i data-lucide="upload" class="w-3.5 h-3.5"></i> Anexar NF / GTA
            </button>
          </div>
          <div class="flex flex-wrap gap-2">${docsHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function openNovoEmbarqueModal() {
  document.getElementById('modalEmbarqueId').value = '';
  document.getElementById('embData').value = '';
  document.getElementById('embQtd').value = '';
  document.getElementById('embCategoria').value = 'Boi Inteiro';
  document.getElementById('embObs').value = '';

  // Preencher selects com unidades
  const optHtml = allUnits.map(u => `<option value="${u.id}">${u.name} (${u.type || 'Unidade'})</option>`).join('');
  document.getElementById('embOrigem').innerHTML = optHtml;
  document.getElementById('embDestino').innerHTML = optHtml;

  // Se for supervisor, pré-seleciona a unidade dele como origem
  if (currentUser.unitId) {
    document.getElementById('embOrigem').value = currentUser.unitId;
  }

  document.getElementById('embarqueModal').classList.remove('hidden');
}

function closeNovoEmbarqueModal() {
  document.getElementById('embarqueModal').classList.add('hidden');
}

async function handleSalvarEmbarque(e) {
  e.preventDefault();
  const id = document.getElementById('modalEmbarqueId').value;
  const dataEmbarque = document.getElementById('embData').value;
  const tipoCarga = document.getElementById('embTipoCarga').value;
  const origemUnidadeId = document.getElementById('embOrigem').value;
  const destinoUnidadeId = document.getElementById('embDestino').value;
  const qtdCabecas = document.getElementById('embQtd').value;
  const categoria = document.getElementById('embCategoria').value;
  const observacoes = document.getElementById('embObs').value;

  if (origemUnidadeId === destinoUnidadeId) {
    alert('A unidade de origem e de destino devem ser diferentes.');
    return;
  }

  if (id) {
    const conf = confirm(`CONFIRMAÇÃO DE EDIÇÃO DE EMBARQUE:\n\nDeseja realmente salvar as alterações nesta programação de embarque de ${qtdCabecas} cabeças?`);
    if (!conf) return;
  }

  const payload = {
    dataEmbarque,
    tipoCarga,
    origemUnidadeId,
    destinoUnidadeId,
    qtdCabecas,
    categoria,
    observacoes,
    usuarioId: currentUser.id,
    usuarioNome: currentUser.name,
    usuarioRole: currentUser.role,
    usuarioUnitId: currentUser.unitId
  };

  try {
    const endpoint = id ? `/api/embarques/${id}` : '/api/embarques';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao programar embarque.');
      return;
    }

    closeNovoEmbarqueModal();
    loadEmbarquesData();
    alert(id ? 'Programação de embarque atualizada com sucesso!' : 'Programação de embarque criada com sucesso!');
  } catch (err) {
    alert('Erro de conexão com o servidor.');
  }
}

async function alterarStatusEmbarque(id, status) {
  if (!confirm(`Deseja alterar o status deste embarque para ${status}?`)) return;
  try {
    const res = await fetch(`/api/embarques/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        usuarioId: currentUser.id,
        usuarioRole: currentUser.role
      })
    });
    if (res.ok) loadEmbarquesData();
  } catch (e) {
    alert('Erro ao atualizar status.');
  }
}

function openDocModal(embId) {
  document.getElementById('modalDocEmbarqueId').value = embId;
  document.getElementById('docFileInput').value = '';
  document.getElementById('docModal').classList.remove('hidden');
}

function closeDocModal() {
  document.getElementById('docModal').classList.add('hidden');
}

async function handleSalvarDoc(e) {
  e.preventDefault();
  const embId = document.getElementById('modalDocEmbarqueId').value;
  const tipoDoc = document.getElementById('docTipo').value;
  const file = document.getElementById('docFileInput').files[0];

  if (!file) return;

  const formData = new FormData();
  formData.append('documento', file);
  formData.append('tipoDoc', tipoDoc);
  formData.append('usuarioNome', currentUser.name);

  try {
    const res = await fetch(`/api/embarques/${embId}/documentos`, {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      closeDocModal();
      loadEmbarquesData();
      alert('Documento anexado com sucesso ao embarque!');
    }
  } catch (err) {
    alert('Erro ao anexar documento.');
  }
}

// -------------------------------------------------------------
// VIEW 4: GESTÃO DE ESTOQUES (Gado e Suprimentos)
// -------------------------------------------------------------
async function loadEstoquesData() {
  try {
    const [resEst, resUnits] = await Promise.all([
      fetch('/api/estoques'),
      fetch('/api/units')
    ]);
    allEstoques = await resEst.json();
    allUnits = await resUnits.json();

    // Apenas Admin pode criar estoque
    const btnCriarEst = document.getElementById('btnCriarEstoqueAdmin');
    if (btnCriarEst) {
      if (currentUser.role === 'admin') btnCriarEst.classList.remove('hidden');
      else btnCriarEst.classList.add('hidden');
    }

    renderEstoquesList();
  } catch (err) {
    console.error(err);
  }
}

function renderEstoquesList() {
  const container = document.getElementById('estoquesList');
  if (!container) return;

  if (allEstoques.length === 0) {
    container.innerHTML = `<div class="col-span-3 py-12 text-center text-gray-500 text-xs">Nenhum estoque cadastrado.</div>`;
    return;
  }

  const isAdmin = currentUser.role === 'admin';

  container.innerHTML = allEstoques.map(est => {
    const unit = allUnits.find(u => u.id === est.unitId);
    const unitName = unit ? unit.name : 'Unidade';

    // Regra: Somente o titular da unidade (supervisor) ou gestor/admin pode movimentar
    const canMove = (currentUser.role === 'supervisor' && currentUser.unitId === est.unitId) ||
                    (currentUser.role === 'admin' || currentUser.role === 'gestor');

    return `
      <div class="bg-[#0e1411] border border-[#1b2520] rounded-2xl p-5 flex flex-col justify-between shadow-xl relative group">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-bold text-white">${est.item}</span>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">${est.tipo}</span>
              ${isAdmin ? `
                <button onclick="editarEstoque('${est.id}')" class="p-1 text-gray-400 hover:text-emerald-400 transition" title="Editar Informações do Estoque (Admin)">
                  <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                </button>
                <button onclick="excluirEstoque('${est.id}')" class="p-1 text-gray-400 hover:text-red-400 transition" title="Excluir Estoque (Admin)">
                  <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="text-[11px] text-gray-400">Unidade: <strong class="text-emerald-400">${unitName}</strong></div>

          <div class="mt-4 p-3.5 bg-[#121915] rounded-xl border border-[#1c2721] flex items-center justify-between">
            <div>
              <div class="text-[10px] text-gray-500 font-bold uppercase">Saldo Atual</div>
              <div class="text-xl font-black text-white">${Number(est.quantidade).toLocaleString('pt-BR')} <span class="text-xs font-normal text-gray-400">${est.unidadeMedida}</span></div>
            </div>
            <div class="text-right text-[11px] text-gray-400 space-y-0.5">
              <div>Mín: <strong class="text-amber-400">${est.minimo || 0}</strong> ${est.unidadeMedida}</div>
              <div>Máx: <strong class="text-blue-400">${est.maximo || '-'}</strong> ${est.unidadeMedida}</div>
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-[#17201b] flex items-center justify-between">
          ${canMove ? `
            <div class="flex items-center gap-2 w-full">
              <button onclick="movimentarEstoque('${est.id}', 'ENTRADA')" class="flex-1 py-1.5 px-3 bg-[#16211b] hover:bg-[#1d2a23] text-emerald-400 font-bold rounded-xl text-xs flex items-center justify-center gap-1 border border-emerald-500/20">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Entrada
              </button>
              <button onclick="movimentarEstoque('${est.id}', 'SAIDA')" class="flex-1 py-1.5 px-3 bg-[#211616] hover:bg-[#2b1d1d] text-red-400 font-bold rounded-xl text-xs flex items-center justify-center gap-1 border border-red-500/20">
                <i data-lucide="minus" class="w-3.5 h-3.5"></i> Saída
              </button>
            </div>
          ` : `
            <span class="text-[11px] text-gray-500 italic">Movimentação restrita ao Titular da Unidade.</span>
          `}
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function openCriarEstoqueModal() {
  document.getElementById('estModalId').value = '';
  document.getElementById('estoqueModalTitle').textContent = 'Criar Estoque na Unidade (Admin)';
  document.getElementById('estModalItem').value = '';
  document.getElementById('estModalTipo').value = 'Suprimento';
  document.getElementById('estModalQtd').value = '';
  document.getElementById('estModalMedida').value = '';
  document.getElementById('estModalMinimo').value = '';
  document.getElementById('estModalMaximo').value = '';
  document.getElementById('estModalUnit').innerHTML = allUnits.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  document.getElementById('criarEstoqueModal').classList.remove('hidden');
}

function editarEstoque(id) {
  const est = allEstoques.find(e => e.id === id);
  if (!est) return;

  document.getElementById('estModalId').value = est.id;
  document.getElementById('estoqueModalTitle').textContent = 'Editar Informações do Estoque (Admin)';
  document.getElementById('estModalItem').value = est.item || '';
  document.getElementById('estModalTipo').value = est.tipo || 'Suprimento';
  document.getElementById('estModalQtd').value = est.quantidade !== undefined ? est.quantidade : 0;
  document.getElementById('estModalMedida').value = est.unidadeMedida || '';
  document.getElementById('estModalMinimo').value = est.minimo !== undefined ? est.minimo : 0;
  document.getElementById('estModalMaximo').value = est.maximo !== undefined ? est.maximo : 0;
  
  document.getElementById('estModalUnit').innerHTML = allUnits.map(u => 
    `<option value="${u.id}" ${u.id === est.unitId ? 'selected' : ''}>${u.name}</option>`
  ).join('');

  document.getElementById('criarEstoqueModal').classList.remove('hidden');
}

function closeCriarEstoqueModal() {
  document.getElementById('criarEstoqueModal').classList.add('hidden');
}

async function handleSalvarEstoque(e) {
  e.preventDefault();
  const id = document.getElementById('estModalId').value;
  const unitId = document.getElementById('estModalUnit').value;
  const item = document.getElementById('estModalItem').value;
  const tipo = document.getElementById('estModalTipo').value;
  const quantidade = document.getElementById('estModalQtd').value;
  const unidadeMedida = document.getElementById('estModalMedida').value;
  const minimo = document.getElementById('estModalMinimo').value;
  const maximo = document.getElementById('estModalMaximo').value;

  if (id) {
    const estAtual = allEstoques.find(e => e.id === id);
    const un = allUnits.find(u => u.id === unitId);
    const conf = confirm(
      `CONFIRMAÇÃO DE EDIÇÃO DE ESTOQUE:\n\n` +
      `Deseja realmente salvar as alterações no estoque de "${estAtual ? estAtual.item : item}"?\n\n` +
      `• Item: ${item}\n` +
      `• Unidade: ${un ? un.name : '-'}\n` +
      `• Quantidade: ${quantidade} ${unidadeMedida}\n` +
      `• Mínimo: ${minimo} | Máximo: ${maximo}\n\n` +
      `Clique em 'OK' para confirmar a alteração ou 'Cancelar' para desistir.`
    );
    if (!conf) return;
  }

  const endpoint = id ? `/api/estoques/${id}` : '/api/estoques';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unitId,
        item,
        tipo,
        quantidade,
        unidadeMedida,
        minimo,
        maximo,
        usuarioRole: currentUser.role
      })
    });
    if (res.ok) {
      closeCriarEstoqueModal();
      loadEstoquesData();
      alert(id ? 'Informações do estoque atualizadas com sucesso!' : 'Novo estoque cadastrado com sucesso!');
    } else {
      const err = await res.json();
      alert(err.error || 'Erro ao salvar estoque.');
    }
  } catch (err) {
    alert('Erro ao salvar estoque.');
  }
}

async function excluirEstoque(id) {
  const est = allEstoques.find(e => e.id === id);
  const un = allUnits.find(u => u.id === (est ? est.unitId : ''));
  const conf = confirm(
    `ATENÇÃO - CONFIRMAÇÃO DE EXCLUSÃO DE ESTOQUE:\n\n` +
    `Tem certeza de que deseja EXCLUIR permanentemente o cadastro de estoque de "${est ? est.item : 'este item'}"${un ? ' da unidade ' + un.name : ''}?\n\n` +
    `Esta ação removerá o controle deste insumo e não poderá ser desfeita.\n\n` +
    `Clique em 'OK' para excluir ou 'Cancelar' para manter o estoque.`
  );
  if (!conf) return;

  try {
    const res = await fetch(`/api/estoques/${id}?usuarioRole=${currentUser.role}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      loadEstoquesData();
      alert('Estoque removido com sucesso!');
    }
  } catch (e) {
    alert('Erro ao excluir estoque.');
  }
}

async function movimentarEstoque(id, tipoMovimento) {
  const est = allEstoques.find(e => e.id === id);
  if (!est) return;

  const qtdStr = prompt(`Informe a quantidade para ${tipoMovimento === 'ENTRADA' ? 'dar ENTRADA no' : 'dar SAÍDA do'} estoque de "${est.item}":`);
  if (!qtdStr || isNaN(qtdStr) || Number(qtdStr) <= 0) return;

  const qtd = Number(qtdStr);
  const conf = confirm(
    `CONFIRMAÇÃO DE MOVIMENTAÇÃO DE ESTOQUE:\n\n` +
    `Confirma a ${tipoMovimento === 'ENTRADA' ? 'ENTRADA' : 'SAÍDA'} de ${qtd} ${est.unidadeMedida} no estoque de "${est.item}"?\n\n` +
    `• Saldo Atual: ${est.quantidade} ${est.unidadeMedida}\n` +
    `• Novo Saldo Previsto: ${tipoMovimento === 'ENTRADA' ? (est.quantidade + qtd) : (est.quantidade - qtd)} ${est.unidadeMedida}\n\n` +
    `Clique em 'OK' para confirmar.`
  );
  if (!conf) return;

  try {
    const res = await fetch(`/api/estoques/${id}/movimentar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipoMovimento,
        quantidade: qtd,
        usuarioUnitId: currentUser.unitId,
        usuarioRole: currentUser.role,
        usuarioNome: currentUser.name
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao movimentar estoque.');
      return;
    }
    loadEstoquesData();
    alert(`Movimentação de ${tipoMovimento} registrada com sucesso no estoque de "${est.item}"!`);
  } catch (err) {
    alert('Erro ao movimentar estoque.');
  }
}

// -------------------------------------------------------------
// MODAL: ATUALIZAR RELATÓRIO DENTRO DO REBANHO
// -------------------------------------------------------------
function openAtualizarRelatorioModal() {
  document.getElementById('modalFileRelatorioInput').value = '';
  document.getElementById('modalPreviewArea').classList.add('hidden');
  document.getElementById('modalUploadArea').classList.remove('hidden');
  document.getElementById('modalConfirmImportBtn').disabled = true;
  pendingImportLots = [];
  document.getElementById('atualizarRelatorioModal').classList.remove('hidden');
  lucide.createIcons();
}

function closeAtualizarRelatorioModal() {
  document.getElementById('atualizarRelatorioModal').classList.add('hidden');
  pendingImportLots = [];
}

async function handleModalFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import/preview', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao processar relatório.');
      return;
    }

    pendingImportLots = data.itens.map(item => item.novo);

    document.getElementById('modalPreviewArea').classList.remove('hidden');
    document.getElementById('modalUploadArea').classList.add('hidden');
    document.getElementById('modalPreviewFileName').textContent = data.filename;
    document.getElementById('modalPreviewFileStats').textContent = 
      `${data.totalLotes} lotes identificados • ${Number(data.totalAnimais).toLocaleString('pt-BR')} cabeças no total`;

    const tbody = document.getElementById('modalPreviewTableBody');
    tbody.innerHTML = data.itens.map(item => {
      let statusBadge = item.status === 'NOVO_LOTE'
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400">NOVO</span>`
        : (item.status === 'ALTERADO_QTD'
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400">ALTERADO</span>`
          : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">ATUALIZADO</span>`);

      return `
        <tr class="hover:bg-[#121915] transition-colors">
          <td class="py-1.5 px-2.5">${statusBadge}</td>
          <td class="py-1.5 px-2.5 font-bold text-white">${item.novo.baia}</td>
          <td class="py-1.5 px-2.5 text-emerald-400 font-semibold">${item.novo.lote}</td>
          <td class="py-1.5 px-2.5 text-right font-bold text-white">${Number(item.novo.qtdAnimais).toLocaleString('pt-BR')}</td>
          <td class="py-1.5 px-2.5 text-right text-gray-400">${item.atual ? Number(item.atual.qtdAnimais).toLocaleString('pt-BR') : '-'}</td>
          <td class="py-1.5 px-2.5 text-right font-semibold text-white">${item.novo.pesoEstimadoHoje ? Number(item.novo.pesoEstimadoHoje).toFixed(1) : '-'}</td>
          <td class="py-1.5 px-2.5 text-gray-300 text-xs">${item.novo.dieta || '-'}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('modalConfirmImportBtn').disabled = false;
    lucide.createIcons();
  } catch (err) {
    alert('Falha ao processar arquivo para pré-visualização.');
  }
}

async function confirmModalImport() {
  if (!pendingImportLots || pendingImportLots.length === 0) return;
  const btn = document.getElementById('modalConfirmImportBtn');
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Atualizando rebanho...`;

  try {
    const res = await fetch('/api/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lotes: pendingImportLots })
    });

    if (res.ok) {
      alert('Relatório de rebanho atualizado com sucesso!');
      closeAtualizarRelatorioModal();
      loadRebanhoData();
    } else {
      const err = await res.json();
      alert(err.error || 'Erro ao sincronizar.');
    }
  } catch (err) {
    alert('Erro de conexão ao atualizar relatório.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i> Confirmar Atualização`;
    lucide.createIcons();
  }
}
async function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import/preview', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao processar relatório.');
      return;
    }

    pendingImportLots = data.itens.map(item => item.novo);
    document.getElementById('importPreviewArea').classList.remove('hidden');
    document.getElementById('previewFileName').textContent = `Arquivo: ${data.filename}`;
    document.getElementById('previewFileStats').textContent = 
      `${data.totalLotes} lotes identificados • ${Number(data.totalAnimais).toLocaleString('pt-BR')} cabeças`;

    const tbody = document.getElementById('importPreviewTableBody');
    tbody.innerHTML = data.itens.map(item => {
      let statusBadge = item.status === 'NOVO_LOTE'
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400">NOVO</span>`
        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">ATUALIZADO</span>`;

      return `
        <tr class="hover:bg-[#121915] transition-colors">
          <td class="py-2 px-3">${statusBadge}</td>
          <td class="py-2 px-3 font-bold text-white">${item.novo.baia}</td>
          <td class="py-2 px-3 text-emerald-400">${item.novo.lote}</td>
          <td class="py-2 px-3 text-right font-bold text-white">${item.novo.qtdAnimais}</td>
          <td class="py-2 px-3 text-right text-gray-400">${item.atual ? item.atual.qtdAnimais : '-'}</td>
          <td class="py-2 px-3 text-right">${item.novo.pesoEntrada ? Number(item.novo.pesoEntrada).toFixed(1) : '-'}</td>
          <td class="py-2 px-3 text-right font-semibold text-white">${item.novo.pesoEstimadoHoje ? Number(item.novo.pesoEstimadoHoje).toFixed(1) : '-'}</td>
          <td class="py-2 px-3 text-gray-300 text-xs">${item.novo.dieta || '-'}</td>
          <td class="py-2 px-3 text-gray-400">${item.novo.dataEstimadaEmbarque || '-'}</td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    alert('Falha ao enviar arquivo.');
  }
}

function cancelImport() {
  document.getElementById('importPreviewArea').classList.add('hidden');
  document.getElementById('fileImportInput').value = '';
  pendingImportLots = [];
}

async function confirmImport() {
  if (!pendingImportLots || pendingImportLots.length === 0) return;
  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lotes: pendingImportLots })
    });

    if (res.ok) {
      alert('Relatório importado com sucesso!');
      cancelImport();
      navigateTo('rebanho');
    }
  } catch (err) {
    alert('Erro de conexão ao salvar.');
    btn.disabled = false;
  }
}

// -------------------------------------------------------------
// VIEW 6: DASHBOARD
// -------------------------------------------------------------
async function loadDashboardData() {
  const dtIni = document.getElementById('filterDataInicio').value;
  const dtFim = document.getElementById('filterDataFim').value;
  const tipo = document.getElementById('filterTipo').value;
  const baia = document.getElementById('filterBaia').value;

  const params = new URLSearchParams();
  if (dtIni) params.append('dataInicio', dtIni);
  if (dtFim) params.append('dataFim', dtFim);
  if (tipo) params.append('tipo', tipo);
  if (baia) params.append('baia', baia);

  document.getElementById('exportDashExcelBtn').href = `/api/export/excel?tipo=movimentacoes&${params.toString()}`;

  try {
    const res = await fetch(`/api/dashboard/movimentacoes?${params.toString()}`);
    const data = await res.json();

    document.getElementById('dashKpiCabecas').textContent = Number(data.totalCabecas || 0).toLocaleString('pt-BR');
    document.getElementById('dashKpiRegistros').textContent = Number(data.totalRegistros || 0).toLocaleString('pt-BR');

    let totalEntr = 0;
    let totalSaid = 0;
    Object.keys(data.porTipo || {}).forEach(k => {
      if (k.includes('ENTRADA')) totalEntr += data.porTipo[k];
      else if (k.includes('VENDA') || k.includes('ABATE') || k.includes('SAÍDA')) totalSaid += data.porTipo[k];
    });
    document.getElementById('dashKpiEntradas').textContent = Number(totalEntr).toLocaleString('pt-BR');
    document.getElementById('dashKpiSaidas').textContent = Number(totalSaid).toLocaleString('pt-BR');
    document.getElementById('dashTableInfo').textContent = `${data.totalRegistros} movimentações localizadas`;

    const tbody = document.getElementById('dashTableBody');
    if (data.movimentacoes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="py-8 text-center text-gray-500 text-xs">Nenhum registro encontrado.</td></tr>`;
    } else {
      tbody.innerHTML = data.movimentacoes.slice(0, 100).map(m => `
        <tr class="hover:bg-[#121915] transition-colors border-b border-[#141d18]">
          <td class="py-2.5 px-3 font-semibold text-white">${m.data || '-'}</td>
          <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/10 text-emerald-400">${m.tipo}</span></td>
          <td class="py-2.5 px-3 text-gray-300">${m.baia || ''} ${m.lote ? '('+m.lote+')' : ''}</td>
          <td class="py-2.5 px-3 text-right font-bold text-white">${Number(m.quantidade || 0).toLocaleString('pt-BR')}</td>
          <td class="py-2.5 px-3 text-gray-400">${m.categoria || '-'}</td>
          <td class="py-2.5 px-3 text-right">${m.peso ? Number(m.peso).toFixed(1) : '-'}</td>
          <td class="py-2.5 px-3 text-right text-emerald-400">${m.precoArroba ? 'R$ ' + Number(m.precoArroba).toFixed(2) : '-'}</td>
          <td class="py-2.5 px-3 text-right text-gray-200">${m.valorTotal ? 'R$ ' + Number(m.valorTotal).toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '-'}</td>
          <td class="py-2.5 px-3 text-gray-400">${m.origemDestino || '-'}</td>
          <td class="py-2.5 px-3 text-[11px] text-gray-500 max-w-xs truncate">${m.obs || '-'}</td>
        </tr>
      `).join('');
    }

    renderCharts(data.porTipo, data.evolucaoMensal);

    // Carregar e atualizar Card Específico de Transferência de Insumos no Dashboard
    try {
      const resInsumos = await fetch('/api/transferencias-insumos');
      allTransferenciasInsumos = await resInsumos.json();
      renderDashboardInsumosCard();
    } catch (eInsumo) {
      console.warn('Erro ao atualizar insumos no dash:', eInsumo);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderDashboardInsumosCard() {
  const tbody = document.getElementById('dashInsumosTableBody');
  if (!tbody) return;

  const busca = (document.getElementById('dashInsumosBusca')?.value || '').toLowerCase().trim();
  const filtroStatus = document.getElementById('dashInsumosFiltroStatus')?.value || 'ARQUIVADA';

  // KPIs
  const arquivadasList = allTransferenciasInsumos.filter(t => t.status === 'ARQUIVADA' || t.status === 'RECEBIDA');
  const enviadasList = allTransferenciasInsumos.filter(t => t.status === 'ENVIADA');
  const confirmadasList = allTransferenciasInsumos.filter(t => t.status === 'CONFIRMADA' || t.status === 'APROVADA');

  const totalVolumeArquivado = arquivadasList.reduce((acc, t) => acc + (Number(t.volumeAprovado || t.volumeSolicitado) || 0), 0);

  const kpiArq = document.getElementById('dashKpiTransfArquivadas');
  const kpiVol = document.getElementById('dashKpiVolumeArquivado');
  const kpiPend = document.getElementById('dashKpiTransfPendentes');
  const kpiConf = document.getElementById('dashKpiTransfConfirmadas');

  if (kpiArq) kpiArq.textContent = arquivadasList.length;
  if (kpiVol) kpiVol.textContent = Number(totalVolumeArquivado).toLocaleString('pt-BR');
  if (kpiPend) kpiPend.textContent = enviadasList.length;
  if (kpiConf) kpiConf.textContent = confirmadasList.length;

  let filtradas = allTransferenciasInsumos.slice();

  if (filtroStatus === 'ARQUIVADA') {
    filtradas = filtradas.filter(t => t.status === 'ARQUIVADA' || t.status === 'RECEBIDA');
  } else if (filtroStatus === 'ENVIADA') {
    filtradas = filtradas.filter(t => t.status === 'ENVIADA');
  }

  if (busca) {
    filtradas = filtradas.filter(t => 
      (t.numero && t.numero.toLowerCase().includes(busca)) ||
      (t.material && t.material.toLowerCase().includes(busca)) ||
      (t.remetenteUnitNome && t.remetenteUnitNome.toLowerCase().includes(busca)) ||
      (t.solicitanteUnitNome && t.solicitanteUnitNome.toLowerCase().includes(busca)) ||
      (t.dadosEnvio?.motorista && t.dadosEnvio.motorista.toLowerCase().includes(busca)) ||
      (t.dadosEnvio?.numeroNF && t.dadosEnvio.numeroNF.toLowerCase().includes(busca))
    );
  }

  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-gray-500 text-xs">Nenhuma transferência de insumo localizada para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas.map(t => {
    let statusBadge = '';
    if (t.status === 'ARQUIVADA' || t.status === 'RECEBIDA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">ARQUIVADA</span>`;
    } else if (t.status === 'ENVIADA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">EM TRÂNSITO</span>`;
    } else if (t.status === 'CONFIRMADA' || t.status === 'APROVADA') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">CONFIRMADA</span>`;
    } else if (t.status === 'PENDENTE') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300">PENDENTE</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/20 text-gray-300">${t.status}</span>`;
    }

    const docs = (t.documentos || []).map(d => `<span class="inline-block text-[10px] text-blue-400 font-semibold underline mr-1" title="${d.nome}">[${d.tipo}]</span>`).join('') || '<span class="text-gray-500 text-[11px]">-</span>';

    return `
      <tr class="hover:bg-[#121915] transition-colors border-b border-[#141d18]">
        <td class="py-2.5 px-3 font-mono font-bold text-white">${t.numero}</td>
        <td class="py-2.5 px-3 text-white font-medium">${t.remetenteUnitNome}</td>
        <td class="py-2.5 px-3 text-white font-medium">${t.solicitanteUnitNome}</td>
        <td class="py-2.5 px-3 font-bold text-emerald-400">${t.material}</td>
        <td class="py-2.5 px-3 text-right font-bold text-white">${t.volumeAprovado || t.volumeSolicitado} ${t.unidadeMedida}</td>
        <td class="py-2.5 px-3 text-gray-300 text-[11px]">${t.dadosEnvio ? `${t.dadosEnvio.motorista || '-'} ${t.dadosEnvio.numeroNF ? '(NF: '+t.dadosEnvio.numeroNF+')' : ''}` : '-'}</td>
        <td class="py-2.5 px-3 text-gray-400 text-[11px]">
          <div>Env: ${t.dadosEnvio?.dataEnvio || t.dataPrevisaoEnvio || '-'}</div>
          <div>Rec: ${t.dadosRecebimento?.dataRecebimento || '-'}</div>
        </td>
        <td class="py-2.5 px-3">${statusBadge}</td>
        <td class="py-2.5 px-3">${docs}</td>
      </tr>
    `;
  }).join('');
}

function clearDashboardFilters() {
  document.getElementById('filterDataInicio').value = '';
  document.getElementById('filterDataFim').value = '';
  document.getElementById('filterTipo').value = '';
  document.getElementById('filterBaia').value = '';
  loadDashboardData();
}

function renderCharts(porTipo, evolucao) {
  const ctxTipo = document.getElementById('chartTipo').getContext('2d');
  if (chartTipoInstance) chartTipoInstance.destroy();

  chartTipoInstance = new Chart(ctxTipo, {
    type: 'doughnut',
    data: {
      labels: Object.keys(porTipo || {}),
      datasets: [{
        data: Object.values(porTipo || {}),
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 } } } }
    }
  });

  const ctxEvolucao = document.getElementById('chartEvolucao').getContext('2d');
  if (chartEvolucaoInstance) chartEvolucaoInstance.destroy();

  chartEvolucaoInstance = new Chart(ctxEvolucao, {
    type: 'bar',
    data: {
      labels: (evolucao || []).map(e => e.mes),
      datasets: [
        { label: 'Entradas', data: (evolucao || []).map(e => e.entradas), backgroundColor: '#3b82f6' },
        { label: 'Saídas / Abates', data: (evolucao || []).map(e => e.saidas), backgroundColor: '#10b981' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#17201b' } }
      },
      plugins: { legend: { position: 'top', labels: { color: '#9ca3af', font: { size: 10 } } } }
    }
  });
}

function exportDashboardPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  doc.setFontSize(14);
  doc.setTextColor(34, 197, 94);
  doc.text("Gestão de Dados de Confinamento - Relatório de Movimentações", 14, 15);

  const rows = [];
  document.querySelectorAll('#dashTableBody tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 8) {
      rows.push([
        tds[0].innerText.trim(),
        tds[1].innerText.trim(),
        tds[2].innerText.trim(),
        tds[3].innerText.trim(),
        tds[4].innerText.trim(),
        tds[5].innerText.trim(),
        tds[6].innerText.trim(),
        tds[8].innerText.trim()
      ]);
    }
  });

  doc.autoTable({
    head: [['Data', 'Tipo', 'Baia/Lote', 'Qtd (Cab)', 'Categoria', 'Peso', 'R$/@', 'Origem/Destino']],
    body: rows,
    startY: 25,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [18, 26, 21], textColor: [34, 197, 94] }
  });

  doc.save(`dashboard_movimentacoes_${Date.now()}.pdf`);
}

// -------------------------------------------------------------
// VIEW 7: ADMINISTRAÇÃO (Usuários, Papéis & Gestão de Unidades)
// -------------------------------------------------------------
async function loadAdminData() {
  try {
    const [resUsers, resUnits] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/units')
    ]);
    const users = await resUsers.json();
    allUnits = await resUnits.json();

    const tbodyUsers = document.getElementById('adminUsersTableBody');
    tbodyUsers.innerHTML = users.map(u => {
      let roleBadge = '';
      if (u.role === 'admin') roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">ADMIN</span>`;
      else if (u.role === 'gestor') roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">GESTOR</span>`;
      else if (u.role === 'supervisor') roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">SUPERVISOR</span>`;
      else if (u.role === 'observador') roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">OBSERVADOR</span>`;
      else roleBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/10 text-gray-400">PENDENTE</span>`;

      const unit = allUnits.find(un => un.id === u.unitId);
      const modCount = (u.modulos || []).length;

      return `
        <tr class="hover:bg-[#121915] transition-colors border-b border-[#141d18]">
          <td class="py-2.5 px-3 font-semibold text-white">${u.name}</td>
          <td class="py-2.5 px-3 text-gray-400">${u.email}</td>
          <td class="py-2.5 px-3">${roleBadge}</td>
          <td class="py-2.5 px-3 text-gray-300 font-medium">${unit ? unit.name : '<span class="text-gray-500 italic">Não vinculado</span>'}</td>
          <td class="py-2.5 px-3 text-xs text-emerald-400 font-semibold">${u.role === 'admin' ? 'Todos Liberados' : `${modCount} módulo(s)`}</td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="editarConfigUser('${u.id}')" class="text-xs px-2.5 py-1 rounded bg-[#17211b] hover:bg-[#202d25] text-emerald-400 font-medium mr-2">
              Configurar Acesso
            </button>
            <button onclick="deleteUser('${u.id}')" class="text-xs text-red-400 hover:text-red-300">
              <i data-lucide="trash-2" class="w-4 h-4 inline-block"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Renderizar lista de Gestão de Unidades com botão de edição para Admin
    const isAdmin = currentUser.role === 'admin';
    const unitsList = document.getElementById('adminUnitsList');
    unitsList.innerHTML = allUnits.map(un => `
      <div class="bg-[#121915] border border-[#1e2a22] rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-bold text-white">${un.name}</span>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">${un.type || 'Unidade'}</span>
              ${isAdmin ? `
                <button onclick="editarUnidade('${un.id}')" class="p-1 text-gray-400 hover:text-emerald-400 transition" title="Editar Informações da Unidade">
                  <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                </button>
                <button onclick="excluirUnidade('${un.id}')" class="p-1 text-gray-400 hover:text-red-400 transition" title="Excluir Unidade">
                  <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="text-[11px] text-gray-400">Cód: <span class="font-mono text-gray-300">${un.code}</span></div>
          <div class="text-xs text-gray-300 mt-2">Capacidade: <strong class="text-white">${Number(un.capacity || 0).toLocaleString('pt-BR')}</strong></div>
        </div>
      </div>
    `).join('');

    lucide.createIcons();
  } catch (err) {
    console.error(err);
  }
}

// Configurar Usuário (Status, Unidade e Módulos)
async function editarConfigUser(userId) {
  const res = await fetch('/api/users');
  const users = await res.json();
  const u = users.find(user => user.id === userId);
  if (!u) return;

  document.getElementById('editUserId').value = u.id;
  document.getElementById('editUserName').value = u.name;
  document.getElementById('editUserEmail').value = u.email;
  document.getElementById('editUserRole').value = u.role || 'observador';

  // Opções de unidade
  document.getElementById('editUserUnit').innerHTML = 
    `<option value="">-- Nenhuma / Acesso Geral --</option>` +
    allUnits.map(un => `<option value="${un.id}" ${u.unitId === un.id ? 'selected' : ''}>${un.name} (${un.type || 'Geral'})</option>`).join('');

  // Preencher checkboxes de módulos
  const mods = u.modulos || [];
  ['rebanho', 'embarque', 'estoque', 'importar', 'dashboard', 'admin'].forEach(m => {
    const cb = document.getElementById('mod_' + m);
    if (cb) cb.checked = u.role === 'admin' || mods.includes(m);
  });

  document.getElementById('userModal').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('userModal').classList.add('hidden');
}

function handleRoleChange(role) {
  // Ajuste de módulos padrão pelo cargo
  const mods = {
    'admin': ['rebanho', 'embarque', 'estoque', 'importar', 'dashboard', 'admin'],
    'gestor': ['rebanho', 'embarque', 'estoque', 'dashboard'],
    'supervisor': ['rebanho', 'embarque', 'estoque'],
    'observador': ['rebanho', 'embarque'],
    'pendente': []
  }[role] || [];

  ['rebanho', 'embarque', 'estoque', 'importar', 'dashboard', 'admin'].forEach(m => {
    const cb = document.getElementById('mod_' + m);
    if (cb) cb.checked = mods.includes(m);
  });
}

async function handleSalvarConfigUser(e) {
  e.preventDefault();
  const id = document.getElementById('editUserId').value;
  const name = document.getElementById('editUserName').value;
  const role = document.getElementById('editUserRole').value;
  const unitId = document.getElementById('editUserUnit').value || null;

  const modulos = [];
  ['rebanho', 'embarque', 'estoque', 'importar', 'dashboard', 'admin'].forEach(m => {
    const cb = document.getElementById('mod_' + m);
    if (cb && cb.checked) modulos.push(m);
  });

  const un = allUnits.find(u => u.id === unitId);
  const unNome = un ? un.name : 'Nenhuma (Acesso Geral)';
  const conf = confirm(
    `CONFIRMAÇÃO DE ALTERAÇÃO DE PERMISSÕES DO USUÁRIO:\n\n` +
    `Deseja realmente atualizar o perfil e permissões de "${name}"?\n\n` +
    `• Novo Cargo: ${role.toUpperCase()}\n` +
    `• Unidade Vinculada: ${unNome}\n` +
    `• Módulos Liberados: ${modulos.length > 0 ? modulos.join(', ') : 'Nenhum'}\n\n` +
    `Clique em 'OK' para confirmar ou 'Cancelar' para desistir.`
  );
  if (!conf) return;

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, unitId, modulos })
    });
    if (res.ok) {
      closeUserModal();
      loadAdminData();
      alert('Permissões e módulos do usuário atualizados com sucesso!');
    }
  } catch (err) {
    alert('Erro ao salvar permissões.');
  }
}

async function deleteUser(id) {
  const conf = confirm(
    `ATENÇÃO - CONFIRMAÇÃO DE EXCLUSÃO DE USUÁRIO:\n\n` +
    `Tem certeza absoluta de que deseja EXCLUIR permanentemente este usuário do sistema?\n\n` +
    `O usuário perderá imediatamente todo o acesso à plataforma.\n\n` +
    `Clique em 'OK' para excluir ou 'Cancelar' para manter o usuário.`
  );
  if (!conf) return;

  try {
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    loadAdminData();
    alert('Usuário removido com sucesso!');
  } catch (err) {
    alert('Erro ao excluir usuário.');
  }
}

// -------------------------------------------------------------
// GESTÃO DE UNIDADES (Criar e Editar Informações)
// -------------------------------------------------------------
function openNewUnitModal() {
  document.getElementById('modalUnitId').value = '';
  document.getElementById('unitModalTitle').textContent = 'Cadastrar Nova Unidade';
  document.getElementById('modalUnitName').value = '';
  document.getElementById('modalUnitCode').value = '';
  document.getElementById('modalUnitCapacity').value = '';
  document.getElementById('modalUnitType').value = 'Pasto / Recria';
  document.getElementById('unitModal').classList.remove('hidden');
}

function editarUnidade(id) {
  const un = allUnits.find(u => u.id === id);
  if (!un) return;

  document.getElementById('modalUnitId').value = un.id;
  document.getElementById('unitModalTitle').textContent = 'Editar Informações da Unidade';
  document.getElementById('modalUnitName').value = un.name || '';
  document.getElementById('modalUnitCode').value = un.code || '';
  document.getElementById('modalUnitCapacity').value = un.capacity !== undefined ? un.capacity : '';
  document.getElementById('modalUnitType').value = un.type || 'Pasto / Recria';

  document.getElementById('unitModal').classList.remove('hidden');
}

function closeUnitModal() {
  document.getElementById('unitModal').classList.add('hidden');
}

async function handleSaveUnit(e) {
  e.preventDefault();
  const id = document.getElementById('modalUnitId').value;
  const name = document.getElementById('modalUnitName').value;
  const type = document.getElementById('modalUnitType').value;
  const code = document.getElementById('modalUnitCode').value;
  const capacity = document.getElementById('modalUnitCapacity').value;

  if (id) {
    const unAtual = allUnits.find(u => u.id === id);
    const nomeAntigo = unAtual ? unAtual.name : name;
    const conf = confirm(
      `CONFIRMAÇÃO DE EDIÇÃO DE UNIDADE:\n\n` +
      `Deseja realmente salvar as alterações na unidade "${nomeAntigo}"?\n\n` +
      `• Nome: ${name}\n` +
      `• Tipo: ${type}\n` +
      `• Código: ${code || 'N/A'}\n` +
      `• Capacidade: ${capacity || 0} cabeças\n\n` +
      `Clique em 'OK' para salvar ou 'Cancelar' para desistir.`
    );
    if (!conf) return;
  }

  const endpoint = id ? `/api/units/${id}` : '/api/units';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, code, capacity })
    });
    if (res.ok) {
      closeUnitModal();
      loadAdminData();
      alert(id ? 'Informações da unidade atualizadas com sucesso!' : 'Unidade cadastrada com sucesso!');
    }
  } catch (err) {
    alert('Erro ao salvar unidade.');
  }
}

async function excluirUnidade(id) {
  const un = allUnits.find(u => u.id === id);
  const conf = confirm(
    `ATENÇÃO CRÍTICA - CONFIRMAÇÃO DE EXCLUSÃO DE UNIDADE:\n\n` +
    `Tem certeza absoluta de que deseja EXCLUIR a unidade "${un ? un.name : 'esta unidade'}"?\n\n` +
    `AVISO: A exclusão de uma unidade impacta estoques, lotes e usuários vinculados a ela.\n\n` +
    `Clique em 'OK' para confirmar a exclusão ou 'Cancelar' para manter a unidade.`
  );
  if (!conf) return;

  try {
    const res = await fetch(`/api/units/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadAdminData();
      alert('Unidade removida com sucesso!');
    }
  } catch (err) {
    alert('Erro ao excluir unidade.');
  }
}

function copyPublicRegisterLink() {
  const url = `${window.location.origin}/#register`;
  navigator.clipboard.writeText(url).then(() => {
    alert(`Link de cadastro copiado!\n\nEnvie este link para quem você deseja cadastrar:\n${url}`);
  }).catch(() => {
    prompt('Copie o link abaixo para enviar:', url);
  });
}

function openInviteModal() {
  document.getElementById('inviteName').value = '';
  document.getElementById('inviteEmail').value = '';
  document.getElementById('inviteRole').value = 'supervisor';
  document.getElementById('inviteModal').classList.remove('hidden');
}

function closeInviteModal() {
  document.getElementById('inviteModal').classList.add('hidden');
}

async function handleSendInvite(e) {
  e.preventDefault();
  const name = document.getElementById('inviteName').value;
  const email = document.getElementById('inviteEmail').value;
  const role = document.getElementById('inviteRole').value;
  const btn = document.getElementById('btnSubmitInvite');

  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...`;

  try {
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role })
    });

    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="mail" class="w-4 h-4"></i> Enviar Convite`;

    if (!res.ok) {
      alert(data.error || 'Erro ao enviar convite.');
      return;
    }

    alert(data.message || 'Convite enviado com sucesso!');
    closeInviteModal();
    loadAdminData();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="mail" class="w-4 h-4"></i> Enviar Convite`;
    alert('Erro de conexão ao enviar convite.');
  }
}
