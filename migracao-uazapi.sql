-- ============================================================
-- UazAPI como API não oficial alternativa à Evolution
-- ============================================================

-- Config global (URL + admintoken) — só super admin grava
CREATE TABLE IF NOT EXISTS public."SAAS_Config_Uazapi" (
  id INT PRIMARY KEY DEFAULT 1,
  url TEXT,
  token TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row_config_uazapi CHECK (id = 1)
);

INSERT INTO public."SAAS_Config_Uazapi" (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public."SAAS_Config_Uazapi" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public."SAAS_Config_Uazapi" TO authenticated;

DROP POLICY IF EXISTS "select_config_uazapi" ON public."SAAS_Config_Uazapi";
DROP POLICY IF EXISTS "insert_config_uazapi" ON public."SAAS_Config_Uazapi";
DROP POLICY IF EXISTS "update_config_uazapi" ON public."SAAS_Config_Uazapi";

CREATE POLICY "select_config_uazapi" ON public."SAAS_Config_Uazapi"
  FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE POLICY "insert_config_uazapi" ON public."SAAS_Config_Uazapi"
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

CREATE POLICY "update_config_uazapi" ON public."SAAS_Config_Uazapi"
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Plano: qual API não oficial usar (evolution | uazapi)
ALTER TABLE public."SAAS_Planos"
  ADD COLUMN IF NOT EXISTS "apiNaoOficial" TEXT NOT NULL DEFAULT 'evolution';

ALTER TABLE public."SAAS_Planos"
  DROP CONSTRAINT IF EXISTS saas_planos_api_nao_oficial_check;

ALTER TABLE public."SAAS_Planos"
  ADD CONSTRAINT saas_planos_api_nao_oficial_check
  CHECK ("apiNaoOficial" IN ('evolution', 'uazapi'));

-- Conexão: provedor + URL base (para uazapi não depender do token admin no client)
ALTER TABLE public."SAAS_Conexões"
  ADD COLUMN IF NOT EXISTS "provedorApi" TEXT NOT NULL DEFAULT 'evolution';

ALTER TABLE public."SAAS_Conexões"
  DROP CONSTRAINT IF EXISTS saas_conexoes_provedor_api_check;

ALTER TABLE public."SAAS_Conexões"
  ADD CONSTRAINT saas_conexoes_provedor_api_check
  CHECK ("provedorApi" IN ('evolution', 'uazapi', 'oficial'));

ALTER TABLE public."SAAS_Conexões"
  ADD COLUMN IF NOT EXISTS "urlApi" TEXT;

-- URL pública da UazAPI (sem token) para o front das contas
CREATE OR REPLACE FUNCTION public.obter_url_uazapi()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT NULLIF(trim(url), '') FROM public."SAAS_Config_Uazapi" WHERE id = 1;
$$;

GRANT EXECUTE ON FUNCTION public.obter_url_uazapi() TO authenticated;

-- Provedor do plano da conta (para criação de conexão QR)
CREATE OR REPLACE FUNCTION public.obter_api_nao_oficial_conta(p_conta_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(NULLIF(trim(p."apiNaoOficial"), ''), 'evolution')
  FROM public."SAAS_Contas" c
  LEFT JOIN public."SAAS_Planos" p ON p.id = c.plano
  WHERE c.id = p_conta_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.obter_api_nao_oficial_conta(UUID) TO authenticated;

-- Atualiza RPC de exclusão de conta para retornar provedorApi/urlApi
CREATE OR REPLACE FUNCTION public.f_admin_excluir_conta_validar(p_conta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_ids uuid[];
  v_conexoes jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Apenas super admin');
  END IF;

  IF p_conta_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contaId obrigatório');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public."SAAS_Contas" WHERE id = p_conta_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Conta não encontrada');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."SAAS_Usuarios"
    WHERE "contaId" = p_conta_id AND auth_user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Você não pode excluir a própria conta');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."SAAS_Usuarios"
    WHERE "contaId" = p_conta_id AND super_admin IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível excluir uma conta de super admin');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT uid), '{}')
  INTO v_auth_ids
  FROM (
    SELECT u.auth_user_id AS uid
    FROM public."SAAS_Usuarios" u
    WHERE u."contaId" = p_conta_id AND u.auth_user_id IS NOT NULL
    UNION
    SELECT u.id
    FROM public."SAAS_Usuarios" u
    JOIN auth.users au ON au.id = u.id
    WHERE u."contaId" = p_conta_id
    UNION
    SELECT au.id
    FROM public."SAAS_Usuarios" u
    JOIN auth.users au ON lower(au.email) = lower(u."Email")
    WHERE u."contaId" = p_conta_id AND u."Email" IS NOT NULL
    UNION
    SELECT au.id
    FROM public."SAAS_Contas" c
    JOIN auth.users au ON lower(au.email) = lower(c.email)
    WHERE c.id = p_conta_id AND c.email IS NOT NULL
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cx.id,
    'instanceName', cx."instanceName",
    'apikey', cx."Apikey",
    'apiOficial', COALESCE(cx."apiOficial", false),
    'provedorApi', COALESCE(cx."provedorApi", 'evolution'),
    'urlApi', cx."urlApi"
  )), '[]'::jsonb)
  INTO v_conexoes
  FROM public."SAAS_Conexões" cx
  WHERE cx."contaId" = p_conta_id;

  RETURN jsonb_build_object(
    'ok', true,
    'contaId', p_conta_id,
    'auth_ids', to_jsonb(v_auth_ids),
    'conexoes', v_conexoes
  );
END;
$$;

-- Liberar API Oficial por plano
ALTER TABLE public."SAAS_Planos"
  ADD COLUMN IF NOT EXISTS "liberarApiOficial" BOOLEAN NOT NULL DEFAULT false;

-- Planos existentes: mantém comportamento anterior (libera todos, exceto Free)
UPDATE public."SAAS_Planos"
SET "liberarApiOficial" = true
WHERE COALESCE(lower(trim(nome)), '') <> 'free'
  AND "liberarApiOficial" IS NOT TRUE;

