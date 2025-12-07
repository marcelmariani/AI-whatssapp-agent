# SmartIA Platform - Sistema de Automação de Atendimento WhatsApp

Plataforma completa para automação de atendimento via WhatsApp com IA, cobrança por tokens e gerenciamento de prompts.

---

## 📋 Visão Geral do Projeto

SmartIA é uma plataforma SaaS que permite clientes automatizar atendimento via WhatsApp usando IA. Os clientes seguem este fluxo:

1. **Registram e criam perfil** - Email, senha e dados pessoais
2. **Adicionam cartão de crédito** - Integração com Stripe
3. **Criam sessões WhatsApp** - Autenticação via QR code
4. **Definem prompts** - Instruções personalizadas para a IA
5. **IA responde automaticamente** - 24/7 baseada nos prompts definidos

---

## 🏗️ Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| **Frontend Cliente** | React 18 + Vite + TypeScript |
| **Frontend Admin** | React 18 + Vite + TypeScript |
| **API Gateway** | Express + Node.js |
| **Microserviços** | Express + Node.js |
| **Banco de Dados** | MongoDB (múltiplas instâncias) |
| **Cache/Fila** | Redis |
| **Autenticação** | JWT + Google OAuth |
| **Pagamentos** | Stripe Checkout (hospedado) |
| **WhatsApp** | Baileys (reverse engineering) |

---

## 🏗️ Arquitetura do Sistema

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                       │
├──────────────────────┬──────────────────────────────────────┤
│  Portal Cliente      │     Portal Admin (futuro)            │
│  - Autenticação      │     - Gerenciar clientes             │
│  - Perfil            │     - Tokens/cobrança                │
│  - Cartão (Stripe)   │     - Analytics                      │
│  - WhatsApp          │                                      │
│  - Prompts           │                                      │
│  - Dashboard         │                                      │
└──────────────────────┴──────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    API GATEWAY (Port 4000)                  │
│  Express + JWT Middleware                                   │
│  - Rota de autenticação (register, login, Google OAuth)    │
│  - Rota de clientes (me, perfil update)                    │
│  - Rota de pagamentos (Stripe checkout, payment method)    │
│  - Rota de WhatsApp (sessões, QR code)                     │
│  - Rota de prompts (CRUD)                                  │
└─────────────────────────────────────────────────────────────┘
         ↓         ↓         ↓         ↓         ↓
      ┌──────┬──────────┬──────────┬────────┬─────────┐
      │      │          │          │        │         │
    AUTH  CUSTOMERS  WHATSAPP   BILLING  PROMPTS  (outros)
    4001    4002      4003       4004     4005
      │      │          │          │        │
   ┌──────────────────────────────────────────────┐
   │  MongoDB x5 (um por microserviço)            │
   │  + Redis (cache/sessões)                    │
   └──────────────────────────────────────────────┘
```

---

### Fluxo do Cliente - Etapas Principais

#### 1️⃣ Onboarding

```
Registrar (email/senha)
    ↓
Login (JWT gerado)
    ↓
[Perfil] Completar dados (nome, documento, telefone, endereço)
    ↓
[Billing] Adicionar cartão via Stripe Checkout
    ↓
Cartão armazenado com segurança (apenas token Stripe)
```

#### 2️⃣ Criar Sessão WhatsApp

```
[WhatsApp] Clicar "Criar sessão"
    ↓
Validar: perfil completo (document + phone) + cartão ativo
    ↓
Gateway → WhatsApp service cria sessão (status: pending)
    ↓
Baileys inicia socket e gera QR code
    ↓
QR exibido no modal (polling 1.5s)
    ↓
Cliente escaneia com WhatsApp
    ↓
Sessão status: connected (IA responde 24/7)
```

#### 3️⃣ Configurar Prompt

```
[Prompt] Criar novo prompt (inativo por padrão)
    ↓
Selecionar número WhatsApp com sessão conectada
    ↓
Editar instruções para IA
    ↓
Ativar prompt (apenas um ativo por número)
    ↓
IA começa a responder conforme instruções
```

#### 4️⃣ Consumo de Tokens

```
Cliente cada mensagem respondida pela IA
    ↓
Tokens consumidos do saldo
    ↓
Quando saldo baixo → alertar cliente
    ↓
Cliente solicita recarga via suporte
    ↓
Admin recarrega manualmente
```

---

## 📦 Microserviços Disponíveis

### Gateway (Port 4000)

- **Função**: Proxy/orquestrador de autenticação e requisições
- **Responsabilidades**:
  - Validar JWT em todas as rotas protegidas
  - Rotear requisições para serviços corretos
  - Gerenciar Stripe Checkout (criar sessão, finalizar)
  - Google OAuth (verificar token, criar/login usuário)
- **ENV**: `JWT_SECRET`, `STRIPE_SECRET_KEY`, `GOOGLE_CLIENT_ID`

### Auth (Port 4001)

- **Função**: Autenticação e gerenciamento de usuários
- **Responsabilidades**:
  - Register/Login (email/senha)
  - Gerar JWT
  - Sincronizar novo usuário com serviço de clientes
  - Mudar senha
- **Banco**: `auth` (colection: `users`)
- **ENV**: `JWT_SECRET`, `CUSTOMERS_SERVICE_URL`

### Customers (Port 4002)

- **Função**: Gerenciar dados de clientes
- **Responsabilidades**:
  - CRUD de clientes (name, document, phone, type, address)
  - Armazenar `paymentMethodId` (token Stripe)
  - Armazenar `tokensRemaining` (saldo)
- **Banco**: `customers` (colection: `customers`)
- **Validação**: document/phone opcionais no registro (completar depois em Perfil)

### WhatsApp (Port 4003)

- **Função**: Gerenciar sessões WhatsApp via Baileys
- **Responsabilidades**:
  - CRUD de sessões
  - Gerar QR codes
  - Gerenciar status (pending → connected → inactive)
  - Manter socket ativo para receber mensagens
- **Banco**: `whatsapp` (colection: `sessions`)
- **Armazenamento**: `./.wa-sessions/{sessionId}/` (credenciais locais)
- **ENV**: `MONGO_URI`, `API_KEY`

### Billing (Port 4004)

- **Status**: Futuro
- **Função**: Gerenciar faturas e cobranças automáticas
- *(Ainda em planejamento)*

### Prompts (Port 4005)

- **Função**: Gerenciar prompts (instruções para IA)
- **Responsabilidades**:
  - CRUD de prompts
  - Ativar/inativar (apenas um ativo por número)
  - Copiar prompt (para editar variações)
- **Banco**: `prompts` (colection: `prompts`)
- **Campos**: `customerId`, `whatsappNumber`, `prompt`, `status` (active/inactive)

---

## 🔐 Segurança & Fluxos de Dados

### Autenticação JWT

```
Login → JWT gerado (userId, email, role, customerId)
    ↓
JWT salvo em localStorage (cliente)
    ↓
Cada requisição inclui: Authorization: Bearer {JWT}
    ↓
Gateway valida JWT com JWT_SECRET
    ↓
Se válido → requisição prossegue; senão → 401
```

### Google OAuth

```
Cliente clica "Entrar com Google"
    ↓
Google retorna credential (ID token)
    ↓
Gateway verifica token com Google Auth Library
    ↓
Extrai email/name
    ↓
Usuário existe? → login normal
    ↓
Não existe? → registrar + login automático
    ↓
JWT retornado
```

### Pagamento (Stripe)

```
Cliente em Billing clica "Adicionar cartão"
    ↓
Gateway cria Stripe Checkout Session (modo setup)
    ↓
Cliente redirecionado para Stripe Checkout hospedado
    ↓
Cliente preenche dados do cartão (NA STRIPE, não no app)
    ↓
Sucesso → volta para app com session_id
    ↓
App chama GET /api/customer/payment-method/checkout-complete
    ↓
Gateway recupera setupIntent.payment_method do Stripe
    ↓
Salva paymentMethodId em customers service
    ↓
Cartão ativo (token armazenado, não o número)
```

### Sessões WhatsApp

```
POST /api/customer/sessions
    ↓
Validar: perfil completo (document + phone) + cartão ativo
    ↓
Rejeitar se sem cartão (402 Payment Required)
    ↓
Criar sessão com status: pending
    ↓
Iniciar Baileys socket
    ↓
Gerar QR code (data URL em base64)
    ↓
Salvar em banco
    ↓
Cliente faz polling (1.5s) para carregar QR
    ↓
Quando escaneia → socket detecta autenticação
    ↓
Status muda para: connected
```

---

## 🚀 Setup & Deployment

### Requisitos do Sistema

- Node.js LTS
- PNPM 8+
- Docker & Docker Compose
- Stripe Account (chaves de teste)
- Google OAuth Credentials

### Instalação Local

```bash
# 1. Instalar dependências
pnpm install

# 2. Configurar variáveis de ambiente
# apps/smart-portal/.env.local
VITE_API_URL=http://localhost:4000
VITE_API_KEY=dev-key
VITE_GOOGLE_CLIENT_ID=seu_google_client_id

# services/gateway/.env
PORT=4000
JWT_SECRET=seu_segredo_jwt
STRIPE_SECRET_KEY=sk_test_...
GOOGLE_CLIENT_ID=seu_google_client_id

# ... (outros .env em cada serviço)

# 3. Iniciar infraestrutura
docker-compose up -d

# 4. Rodar tudo em paralelo
pnpm dev:all
```

### URLs de Acesso Local

| Serviço | URL |
|---------|-----|
| Portal Cliente | http://localhost:5174 |
| Portal Admin | http://localhost:5175 |
| Gateway API | http://localhost:4000 |
| Auth Service | http://localhost:4001 |
| Customers Service | http://localhost:4002 |
| WhatsApp Service | http://localhost:4003 |
| Billing Service | http://localhost:4004 |
| Prompts Service | http://localhost:4005 |

---

## 📝 Variáveis de Ambiente

### Gateway (.env)

```env
PORT=4000
AUTH_SERVICE_URL=http://localhost:4001
CUSTOMERS_SERVICE_URL=http://localhost:4002
WHATSAPP_SERVICE_URL=http://localhost:4003
BILLING_SERVICE_URL=http://localhost:4004
PROMPTS_SERVICE_URL=http://localhost:4005
API_KEY=dev-key
JWT_SECRET=seu_segredo_super_seguro
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLIC_KEY=pk_test_xxx
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
```

### Cada Microserviço

```env
PORT=400x
MONGO_URI=mongodb://localhost:270xx/database_name
API_KEY=dev-key
JWT_SECRET=seu_segredo_super_seguro (se necessário)
```

---

## 🧪 Testes Rápidos

### 1. Verificar serviços

```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
# ... etc
```

### 2. Registrar cliente

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"email":"test@example.com","password":"123456","role":"customer"}'
```

### 3. Fazer login

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"email":"test@example.com","password":"123456"}'
```

### 4. Completar perfil

```bash
curl -X PATCH http://localhost:4000/api/customer/me \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -H "Authorization: Bearer {JWT}" \
  -d '{"name":"João","document":"12345678900","phone":"11999999999"}'
```

### 5. Criar sessão WhatsApp

```bash
curl -X POST http://localhost:4000/api/customer/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -H "Authorization: Bearer {JWT}" \
  -d '{"phone":"5511999999999"}'
```

---

## 📊 Sequência Completa: Do Registro à IA Respondendo

```
1. Cliente registra email/senha
    ↓
2. Auth cria usuário + sincroniza com Customers
    ↓
3. Cliente loga → JWT gerado
    ↓
4. Cliente vai em Perfil → completa dados
    ↓
5. Cliente vai em Billing → Stripe Checkout
    ↓
6. Cartão salvo (token Stripe apenas)
    ↓
7. Cliente cria sessão WhatsApp → gera QR
    ↓
8. Cliente escaneia → Baileys autentica
    ↓
9. Sessão status: connected
    ↓
10. Cliente cria prompt → escolhe número conectado
     ↓
11. Cliente ativa prompt
     ↓
12. IA começa a responder com base no prompt
```

---

## 🔧 Troubleshooting

| Problema | Solução |
|----------|---------|
| QR code não aparece | Verificar se WhatsApp service está rodando; checar logs com `pnpm dev:whatsapp` |
| Sessão não conecta | Cliente precisa escanear antes de 30s; se expirar, deletar e criar nova |
| Cartão não salva | Verificar STRIPE_SECRET_KEY no gateway; testar com card `4242 4242 4242 4242` |
| Google OAuth falha | Verificar GOOGLE_CLIENT_ID e URI autorizada em Google Cloud Console |
| Erro 402 ao criar sessão | Completar perfil + adicionar cartão via Billing |

---

## 📚 Referências e Documentação

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Express.js Guide](https://expressjs.com/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [React 18 Docs](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

## 📄 Informações do Projeto

| Campo | Valor |
|-------|-------|
| **Status** | Em desenvolvimento |
| **Versão** | 0.1.0 |
| **Linguagem Principal** | TypeScript |
| **Repositório** | [AI-whatssapp-agent](https://github.com/marcelmariani/AI-whatssapp-agent) |
| **Owner** | marcelmariani |

**Última atualização**: Dezembro 2025
 
 