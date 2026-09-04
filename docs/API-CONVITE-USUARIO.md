# API de Convite de Usuário

Especificação do endpoint que o backend deve expor para convidar usuários à conta. O frontend envia uma requisição POST para seu backend, que por sua vez usa a **Supabase Auth Admin API** (service_role) para enviar o convite.

---

## Requisição HTTP que o frontend fará ao seu backend

### Método e URL
```
POST {URL_DO_SEU_BACKEND}/convidar-usuario
```
Exemplo: `POST https://api.seudominio.com/convidar-usuario`

### Headers
| Header | Valor | Obrigatório |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Sim |
| `Authorization` | `Bearer {access_token}` | Sim - JWT do Supabase Auth do usuário logado |

### Body (JSON)
```json
{
  "email": "usuario@exemplo.com",
  "funcao": "membro",
  "contaId": "uuid-da-conta",
  "redirectTo": "https://seudominio.com/configuracoes.html"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `email` | string | Sim | Email do convidado |
| `funcao` | string | Sim | `"admin"` ou `"membro"` |
| `contaId` | string (UUID) | Sim | ID da conta onde o usuário será adicionado |
| `redirectTo` | string | Não | URL de redirecionamento após o convidado aceitar (opcional) |

---

## O que seu backend deve fazer

1. **Validar o JWT** – Usar o header `Authorization` para identificar o usuário autenticado (via Supabase `auth.getUser(token)` ou decodificação do JWT).

2. **Verificar se é admin** – Consultar `SAAS_Usuarios` e garantir que o usuário logado tem `funcao = 'admin'` na conta indicada por `contaId`.

3. **Chamar Supabase Auth Admin**:
   ```javascript
   // Exemplo em Node.js com @supabase/supabase-js
   const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
     data: {
       contaId: contaId,
       funcao: funcao === 'admin' ? 'admin' : 'membro',
       invite: 'true',
     },
     redirectTo: redirectTo,
   });
   ```

4. **Regra importante** – O metadata `invite: 'true'` e `contaId` são usados pelo trigger em `auth.users` para inserir o usuário na conta correta ao aceitar o convite.

---

## Requisição HTTP para o Supabase (backend deve fazer)

### Método e URL
```
POST https://{PROJECT_REF}.supabase.co/auth/v1/invite?redirect_to={REDIRECT_URL}
```
Exemplo: `POST https://hxumiciyohbianfnzfyk.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fseudominio.com%2Fconfiguracoes.html`

### Headers
| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `apikey` | `{SUPABASE_SERVICE_ROLE_KEY}` |
| `Authorization` | `Bearer {SUPABASE_SERVICE_ROLE_KEY}` |

> Use a chave **service_role** (não a anon).

### Query string
| Parâmetro | Valor |
|-----------|-------|
| `redirect_to` | URL de redirecionamento após o convidado aceitar (encode em URL) |

### Body (JSON) – convite por e-mail
```json
{
  "email": "usuario@exemplo.com",
  "data": {
    "contaId": "uuid-da-conta",
    "funcao": "membro",
    "invite": "true"
  }
}
```

---

## Adicionar usuário com senha padrão (criar e vincular à conta)

Para criar o usuário já com e-mail confirmado e senha padrão (ex.: tela de membros em Configurações), o backend deve chamar o endpoint **admin/users** do Supabase com o body **exatamente** assim:

### Método e URL
```
POST https://hxumiciyohbianfnzfyk.supabase.co/auth/v1/admin/users
```

### Headers
```
Content-Type: application/json
apikey: {SUPABASE_SERVICE_ROLE_KEY}
Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
```

### Body (JSON) – obrigatório neste formato
```json
{
  "email": "usuario@exemplo.com",
  "password": "SenhaPadrao123!",
  "email_confirm": true,
  "user_metadata": {
    "contaId": "uuid-da-conta",
    "funcao": "membro",
    "invite": "true"
  }
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `email` | Sim | E-mail do novo usuário |
| `password` | Sim | Senha padrão (exibir para o admin na tela) |
| `email_confirm` | Sim | `true` para e-mail já confirmado |
| `user_metadata.contaId` | Sim | UUID da conta à qual o usuário será vinculado |
| `user_metadata.funcao` | Sim | `"admin"` ou `"membro"` |
| `user_metadata.invite` | Sim | `"true"` – faz o trigger vincular à conta sem criar nova |

O trigger em `auth.users` lê `user_metadata` (em `raw_user_meta_data`). Com `contaId` + `invite: "true"`, ele insere apenas em `SAAS_Usuarios` e **não** cria nova linha em `SAAS_Contas`.

### Exemplo cURL (criar usuário com senha padrão)
```bash
curl -X POST 'https://hxumiciyohbianfnzfyk.supabase.co/auth/v1/admin/users' \
  -H 'Content-Type: application/json' \
  -H 'apikey: SEU_SERVICE_ROLE_KEY' \
  -H 'Authorization: Bearer SEU_SERVICE_ROLE_KEY' \
  -d '{
  "email": "usuario@exemplo.com",
  "password": "SenhaPadrao123!",
  "email_confirm": true,
  "user_metadata": {
    "contaId": "uuid-da-conta",
    "funcao": "membro",
    "invite": "true"
  }
}'
```

---

### Exemplo cURL (convite por e-mail)
```bash
curl -X POST 'https://hxumiciyohbianfnzfyk.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fseudominio.com%2Fconfiguracoes.html' \
  -H 'Content-Type: application/json' \
  -H 'apikey: SEU_SERVICE_ROLE_KEY' \
  -H 'Authorization: Bearer SEU_SERVICE_ROLE_KEY' \
  -d '{
    "email": "usuario@exemplo.com",
    "data": {
      "contaId": "uuid-da-conta",
      "funcao": "membro",
      "invite": "true"
    }
  }'
```

---

## Respostas esperadas pelo frontend

A página de configurações considera **sucesso** quando:
- **HTTP status 2xx** (200, 201, etc.) **e**
- O body JSON **não** contém o campo `"error"`.

Caso contrário (status 4xx/5xx ou body com `"error"`), a tela exibe "Erro ao adicionar usuário".

### Sucesso (200) – formato recomendado
```json
{
  "success": true,
  "message": "Usuário criado com sucesso"
}
```
Ou qualquer resposta 2xx sem o campo `"error"` (ex.: `{}` ou `{ "message": "OK" }`).

### Erro (4xx ou 5xx, ou 2xx com error)
```json
{
  "error": "Mensagem de erro legível"
}
```
Quando o backend retorna status de erro ou inclui `"error"` no body, a tela mostra essa mensagem.

Exemplos de mensagens:
- `401` – "Token de autorização ausente" ou "Não autenticado"
- `400` – "Email e contaId são obrigatórios" ou mensagem do Supabase
- `403` – "Apenas administradores podem convidar usuários"

---

## Configuração no frontend

No arquivo `configuracoes.html`, altere a variável `INVITE_USER_BACKEND_URL` para a URL completa do endpoint do seu backend. Exemplo:

```javascript
const INVITE_USER_BACKEND_URL = 'https://api.seudominio.com/convidar-usuario';
```
