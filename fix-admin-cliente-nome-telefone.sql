-- Patch: Super Admin — carregar/salvar Nome e Telefone do cliente contratante
-- Execute no SQL Editor do Supabase (uma vez).
-- Causa: nome/telefone ficam em SAAS_Usuarios; o painel admin às vezes não encontrava o usuário certo
-- e o UPDATE podia falhar em silêncio por RLS.

CREATE OR REPLACE FUNCTION public.f_admin_contatos_clientes()
RETURNS TABLE (conta_id uuid, nome text, telefone text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas super admin';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (c.id)
    c.id AS conta_id,
    u.nome,
    u.telefone,
    u."Email" AS email
  FROM public."SAAS_Contas" c
  LEFT JOIN public."SAAS_Usuarios" u ON u."contaId" = c.id
  ORDER BY
    c.id,
    CASE WHEN u."Email" IS NOT NULL AND lower(u."Email") = lower(COALESCE(c.email, '')) THEN 0 ELSE 1 END,
    CASE WHEN u.funcao = 'admin' THEN 0 ELSE 1 END,
    CASE WHEN NULLIF(trim(COALESCE(u.nome, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
    u.created_at ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.f_admin_atualizar_cliente_contato(
  p_conta_id uuid,
  p_nome text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_status boolean DEFAULT NULL,
  p_data_validade date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_usuario_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Apenas super admin');
  END IF;
  IF p_conta_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contaId obrigatório');
  END IF;

  UPDATE public."SAAS_Contas"
  SET
    status = COALESCE(p_status, status),
    "dataValidade" = p_data_validade
  WHERE id = p_conta_id;

  IF p_nome IS NOT NULL OR p_telefone IS NOT NULL THEN
    SELECT c.email INTO v_email FROM public."SAAS_Contas" c WHERE c.id = p_conta_id;

    SELECT u.id INTO v_usuario_id
    FROM public."SAAS_Usuarios" u
    WHERE u."contaId" = p_conta_id
    ORDER BY
      CASE WHEN v_email IS NOT NULL AND lower(COALESCE(u."Email", '')) = lower(v_email) THEN 0 ELSE 1 END,
      CASE WHEN u.funcao = 'admin' THEN 0 ELSE 1 END,
      CASE WHEN NULLIF(trim(COALESCE(u.nome, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
      u.created_at ASC NULLS LAST
    LIMIT 1;

    IF v_usuario_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Usuário da conta não encontrado');
    END IF;

    UPDATE public."SAAS_Usuarios"
    SET
      nome = COALESCE(p_nome, nome),
      telefone = COALESCE(p_telefone, telefone)
    WHERE id = v_usuario_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'contaId', p_conta_id, 'usuarioId', v_usuario_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.f_admin_contatos_clientes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.f_admin_atualizar_cliente_contato(uuid, text, text, boolean, date) TO authenticated;
