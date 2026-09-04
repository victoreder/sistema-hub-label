# Exemplo do JSON da Requisição de Agendar Disparo

## Estrutura Atual (Após as Correções)

```json
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "connections": [
    {
      "id": 1,
      "instanceName": "minha-instancia",
      "nomeConexao": "WhatsApp Principal",
      "telefone": "5511999999999",
      "apikey": "chave-api-aqui"
    }
  ],
  "idLista": [1, 2, 3],
  "messages": [
    {
      "text": "Olá! Esta é uma mensagem de texto simples.",
      "type": "text"
    },
    {
      "text": "Mensagem com imagem anexada",
      "type": "text",
      "media": {
        "filename": "imagem.jpg",
        "mimetype": "image/jpeg",
        "type": "image",
        "base64": "iVBORw0KGgoAAAANSUhEUgAA..."
      }
    },
    {
      "text": "Mensagem com vídeo",
      "type": "text",
      "media": {
        "filename": "video.mp4",
        "mimetype": "video/mp4",
        "type": "video",
        "base64": "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAA..."
      }
    },
    {
      "text": "Mensagem com áudio",
      "type": "text",
      "media": {
        "filename": "audio.mp3",
        "mimetype": "audio/mpeg",
        "type": "audio",
        "base64": "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjIwLjEwMAAAAAAAAAAAAAAA..."
      }
    },
    {
      "text": "Mensagem com documento",
      "type": "text",
      "media": {
        "filename": "documento.pdf",
        "mimetype": "application/pdf",
        "type": "document",
        "base64": "JVBERi0xLjQKJcOkw7zDtsO..."
      }
    }
  ],
  "contacts": [],
  "settings": {
    "scheduleData": "2024-01-15T14:30:00.000Z",
    "mencionarTodos": true
  }
}
```

## Principais Mudanças Realizadas

### 1. ✅ Removido `hasVariables`
- **Antes**: `"hasVariables": true`
- **Depois**: Campo removido completamente

### 2. ✅ Renomeado `data` para `base64`
- **Antes**: `"data": "iVBORw0KGgoAAAANSUhEUgAA..."`
- **Depois**: `"base64": "iVBORw0KGgoAAAANSUhEUgAA..."`

### 3. ✅ Movido `type` para dentro de `media`
- **Antes**: 
  ```json
  {
    "text": "Mensagem",
    "type": "image",
    "media": {
      "filename": "imagem.jpg",
      "mimetype": "image/jpeg",
      "data": "..."
    }
  }
  ```
- **Depois**:
  ```json
  {
    "text": "Mensagem",
    "type": "text",
    "media": {
      "filename": "imagem.jpg",
      "mimetype": "image/jpeg",
      "type": "image",
      "base64": "..."
    }
  }
  ```

## Tipos de Mídia Suportados

- **image**: Imagens (jpg, png, gif, etc.)
- **video**: Vídeos (mp4, avi, mov, etc.)
- **audio**: Áudios (mp3, wav, ogg, etc.)
- **document**: Documentos (pdf, doc, txt, etc.)

## Observações

1. O campo `type` da mensagem sempre será `"text"`, mesmo quando há mídia anexada
2. O tipo real da mídia fica em `media.type`
3. O arquivo em base64 fica em `media.base64`
4. O campo `hasVariables` foi completamente removido
5. A estrutura está mais limpa e organizada 