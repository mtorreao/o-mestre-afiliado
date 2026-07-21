# Evolution API — Referência

> **Base URL (padrão):** `http://localhost:8080`
> **Autenticação:** Header `apikey` em todas as requisições
> **Formato:** JSON (request e response)
> **Versão:** v2.x (Baileys WhatsApp Web API)

---

## Índice

- [Instâncias (Instance)](#instâncias-instance)
- [Mensagens (Message)](#mensagens-message)
- [Grupos (Group)](#grupos-group)
- [Chats](#chats)
- [Webhooks](#webhooks)
- [Settings](#settings)
- [Eventos (Webhook Events)](#eventos-webhook-events)
- [Proxy](#proxy)
- [Labels](#labels)

---

## Instâncias (Instance)

Uma **instance** representa uma conexão WhatsApp. Cada afiliado = uma instance.

### POST /instance/create

Cria uma nova instance. Retorna o QR code para conectar.

**Request:**
```json
{
  "instanceName": "affiliate-1",
  "qrcode": true,
  "integration": "WHATSAPP_BAILEYS",
  "webhook": {
    "enabled": true,
    "url": "http://whatsapp-bot:3001/webhook/message",
    "events": [
      "messages.upsert",
      "connection.update",
      "qrcode.updated"
    ],
    "byEvents": true,
    "base64": false
  }
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `instanceName` | string | ✅ | Nome único da instance (ex: `affiliate-1`) |
| `qrcode` | boolean | ❌ | Se `true`, retorna QR code base64 na resposta |
| `integration` | string | ❌ | `WHATSAPP_BAILEYS` (default) ou `WHATSAPP_API` |
| `webhook` | object | ❌ | Configuração de webhook (ver seção Webhooks) |

**Response (201):**
```json
{
  "instance": {
    "instanceName": "affiliate-1",
    "status": "created",
    "qrcode": {
      "count": 1,
      "code": "2@...",
      "base64": "data:image/png;base64,..."
    }
  },
  "hash": {
    "apikey": "hash-do-apikey"
  }
}
```

### GET /instance/connect/:instanceName

Obtém o QR code para conectar uma instance já criada.

**Response (200):**
```json
{
  "base64": "data:image/png;base64,...",
  "code": "2@...",
  "count": 1
}
```

### GET /instance/connectionState/:instanceName

Obtém o estado da conexão.

**Response (200):**
```json
{
  "instanceName": "affiliate-1",
  "state": "open"
}
```

| `state` | Significado |
|---------|-------------|
| `open` | Conectado |
| `connecting` | Conectando |
| `close` | Desconectado |
| `qrcode` | Aguardando QR code |

### GET /instance/fetchInstances

Lista todas as instances.

**Response (200):**
```json
[
  {
    "instanceName": "affiliate-1",
    "status": "open",
    "integration": "WHATSAPP_BAILEYS",
    "ownerJid": "5511999999999@s.whatsapp.net",
    "profileName": "João",
    "profilePicUrl": "https://..."
  }
]
```

### POST /instance/restart/:instanceName

Reinicia uma instance (desconecta e reconecta).

### POST /instance/setPresence/:instanceName

Define o status de presença.

**Request:**
```json
{
  "presence": "available"
}
```

| `presence` | Descrição |
|------------|-----------|
| `available` | Online |
| `unavailable` | Offline |
| `composing` | Digitando |
| `recording` | Gravando |

### DELETE /instance/logout/:instanceName

Desconecta a sessão WhatsApp sem deletar a instance.

### DELETE /instance/delete/:instanceName

Remove a instance permanentemente.

---

## Mensagens (Message)

### POST /message/sendText/:instanceName

Envia mensagem de texto.

**Request:**
```json
{
  "number": "5511999999999",
  "text": "Olá! Confira esta oferta: https://shopee.com.br/produto-X"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `number` | string | ✅ | Número de destino (com DDI e DDD, sem `+` ou espaço) |
| `text` | string | ✅ | Texto da mensagem |
| `delay` | number | ❌ | Delay em ms antes de enviar |
| `linkPreview` | boolean | ❌ | Gerar preview do link (default: true) |
| `quoted` | object | ❌ | Responder a uma mensagem específica |
| `mentionsEveryOne` | boolean | ❌ | Marcar todos |
| `mentioned` | string[] | ❌ | Lista de JIDs para marcar |

**Response (201):**
```json
{
  "key": {
    "id": "ABEGkSj...",
    "remoteJid": "5511999999999@s.whatsapp.net",
    "fromMe": true
  },
  "status": "PENDING"
}
```

### POST /message/sendMedia/:instanceName

Envia mídia (imagem, vídeo, áudio, documento).

**Request (JSON):**
```json
{
  "number": "5511999999999",
  "mediatype": "image",
  "media": "https://exemplo.com/imagem.jpg",
  "caption": "Legenda da imagem",
  "fileName": "documento.pdf"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `number` | string | ✅ | Número de destino |
| `mediatype` | enum | ✅ | `image`, `video`, `audio`, `document`, `ptv` |
| `media` | string | ✅ | URL pública ou base64 da mídia |
| `caption` | string | ❌ | Legenda (imagem/vídeo) |
| `fileName` | string | ❌ | Nome do arquivo (documento) |
| `mimetype` | string | ❌ | MIME type (opcional, detectado automático) |

**Multipart:** também aceita upload de arquivo via `multipart/form-data` com campo `file`.

### POST /message/sendLocation/:instanceName

Envia localização.

```json
{
  "number": "5511999999999",
  "name": "Minha Loja",
  "address": "Rua Exemplo, 123",
  "latitude": -8.047562,
  "longitude": -34.877033
}
```

### POST /message/sendContact/:instanceName

Envia contato.

```json
{
  "number": "5511999999999",
  "contacts": [
    {
      "fullName": "João Silva",
      "phone": "5511988888888"
    }
  ]
}
```

### POST /message/sendReaction/:instanceName

Reage a uma mensagem.

```json
{
  "number": "5511999999999",
  "reactionMessage": {
    "key": {
      "id": "ABEGkSj...",
      "remoteJid": "5511999999999@s.whatsapp.net"
    },
    "reaction": "👍"
  }
}
```

### POST /message/sendPoll/:instanceName

Envia enquete.

```json
{
  "number": "5511999999999",
  "name": "Qual o melhor?",
  "selectableCount": 1,
  "values": ["Opção 1", "Opção 2", "Opção 3"]
}
```

### POST /message/sendList/:instanceName

Envia lista interativa.

```json
{
  "number": "5511999999999",
  "title": "Menu",
  "description": "Escolha uma opção",
  "footer": "Obrigado!",
  "buttonText": "Ver opções",
  "sections": [
    {
      "title": "Categoria 1",
      "rows": [
        { "title": "Item 1", "description": "Descrição", "rowId": "item1" }
      ]
    }
  ]
}
```

### POST /message/sendButtons/:instanceName

Envia botões interativos.

```json
{
  "number": "5511999999999",
  "title": "Título",
  "description": "Descrição",
  "footer": "Rodapé",
  "buttons": [
    { "type": "reply", "displayText": "Sim", "id": "sim" },
    { "type": "url", "displayText": "Site", "url": "https://..." }
  ]
}
```

| `type` | Descrição |
|--------|-----------|
| `reply` | Botão de resposta rápida |
| `url` | Botão de URL (abre no navegador) |
| `copy` | Botão de copiar texto |
| `call` | Botão de ligação |
| `pix` | Botão de PIX (copia chave) |

---

## Grupos (Group)

### POST /group/create/:instanceName

Cria um grupo.

```json
{
  "subject": "Ofertas Afiliados",
  "participants": ["5511999999999", "5511888888888"],
  "description": "Grupo de ofertas"
}
```

### GET /group/findGroupInfos/:instanceName?groupJid=120363123456789@g.us

Obtém informações do grupo.

### GET /group/participants/:instanceName?groupJid=120363123456789@g.us

Lista participantes do grupo.

### GET /group/inviteCode/:instanceName?groupJid=120363123456789@g.us

Obtém código de convite do grupo.

### POST /group/updateParticipant/:instanceName

Gerencia participantes (adicionar, remover, promover, rebaixar).

```json
{
  "groupJid": "120363123456789@g.us",
  "action": "add",
  "participants": ["5511999999999"]
}
```

| `action` | Descrição |
|----------|-----------|
| `add` | Adicionar |
| `remove` | Remover |
| `promote` | Promover a admin |
| `demote` | Rebaixar de admin |

### POST /group/updateSetting/:instanceName

Define configurações do grupo.

```json
{
  "groupJid": "120363123456789@g.us",
  "action": "announcement"
}
```

| `action` | Descrição |
|----------|-----------|
| `announcement` | Só admins enviam msg |
| `not_announcement` | Todos enviam msg |
| `locked` | Só admins alteram dados |
| `unlocked` | Todos alteram dados |

### POST /group/sendInvite/:instanceName

Envia convite do grupo para um número.

```json
{
  "groupJid": "120363123456789@g.us",
  "numbers": ["5511999999999"]
}
```

### GET /group/inviteInfo/:instanceName?inviteCode=ABC123

Obtém informações de um código de convite.

### GET /group/acceptInviteCode/:instanceName?inviteCode=ABC123

Aceita um código de convite (entra no grupo).

### DELETE /group/leaveGroup/:instanceName?groupJid=120363123456789@g.us

Sai do grupo.

---

## Chats

### POST /chat/findMessages/:instanceName

Busca mensagens de um chat.

```json
{
  "jid": "5511999999999@s.whatsapp.net",
  "count": 20
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `jid` | string | ✅ | JID do chat (número ou grupo) |
| `count` | number | ❌ | Quantidade de mensagens (default: 20) |

### POST /chat/findChats/:instanceName

Lista todos os chats da conta.

```json
{
  "page": 1,
  "offset": 0
}
```

### POST /chat/markMessageAsRead/:instanceName

Marca mensagem como lida.

```json
{
  "jid": "5511999999999@s.whatsapp.net",
  "messageId": "ABEGkSj..."
}
```

### POST /chat/archiveChat/:instanceName

Arquiva/desarquiva um chat.

```json
{
  "jid": "5511999999999@s.whatsapp.net",
  "archive": true
}
```

### POST /chat/updateProfileName/:instanceName

Altera o nome de perfil.

```json
{
  "name": "Novo Nome"
}
```

### POST /chat/updateProfileStatus/:instanceName

Altera o status/recado.

```json
{
  "status": "Novo status"
}
```

### POST /chat/checkWhatsAppNumbers/:instanceName

Verifica se números têm WhatsApp.

```json
{
  "numbers": ["5511999999999", "5511888888888"]
}
```

---

## Webhooks

### GET /settings/getWebhook/:instanceName

Obtém a configuração atual do webhook da instance.

### POST /settings/setWebhook/:instanceName

Configura o webhook da instance.

```json
{
  "enabled": true,
  "url": "http://whatsapp-bot:3001/webhook/message",
  "events": [
    "messages.upsert",
    "connection.update",
    "qrcode.updated"
  ],
  "byEvents": true,
  "base64": false,
  "webhookByEvents": false,
  "headers": {}
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `enabled` | boolean | Ativar/desativar webhook |
| `url` | string | URL para onde enviar os eventos |
| `events` | string[] | Lista de eventos (vazio = todos) |
| `byEvents` | boolean | Se `true`, cada evento tem sua própria URL |
| `base64` | boolean | Codificar mídia em base64 no payload |
| `headers` | object | Headers customizados (ex: `{"Authorization": "Bearer xyz"}`) |

### GET /settings/getWebSocket/:instanceName

Obtém configuração do WebSocket.

### POST /settings/setWebSocket/:instanceName

Configura WebSocket para eventos em tempo real.

---

## Settings

### GET /settings/get/:instanceName

Obtém todas as configurações da instance.

### POST /settings/set/:instanceName

Define configurações da instance.

```json
{
  "rejectCall": false,
  "msgCall": "Não atendo chamadas",
  "groupsIgnore": false,
  "alwaysOnline": true,
  "readMessages": true,
  "readStatus": false,
  "syncFullHistory": false
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `rejectCall` | boolean | Rejeitar chamadas automaticamente |
| `msgCall` | string | Mensagem automática ao rejeitar chamada |
| `groupsIgnore` | boolean | Ignorar mensagens de grupos |
| `alwaysOnline` | boolean | Manter sempre online |
| `readMessages` | boolean | Marcar mensagens como lidas |
| `readStatus` | boolean | Marcar status como visualizado |
| `syncFullHistory` | boolean | Sincronizar histórico completo |

---

## Eventos (Webhook Events)

Eventos que a Evolution API envia via webhook. Payload enviado como `POST` para a URL configurada.

### `messages.upsert`

Nova mensagem recebida.

```json
{
  "event": "messages.upsert",
  "instance": "affiliate-1",
  "data": [
    {
      "key": {
        "id": "ABEGkSj...",
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "participant": "5511999999999@s.whatsapp.net"
      },
      "message": {
        "conversation": "Olá! Confira: https://shopee.com.br/produto-X"
      },
      "messageTimestamp": 1729000000,
      "pushName": "João"
    }
  ]
}
```

### `connection.update`

Estado da conexão atualizado.

```json
{
  "event": "connection.update",
  "instance": "affiliate-1",
  "data": {
    "state": "open",
    "statusReason": 200
  }
}
```

### `qrcode.updated`

Novo QR code gerado (para escanear).

```json
{
  "event": "qrcode.updated",
  "instance": "affiliate-1",
  "data": {
    "count": 1,
    "code": "2@...",
    "base64": "data:image/png;base64,..."
  }
}
```

### `messages.set`

Mensagens definidas/sincronizadas (histórico).

### `messages.edited`

Mensagem editada.

### `messages.update`

Mensagem atualizada (ex: status de entrega).

### `messages.delete`

Mensagem apagada.

### `send.message`

Status de envio de mensagem.

### `send.message.update`

Atualização de status de envio.

### `chats.set` / `chats.update` / `chats.upsert` / `chats.delete`

Eventos de chats (definir, atualizar, novo, deletar).

### `contacts.set` / `contacts.upsert` / `contacts.update`

Eventos de contatos.

### `presence.update`

Status de presença alterado.

### `groups.upsert` / `groups.update`

Eventos de grupo (novo, atualizado).

### `group-participants.update`

Participante entrou/saiu do grupo.

```json
{
  "event": "group-participants.update",
  "instance": "affiliate-1",
  "data": {
    "jid": "120363123456789@g.us",
    "participants": ["5511999999999@s.whatsapp.net"],
    "action": "add"
  }
}
```

### `call`

Chamada recebida.

---

## Proxy

### GET /proxy/get/:instanceName

Obtém configuração de proxy da instance.

### POST /proxy/set/:instanceName

Define proxy para a instance.

```json
{
  "enabled": true,
  "host": "proxy.exemplo.com",
  "port": "3128",
  "protocol": "http",
  "username": "user",
  "password": "pass"
}
```

---

## Labels

### GET /label/getLabels/:instanceName

Lista todas as labels/etiquetas.

### POST /label/handleLabel/:instanceName

Gerencia labels (criar, editar, associar a chat/mensagem).

---

## Notas de Implementação

### Headers obrigatórios

Todas as requisições para a Evolution API precisam do header:

```
apikey: <sua-api-key-configurada-no-env>
```

### URL patterns

Os parâmetros com `:` são substituídos pelo valor real:

- `POST /instance/create` → sem `:instanceName` (cria nova)
- `POST /instance/restart/:instanceName` → `POST /instance/restart/affiliate-1`
- `POST /message/sendText/:instanceName` → `POST /message/sendText/affiliate-1`

### Números de telefone

- Com DDI e DDD, sem `+`, sem espaços: `5511999999999`
- JID de grupo: `120363123456789@g.us` (obtido via `findGroupInfos` ou `groups.upsert`)
- JID de contato: `5511999999999@s.whatsapp.net`

### Webhook target

O webhook deve apontar para o `apps/api`. Em desenvolvimento via Docker Compose, usar o nome do serviço:

```
url: "http://api:3000/webhook/message"
```

### Rate limiting

- Evolution API não tem rate-limit interno agressivo
- WhatsApp Baileys aplica rate-limit próprio (~1 msg/seg para grupos)
- Delay recomendado entre envios: `delay: 2000` (2 segundos)

---

*Documentação baseada no source code da Evolution API (evolution-foundation/evolution-api) — tag v2.x. Consulte https://docs.evolutionfoundation.com.br para a documentação oficial completa.*
