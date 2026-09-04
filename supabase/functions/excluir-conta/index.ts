import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVOLUTION_BASE = Deno.env.get('EVOLUTION_URL') || 'https://evolution2.victoreder.com.br';
const STORAGE_BUCKET = 'arquivos';
const BRAND_PREFIXES = ['logo', 'favicon', 'LOGO PRINCIPAL', 'FAVICON', 'personalizacao/'];

type ValidarOk = {
  ok: true;
  contaId: string;
  auth_ids: string[];
  conexoes: Array<{
    id: number;
    instanceName: string | null;
    apikey: string | null;
    apiOficial: boolean;
    provedorApi?: string | null;
    urlApi?: string | null;
  }>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isBrandPath(name: string) {
  return BRAND_PREFIXES.some((p) => name === p || name.startsWith(p) || name.toLowerCase().startsWith(p.toLowerCase()));
}

function pathFromStorageUrl(url: string) {
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const markerSign = `/object/sign/${STORAGE_BUCKET}/`;
  const raw = String(url || '');
  const idx = raw.indexOf(marker);
  if (idx >= 0) return decodeURIComponent(raw.slice(idx + marker.length).split('?')[0]);
  const idx2 = raw.indexOf(markerSign);
  if (idx2 >= 0) return decodeURIComponent(raw.slice(idx2 + markerSign.length).split('?')[0]);
  return null;
}

async function evolutionDelete(instanceName: string, apikey: string) {
  const name = encodeURIComponent(instanceName);
  const headers = { apikey };
  await fetch(`${EVOLUTION_BASE}/instance/logout/${name}`, { method: 'DELETE', headers }).catch(() => null);
  const del = await fetch(`${EVOLUTION_BASE}/instance/delete/${name}`, { method: 'DELETE', headers });
  if (!del.ok && del.status !== 404) {
    console.warn('Evolution delete falhou', instanceName, del.status);
  }
}

async function uazapiDelete(urlApi: string, token: string) {
  const base = String(urlApi || '').replace(/\/+$/, '');
  if (!base || !token) return;
  const headers = { token, 'Content-Type': 'application/json' };
  await fetch(`${base}/instance/disconnect`, { method: 'POST', headers, body: '{}' }).catch(() => null);
  const del = await fetch(`${base}/instance`, { method: 'DELETE', headers });
  if (!del.ok && del.status !== 404) {
    console.warn('UazAPI delete falhou', base, del.status);
  }
}

async function listPrefix(admin: ReturnType<typeof createClient>, prefix: string) {
  const paths: string[] = [];
  const queue = [prefix.replace(/\/$/, '')];
  while (queue.length) {
    const current = queue.pop() as string;
    const { data } = await admin.storage.from(STORAGE_BUCKET).list(current || '', { limit: 1000 });
    for (const item of data || []) {
      const full = current ? `${current}/${item.name}` : item.name;
      if (item.id) paths.push(full);
      else queue.push(full);
    }
  }
  return paths;
}

async function removePaths(admin: ReturnType<typeof createClient>, paths: string[]) {
  const unique = [...new Set(paths.filter((p) => p && !isBrandPath(p)))];
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    if (!chunk.length) continue;
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) console.warn('Storage remove', error.message);
  }
  return unique.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, erro: 'Método inválido' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') || '';

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ ok: false, erro: 'Função sem credenciais' }, 500);
    }
    if (!authHeader) return json({ ok: false, erro: 'Não autenticado' }, 401);

    const body = await req.json().catch(() => ({}));
    const contaId = String(body.contaId || body.p_conta_id || '').trim();
    if (!contaId) return json({ ok: false, erro: 'contaId obrigatório' }, 400);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Validar usuário administrador
    const { data: validar, error: validarErr } = await userClient.rpc('f_admin_excluir_conta_validar', {
      p_conta_id: contaId,
    });
    if (validarErr) return json({ ok: false, erro: validarErr.message }, 400);
    if (!validar || validar.ok === false) {
      return json({ ok: false, erro: validar?.erro || 'Falha na validação' }, 403);
    }

    const payload = validar as ValidarOk;
    const authIds = (payload.auth_ids || []).filter(Boolean);
    const conexoes = payload.conexoes || [];

    // 2. Excluir/desconectar recursos externos (Evolution / UazAPI)
    for (const cx of conexoes) {
      if (cx.apiOficial) continue;
      const instanceName = String(cx.instanceName || '').trim();
      const apikey = String(cx.apikey || '').trim();
      if (!apikey) continue;
      try {
        if (String(cx.provedorApi || '').toLowerCase() === 'uazapi') {
          await uazapiDelete(String(cx.urlApi || ''), apikey);
        } else if (instanceName) {
          await evolutionDelete(instanceName, apikey);
        }
      } catch (err) {
        console.warn('Falha ao desconectar instância', instanceName, err);
      }
    }

    // 3. Excluir arquivos/storage do cliente
    const storagePaths = new Set<string>();
    for (const p of await listPrefix(admin, contaId)) storagePaths.add(p);

    if (authIds.length) {
      try {
        const { data: owned } = await admin.schema('storage').from('objects').select('name').eq('bucket_id', STORAGE_BUCKET).in('owner', authIds);
        for (const row of owned || []) {
          if (row?.name) storagePaths.add(row.name);
        }
      } catch (err) {
        console.warn('Falha ao listar storage.objects', err);
      }
    }

    const urlCols = [
      { table: 'SAAS_Contatos', col: 'fotoPerfil' },
      { table: 'SAAS_Mensagens', col: 'arquivoUrl' },
      { table: 'SAAS_Conexões', col: 'FotoPerfil' },
    ];
    for (const { table, col } of urlCols) {
      const { data: rows } = await admin.from(table).select(col).eq('contaId', contaId);
      for (const row of rows || []) {
        const path = pathFromStorageUrl(String((row as Record<string, string>)[col] || ''));
        if (path) storagePaths.add(path);
      }
    }

    const arquivosRemovidos = await removePaths(admin, [...storagePaths]);

    // 4. Excluir auth.users pelo Admin API
    let authExcluidos = 0;
    for (const uid of authIds) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error && !/user not found|User not found/i.test(error.message)) {
        console.warn('deleteUser', uid, error.message);
      } else {
        authExcluidos += 1;
      }
    }

    // 5. ON DELETE CASCADE limpa o restante do banco
    const { data: cascade, error: cascadeErr } = await userClient.rpc('f_admin_excluir_conta_cascade', {
      p_conta_id: contaId,
    });
    if (cascadeErr) return json({ ok: false, erro: cascadeErr.message }, 400);
    if (!cascade || cascade.ok === false) {
      return json({ ok: false, erro: cascade?.erro || 'Falha ao excluir a conta' }, 400);
    }

    return json({
      ok: true,
      contaId,
      auth_excluidos: authExcluidos,
      arquivos_removidos: arquivosRemovidos,
    });
  } catch (err) {
    console.error(err);
    return json({ ok: false, erro: err instanceof Error ? err.message : 'Erro ao excluir conta' }, 500);
  }
});
