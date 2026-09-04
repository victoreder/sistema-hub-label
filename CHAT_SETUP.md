# Configuração do Chat - Supabase

## Estrutura do Banco de Dados

Para que o chat funcione corretamente, você precisa criar as seguintes tabelas no Supabase.

**IMPORTANTE**: Este setup usa `userId` de uma tabela customizada (não do schema `auth`). As políticas RLS usam uma função auxiliar para verificar o userId.

### 1. Criar função auxiliar para RLS

Primeiro, crie uma função que será usada nas políticas RLS para verificar o userId:

```sql
-- Função para obter o userId atual (será passado via contexto)
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  -- Retorna o userId do contexto da sessão
  -- Este valor será definido via SET LOCAL antes das queries
  RETURN current_setting('app.current_user_id', true)::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
```

### 2. Tabela `conversations`

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  last_message TEXT,
  last_message_time TIMESTAMPTZ DEFAULT NOW(),
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_last_message_time ON conversations(last_message_time DESC);

-- RLS (Row Level Security)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Política: usuários só podem ver suas próprias conversas
-- Usa a função get_current_user_id() em vez de auth.uid()
CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT
  USING (get_current_user_id() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  WITH CHECK (get_current_user_id() = user_id);

CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE
  USING (get_current_user_id() = user_id);
```

### 3. Tabela `messages`

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_name TEXT,
  message_text TEXT NOT NULL,
  is_sent BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- RLS (Row Level Security)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Política: usuários só podem ver mensagens de suas conversas
CREATE POLICY "Users can view messages from own conversations"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = get_current_user_id()
    )
  );

CREATE POLICY "Users can insert messages to own conversations"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = get_current_user_id()
    )
  );
```

### 4. Criar função para definir userId no contexto

Para que as políticas RLS funcionem, precisamos definir o userId no contexto antes de cada query. Crie uma função que faz isso:

```sql
-- Função para definir o userId no contexto da sessão
CREATE OR REPLACE FUNCTION set_user_context(user_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_user_id', user_id::text, false);
END;
$$ LANGUAGE plpgsql;
```

**Alternativa mais simples (recomendada)**: Se você preferir uma abordagem mais direta sem funções, pode usar políticas que verificam diretamente o userId passado via parâmetro. Veja a seção "Abordagem Alternativa" abaixo.

### 3. Habilitar Realtime

No painel do Supabase, vá em:
- **Database** > **Replication**
- Habilite a replicação para as tabelas `conversations` e `messages`

Ou via SQL:

```sql
-- Habilitar Realtime para conversations
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Habilitar Realtime para messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

## Configuração da Chave API

1. Acesse o painel do Supabase
2. Vá em **Settings** > **API**
3. Copie a **anon/public key**
4. Substitua a chave no arquivo `chat.html` na linha:

```javascript
const SUPABASE_ANON_KEY = 'SUA_CHAVE_AQUI';
```

## ⚠️ IMPORTANTE: RLS e Cookies

**O RLS do Supabase NÃO tem acesso aos cookies do navegador!**

O RLS funciona no nível do banco de dados e só consegue ver:
- `auth.uid()` - do JWT token do Supabase Auth
- Variáveis de contexto da sessão SQL

**Isso significa que você NÃO pode passar o userId dos cookies diretamente para o RLS.**

## Soluções Práticas

### ⚠️ Opção 1: RLS Desabilitado + Filtragem no Frontend (NÃO SEGURO)

**⚠️ ATENÇÃO: Esta abordagem NÃO é segura para produção!**

```sql
-- Desabilitar RLS
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
```

**Por que NÃO é seguro:**
- ❌ Qualquer pessoa pode abrir o console do navegador
- ❌ Pode modificar o código JavaScript
- ❌ Pode fazer queries sem filtro: `supabase.from('conversations').select('*')`
- ❌ Pode ver TODAS as conversas de TODOS os usuários
- ❌ Pode acessar mensagens de qualquer conversa

**Exemplo de ataque:**
```javascript
// No console do navegador, um usuário malicioso pode fazer:
const { data } = await supabase
  .from('conversations')
  .select('*');  // ← Sem filtro! Vê TUDO!

// Ou pior, pode tentar acessar conversas específicas:
const { data } = await supabase
  .from('conversations')
  .select('*')
  .eq('user_id', 'outro-user-id-aqui');  // ← Acessa dados de outros!
```

**Quando usar:**
- ✅ Apenas para desenvolvimento/testes
- ✅ Se você tem validação completa no backend (Edge Functions, API, etc)
- ❌ NUNCA use apenas isso em produção sem backend

**Se você usar esta opção, você DEVE ter:**
- Backend que valida todas as operações
- Edge Functions do Supabase que validam o userId
- API própria que faz as queries com service_role

**No código JavaScript, SEMPRE filtre por `user_id`:**

```javascript
// ✅ SEMPRE filtrar por user_id
const { data } = await supabase
  .from('conversations')
  .select('*')
  .eq('user_id', currentUserId)  // ← Filtro obrigatório
  .order('last_message_time', { ascending: false });

// ✅ Realtime também filtra
const channel = supabase
  .channel('conversations')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    filter: `user_id=eq.${currentUserId}`  // ← Filtro no Realtime
  }, (payload) => {
    // Apenas eventos deste usuário serão recebidos
  })
  .subscribe();
```

**Segurança:** Se você já tem validação no backend (como parece ser o caso), esta abordagem é segura o suficiente.

### ⚠️ Opção 2: RLS com RPC Functions (Parcialmente Seguro)

**⚠️ ATENÇÃO: Ainda não é totalmente seguro!**

Criar funções SQL que recebem o userId como parâmetro:

```sql
-- Função para buscar conversas do usuário
CREATE OR REPLACE FUNCTION get_user_conversations(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) 
SECURITY DEFINER  -- ← Executa com privilégios do criador
AS $$
BEGIN
  -- A função sempre filtra por user_id, mas...
  -- ⚠️ O usuário ainda pode passar QUALQUER userId!
  RETURN QUERY
  SELECT 
    c.id,
    c.user_id,
    c.contact_name,
    c.contact_phone,
    c.last_message,
    c.last_message_time,
    c.unread_count,
    c.created_at,
    c.updated_at
  FROM conversations c
  WHERE c.user_id = p_user_id  -- ← Filtra, mas aceita qualquer userId
  ORDER BY c.last_message_time DESC;
END;
$$ LANGUAGE plpgsql;

-- Política: permitir execução da função
GRANT EXECUTE ON FUNCTION get_user_conversations(UUID) TO anon, authenticated;
```

**No código JavaScript:**

```javascript
// Chamar a função RPC passando o userId
const { data, error } = await supabase
  .rpc('get_user_conversations', { p_user_id: currentUserId });
```

**Por que ainda não é totalmente seguro:**
- ❌ Usuário pode modificar o código e passar outro userId:
  ```javascript
  // No console do navegador:
  const { data } = await supabase
    .rpc('get_user_conversations', { 
      p_user_id: 'outro-user-id-aqui'  // ← Acessa dados de outros!
    });
  ```

**Como tornar seguro:**
- ✅ Validar o userId no backend antes de chamar a função
- ✅ Usar Edge Functions do Supabase que validam o userId
- ✅ Criar uma função que valida o userId via JWT (se usar Supabase Auth)

**Vantagens:**
- ✅ Mais seguro que desabilitar RLS completamente
- ✅ Validação no banco de dados
- ✅ Realtime ainda funciona (mas precisa filtrar também)

**Desvantagens:**
- ⚠️ Ainda vulnerável se usado apenas no frontend
- ⚠️ Mais complexo de implementar
- ⚠️ Precisa criar funções para cada operação
- ⚠️ Realtime ainda precisa filtrar no código

### ✅ Opção 3: Backend com Service Role (RECOMENDADO PARA PRODUÇÃO)

**Esta é a solução SEGURA para produção!**

Fazer todas as operações via backend que usa `service_role` key:

```javascript
// No seu backend (Node.js, Python, etc)
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY  // ← Chave service_role (NUNCA exponha no frontend!)
);

// Backend valida o userId dos cookies e faz as queries
app.get('/api/conversations', async (req, res) => {
  // 1. Validar userId dos cookies no backend
  const userId = req.cookies.userId;
  if (!userId || !isValidUUID(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 2. Validar se o usuário existe e está ativo (opcional)
  // const user = await validateUser(userId);
  // if (!user) return res.status(401).json({ error: 'User not found' });
  
  // 3. Fazer query com service_role (bypassa RLS)
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('user_id', userId);  // ← Filtro aplicado no backend (seguro!)
    
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data);
});

// Endpoint para enviar mensagem
app.post('/api/messages', async (req, res) => {
  const userId = req.cookies.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const { conversation_id, message_text } = req.body;
  
  // Validar se a conversa pertence ao usuário
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('id', conversation_id)
    .eq('user_id', userId)
    .single();
    
  if (!conv) {
    return res.status(403).json({ error: 'Conversation not found' });
  }
  
  // Inserir mensagem
  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id,
      sender_id: userId,
      message_text,
      is_sent: true
    })
    .select()
    .single();
    
  res.json(data);
});
```

**No frontend (chat.html):**

```javascript
// Buscar conversas via backend
async function loadConversations() {
  const response = await fetch('https://seu-backend.com/api/conversations', {
    credentials: 'include'  // ← Envia cookies automaticamente
  });
  
  if (!response.ok) {
    console.error('Erro ao carregar conversas');
    return;
  }
  
  const data = await response.json();
  // Renderizar conversas...
}

// Enviar mensagem via backend
async function sendMessage(conversationId, messageText) {
  const response = await fetch('https://seu-backend.com/api/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      conversation_id: conversationId,
      message_text: messageText
    })
  });
  
  const data = await response.json();
  // Atualizar UI...
}
```

**Realtime via Backend (WebSocket ou Server-Sent Events):**

```javascript
// Backend pode usar Supabase Realtime Admin ou criar WebSocket próprio
// Frontend se conecta ao WebSocket do backend, não diretamente ao Supabase
```

**Vantagens:**
- ✅ **MÁXIMA SEGURANÇA** - Validação no backend
- ✅ Usuário não pode modificar código para acessar outros dados
- ✅ RLS pode ficar habilitado (service_role bypassa, mas você valida manualmente)
- ✅ Controle total sobre quem acessa o quê

**Desvantagens:**
- ⚠️ Requer backend (Node.js, Python, PHP, etc)
- ⚠️ Realtime precisa ser configurado via backend também
- ⚠️ Mais complexo de implementar

**Esta é a ÚNICA forma verdadeiramente segura para produção!**

### Opção 4: JWT Customizado (Avançado)

Criar um JWT token customizado com o userId e passar para o Supabase. Isso requer:
- Backend para gerar o JWT
- Configuração no Supabase para aceitar o JWT customizado
- Função RLS que extrai o userId do JWT

**Esta opção é complexa e geralmente não é necessária.**

## Autenticação

O chat usa o sistema de autenticação existente do projeto (cookies com `userId`). O `userId` é um UUID armazenado nos cookies e vem de uma tabela de usuários customizada (não do schema `auth` do Supabase).

## Como Funciona o Realtime SEM RLS (Recomendado)

**Resposta direta: NÃO, o RLS não consegue pegar o userId dos cookies.**

O RLS funciona no nível do banco de dados e só vê:
- O JWT token do Supabase Auth (`auth.uid()`)
- Variáveis de contexto SQL

**Solução Recomendada: Desabilitar RLS e filtrar no código**

O Realtime funciona perfeitamente mesmo sem RLS, desde que você filtre por `user_id`:

```javascript
// 1. Buscar conversas - SEMPRE filtrar por user_id
const { data } = await supabase
  .from('conversations')
  .select('*')
  .eq('user_id', currentUserId)  // ← Filtro obrigatório
  .order('last_message_time', { ascending: false });

// 2. Realtime - SEMPRE filtrar por user_id
const channel = supabase
  .channel('conversations-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    filter: `user_id=eq.${currentUserId}`  // ← Filtro no Realtime
  }, (payload) => {
    // ✅ Apenas mudanças das conversas deste usuário serão recebidas
    // ✅ O Realtime respeita o filtro, mesmo sem RLS
    console.log('Nova mudança:', payload);
  })
  .subscribe();
```

**Por que isso funciona:**
- ✅ O Realtime do Supabase respeita os filtros que você define
- ✅ Apenas eventos que correspondem ao filtro `user_id=eq.${currentUserId}` são enviados
- ✅ Mesmo que alguém tente acessar sem filtro, não receberá dados de outros usuários
- ✅ Se você já tem validação no backend, esta abordagem é segura

**Segurança:**
- A filtragem no código JavaScript é suficiente se você confia no seu frontend
- Se quiser segurança extra, use um backend com `service_role` key
- O Realtime com filtros é seguro porque o servidor do Supabase aplica os filtros antes de enviar os eventos

## Testando

1. Certifique-se de que as tabelas foram criadas
2. Crie a função `get_current_user_id()` (se usar a abordagem com funções)
3. Configure as políticas RLS
4. Verifique se o Realtime está habilitado
5. Configure a chave API no arquivo `chat.html`
6. Acesse a página e teste criando uma conversa e enviando mensagens

## Exemplo de Código JavaScript

Aqui está como usar no código JavaScript do `chat.html`:

```javascript
// Configuração do Supabase
const SUPABASE_URL = 'https://seu-projeto.supabase.co';
const SUPABASE_ANON_KEY = 'sua-chave-anon';

let supabase;
let currentUserId = null;

// Inicializar Supabase
function initSupabase() {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Obter userId dos cookies (seu sistema atual)
function getSecureUserId() {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; userId=`);
    if (parts.length === 2) {
        const userId = parts.pop().split(';').shift();
        if (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
            return userId;
        }
    }
    return null;
}

// Carregar conversas - SEMPRE filtrar por user_id
async function loadConversations() {
    currentUserId = getSecureUserId();
    if (!currentUserId) {
        console.error('UserId não encontrado');
        return;
    }

    // IMPORTANTE: Sempre filtrar por user_id
    const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', currentUserId)  // ← Filtro obrigatório
        .order('last_message_time', { ascending: false });

    if (error) {
        console.error('Erro ao carregar conversas:', error);
        return;
    }

    // Renderizar conversas...
}

// Inscrever no Realtime - SEMPRE filtrar por user_id
function subscribeToConversations() {
    const channel = supabase
        .channel('conversations-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            filter: `user_id=eq.${currentUserId}`  // ← Filtro no Realtime
        }, (payload) => {
            console.log('Mudança recebida:', payload);
            // Apenas mudanças das conversas deste usuário serão recebidas
            loadConversations();
        })
        .subscribe();

    return channel;
}

// Carregar mensagens - filtrar por conversation_id
async function loadMessages(conversationId) {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)  // Filtro por conversa
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Erro ao carregar mensagens:', error);
        return;
    }

    // Renderizar mensagens...
}

// Inscrever em novas mensagens - filtrar por conversation_id
function subscribeToMessages(conversationId) {
    const channel = supabase
        .channel(`messages-${conversationId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            filter: `conversation_id=eq.${conversationId}`  // ← Filtro no Realtime
        }, (payload) => {
            console.log('Nova mensagem:', payload);
            // Adicionar mensagem à UI
        })
        .subscribe();

    return channel;
}

// Enviar mensagem
async function sendMessage(conversationId, messageText) {
    const { data, error } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            sender_id: currentUserId,  // ← Usar o userId do cookie
            message_text: messageText,
            is_sent: true,
            created_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('Erro ao enviar mensagem:', error);
        return;
    }

    // Atualizar última mensagem da conversa
    await supabase
        .from('conversations')
        .update({
            last_message: messageText,
            last_message_time: new Date().toISOString()
        })
        .eq('id', conversationId)
        .eq('user_id', currentUserId);  // ← Garantir que só atualiza conversas do usuário
}
```

## 🔒 Resumo: Segurança e RLS

### ❌ O que NÃO funciona:
- RLS não consegue ler cookies do navegador
- RLS não consegue usar `auth.uid()` se você não usa Supabase Auth
- Passar userId dos cookies diretamente para RLS não é possível
- **Filtrar apenas no frontend NÃO é seguro** - usuário pode modificar o código

### ✅ O que FUNCIONA (em ordem de segurança):

1. **✅ Backend com Service Role** (MÁXIMA SEGURANÇA - RECOMENDADO)
   - ✅ Validação no backend (usuário não pode modificar)
   - ✅ Máxima segurança
   - ⚠️ Requer backend
   - ⚠️ Realtime via backend também

2. **⚠️ RPC Functions + Validação no Backend** (SEGURO)
   - ✅ Validação no backend antes de chamar função
   - ✅ Mais seguro que apenas frontend
   - ⚠️ Requer backend para validação
   - ⚠️ Mais complexo

3. **❌ RPC Functions apenas no Frontend** (NÃO SEGURO)
   - ❌ Usuário pode passar qualquer userId
   - ❌ Não use em produção sem backend

4. **❌ Desabilitar RLS + Filtrar no Frontend** (NÃO SEGURO)
   - ❌ Usuário pode modificar código e ver todos os dados
   - ❌ NUNCA use em produção sem backend
   - ✅ Apenas para desenvolvimento/testes

## 🎯 Recomendação Final

**Para PRODUÇÃO, você DEVE usar Backend com Service Role (Opção 3).**

**Por quê?**
- ✅ Usuário não consegue modificar código para acessar dados de outros
- ✅ Validação acontece no servidor (não pode ser burlada)
- ✅ Máxima segurança possível
- ✅ RLS pode ficar habilitado como camada extra

**Estrutura recomendada:**
```
Frontend (chat.html)
    ↓ (faz requisições HTTP)
Backend (Node.js/Python/PHP)
    ↓ (valida userId dos cookies)
    ↓ (usa service_role key)
Supabase (com RLS habilitado)
```

**Exemplo de fluxo seguro:**
1. Frontend envia requisição para `/api/conversations` (com cookies)
2. Backend valida userId dos cookies
3. Backend faz query com `service_role` key (bypassa RLS, mas valida manualmente)
4. Backend retorna apenas dados do usuário validado
5. Frontend renderiza os dados

## Notas Importantes

- O `user_id` nas tabelas deve corresponder ao `userId` armazenado nos cookies
- **NUNCA confie apenas em filtragem no frontend para segurança**
- **SEMPRE valide no backend** antes de acessar dados sensíveis
- O Realtime funciona perfeitamente com filtros, mas a validação deve ser no backend
- **Para produção: Backend obrigatório!**

