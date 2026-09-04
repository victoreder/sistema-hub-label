import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeBaseUrl(url: string) {
  return String(url || '').trim().replace(/\/+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Supabase env ausente' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Não autenticado' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const contaId = String(body?.contaId || '').trim();
    const instanceName = String(body?.instanceName || body?.nomeConexao || '').trim();
    if (!contaId || !instanceName) {
      return json({ error: 'contaId e instanceName são obrigatórios' }, 400);
    }
    if (/[^a-zA-ZÀ-ÿ0-9\s]/.test(instanceName)) {
      return json({ error: 'Nome da conexão inválido' }, 400);
    }

    let usuario = null;
    {
      const r1 = await admin.from('SAAS_Usuarios').select('contaId').eq('auth_user_id', userData.user.id).maybeSingle();
      usuario = r1.data;
      if (!usuario?.contaId) {
        const r2 = await admin.from('SAAS_Usuarios').select('contaId').eq('id', userData.user.id).maybeSingle();
        usuario = r2.data;
      }
    }
    if (!usuario?.contaId || String(usuario.contaId) !== contaId) {
      return json({ error: 'Conta não autorizada' }, 403);
    }

    const { data: cfg, error: cfgErr } = await admin
      .from('SAAS_Config_Uazapi')
      .select('url, token')
      .eq('id', 1)
      .maybeSingle();
    if (cfgErr || !cfg?.url || !cfg?.token) {
      return json({ error: 'UazAPI não configurada no admin (URL e token)' }, 400);
    }

    const baseUrl = normalizeBaseUrl(cfg.url);
    const adminToken = String(cfg.token).trim();

    const initRes = await fetch(`${baseUrl}/instance/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        admintoken: adminToken,
      },
      body: JSON.stringify({
        name: instanceName,
        systemName: 'hublabel',
        adminField01: contaId,
      }),
    });
    const initData = await initRes.json().catch(() => ({}));
    if (!initRes.ok) {
      return json({
        error: initData?.message || initData?.error || `Falha ao criar instância UazAPI (${initRes.status})`,
        details: initData,
      }, 502);
    }

    const instanceToken = String(initData?.token || initData?.instance?.token || '').trim();
    const savedName = String(initData?.name || initData?.instance?.name || instanceName).trim();
    if (!instanceToken) {
      return json({ error: 'UazAPI não retornou token da instância', details: initData }, 502);
    }

    let qrcode: string | null = initData?.qrcode || initData?.qrCode || null;
    try {
      const connectRes = await fetch(`${baseUrl}/instance/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: instanceToken,
        },
        body: JSON.stringify({}),
      });
      const connectData = await connectRes.json().catch(() => ({}));
      qrcode = connectData?.qrcode || connectData?.qrCode || connectData?.base64 || qrcode || null;
    } catch (_) {
      // QR pode ser obtido depois no front
    }

    const { data: inserted, error: insertErr } = await admin
      .from('SAAS_Conexões')
      .insert({
        instanceName: savedName,
        NomeConexao: instanceName,
        Apikey: instanceToken,
        contaId,
        apiOficial: false,
        provedorApi: 'uazapi',
        urlApi: baseUrl,
      })
      .select('*')
      .single();

    if (insertErr) {
      // tenta limpar instância órfã
      await fetch(`${baseUrl}/instance`, {
        method: 'DELETE',
        headers: { token: instanceToken },
      }).catch(() => null);
      return json({ error: insertErr.message || 'Falha ao salvar conexão' }, 500);
    }

    return json({
      ok: true,
      instanceName: savedName,
      apikey: instanceToken,
      qrcode,
      provedorApi: 'uazapi',
      urlApi: baseUrl,
      conexao: inserted,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Erro interno' }, 500);
  }
});
