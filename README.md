# SmartIA Platform

Plataforma SaaS de Automação de Atendimento WhatsApp com IA

## 📋 Visão Geral

SmartIA é uma plataforma que permite clientes automatizar atendimento via WhatsApp usando inteligência artificial.

### Fluxo Principal

1. Registrar e criar perfil
2. Adicionar cartão de crédito (Stripe)
3. Criar sessão WhatsApp
4. Definir prompts (instruções para IA)
5. IA responde automaticamente 24/7

## 🏗️ Stack Tecnológico

- **Frontend**: React 18 + Vite + TypeScript
- **Backend**: Express + Node.js
- **Banco de Dados**: MongoDB
- **Cache**: Redis
- **Autenticação**: JWT + Google OAuth
- **Pagamentos**: Stripe
- **WhatsApp**: Baileys

## 🔧 Arquitetura

```
FRONTEND (React)
  ↓
API GATEWAY (Port 4000)
  ↓
┌─────────────────────────────────────┐
│      MICROSERVIÇOS                  │
├─────────────────────────────────────┤
│ Auth (4001)                         │
│ Customers (4002)                    │
│ WhatsApp (4003)                     │
│ Billing (4004)                      │
│ Prompts (4005)                      │
├─────────────────────────────────────┤
│ MongoDB (x5) + Redis                │
└─────────────────────────────────────┘
```

## 📦 Microserviços

### Gateway (Port 4000)
Proxy de autenticação e roteamento de requisições.

### Auth (Port 4001)
Gerenciamento de usuários e autenticação.

### Customers (Port 4002)
Dados dos clientes e informações de pagamento.

### WhatsApp (Port 4003)
Gerenciamento de sessões WhatsApp via Baileys.

### Billing (Port 4004)
Faturas e cobranças (futuro).

### Prompts (Port 4005)
Gerenciamento de prompts e instruções da IA.

## 🚀 Setup Local

### Requisitos

- Node.js LTS
- PNPM 8+
- Docker & Docker Compose
- Stripe Account (test keys)
- Google OAuth Credentials

### Instalação

```bash
# Instalar dependências
pnpm install

# Configurar variáveis de ambiente
# Veja .env.example em cada serviço

# Iniciar infraestrutura
docker-compose up -d

# Rodar em desenvolvimento
pnpm dev:all
```

### URLs de Acesso

| Serviço | URL |
|---------|-----|
| Portal Cliente | http://localhost:5174 |
| Portal Admin | http://localhost:5175 |
| Gateway | http://localhost:4000 |
| Auth | http://localhost:4001 |
| Customers | http://localhost:4002 |
| WhatsApp | http://localhost:4003 |
| Billing | http://localhost:4004 |
| Prompts | http://localhost:4005 |

## 🔐 Fluxos de Autenticação

### JWT
- Login retorna JWT
- Stored em localStorage
- Enviado em cada requisição
- Validado pelo Gateway

### Google OAuth
- Login via Google
- Retorna ID token
- Gateway verifica e cria usuário
- Retorna JWT

### Stripe
- Cliente adiciona cartão
- Redirecionado para Stripe Checkout
- Stripe retorna token
- Armazenado no banco

## 🧪 Testes Rápidos
