require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseExcelLotesAtivos, parsePdfLotesAtivos } = require('./parsers');
const { isSupabaseConfigured, supabaseAdmin, supabaseClient, supabaseUrl, supabaseAnonKey } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Upload de relatórios e documentos (GTA, NF, etc.)
const upload = multer({ storage: multer.memoryStorage() });

function getDb() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      users: [],
      units: [],
      baias: [],
      lotacao: {},
      movimentacoes: [],
      programacaoEmbarques: [],
      estoques: [],
      transferenciasInsumos: [],
      lastUpdate: new Date().toISOString()
    };
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  if (!data.programacaoEmbarques) data.programacaoEmbarques = [];
  if (!data.estoques) data.estoques = [];
  if (!data.transferenciasInsumos) data.transferenciasInsumos = [];
  return data;
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// -------------------------------------------------------------
// CONFIGURAÇÕES GERAIS
// -------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({
    appName: 'Gestão de Dados de Confinamento',
    supabaseConfigured: isSupabaseConfigured,
    supabaseUrl: supabaseUrl || null,
    supabaseAnonKey: supabaseAnonKey || null,
    appUrl: process.env.APP_URL || `http://localhost:${PORT}`
  });
});

// -------------------------------------------------------------
// 1. AUTENTICAÇÃO, CONTROLE DE ACESSO (RBAC) & PERMISSÕES
// Perfis: admin | gestor | supervisor | observador | pendente
// -------------------------------------------------------------
app.get('/api/users/stats', async (req, res) => {
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('profiles').select('id, role');
      if (data) {
        return res.json({
          totalUsers: data.length,
          hasAdmin: data.some(u => u.role === 'admin')
        });
      }
    } catch (e) {
      console.warn(e.message);
    }
  }
  const db = getDb();
  res.json({ totalUsers: db.users.length, hasAdmin: db.users.some(u => u.role === 'admin') });
});

// Cadastro de usuário
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, unitId } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Preencha nome e e-mail.' });
  }

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: existingProfiles } = await supabaseAdmin.from('profiles').select('id');
      const isFirstUser = !existingProfiles || existingProfiles.length === 0;
      
      // O primeiro usuário é Admin com acesso total.
      // Usuários subsequentes iniciam com status 'pendente' e sem módulos liberados até o Admin atribuir
      const role = isFirstUser ? 'admin' : 'pendente';
      const modulos = isFirstUser ? ['inicio', 'rebanho', 'importar', 'dashboard', 'embarque', 'estoque', 'admin'] : [];

      const { data, error } = await supabaseAdmin.auth.signUp({
        email: email.toLowerCase(),
        password: password || 'TempPass@' + Math.random().toString(36).slice(-8),
        options: {
          data: {
            name,
            role,
            unit_id: unitId || (isFirstUser ? 'unit_1' : null),
            modulos
          },
          emailRedirectTo: `${appUrl}/#confirm`
        }
      });

      if (error) return res.status(400).json({ error: error.message });

      return res.json({
        success: true,
        isSupabase: true,
        user: data.user,
        message: isFirstUser
          ? 'Primeiro usuário registrado como Administrador! Link enviado por e-mail.'
          : 'Cadastro realizado! Você receberá o link para confirmar sua conta. Após a ativação, o Administrador liberará suas permissões e módulos de acesso.'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Fallback Local
  const db = getDb();
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Email já cadastrado.' });

  const isFirstUser = db.users.length === 0;
  const role = isFirstUser ? 'admin' : 'pendente';
  const modulos = isFirstUser ? ['inicio', 'rebanho', 'importar', 'dashboard', 'embarque', 'estoque', 'admin'] : [];

  const newUser = {
    id: 'user_' + Date.now(),
    name,
    email: email.toLowerCase(),
    password: password || '123456',
    role,
    unitId: isFirstUser ? (db.units[0]?.id || 'unit_1') : null,
    modulos,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDb(db);

  const { password: _, ...userWithoutPass } = newUser;
  res.json({
    user: userWithoutPass,
    message: isFirstUser
      ? 'Primeiro usuário registrado e promovido a Administrador!'
      : 'Cadastro realizado! Aguarde a atribuição de permissões e liberação dos módulos pelo Administrador.'
  });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (isSupabaseConfigured && supabaseClient) {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: (email || '').toLowerCase(),
        password
      });

      if (error) {
        return res.status(401).json({ error: 'Credenciais inválidas ou e-mail não confirmado: ' + error.message });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return res.json({
        user: {
          id: data.user.id,
          email: data.user.email,
          name: profile ? profile.name : data.user.user_metadata?.name || data.user.email,
          role: profile ? profile.role : data.user.user_metadata?.role || 'pendente',
          unitId: profile ? profile.unit_id : data.user.user_metadata?.unit_id || null,
          modulos: profile?.modulos || data.user.user_metadata?.modulos || []
        },
        session: data.session
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Fallback Local
  const db = getDb();
  if (db.users.length === 0) {
    return res.status(404).json({ error: 'Nenhum usuário cadastrado. Crie o primeiro usuário para ser o Administrador.' });
  }

  const user = db.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase() && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
  }

  const { password: _, ...clean } = user;
  res.json({ user: clean });
});

// Convite de Usuário pelo Admin
app.post('/api/users/invite', async (req, res) => {
  const { email, name, role, unitId, modulos } = req.body;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const defaultMods = role === 'admin'
    ? ['inicio', 'rebanho', 'importar', 'dashboard', 'embarque', 'estoque', 'admin']
    : (modulos || ['inicio', 'rebanho', 'embarque']);

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email.toLowerCase(), {
        data: {
          name: name || email.split('@')[0],
          role: role || 'observador',
          unit_id: unitId || null,
          modulos: defaultMods
        },
        redirectTo: `${appUrl}/#confirm`
      });

      if (error) return res.status(400).json({ error: error.message });

      return res.json({
        success: true,
        message: `Convite enviado para ${email}. O usuário definirá sua senha pelo link.`
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Fallback Local
  const db = getDb();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'E-mail já cadastrado.' });
  }

  const newUser = {
    id: 'user_' + Date.now(),
    name: name || email.split('@')[0],
    email: email.toLowerCase(),
    password: 'temp',
    role: role || 'observador',
    unitId: unitId || null,
    modulos: defaultMods,
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  saveDb(db);

  res.json({
    success: true,
    message: `Usuário cadastrado com sucesso!`
  });
});

// Listagem de Usuários (para o Admin gerir)
app.get('/api/users', async (req, res) => {
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('profiles').select('*');
      if (data) {
        return res.json(data.map(p => ({
          id: p.id,
          name: p.name,
          email: p.email,
          role: p.role,
          unitId: p.unit_id,
          modulos: p.modulos || [],
          createdAt: p.created_at
        })));
      }
    } catch (e) {
      console.warn(e.message);
    }
  }

  const db = getDb();
  const usersClean = db.users.map(({ password, ...u }) => u);
  res.json(usersClean);
});

// Atualização de Status, Unidade e Módulos do Usuário pelo Admin
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, role, unitId, modulos } = req.body;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;
      if (role !== undefined) updates.role = role;
      if (unitId !== undefined) updates.unit_id = unitId;
      if (modulos !== undefined) updates.modulos = modulos;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) return res.json(data);
    } catch (e) {
      console.warn(e.message);
    }
  }

  const db = getDb();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (name !== undefined) db.users[idx].name = name;
  if (email !== undefined) db.users[idx].email = email.toLowerCase();
  if (role !== undefined) db.users[idx].role = role;
  if (unitId !== undefined) db.users[idx].unitId = unitId;
  if (modulos !== undefined) db.users[idx].modulos = modulos;

  saveDb(db);
  const { password: _, ...clean } = db.users[idx];
  res.json(clean);
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
      await supabaseAdmin.from('profiles').delete().eq('id', id);
      return res.json({ success: true });
    } catch (e) {
      console.warn(e.message);
    }
  }
  const db = getDb();
  db.users = db.users.filter(u => u.id !== id);
  saveDb(db);
  res.json({ success: true });
});

// -------------------------------------------------------------
// 2. GESTÃO DE UNIDADES (Não vinculada obrigatoriamente a confinamento)
// -------------------------------------------------------------
app.get('/api/units', (req, res) => {
  const db = getDb();
  res.json(db.units || []);
});

app.post('/api/units', (req, res) => {
  const { name, code, type, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome da unidade obrigatório.' });

  const db = getDb();
  const newUnit = {
    id: 'unit_' + Date.now(),
    name,
    code: code || name.toUpperCase().replace(/\s+/g, '_').slice(0, 15),
    type: type || 'Geral / Fazenda', // Tipos: 'Confinamento', 'Recria / Pasto', 'Cria', 'Armazém / Depósito', etc.
    capacity: Number(capacity) || 0,
    active: true,
    createdAt: new Date().toISOString()
  };
  db.units.push(newUnit);
  saveDb(db);
  res.json(newUnit);
});

app.put('/api/units/:id', (req, res) => {
  const { id } = req.params;
  const { name, code, type, capacity, active } = req.body;
  const db = getDb();
  const unit = db.units.find(u => u.id === id);
  if (!unit) return res.status(404).json({ error: 'Unidade não encontrada' });
  if (name !== undefined) unit.name = name;
  if (code !== undefined) unit.code = code;
  if (type !== undefined) unit.type = type;
  if (capacity !== undefined) unit.capacity = Number(capacity);
  if (active !== undefined) unit.active = active;
  saveDb(db);
  res.json(unit);
});

app.delete('/api/units/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  db.units = db.units.filter(u => u.id !== id);
  saveDb(db);
  res.json({ success: true });
});

// -------------------------------------------------------------
// 3. PROGRAMAÇÃO DE EMBARQUES & AGENDAMENTOS
// -------------------------------------------------------------
// Listar embarques programados (com filtro opcional por unidade ou usuário)
app.get('/api/embarques', (req, res) => {
  const { unitId, status } = req.query;
  const db = getDb();
  let embarques = db.programacaoEmbarques || [];

  if (unitId) {
    embarques = embarques.filter(e => e.origemUnidadeId === unitId || e.destinoUnidadeId === unitId);
  }
  if (status) {
    embarques = embarques.filter(e => e.status === status);
  }

  // Ordenar por data de embarque
  embarques.sort((a, b) => new Date(a.dataEmbarque) - new Date(b.dataEmbarque));
  res.json(embarques);
});

// Criar novo agendamento de embarque
// Permitido: Titular/Supervisor da unidade remetente, Gestor ou Admin
app.post('/api/embarques', (req, res) => {
  const {
    dataEmbarque,
    origemUnidadeId,
    destinoUnidadeId,
    qtdCabecas,
    categoria,
    tipoCarga,
    observacoes,
    usuarioId,
    usuarioNome,
    usuarioRole,
    usuarioUnitId
  } = req.body;

  if (!dataEmbarque || !origemUnidadeId || !destinoUnidadeId || !qtdCabecas) {
    return res.status(400).json({ error: 'Preencha a data do embarque, unidades de origem e destino e quantidade de cabeças.' });
  }

  // Regra de autorização: Apenas supervisor da remetente, gestor ou admin podem programar
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isSupervisorRemetente = usuarioRole === 'supervisor' && usuarioUnitId === origemUnidadeId;

  if (!isGestorOuAdmin && !isSupervisorRemetente) {
    return res.status(403).json({ error: 'Apenas o titular/supervisor da unidade remetente ou gestores podem programar embarques.' });
  }

  const db = getDb();
  const origem = db.units.find(u => u.id === origemUnidadeId);
  const destino = db.units.find(u => u.id === destinoUnidadeId);

  const novoEmbarque = {
    id: 'emb_' + Date.now(),
    dataEmbarque,
    origemUnidadeId,
    origemUnidadeNome: origem ? origem.name : 'Origem',
    destinoUnidadeId,
    destinoUnidadeNome: destino ? destino.name : 'Destino',
    qtdCabecas: Number(qtdCabecas) || 0,
    categoria: categoria || 'Geral',
    tipoCarga: tipoCarga || 'Gado', // 'Gado' ou 'Suprimento'
    observacoes: observacoes || '',
    criadoPorUserId: usuarioId,
    criadoPorNome: usuarioNome,
    criadoPorRole: usuarioRole,
    status: 'PROGRAMADO',
    documentos: [],
    createdAt: new Date().toISOString()
  };

  db.programacaoEmbarques.push(novoEmbarque);
  saveDb(db);
  res.json(novoEmbarque);
});

// Editar agendamento de embarque
// Regra: Apenas o usuário que programou o embarque ou um gestor/admin podem editá-lo
app.put('/api/embarques/:id', (req, res) => {
  const { id } = req.params;
  const {
    dataEmbarque,
    origemUnidadeId,
    destinoUnidadeId,
    qtdCabecas,
    categoria,
    tipoCarga,
    observacoes,
    status,
    usuarioId,
    usuarioRole
  } = req.body;

  const db = getDb();
  const emb = db.programacaoEmbarques.find(e => e.id === id);
  if (!emb) return res.status(404).json({ error: 'Agendamento de embarque não encontrado.' });

  const isCriador = emb.criadoPorUserId === usuarioId;
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';

  if (!isCriador && !isGestorOuAdmin) {
    return res.status(403).json({ error: 'Apenas quem programou o embarque ou um Gestor/Admin podem editá-lo.' });
  }

  if (dataEmbarque !== undefined) emb.dataEmbarque = dataEmbarque;
  if (origemUnidadeId !== undefined) {
    emb.origemUnidadeId = origemUnidadeId;
    const u = db.units.find(un => un.id === origemUnidadeId);
    if (u) emb.origemUnidadeNome = u.name;
  }
  if (destinoUnidadeId !== undefined) {
    emb.destinoUnidadeId = destinoUnidadeId;
    const u = db.units.find(un => un.id === destinoUnidadeId);
    if (u) emb.destinoUnidadeNome = u.name;
  }
  if (qtdCabecas !== undefined) emb.qtdCabecas = Number(qtdCabecas);
  if (categoria !== undefined) emb.categoria = categoria;
  if (tipoCarga !== undefined) emb.tipoCarga = tipoCarga;
  if (observacoes !== undefined) emb.observacoes = observacoes;
  if (status !== undefined) emb.status = status; // PROGRAMADO, ADIADO, CANCELADO, CONCLUIDO

  emb.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(emb);
});

// Anexar Documentos (NF e GTA) na Programação de Embarque
// Regra: Todos os envolvidos (remetente, destinatário, gestor, supervisor e observador) podem anexar
app.post('/api/embarques/:id/documentos', upload.single('documento'), (req, res) => {
  const { id } = req.params;
  const { tipoDoc, usuarioNome } = req.body; // 'NF', 'GTA', 'Outro'

  const db = getDb();
  const emb = db.programacaoEmbarques.find(e => e.id === id);
  if (!emb) return res.status(404).json({ error: 'Embarque não encontrado.' });

  const nomeArquivo = req.file ? req.file.originalname : (req.body.nomeArquivo || 'Documento_' + Date.now());

  const novoDoc = {
    id: 'doc_' + Date.now(),
    nome: nomeArquivo,
    tipo: tipoDoc || 'GTA',
    tamanho: req.file ? req.file.size : 0,
    enviadoPor: usuarioNome || 'Usuário',
    dataUpload: new Date().toISOString().split('T')[0]
  };

  if (!emb.documentos) emb.documentos = [];
  emb.documentos.push(novoDoc);

  saveDb(db);
  res.json({ success: true, documento: novoDoc, embarque: emb });
});

// -------------------------------------------------------------
// 4. ESTOQUES DE GADO & SUPRIMENTOS (Admin cria; Titular movimenta)
// -------------------------------------------------------------
app.get('/api/estoques', (req, res) => {
  const { unitId } = req.query;
  const db = getDb();
  let estoques = db.estoques || [];
  if (unitId) {
    estoques = estoques.filter(e => e.unitId === unitId);
  }
  res.json(estoques);
});

// -------------------------------------------------------------
// 5. SOLICITAÇÃO & TRANSFERÊNCIA DE INSUMOS
// -------------------------------------------------------------
// Listar transferências de insumos (com filtros opcionais)
app.get('/api/transferencias-insumos', (req, res) => {
  const { unitId } = req.query;
  const db = getDb();
  let list = db.transferenciasInsumos || [];

  if (unitId) {
    list = list.filter(t => t.solicitanteUnitId === unitId || t.remetenteUnitId === unitId);
  }

  // Ordenar por data mais recente de criação
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

// Criar nova solicitação de insumo
// Permitido: Titular da unidade solicitante (supervisor), Gestor ou Admin
app.post('/api/transferencias-insumos', (req, res) => {
  const {
    solicitanteUnitId,
    remetenteUnitId,
    material,
    volumeSolicitado,
    unidadeMedida,
    dataNecessidade,
    usuarioId,
    usuarioNome,
    usuarioRole,
    usuarioUnitId
  } = req.body;

  if (!solicitanteUnitId || !remetenteUnitId || !material || !volumeSolicitado || !dataNecessidade) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios (unidades, material, volume e data da necessidade).' });
  }

  if (solicitanteUnitId === remetenteUnitId) {
    return res.status(400).json({ error: 'A unidade solicitante deve ser diferente da unidade remetente.' });
  }

  // Validação de acesso: apenas titular da solicitante, gestor ou admin
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularSolicitante = usuarioRole === 'supervisor' && usuarioUnitId === solicitanteUnitId;

  if (!isGestorOuAdmin && !isTitularSolicitante) {
    return res.status(403).json({ error: 'Apenas o titular da unidade solicitante ou o gestor podem solicitar transferência de insumos.' });
  }

  const db = getDb();
  const solicitante = db.units.find(u => u.id === solicitanteUnitId);
  const remetente = db.units.find(u => u.id === remetenteUnitId);

  const numeroSequencial = 1000 + (db.transferenciasInsumos.length + 1);
  const numeroSolicitacao = 'SOL-' + numeroSequencial;

  const novaSolicitacao = {
    id: 'sol_' + Date.now(),
    numero: numeroSolicitacao,
    dataCriacao: new Date().toISOString().split('T')[0],
    dataNecessidade,
    solicitanteUserId: usuarioId,
    solicitanteNome: usuarioNome,
    solicitanteUnitId,
    solicitanteUnitNome: solicitante ? solicitante.name : 'Solicitante',
    remetenteUnitId,
    remetenteUnitNome: remetente ? remetente.name : 'Remetente',
    material,
    volumeSolicitado: Number(volumeSolicitado),
    unidadeMedida: unidadeMedida || 'Un',
    status: 'PENDENTE', // PENDENTE, APROVADA, REJEITADA, ENVIADA, RECEBIDA
    volumeAprovado: null,
    dataPrevisaoEnvio: null,
    justificativaRejeicao: null,
    dadosEnvio: null,
    documentos: [],
    createdAt: new Date().toISOString()
  };

  db.transferenciasInsumos.push(novaSolicitacao);
  saveDb(db);
  res.json(novaSolicitacao);
});

// Responder à solicitação: Aceitar ou Rejeitar
// Permitido: Titular da unidade remetente, Gestor ou Admin
app.post('/api/transferencias-insumos/:id/responder', (req, res) => {
  const { id } = req.params;
  const {
    decisao, // 'ACEITAR' ou 'REJEITAR'
    volumeAprovado,
    dataPrevisaoEnvio,
    justificativaRejeicao,
    usuarioId,
    usuarioNome,
    usuarioRole,
    usuarioUnitId
  } = req.body;

  const db = getDb();
  const sol = db.transferenciasInsumos.find(t => t.id === id);
  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  // Validação: apenas titular da remetente ou gestor/admin
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularRemetente = usuarioRole === 'supervisor' && usuarioUnitId === sol.remetenteUnitId;

  if (!isGestorOuAdmin && !isTitularRemetente) {
    return res.status(403).json({ error: 'Apenas o titular da unidade remetente ou gestores podem responder a esta solicitação.' });
  }

  if (decisao === 'REJEITAR') {
    if (!justificativaRejeicao) {
      return res.status(400).json({ error: 'É obrigatório informar uma justificativa ao rejeitar a solicitação.' });
    }
    sol.status = 'REJEITADA';
    sol.justificativaRejeicao = justificativaRejeicao;
    sol.respondidoPor = usuarioNome;
    sol.dataResposta = new Date().toISOString();
  } else if (decisao === 'ACEITAR') {
    if (!dataPrevisaoEnvio || !volumeAprovado) {
      return res.status(400).json({ error: 'Ao aceitar, confirme a data prevista para envio e o volume aprovado.' });
    }
    sol.status = 'CONFIRMADA';
    sol.volumeAprovado = Number(volumeAprovado);
    sol.dataPrevisaoEnvio = dataPrevisaoEnvio;
    sol.respondidoPor = usuarioNome;
    sol.dataResposta = new Date().toISOString();
  } else {
    return res.status(400).json({ error: 'Decisão inválida. Escolha ACEITAR ou REJEITAR.' });
  }

  saveDb(db);
  res.json({ success: true, solicitacao: sol });
});

// Confirmar Envio do Material (Unidade Remetente)
// Subtrai automaticamente do estoque da remetente!
app.post('/api/transferencias-insumos/:id/enviar', (req, res) => {
  const { id } = req.params;
  const { motorista, numeroNF, usuarioUnitId, usuarioRole, usuarioNome } = req.body;

  if (!motorista) {
    return res.status(400).json({ error: 'Informe o nome do motorista transportador.' });
  }

  const db = getDb();
  const sol = db.transferenciasInsumos.find(t => t.id === id);
  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularRemetente = usuarioRole === 'supervisor' && usuarioUnitId === sol.remetenteUnitId;

  if (!isGestorOuAdmin && !isTitularRemetente) {
    return res.status(403).json({ error: 'Apenas o titular da unidade remetente pode confirmar o envio do material.' });
  }

  const volumeEnvio = sol.volumeAprovado || sol.volumeSolicitado;

  // Localizar estoque do remetente correspondente ao material
  const estRemetente = db.estoques.find(e => 
    e.unitId === sol.remetenteUnitId && 
    e.item.trim().toLowerCase() === sol.material.trim().toLowerCase()
  );

  if (estRemetente) {
    if (estRemetente.quantidade < volumeEnvio) {
      return res.status(400).json({ 
        error: `Saldo insuficiente na unidade remetente. Saldo disponível: ${estRemetente.quantidade} ${estRemetente.unidadeMedida}, Volume do envio: ${volumeEnvio}` 
      });
    }
    estRemetente.quantidade -= volumeEnvio;
    estRemetente.updatedAt = new Date().toISOString();
  }

  sol.status = 'ENVIADA';
  sol.dadosEnvio = {
    motorista,
    numeroNF: numeroNF || '',
    dataEnvio: new Date().toISOString().split('T')[0],
    enviadoPor: usuarioNome
  };

  saveDb(db);
  res.json({ success: true, message: `Envio confirmado! Saldo de ${volumeEnvio} subtraído do estoque da unidade remetente.`, solicitacao: sol });
});

// Confirmar Recebimento do Material (Unidade Solicitante / Destinatária)
// Soma automaticamente ao estoque do destinatário (e cria estoque caso não exista)!
app.post('/api/transferencias-insumos/:id/receber', (req, res) => {
  const { id } = req.params;
  const { usuarioUnitId, usuarioRole, usuarioNome } = req.body;

  const db = getDb();
  const sol = db.transferenciasInsumos.find(t => t.id === id);
  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularDestino = usuarioRole === 'supervisor' && usuarioUnitId === sol.solicitanteUnitId;

  if (!isGestorOuAdmin && !isTitularDestino) {
    return res.status(403).json({ error: 'Apenas o titular da unidade solicitante/destinatária pode confirmar o recebimento.' });
  }

  const volumeRecebido = sol.volumeAprovado || sol.volumeSolicitado;

  // Localizar estoque no destinatário
  let estDestinatario = db.estoques.find(e => 
    e.unitId === sol.solicitanteUnitId && 
    e.item.trim().toLowerCase() === sol.material.trim().toLowerCase()
  );

  // Se não houver estoque com o mesmo nome no destinatário, o sistema cria automaticamente!
  if (!estDestinatario) {
    estDestinatario = {
      id: 'est_' + Date.now(),
      unitId: sol.solicitanteUnitId,
      item: sol.material,
      tipo: 'Suprimento',
      quantidade: volumeRecebido,
      unidadeMedida: sol.unidadeMedida,
      minimo: 0,
      maximo: 0,
      updatedAt: new Date().toISOString()
    };
    db.estoques.push(estDestinatario);
  } else {
    estDestinatario.quantidade += volumeRecebido;
    estDestinatario.updatedAt = new Date().toISOString();
  }

  sol.status = 'ARQUIVADA';
  sol.dadosRecebimento = {
    dataRecebimento: new Date().toISOString().split('T')[0],
    recebidoPor: usuarioNome
  };

  saveDb(db);
  res.json({
    success: true,
    message: `Recebimento confirmado! Saldo de ${volumeRecebido} ${sol.unidadeMedida} incorporado ao estoque da sua unidade. Transferência arquivada com sucesso.`,
    solicitacao: sol
  });
});

// Anexar Documentos (NF / Comprovantes) na Transferência de Insumos
app.post('/api/transferencias-insumos/:id/documentos', upload.single('documento'), (req, res) => {
  const { id } = req.params;
  const { tipoDoc, usuarioNome } = req.body;

  const db = getDb();
  const sol = db.transferenciasInsumos.find(t => t.id === id);
  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const nomeArquivo = req.file ? req.file.originalname : (req.body.nomeArquivo || 'Doc_' + Date.now());

  const novoDoc = {
    id: 'doc_' + Date.now(),
    nome: nomeArquivo,
    tipo: tipoDoc || 'NF',
    tamanho: req.file ? req.file.size : 0,
    enviadoPor: usuarioNome || 'Usuário',
    dataUpload: new Date().toISOString().split('T')[0]
  };

  if (!sol.documentos) sol.documentos = [];
  sol.documentos.push(novoDoc);

  saveDb(db);
  res.json({ success: true, documento: novoDoc, solicitacao: sol });
});
app.post('/api/estoques', (req, res) => {
  const { unitId, item, tipo, quantidade, unidadeMedida, minimo, maximo, usuarioRole } = req.body;
  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode cadastrar novos estoques para as unidades.' });
  }

  const db = getDb();
  const novoEstoque = {
    id: 'est_' + Date.now(),
    unitId,
    item,
    tipo: tipo || 'Suprimento', // 'Gado' ou 'Suprimento'
    quantidade: Number(quantidade) || 0,
    unidadeMedida: unidadeMedida || 'Un',
    minimo: Number(minimo) || 0,
    maximo: Number(maximo) || 0,
    updatedAt: new Date().toISOString()
  };

  db.estoques.push(novoEstoque);
  saveDb(db);
  res.json(novoEstoque);
});

// Editar estoque: Exclusivo do Admin (nome, unidade de medida, mínimo, máximo, tipo, etc.)
app.put('/api/estoques/:id', (req, res) => {
  const { id } = req.params;
  const { unitId, item, tipo, quantidade, unidadeMedida, minimo, maximo, usuarioRole } = req.body;

  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode editar as configurações de estoque.' });
  }

  const db = getDb();
  const est = db.estoques.find(e => e.id === id);
  if (!est) return res.status(404).json({ error: 'Estoque não encontrado.' });

  if (unitId !== undefined) est.unitId = unitId;
  if (item !== undefined) est.item = item;
  if (tipo !== undefined) est.tipo = tipo;
  if (quantidade !== undefined) est.quantidade = Number(quantidade);
  if (unidadeMedida !== undefined) est.unidadeMedida = unidadeMedida;
  if (minimo !== undefined) est.minimo = Number(minimo);
  if (maximo !== undefined) est.maximo = Number(maximo);
  est.updatedAt = new Date().toISOString();

  saveDb(db);
  res.json(est);
});

// Excluir estoque: Exclusivo do Admin
app.delete('/api/estoques/:id', (req, res) => {
  const { id } = req.params;
  const { usuarioRole } = req.query;

  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode remover um cadastro de estoque.' });
  }

  const db = getDb();
  db.estoques = db.estoques.filter(e => e.id !== id);
  saveDb(db);
  res.json({ success: true });
});

// Movimentar estoque: Apenas titular da unidade ou Gestor/Admin
app.post('/api/estoques/:id/movimentar', (req, res) => {
  const { id } = req.params;
  const { tipoMovimento, quantidade, motivo, usuarioUnitId, usuarioRole, usuarioNome } = req.body;

  const db = getDb();
  const est = db.estoques.find(e => e.id === id);
  if (!est) return res.status(404).json({ error: 'Estoque não encontrado.' });

  // Regra: Somente o titular da unidade (supervisor com unitId correspondente) ou gestor/admin pode movimentar
  const isTitular = usuarioRole === 'supervisor' && usuarioUnitId === est.unitId;
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';

  if (!isTitular && !isGestorOuAdmin) {
    return res.status(403).json({ error: 'Somente o titular responsável pela unidade pode movimentar seus estoques.' });
  }

  const qtd = Number(quantidade) || 0;
  if (tipoMovimento === 'SAIDA' && est.quantidade < qtd) {
    return res.status(400).json({ error: 'Saldo insuficiente no estoque.' });
  }

  if (tipoMovimento === 'ENTRADA') {
    est.quantidade += qtd;
  } else {
    est.quantidade -= qtd;
  }
  est.updatedAt = new Date().toISOString();

  saveDb(db);
  res.json({ success: true, estoque: est });
});

// -------------------------------------------------------------
// 5. REBANHO & POSIÇÃO ATUAL
// -------------------------------------------------------------
app.get('/api/rebanho', (req, res) => {
  const db = getDb();
  const baiasComLotacao = db.baias.map(b => {
    const lot = db.lotacao[b.baia] || db.lotacao[b.baia.replace(/^0+/, '')] || null;
    return { ...b, lotacaoSpecs: lot };
  });

  const totalAnimais = db.baias.reduce((acc, b) => acc + (b.qtdAnimais || 0), 0);
  const curraisOcupados = db.baias.filter(b => (b.qtdAnimais || 0) > 0).length;
  const prontosEmbarque = db.baias.filter(b => {
    return (b.pesoAbatePrev && b.pesoEstimadoHoje && b.pesoEstimadoHoje >= b.pesoAbatePrev) ||
           (b.diasConfin && b.diasConfin >= 90 && b.qtdAnimais > 0);
  }).length;

  res.json({
    baias: baiasComLotacao,
    resumo: {
      totalAnimais,
      curraisOcupados,
      prontosEmbarque,
      totalLotes: db.baias.length,
      lastUpdate: db.lastUpdate || '2026-10-11T17:00:00'
    }
  });
});

// -------------------------------------------------------------
// 6. IMPORTAÇÃO DE RELATÓRIOS (Excel / PDF)
// -------------------------------------------------------------
app.post('/api/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const filename = req.file.originalname.toLowerCase();
    let lotes = [];

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      lotes = parseExcelLotesAtivos(req.file.buffer);
    } else if (filename.endsWith('.pdf')) {
      lotes = await parsePdfLotesAtivos(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Formato inválido. Apenas .xlsx, .xls ou .pdf são aceitos.' });
    }

    const db = getDb();
    const comparacao = lotes.map(novo => {
      const atual = db.baias.find(b => b.baia === novo.baia || b.baia === novo.curralOriginal);
      return {
        novo,
        atual: atual || null,
        status: !atual ? 'NOVO_LOTE' : (atual.qtdAnimais !== novo.qtdAnimais ? 'ALTERADO_QTD' : 'ATUALIZADO')
      };
    });

    const totalAnimais = lotes.reduce((acc, l) => acc + (l.qtdAnimais || 0), 0);

    res.json({
      filename: req.file.originalname,
      totalLotes: lotes.length,
      totalAnimais,
      itens: comparacao
    });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao processar arquivo: ' + err.message });
  }
});

app.post('/api/import/confirm', (req, res) => {
  try {
    const { lotes } = req.body;
    if (!lotes || !Array.isArray(lotes)) {
      return res.status(400).json({ error: 'Lista de lotes inválida.' });
    }

    const db = getDb();
    for (const novo of lotes) {
      const idx = db.baias.findIndex(b => b.baia === novo.baia || b.baia === novo.curralOriginal);
      if (idx >= 0) {
        db.baias[idx] = { ...db.baias[idx], ...novo, id: db.baias[idx].id };
      } else {
        db.baias.push({
          id: 'baia_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          ...novo
        });
      }
    }

    db.lastUpdate = new Date().toISOString();
    saveDb(db);

    res.json({ success: true, count: lotes.length, message: `${lotes.length} lotes sincronizados com sucesso!` });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao salvar dados: ' + err.message });
  }
});

// -------------------------------------------------------------
// 7. DASHBOARD & MOVIMENTAÇÕES
// -------------------------------------------------------------
app.get('/api/dashboard/movimentacoes', (req, res) => {
  const { dataInicio, dataFim, tipo, baia, categoria } = req.query;
  const db = getDb();

  let movs = db.movimentacoes || [];

  if (dataInicio) movs = movs.filter(m => m.data >= dataInicio);
  if (dataFim) movs = movs.filter(m => m.data <= dataFim);
  if (tipo) movs = movs.filter(m => m.tipo.toLowerCase().includes(tipo.toLowerCase()));
  if (baia) movs = movs.filter(m => String(m.baia).toLowerCase().includes(baia.toLowerCase()));
  if (categoria) movs = movs.filter(m => String(m.categoria).toLowerCase().includes(categoria.toLowerCase()));

  const porTipo = {};
  const porMes = {};
  let totalCabecas = 0;
  let valorTotalGeral = 0;

  movs.forEach(m => {
    porTipo[m.tipo] = (porTipo[m.tipo] || 0) + (m.quantidade || 0);
    const mes = m.data ? m.data.substring(0, 7) : 'Sem data';
    if (!porMes[mes]) porMes[mes] = { mes, entradas: 0, saidas: 0, mortes: 0 };

    if (m.tipo.includes('ENTRADA')) porMes[mes].entradas += (m.quantidade || 0);
    else if (m.tipo.includes('VENDA') || m.tipo.includes('ABATE') || m.tipo.includes('SAÍDA')) porMes[mes].saidas += (m.quantidade || 0);
    else if (m.tipo.includes('MORTE')) porMes[mes].mortes += (m.quantidade || 0);

    totalCabecas += (m.quantidade || 0);
    valorTotalGeral += (m.valorTotal || 0);
  });

  res.json({
    movimentacoes: movs,
    totalRegistros: movs.length,
    totalCabecas,
    valorTotalGeral,
    porTipo,
    evolucaoMensal: Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes))
  });
});

// -------------------------------------------------------------
// 8. EXPORTAÇÕES (EXCEL XLSX)
// -------------------------------------------------------------
app.get('/api/export/excel', (req, res) => {
  const { tipo, dataInicio, dataFim } = req.query;
  const db = getDb();
  const wb = XLSX.utils.book_new();

  if (tipo === 'movimentacoes') {
    let movs = db.movimentacoes || [];
    if (dataInicio) movs = movs.filter(m => m.data >= dataInicio);
    if (dataFim) movs = movs.filter(m => m.data <= dataFim);

    const dataRows = movs.map(m => ({
      'Lote': m.lote,
      'Baia': m.baia,
      'Data': m.data,
      'Tipo de Movimento': m.tipo,
      'Quantidade (Cab)': m.quantidade,
      'Categoria': m.categoria,
      'Peso (kg)': m.peso,
      'Preço R$/@': m.precoArroba,
      'Valor Total (R$)': m.valorTotal,
      'Origem / Destino': m.origemDestino,
      'Observações': m.obs
    }));

    const ws = XLSX.utils.json_to_sheet(dataRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Movimentações');
  } else {
    const dataRows = db.baias.map(b => ({
      'Baia': b.baia,
      'Lote': b.lote,
      'Raça': b.raca,
      'Categoria': b.categoria,
      'Nº Animais': b.qtdAnimais,
      'Data Entrada': b.dataEntrada,
      'Peso Entrada (kg)': b.pesoEntrada,
      'Dieta Atual': b.dieta,
      'Dias Confinamento': b.diasConfin,
      'Consumo MO': b.consumoMO,
      'GPD (kg/dia)': b.gpd,
      'Peso Abate Previsto (kg)': b.pesoAbatePrev,
      'Peso Estimado Hoje (kg)': b.pesoEstimadoHoje,
      'Previsão Embarque': b.dataEstimadaEmbarque,
      'Observações': b.obs
    }));

    const ws = XLSX.utils.json_to_sheet(dataRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Rebanho Atual');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename=relatorio_${tipo || 'rebanho'}_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.listen(PORT, () => {
  console.log(`Gestão de Dados de Confinamento rodando em http://localhost:${PORT}`);
  console.log(`Supabase Conectado: ${isSupabaseConfigured ? 'SIM' : 'NÃO (armazenamento local)'}`);
});
