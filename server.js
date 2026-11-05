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
// DATABASE MAPPERS (SUPABASE SNAKE_CASE <-> JS CAMELCASE)
// -------------------------------------------------------------
function rowToUnit(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    type: r.type || 'Geral / Fazenda',
    capacity: Number(r.capacity) || 0,
    active: r.active !== undefined ? r.active : true,
    createdAt: r.created_at || r.createdAt
  };
}

function rowToEstoque(r) {
  if (!r) return null;
  return {
    id: r.id,
    unitId: r.unit_id || r.unitId,
    item: r.item,
    tipo: r.tipo || 'Suprimento',
    quantidade: Number(r.quantidade) || 0,
    unidadeMedida: r.unidade_medida || r.unidadeMedida || 'Un',
    minimo: Number(r.minimo) || 0,
    maximo: Number(r.maximo) || 0,
    updatedAt: r.updated_at || r.updatedAt || new Date().toISOString()
  };
}

function estoqueToRow(e) {
  return {
    id: e.id,
    unit_id: e.unitId,
    item: e.item,
    tipo: e.tipo || 'Suprimento',
    quantidade: Number(e.quantidade) || 0,
    unidade_medida: e.unidadeMedida || 'Un',
    minimo: Number(e.minimo) || 0,
    maximo: Number(e.maximo) || 0,
    updated_at: new Date().toISOString()
  };
}

function rowToTransferencia(r) {
  if (!r) return null;
  return {
    id: r.id,
    numero: r.numero,
    dataCriacao: r.data_criacao || r.dataCriacao,
    dataNecessidade: r.data_necessidade || r.dataNecessidade,
    solicitanteUserId: r.solicitante_user_id || r.solicitanteUserId,
    solicitanteNome: r.solicitante_nome || r.solicitanteNome,
    solicitanteUnitId: r.solicitante_unit_id || r.solicitanteUnitId,
    solicitanteUnitNome: r.solicitante_unit_nome || r.solicitanteUnitNome,
    remetenteUnitId: r.remetente_unit_id || r.remetenteUnitId,
    remetenteUnitNome: r.remetente_unit_nome || r.remetenteUnitNome,
    material: r.material,
    volumeSolicitado: Number(r.volume_solicitado !== undefined ? r.volume_solicitado : r.volumeSolicitado),
    unidadeMedida: r.unidade_medida || r.unidadeMedida || 'Un',
    status: r.status,
    volumeAprovado: r.volume_aprovado !== null && r.volume_aprovado !== undefined ? Number(r.volume_aprovado) : (r.volumeAprovado !== null && r.volumeAprovado !== undefined ? Number(r.volumeAprovado) : null),
    dataPrevisaoEnvio: r.data_previsao_envio || r.dataPrevisaoEnvio,
    justificativaRejeicao: r.justificativa_rejeicao || r.justificativaRejeicao,
    dadosEnvio: r.dados_envio || r.dadosEnvio,
    dadosRecebimento: r.dados_recebimento || r.dadosRecebimento,
    documentos: r.documentos || [],
    createdAt: r.created_at || r.createdAt
  };
}

function transferenciaToRow(t) {
  return {
    id: t.id,
    numero: t.numero,
    data_criacao: t.dataCriacao,
    data_necessidade: t.dataNecessidade,
    solicitante_user_id: t.solicitanteUserId,
    solicitante_nome: t.solicitanteNome,
    solicitante_unit_id: t.solicitanteUnitId,
    solicitante_unit_nome: t.solicitanteUnitNome,
    remetente_unit_id: t.remetenteUnitId,
    remetente_unit_nome: t.remetenteUnitNome,
    material: t.material,
    volume_solicitado: Number(t.volumeSolicitado),
    unidade_medida: t.unidadeMedida,
    status: t.status,
    volume_aprovado: t.volumeAprovado !== null && t.volumeAprovado !== undefined ? Number(t.volumeAprovado) : null,
    data_previsao_envio: t.dataPrevisaoEnvio || null,
    justificativa_rejeicao: t.justificativaRejeicao || null,
    dados_envio: t.dadosEnvio || null,
    dados_recebimento: t.dadosRecebimento || null,
    documentos: t.documentos || [],
    updated_at: new Date().toISOString()
  };
}

function rowToEmbarque(r) {
  if (!r) return null;
  return {
    id: r.id,
    dataEmbarque: r.data_embarque || r.dataEmbarque,
    origemUnidadeId: r.origem_unidade_id || r.origemUnidadeId,
    origemUnidadeNome: r.origem_unidade_nome || r.origemUnidadeNome,
    destinoUnidadeId: r.destino_unidade_id || r.destinoUnidadeId,
    destinoUnidadeNome: r.destino_unidade_nome || r.destinoUnidadeNome,
    qtdCabecas: Number(r.qtd_cabecas !== undefined ? r.qtd_cabecas : r.qtdCabecas),
    categoria: r.categoria,
    tipoCarga: r.tipo_carga || r.tipoCarga || 'Gado',
    observacoes: r.observacoes,
    criadoPorUserId: r.criado_por_user_id || r.criadoPorUserId,
    criadoPorNome: r.criado_por_nome || r.criadoPorNome,
    criadoPorRole: r.criado_por_role || r.criadoPorRole,
    status: r.status,
    documentos: r.documentos || [],
    createdAt: r.created_at || r.createdAt
  };
}

function embarqueToRow(e) {
  return {
    id: e.id,
    data_embarque: e.dataEmbarque,
    origem_unidade_id: e.origemUnidadeId,
    origem_unidade_nome: e.origemUnidadeNome,
    destino_unidade_id: e.destinoUnidadeId,
    destino_unidade_nome: e.destinoUnidadeNome,
    qtd_cabecas: Number(e.qtdCabecas),
    categoria: e.categoria,
    tipo_carga: e.tipoCarga || 'Gado',
    observacoes: e.observacoes,
    criado_por_user_id: e.criadoPorUserId,
    criado_por_nome: e.criadoPorNome,
    criado_por_role: e.criadoPorRole,
    status: e.status || 'PROGRAMADO',
    documentos: e.documentos || [],
    updated_at: new Date().toISOString()
  };
}

function rowToBaia(r) {
  if (!r) return null;
  return {
    id: r.id,
    lote: r.lote,
    baia: r.baia,
    raca: r.raca,
    categoria: r.categoria,
    qtdAnimais: Number(r.qtd_animais !== undefined ? r.qtd_animais : r.qtdAnimais) || 0,
    dataEntrada: r.data_entrada || r.dataEntrada,
    pesoEntrada: r.peso_entrada || r.pesoEntrada,
    dieta: r.dieta,
    dtAdap: r.dt_adap || r.dtAdap,
    diasAdap: r.dias_adap || r.diasAdap,
    dtTerm: r.dt_term || r.dtTerm,
    diasTerm: r.dias_term || r.diasTerm,
    diasConfin: r.dias_confin || r.diasConfin,
    consumoMO: r.consumo_mo || r.consumoMO,
    gpd: r.gpd,
    pesoAbatePrev: r.peso_abate_prev || r.pesoAbatePrev,
    pesoEstimadoHoje: r.peso_estimado_hoje || r.pesoEstimadoHoje,
    dataEstimadaEmbarque: r.data_estimada_embarque || r.dataEstimadaEmbarque,
    obs: r.obs
  };
}

function baiaToRow(b) {
  return {
    id: b.id || (b.baia + '_' + b.lote),
    lote: b.lote,
    baia: b.baia,
    raca: b.raca || 'NE',
    categoria: b.categoria || 'Macho',
    qtd_animais: Number(b.qtdAnimais) || 0,
    data_entrada: b.dataEntrada || null,
    peso_entrada: b.pesoEntrada ? Number(b.pesoEntrada) : null,
    dieta: b.dieta || '',
    dt_adap: b.dtAdap || null,
    dias_adap: b.diasAdap ? Number(b.diasAdap) : 0,
    dt_term: b.dtTerm || null,
    dias_term: b.diasTerm ? Number(b.diasTerm) : 0,
    dias_confin: b.diasConfin ? Number(b.diasConfin) : 0,
    consumo_mo: b.consumoMO ? Number(b.consumoMO) : 0,
    gpd: b.gpd ? Number(b.gpd) : 1.4,
    peso_abate_prev: b.pesoAbatePrev ? Number(b.pesoAbatePrev) : null,
    peso_estimado_hoje: b.pesoEstimadoHoje ? Number(b.pesoEstimadoHoje) : null,
    data_estimada_embarque: b.dataEstimadaEmbarque || null,
    obs: b.obs || '',
    updated_at: new Date().toISOString()
  };
}

// -------------------------------------------------------------
// 2. GESTÃO DE UNIDADES (Supabase PostgreSQL + Fallback Local)
// -------------------------------------------------------------
app.get('/api/units', async (req, res) => {
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('units').select('*').order('name');
      if (!error && data && data.length > 0) {
        return res.json(data.map(rowToUnit));
      }
    } catch (e) {
      console.warn('Erro ao ler units do Supabase:', e.message);
    }
  }
  const db = getDb();
  res.json(db.units || []);
});

app.post('/api/units', async (req, res) => {
  const { name, code, type, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome da unidade obrigatório.' });

  const newUnit = {
    id: 'unit_' + Date.now(),
    name,
    code: code || name.toUpperCase().replace(/\s+/g, '_').slice(0, 15),
    type: type || 'Geral / Fazenda',
    capacity: Number(capacity) || 0,
    active: true,
    created_at: new Date().toISOString()
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('units').insert([newUnit]).select().single();
      if (!error && data) {
        const saved = rowToUnit(data);
        const db = getDb();
        db.units.push(saved);
        saveDb(db);
        return res.json(saved);
      }
    } catch (e) {
      console.warn('Erro insert unit Supabase:', e.message);
    }
  }

  const db = getDb();
  db.units.push(newUnit);
  saveDb(db);
  res.json(newUnit);
});

app.put('/api/units/:id', async (req, res) => {
  const { id } = req.params;
  const { name, code, type, capacity, active } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (code !== undefined) updates.code = code;
  if (type !== undefined) updates.type = type;
  if (capacity !== undefined) updates.capacity = Number(capacity);
  if (active !== undefined) updates.active = active;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('units').update(updates).eq('id', id).select().single();
      if (!error && data) {
        const updated = rowToUnit(data);
        const db = getDb();
        const idx = db.units.findIndex(u => u.id === id);
        if (idx !== -1) db.units[idx] = updated;
        saveDb(db);
        return res.json(updated);
      }
    } catch (e) {
      console.warn('Erro update unit Supabase:', e.message);
    }
  }

  const db = getDb();
  const unit = db.units.find(u => u.id === id);
  if (!unit) return res.status(404).json({ error: 'Unidade não encontrada' });
  Object.assign(unit, updates);
  saveDb(db);
  res.json(unit);
});

app.delete('/api/units/:id', async (req, res) => {
  const { id } = req.params;
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin.from('units').delete().eq('id', id);
    } catch (e) {
      console.warn('Erro delete unit Supabase:', e.message);
    }
  }
  const db = getDb();
  db.units = db.units.filter(u => u.id !== id);
  saveDb(db);
  res.json({ success: true });
});

// -------------------------------------------------------------
// 3. PROGRAMAÇÃO DE EMBARQUES & AGENDAMENTOS (Supabase)
// -------------------------------------------------------------
app.get('/api/embarques', async (req, res) => {
  const { unitId, status } = req.query;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      let q = supabaseAdmin.from('programacao_embarques').select('*').order('data_embarque');
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (!error && data) {
        let list = data.map(rowToEmbarque);
        if (unitId) {
          list = list.filter(e => e.origemUnidadeId === unitId || e.destinoUnidadeId === unitId);
        }
        return res.json(list);
      }
    } catch (e) {
      console.warn('Erro ao ler embarques do Supabase:', e.message);
    }
  }

  const db = getDb();
  let embarques = db.programacaoEmbarques || [];
  if (unitId) {
    embarques = embarques.filter(e => e.origemUnidadeId === unitId || e.destinoUnidadeId === unitId);
  }
  if (status) {
    embarques = embarques.filter(e => e.status === status);
  }
  embarques.sort((a, b) => new Date(a.dataEmbarque) - new Date(b.dataEmbarque));
  res.json(embarques);
});

app.post('/api/embarques', async (req, res) => {
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

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isSupervisorRemetente = usuarioRole === 'supervisor' && usuarioUnitId === origemUnidadeId;

  if (!isGestorOuAdmin && !isSupervisorRemetente) {
    return res.status(403).json({ error: 'Apenas o titular/supervisor da unidade remetente ou gestores podem programar embarques.' });
  }

  // Obter nomes das unidades
  let origemNome = 'Origem';
  let destinoNome = 'Destino';

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: uList } = await supabaseAdmin.from('units').select('id, name');
      if (uList) {
        const uO = uList.find(u => u.id === origemUnidadeId);
        const uD = uList.find(u => u.id === destinoUnidadeId);
        if (uO) origemNome = uO.name;
        if (uD) destinoNome = uD.name;
      }
    } catch (e) {}
  } else {
    const db = getDb();
    const uO = db.units.find(u => u.id === origemUnidadeId);
    const uD = db.units.find(u => u.id === destinoUnidadeId);
    if (uO) origemNome = uO.name;
    if (uD) destinoNome = uD.name;
  }

  const novoEmbarque = {
    id: 'emb_' + Date.now(),
    dataEmbarque,
    origemUnidadeId,
    origemUnidadeNome: origemNome,
    destinoUnidadeId,
    destinoUnidadeNome: destinoNome,
    qtdCabecas: Number(qtdCabecas) || 0,
    categoria: categoria || 'Geral',
    tipoCarga: tipoCarga || 'Gado',
    observacoes: observacoes || '',
    criadoPorUserId: usuarioId,
    criadoPorNome: usuarioNome,
    criadoPorRole: usuarioRole,
    status: 'PROGRAMADO',
    documentos: [],
    createdAt: new Date().toISOString()
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const row = embarqueToRow(novoEmbarque);
      const { data, error } = await supabaseAdmin.from('programacao_embarques').insert([row]).select().single();
      if (!error && data) {
        const saved = rowToEmbarque(data);
        const db = getDb();
        db.programacaoEmbarques.push(saved);
        saveDb(db);
        return res.json(saved);
      }
    } catch (e) {
      console.warn('Erro ao inserir embarque no Supabase:', e.message);
    }
  }

  const db = getDb();
  db.programacaoEmbarques.push(novoEmbarque);
  saveDb(db);
  res.json(novoEmbarque);
});

app.put('/api/embarques/:id', async (req, res) => {
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

  let embAtual = null;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('programacao_embarques').select('*').eq('id', id).single();
      if (data) embAtual = rowToEmbarque(data);
    } catch (e) {}
  }

  if (!embAtual) {
    const db = getDb();
    embAtual = db.programacaoEmbarques.find(e => e.id === id);
  }

  if (!embAtual) return res.status(404).json({ error: 'Agendamento de embarque não encontrado.' });

  const isCriador = embAtual.criadoPorUserId === usuarioId;
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';

  if (!isCriador && !isGestorOuAdmin) {
    return res.status(403).json({ error: 'Apenas quem programou o embarque ou um Gestor/Admin podem editá-lo.' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (dataEmbarque !== undefined) updates.data_embarque = dataEmbarque;
  if (origemUnidadeId !== undefined) updates.origem_unidade_id = origemUnidadeId;
  if (destinoUnidadeId !== undefined) updates.destino_unidade_id = destinoUnidadeId;
  if (qtdCabecas !== undefined) updates.qtd_cabecas = Number(qtdCabecas);
  if (categoria !== undefined) updates.categoria = categoria;
  if (tipoCarga !== undefined) updates.tipo_carga = tipoCarga;
  if (observacoes !== undefined) updates.observacoes = observacoes;
  if (status !== undefined) updates.status = status;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('programacao_embarques').update(updates).eq('id', id).select().single();
      if (!error && data) {
        const updated = rowToEmbarque(data);
        const db = getDb();
        const idx = db.programacaoEmbarques.findIndex(e => e.id === id);
        if (idx !== -1) db.programacaoEmbarques[idx] = updated;
        saveDb(db);
        return res.json(updated);
      }
    } catch (e) {
      console.warn('Erro update embarque Supabase:', e.message);
    }
  }

  const db = getDb();
  const emb = db.programacaoEmbarques.find(e => e.id === id);
  if (dataEmbarque !== undefined) emb.dataEmbarque = dataEmbarque;
  if (qtdCabecas !== undefined) emb.qtdCabecas = Number(qtdCabecas);
  if (categoria !== undefined) emb.categoria = categoria;
  if (tipoCarga !== undefined) emb.tipoCarga = tipoCarga;
  if (observacoes !== undefined) emb.observacoes = observacoes;
  if (status !== undefined) emb.status = status;
  emb.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(emb);
});

app.post('/api/embarques/:id/documentos', upload.single('documento'), async (req, res) => {
  const { id } = req.params;
  const { tipoDoc, usuarioNome } = req.body;
  const nomeArquivo = req.file ? req.file.originalname : (req.body.nomeArquivo || 'Documento_' + Date.now());

  const novoDoc = {
    id: 'doc_' + Date.now(),
    nome: nomeArquivo,
    tipo: tipoDoc || 'GTA',
    tamanho: req.file ? req.file.size : 0,
    enviadoPor: usuarioNome || 'Usuário',
    dataUpload: new Date().toISOString().split('T')[0]
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: cur } = await supabaseAdmin.from('programacao_embarques').select('documentos').eq('id', id).single();
      if (cur) {
        const docList = Array.isArray(cur.documentos) ? cur.documentos : [];
        docList.push(novoDoc);
        const { data: updated } = await supabaseAdmin.from('programacao_embarques').update({
          documentos: docList,
          updated_at: new Date().toISOString()
        }).eq('id', id).select().single();
        return res.json({ success: true, documento: novoDoc, embarque: rowToEmbarque(updated) });
      }
    } catch (e) {
      console.warn('Erro anexo doc embarque Supabase:', e.message);
    }
  }

  const db = getDb();
  const emb = db.programacaoEmbarques.find(e => e.id === id);
  if (!emb) return res.status(404).json({ error: 'Embarque não encontrado.' });
  if (!emb.documentos) emb.documentos = [];
  emb.documentos.push(novoDoc);
  saveDb(db);
  res.json({ success: true, documento: novoDoc, embarque: emb });
});

// -------------------------------------------------------------
// 4. ESTOQUES DE GADO & SUPRIMENTOS (Supabase PostgreSQL)
// -------------------------------------------------------------
app.get('/api/estoques', async (req, res) => {
  const { unitId } = req.query;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      let q = supabaseAdmin.from('estoques').select('*').order('item');
      if (unitId) q = q.eq('unit_id', unitId);
      const { data, error } = await q;
      if (!error && data) {
        return res.json(data.map(rowToEstoque));
      }
    } catch (e) {
      console.warn('Erro ao ler estoques do Supabase:', e.message);
    }
  }

  const db = getDb();
  let estoques = db.estoques || [];
  if (unitId) estoques = estoques.filter(e => e.unitId === unitId);
  res.json(estoques);
});

app.post('/api/estoques', async (req, res) => {
  const { unitId, item, tipo, quantidade, unidadeMedida, minimo, maximo, usuarioRole } = req.body;
  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode cadastrar novos estoques para as unidades.' });
  }

  const novoEstoque = {
    id: 'est_' + Date.now(),
    unitId,
    item,
    tipo: tipo || 'Suprimento',
    quantidade: Number(quantidade) || 0,
    unidadeMedida: unidadeMedida || 'Un',
    minimo: Number(minimo) || 0,
    maximo: Number(maximo) || 0,
    updatedAt: new Date().toISOString()
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const row = estoqueToRow(novoEstoque);
      const { data, error } = await supabaseAdmin.from('estoques').insert([row]).select().single();
      if (!error && data) {
        const saved = rowToEstoque(data);
        const db = getDb();
        db.estoques.push(saved);
        saveDb(db);
        return res.json(saved);
      }
    } catch (e) {
      console.warn('Erro ao inserir estoque no Supabase:', e.message);
    }
  }

  const db = getDb();
  db.estoques.push(novoEstoque);
  saveDb(db);
  res.json(novoEstoque);
});

app.put('/api/estoques/:id', async (req, res) => {
  const { id } = req.params;
  const { unitId, item, tipo, quantidade, unidadeMedida, minimo, maximo, usuarioRole } = req.body;
  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode editar as configurações de estoque.' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (unitId !== undefined) updates.unit_id = unitId;
  if (item !== undefined) updates.item = item;
  if (tipo !== undefined) updates.tipo = tipo;
  if (quantidade !== undefined) updates.quantidade = Number(quantidade);
  if (unidadeMedida !== undefined) updates.unidade_medida = unidadeMedida;
  if (minimo !== undefined) updates.minimo = Number(minimo);
  if (maximo !== undefined) updates.maximo = Number(maximo);

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('estoques').update(updates).eq('id', id).select().single();
      if (!error && data) {
        const updated = rowToEstoque(data);
        const db = getDb();
        const idx = db.estoques.findIndex(e => e.id === id);
        if (idx !== -1) db.estoques[idx] = updated;
        saveDb(db);
        return res.json(updated);
      }
    } catch (e) {
      console.warn('Erro update estoque Supabase:', e.message);
    }
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

app.delete('/api/estoques/:id', async (req, res) => {
  const { id } = req.params;
  const { usuarioRole } = req.query;
  if (usuarioRole !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador pode remover um cadastro de estoque.' });
  }

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      await supabaseAdmin.from('estoques').delete().eq('id', id);
    } catch (e) {
      console.warn('Erro delete estoque Supabase:', e.message);
    }
  }

  const db = getDb();
  db.estoques = db.estoques.filter(e => e.id !== id);
  saveDb(db);
  res.json({ success: true });
});

app.post('/api/estoques/:id/movimentar', async (req, res) => {
  const { id } = req.params;
  const { tipoMovimento, quantidade, motivo, usuarioUnitId, usuarioRole, usuarioNome } = req.body;
  const qtd = Number(quantidade) || 0;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: estRow } = await supabaseAdmin.from('estoques').select('*').eq('id', id).single();
      if (estRow) {
        const est = rowToEstoque(estRow);
        const isTitular = usuarioRole === 'supervisor' && usuarioUnitId === est.unitId;
        const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
        if (!isTitular && !isGestorOuAdmin) {
          return res.status(403).json({ error: 'Somente o titular responsável pela unidade pode movimentar seus estoques.' });
        }
        if (tipoMovimento === 'SAIDA' && est.quantidade < qtd) {
          return res.status(400).json({ error: 'Saldo insuficiente no estoque.' });
        }
        const novaQtd = tipoMovimento === 'ENTRADA' ? (est.quantidade + qtd) : (est.quantidade - qtd);
        const { data: updatedRow } = await supabaseAdmin.from('estoques').update({
          quantidade: novaQtd,
          updated_at: new Date().toISOString()
        }).eq('id', id).select().single();

        return res.json({ success: true, estoque: rowToEstoque(updatedRow) });
      }
    } catch (e) {
      console.warn('Erro movimentar estoque Supabase:', e.message);
    }
  }

  const db = getDb();
  const est = db.estoques.find(e => e.id === id);
  if (!est) return res.status(404).json({ error: 'Estoque não encontrado.' });
  const isTitular = usuarioRole === 'supervisor' && usuarioUnitId === est.unitId;
  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  if (!isTitular && !isGestorOuAdmin) {
    return res.status(403).json({ error: 'Somente o titular responsável pela unidade pode movimentar seus estoques.' });
  }
  if (tipoMovimento === 'SAIDA' && est.quantidade < qtd) {
    return res.status(400).json({ error: 'Saldo insuficiente no estoque.' });
  }
  if (tipoMovimento === 'ENTRADA') est.quantidade += qtd;
  else est.quantidade -= qtd;
  est.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json({ success: true, estoque: est });
});

// -------------------------------------------------------------
// 5. SOLICITAÇÃO & TRANSFERÊNCIA DE INSUMOS (Supabase PostgreSQL)
// -------------------------------------------------------------
app.get('/api/transferencias-insumos', async (req, res) => {
  const { unitId } = req.query;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('transferencias_insumos')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        let list = data.map(rowToTransferencia);
        if (unitId) {
          list = list.filter(t => t.solicitanteUnitId === unitId || t.remetenteUnitId === unitId);
        }
        return res.json(list);
      }
    } catch (e) {
      console.warn('Erro ao ler transferencias_insumos do Supabase:', e.message);
    }
  }

  const db = getDb();
  let list = db.transferenciasInsumos || [];
  if (unitId) {
    list = list.filter(t => t.solicitanteUnitId === unitId || t.remetenteUnitId === unitId);
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.post('/api/transferencias-insumos', async (req, res) => {
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

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularSolicitante = usuarioRole === 'supervisor' && usuarioUnitId === solicitanteUnitId;

  if (!isGestorOuAdmin && !isTitularSolicitante) {
    return res.status(403).json({ error: 'Apenas o titular da unidade solicitante ou o gestor podem solicitar transferência de insumos.' });
  }

  let solicitanteNome = 'Solicitante';
  let remetenteNome = 'Remetente';
  let totalCount = 0;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: uList } = await supabaseAdmin.from('units').select('id, name');
      if (uList) {
        const uS = uList.find(u => u.id === solicitanteUnitId);
        const uR = uList.find(u => u.id === remetenteUnitId);
        if (uS) solicitanteNome = uS.name;
        if (uR) remetenteNome = uR.name;
      }
      const { count } = await supabaseAdmin.from('transferencias_insumos').select('*', { count: 'exact', head: true });
      totalCount = count || 0;
    } catch (e) {}
  } else {
    const db = getDb();
    const uS = db.units.find(u => u.id === solicitanteUnitId);
    const uR = db.units.find(u => u.id === remetenteUnitId);
    if (uS) solicitanteNome = uS.name;
    if (uR) remetenteNome = uR.name;
    totalCount = db.transferenciasInsumos.length;
  }

  const numeroSequencial = 1000 + (totalCount + 1);
  const numeroSolicitacao = 'SOL-' + numeroSequencial;

  const novaSolicitacao = {
    id: 'sol_' + Date.now(),
    numero: numeroSolicitacao,
    dataCriacao: new Date().toISOString().split('T')[0],
    dataNecessidade,
    solicitanteUserId: usuarioId,
    solicitanteNome: usuarioNome,
    solicitanteUnitId,
    solicitanteUnitNome: solicitanteNome,
    remetenteUnitId,
    remetenteUnitNome: remetenteNome,
    material,
    volumeSolicitado: Number(volumeSolicitado),
    unidadeMedida: unidadeMedida || 'Un',
    status: 'PENDENTE',
    volumeAprovado: null,
    dataPrevisaoEnvio: null,
    justificativaRejeicao: null,
    dadosEnvio: null,
    dadosRecebimento: null,
    documentos: [],
    createdAt: new Date().toISOString()
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const row = transferenciaToRow(novaSolicitacao);
      const { data, error } = await supabaseAdmin.from('transferencias_insumos').insert([row]).select().single();
      if (!error && data) {
        const saved = rowToTransferencia(data);
        const db = getDb();
        db.transferenciasInsumos.push(saved);
        saveDb(db);
        return res.json(saved);
      }
    } catch (e) {
      console.warn('Erro ao inserir transferencia no Supabase:', e.message);
    }
  }

  const db = getDb();
  db.transferenciasInsumos.push(novaSolicitacao);
  saveDb(db);
  res.json(novaSolicitacao);
});

// Responder à solicitação (Aceitar -> TRANSFERÊNCIA CONFIRMADA, ou Rejeitar)
app.post('/api/transferencias-insumos/:id/responder', async (req, res) => {
  const { id } = req.params;
  const {
    decisao,
    volumeAprovado,
    dataPrevisaoEnvio,
    justificativaRejeicao,
    usuarioId,
    usuarioNome,
    usuarioRole,
    usuarioUnitId
  } = req.body;

  let sol = null;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('transferencias_insumos').select('*').eq('id', id).single();
      if (data) sol = rowToTransferencia(data);
    } catch (e) {}
  }

  if (!sol) {
    const db = getDb();
    sol = db.transferenciasInsumos.find(t => t.id === id);
  }

  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularRemetente = usuarioRole === 'supervisor' && usuarioUnitId === sol.remetenteUnitId;

  if (!isGestorOuAdmin && !isTitularRemetente) {
    return res.status(403).json({ error: 'Apenas o titular da unidade remetente ou gestores podem responder a esta solicitação.' });
  }

  const updates = { updated_at: new Date().toISOString() };

  if (decisao === 'REJEITAR') {
    if (!justificativaRejeicao) {
      return res.status(400).json({ error: 'É obrigatório informar uma justificativa ao rejeitar a solicitação.' });
    }
    updates.status = 'REJEITADA';
    updates.justificativa_rejeicao = justificativaRejeicao;
    sol.status = 'REJEITADA';
    sol.justificativaRejeicao = justificativaRejeicao;
  } else if (decisao === 'ACEITAR') {
    if (!dataPrevisaoEnvio || !volumeAprovado) {
      return res.status(400).json({ error: 'Ao aceitar, confirme a data prevista para envio e o volume aprovado.' });
    }
    updates.status = 'CONFIRMADA';
    updates.volume_aprovado = Number(volumeAprovado);
    updates.data_previsao_envio = dataPrevisaoEnvio;
    sol.status = 'CONFIRMADA';
    sol.volumeAprovado = Number(volumeAprovado);
    sol.dataPrevisaoEnvio = dataPrevisaoEnvio;
  } else {
    return res.status(400).json({ error: 'Decisão inválida. Escolha ACEITAR ou REJEITAR.' });
  }

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('transferencias_insumos').update(updates).eq('id', id).select().single();
      if (!error && data) {
        sol = rowToTransferencia(data);
      }
    } catch (e) {
      console.warn('Erro update responder transferencia Supabase:', e.message);
    }
  }

  const db = getDb();
  const idx = db.transferenciasInsumos.findIndex(t => t.id === id);
  if (idx !== -1) db.transferenciasInsumos[idx] = sol;
  saveDb(db);

  res.json({ success: true, solicitacao: sol });
});

// Confirmar Envio do Material (Unidade Remetente): Baixa automática no estoque!
app.post('/api/transferencias-insumos/:id/enviar', async (req, res) => {
  const { id } = req.params;
  const { motorista, numeroNF, usuarioUnitId, usuarioRole, usuarioNome } = req.body;

  if (!motorista) {
    return res.status(400).json({ error: 'Informe o nome do motorista transportador.' });
  }

  let sol = null;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('transferencias_insumos').select('*').eq('id', id).single();
      if (data) sol = rowToTransferencia(data);
    } catch (e) {}
  }

  if (!sol) {
    const db = getDb();
    sol = db.transferenciasInsumos.find(t => t.id === id);
  }

  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularRemetente = usuarioRole === 'supervisor' && usuarioUnitId === sol.remetenteUnitId;

  if (!isGestorOuAdmin && !isTitularRemetente) {
    return res.status(403).json({ error: 'Apenas o titular da unidade remetente pode confirmar o envio do material.' });
  }

  const volumeEnvio = sol.volumeAprovado || sol.volumeSolicitado;

  // Localizar e subtrair estoque no Supabase
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: estRows } = await supabaseAdmin
        .from('estoques')
        .select('*')
        .eq('unit_id', sol.remetenteUnitId);

      const estRem = (estRows || []).find(e => e.item.trim().toLowerCase() === sol.material.trim().toLowerCase());
      if (estRem) {
        if (Number(estRem.quantidade) < volumeEnvio) {
          return res.status(400).json({
            error: `Saldo insuficiente na unidade remetente. Saldo disponível: ${estRem.quantidade} ${estRem.unidade_medida}, Volume do envio: ${volumeEnvio}`
          });
        }
        await supabaseAdmin.from('estoques').update({
          quantidade: Number(estRem.quantidade) - volumeEnvio,
          updated_at: new Date().toISOString()
        }).eq('id', estRem.id);
      }
    } catch (e) {
      console.warn('Erro ao baixar estoque no Supabase:', e.message);
    }
  }

  // Baixa local db.json
  const db = getDb();
  const estLocal = db.estoques.find(e => 
    e.unitId === sol.remetenteUnitId && 
    e.item.trim().toLowerCase() === sol.material.trim().toLowerCase()
  );
  if (estLocal) {
    estLocal.quantidade -= volumeEnvio;
    estLocal.updatedAt = new Date().toISOString();
  }

  const dadosEnvio = {
    motorista,
    numeroNF: numeroNF || '',
    dataEnvio: new Date().toISOString().split('T')[0],
    enviadoPor: usuarioNome
  };

  sol.status = 'ENVIADA';
  sol.dadosEnvio = dadosEnvio;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('transferencias_insumos').update({
        status: 'ENVIADA',
        dados_envio: dadosEnvio,
        updated_at: new Date().toISOString()
      }).eq('id', id).select().single();
      if (data) sol = rowToTransferencia(data);
    } catch (e) {
      console.warn('Erro update envio transferencia Supabase:', e.message);
    }
  }

  const idx = db.transferenciasInsumos.findIndex(t => t.id === id);
  if (idx !== -1) db.transferenciasInsumos[idx] = sol;
  saveDb(db);

  res.json({
    success: true,
    message: `Envio confirmado! Saldo de ${volumeEnvio} subtraído do estoque da unidade remetente.`,
    solicitacao: sol
  });
});

// Confirmar Recebimento do Material (Unidade Destinatária): Soma automática e arquivamento!
app.post('/api/transferencias-insumos/:id/receber', async (req, res) => {
  const { id } = req.params;
  const { usuarioUnitId, usuarioRole, usuarioNome } = req.body;

  let sol = null;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('transferencias_insumos').select('*').eq('id', id).single();
      if (data) sol = rowToTransferencia(data);
    } catch (e) {}
  }

  if (!sol) {
    const db = getDb();
    sol = db.transferenciasInsumos.find(t => t.id === id);
  }

  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  const isGestorOuAdmin = usuarioRole === 'admin' || usuarioRole === 'gestor';
  const isTitularDestino = usuarioRole === 'supervisor' && usuarioUnitId === sol.solicitanteUnitId;

  if (!isGestorOuAdmin && !isTitularDestino) {
    return res.status(403).json({ error: 'Apenas o titular da unidade solicitante/destinatária pode confirmar o recebimento.' });
  }

  const volumeRecebido = sol.volumeAprovado || sol.volumeSolicitado;

  // Localizar ou criar estoque no destino no Supabase
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: estRows } = await supabaseAdmin
        .from('estoques')
        .select('*')
        .eq('unit_id', sol.solicitanteUnitId);

      const estDest = (estRows || []).find(e => e.item.trim().toLowerCase() === sol.material.trim().toLowerCase());
      if (estDest) {
        await supabaseAdmin.from('estoques').update({
          quantidade: Number(estDest.quantidade) + volumeRecebido,
          updated_at: new Date().toISOString()
        }).eq('id', estDest.id);
      } else {
        await supabaseAdmin.from('estoques').insert([{
          id: 'est_' + Date.now(),
          unit_id: sol.solicitanteUnitId,
          item: sol.material,
          tipo: 'Suprimento',
          quantidade: volumeRecebido,
          unidade_medida: sol.unidadeMedida,
          minimo: 0,
          maximo: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      }
    } catch (e) {
      console.warn('Erro ao somar estoque no Supabase:', e.message);
    }
  }

  // Localizar ou criar estoque local db.json
  const db = getDb();
  let estLocal = db.estoques.find(e => 
    e.unitId === sol.solicitanteUnitId && 
    e.item.trim().toLowerCase() === sol.material.trim().toLowerCase()
  );
  if (!estLocal) {
    estLocal = {
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
    db.estoques.push(estLocal);
  } else {
    estLocal.quantidade += volumeRecebido;
    estLocal.updatedAt = new Date().toISOString();
  }

  const dadosRecebimento = {
    dataRecebimento: new Date().toISOString().split('T')[0],
    recebidoPor: usuarioNome
  };

  sol.status = 'ARQUIVADA';
  sol.dadosRecebimento = dadosRecebimento;

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin.from('transferencias_insumos').update({
        status: 'ARQUIVADA',
        dados_recebimento: dadosRecebimento,
        updated_at: new Date().toISOString()
      }).eq('id', id).select().single();
      if (data) sol = rowToTransferencia(data);
    } catch (e) {
      console.warn('Erro update recebimento transferencia Supabase:', e.message);
    }
  }

  const idx = db.transferenciasInsumos.findIndex(t => t.id === id);
  if (idx !== -1) db.transferenciasInsumos[idx] = sol;
  saveDb(db);

  res.json({
    success: true,
    message: `Recebimento confirmado! Saldo de ${volumeRecebido} ${sol.unidadeMedida} incorporado ao estoque da sua unidade. Transferência arquivada com sucesso.`,
    solicitacao: sol
  });
});

// Anexar Documentos (NF / Comprovantes) na Transferência de Insumos
app.post('/api/transferencias-insumos/:id/documentos', upload.single('documento'), async (req, res) => {
  const { id } = req.params;
  const { tipoDoc, usuarioNome } = req.body;
  const nomeArquivo = req.file ? req.file.originalname : (req.body.nomeArquivo || 'Doc_' + Date.now());

  const novoDoc = {
    id: 'doc_' + Date.now(),
    nome: nomeArquivo,
    tipo: tipoDoc || 'NF',
    tamanho: req.file ? req.file.size : 0,
    enviadoPor: usuarioNome || 'Usuário',
    dataUpload: new Date().toISOString().split('T')[0]
  };

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data: cur } = await supabaseAdmin.from('transferencias_insumos').select('documentos').eq('id', id).single();
      if (cur) {
        const docList = Array.isArray(cur.documentos) ? cur.documentos : [];
        docList.push(novoDoc);
        const { data: updated } = await supabaseAdmin.from('transferencias_insumos').update({
          documentos: docList,
          updated_at: new Date().toISOString()
        }).eq('id', id).select().single();
        return res.json({ success: true, documento: novoDoc, solicitacao: rowToTransferencia(updated) });
      }
    } catch (e) {
      console.warn('Erro anexo doc transferencia Supabase:', e.message);
    }
  }

  const db = getDb();
  const sol = db.transferenciasInsumos.find(t => t.id === id);
  if (!sol) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (!sol.documentos) sol.documentos = [];
  sol.documentos.push(novoDoc);
  saveDb(db);
  res.json({ success: true, documento: novoDoc, solicitacao: sol });
});

// -------------------------------------------------------------
// 6. REBANHO & POSIÇÃO ATUAL (Supabase PostgreSQL)
// -------------------------------------------------------------
app.get('/api/rebanho', async (req, res) => {
  let baias = [];

  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.from('baias').select('*');
      if (!error && data && data.length > 0) {
        baias = data.map(rowToBaia);
        baias.sort((a, b) => {
          const numA = parseInt(a.baia, 10);
          const numB = parseInt(b.baia, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          if (!isNaN(numA)) return -1;
          if (!isNaN(numB)) return 1;
          return String(a.baia).localeCompare(String(b.baia), undefined, { numeric: true });
        });
      }
    } catch (e) {
      console.warn('Erro ao ler baias do Supabase:', e.message);
    }
  }

  if (baias.length === 0) {
    const db = getDb();
    baias = db.baias || [];
  }

  const totalAnimais = baias.reduce((acc, b) => acc + (b.qtdAnimais || 0), 0);
  const curraisOcupados = baias.filter(b => (b.qtdAnimais || 0) > 0).length;
  const prontosEmbarque = baias.filter(b => {
    return (b.pesoAbatePrev && b.pesoEstimadoHoje && b.pesoEstimadoHoje >= b.pesoAbatePrev) ||
           (b.diasConfin && b.diasConfin >= 90 && b.qtdAnimais > 0);
  }).length;

  res.json({
    baias,
    resumo: {
      totalAnimais,
      curraisOcupados,
      prontosEmbarque,
      totalLotes: baias.length,
      lastUpdate: new Date().toISOString()
    }
  });
});

// -------------------------------------------------------------
// 7. IMPORTAÇÃO DE RELATÓRIOS (Excel / PDF)
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

    let baiasAtuais = [];
    if (isSupabaseConfigured && supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin.from('baias').select('*');
        if (data) baiasAtuais = data.map(rowToBaia);
      } catch (e) {}
    }
    if (baiasAtuais.length === 0) {
      const db = getDb();
      baiasAtuais = db.baias || [];
    }

    const comparacao = lotes.map(novo => {
      const atual = baiasAtuais.find(b => b.baia === novo.baia || b.baia === novo.curralOriginal);
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

app.post('/api/import/confirm', async (req, res) => {
  try {
    const { lotes } = req.body;
    if (!lotes || !Array.isArray(lotes)) {
      return res.status(400).json({ error: 'Lista de lotes inválida.' });
    }

    // Persistir no Supabase
    if (isSupabaseConfigured && supabaseAdmin) {
      try {
        const rows = lotes.map(l => baiaToRow(l));
        await supabaseAdmin.from('baias').upsert(rows, { onConflict: 'baia' });
      } catch (e) {
        console.warn('Erro ao salvar baias no Supabase:', e.message);
      }
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

    res.json({ success: true, count: lotes.length, message: `${lotes.length} lotes sincronizados e salvos com sucesso!` });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao salvar dados: ' + err.message });
  }
});

// -------------------------------------------------------------
// 8. DASHBOARD & MOVIMENTAÇÕES (Supabase + Fallback)
// -------------------------------------------------------------
app.get('/api/dashboard/movimentacoes', async (req, res) => {
  const { dataInicio, dataFim, tipo, baia, categoria } = req.query;

  let movs = [];
  if (isSupabaseConfigured && supabaseAdmin) {
    try {
      let q = supabaseAdmin.from('movimentacoes').select('*');
      if (dataInicio) q = q.gte('data', dataInicio);
      if (dataFim) q = q.lte('data', dataFim);
      const { data, error } = await q;
      if (!error && data && data.length > 0) {
        movs = data.map(m => ({
          id: m.id,
          lote: m.lote,
          baia: m.baia,
          data: m.data,
          tipo: m.tipo,
          quantidade: m.quantidade,
          categoria: m.categoria,
          peso: m.peso,
          precoArroba: m.preco_arroba,
          valorTotal: m.valor_total,
          origemDestino: m.origem_destino,
          obs: m.obs
        }));
      }
    } catch (e) {}
  }

  if (movs.length === 0) {
    const db = getDb();
    movs = db.movimentacoes || [];
    if (dataInicio) movs = movs.filter(m => m.data >= dataInicio);
    if (dataFim) movs = movs.filter(m => m.data <= dataFim);
  }

  if (tipo) movs = movs.filter(m => (m.tipo || '').toLowerCase().includes(tipo.toLowerCase()));
  if (baia) movs = movs.filter(m => String(m.baia || '').toLowerCase().includes(baia.toLowerCase()));
  if (categoria) movs = movs.filter(m => String(m.categoria || '').toLowerCase().includes(categoria.toLowerCase()));

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
