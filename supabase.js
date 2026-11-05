require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Verifica se as credenciais do Supabase foram configuradas
const isSupabaseConfigured = Boolean(supabaseUrl && (supabaseAnonKey || supabaseServiceKey));

// Cliente para operações públicas / autenticadas
const supabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey)
  : null;

// Cliente com privilégios de Admin (service_role) para convidar usuários e gerenciar auth
const supabaseAdmin = isSupabaseConfigured && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : supabaseClient;

module.exports = {
  isSupabaseConfigured,
  supabaseUrl,
  supabaseAnonKey,
  supabaseClient,
  supabaseAdmin
};
