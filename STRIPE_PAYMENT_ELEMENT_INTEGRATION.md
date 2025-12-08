# Integração Stripe Payment Element - Mudanças no Backend

## Novo Endpoint: POST /api/customer/billing/setup-intent

Este endpoint substitui o anterior `checkout-session` e cria um SetupIntent para o Payment Element.

### Implementação (Express.js)

```typescript
// services/gateway/src/routes/billing.ts

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// POST /api/customer/billing/setup-intent
router.post('/setup-intent', authenticate, async (req, res) => {
  try {
    const customerId = req.user.customerId;
    
    // Buscar cliente Stripe
    const customer = await getStripeCustomer(customerId);
    
    if (!customer) {
      return res.status(400).json({ 
        message: "Perfil incompleto. Configure seu perfil antes." 
      });
    }

    // Criar SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session', // Permite cobranças futuras
      metadata: {
        customerId: customerId
      }
    });

    res.json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    console.error('Erro ao criar SetupIntent:', error);
    res.status(500).json({ 
      message: "Falha ao iniciar formulário de pagamento" 
    });
  }
});

// Webhook para confirmar SetupIntent
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === 'setup_intent.succeeded') {
      const setupIntent = event.data.object as Stripe.SetupIntent;
      const customerId = setupIntent.metadata?.customerId;
      const paymentMethodId = setupIntent.payment_method;

      // Salvar payment_method no banco de dados
      if (customerId && paymentMethodId) {
        await Customer.updateOne(
          { _id: customerId },
          { paymentMethodId: paymentMethodId }
        );
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});
```

## Variáveis de Ambiente (Backend)

```env
# .env (services/gateway)

# Stripe
STRIPE_SECRET_KEY=sk_test_seu_secret_key_aqui
STRIPE_WEBHOOK_SECRET=whsec_seu_webhook_secret_aqui

# ... outras variáveis
```

## Setup do Webhook Stripe

1. Acesse [Stripe Dashboard > Developers > Webhooks](https://dashboard.stripe.com/webhooks)
2. Clique em "Add endpoint"
3. Digite a URL: `https://seu-dominio.com/api/customer/billing/webhook`
4. Selecione os eventos:
   - `setup_intent.succeeded`
   - `setup_intent.setup_failed`
5. Copie o "Signing secret" e coloque em `STRIPE_WEBHOOK_SECRET`

## Fluxo Atualizado

```
Cliente clica "Adicionar cartão"
    ↓
Frontend chama POST /api/customer/billing/setup-intent
    ↓
Backend cria SetupIntent e retorna clientSecret
    ↓
Frontend renderiza Payment Element com clientSecret
    ↓
Cliente preenche dados do cartão (permanece na página)
    ↓
Frontend chama stripe.confirmSetup()
    ↓
Stripe processa o cartão e retorna setupIntent
    ↓
setupIntent.status === 'succeeded' → Cartão confirmado
    ↓
Frontend salva paymentMethodId no state
    ↓
Webhook Stripe notifica backend → Salva no banco
```

## Remover Endpoint Anterior

O endpoint `POST /api/customer/billing/checkout-session` pode ser removido ou deprecado, pois será substituído por `setup-intent`.

```typescript
// ❌ REMOVER
router.post('/checkout-session', authenticate, async (req, res) => {
  // ... código antigo
});

// ❌ REMOVER também a rota de callback
router.get('/payment-method/checkout-complete', authenticate, async (req, res) => {
  // ... código antigo
});
```

## Segurança

- ✅ ClientSecret é único por sessão
- ✅ Stripe JavaScript não expõe dados sensíveis
- ✅ PCI DSS compliance automático
- ✅ Sem necessidade de armazenar números de cartão

## Testes Locais (Stripe Test Mode)

Use estes cartões de teste:

| Cenário | Cartão | Exp | CVC |
|---------|--------|-----|-----|
| Sucesso | 4242 4242 4242 4242 | 12/25 | 123 |
| Autenticação 3D | 4000 0027 6000 3184 | 12/25 | 123 |
| Cartão recusado | 4000 0000 0000 0002 | 12/25 | 123 |

## Troubleshooting

### "Client secret is not valid"
- Certifique-se que o `clientSecret` é válido e não expirou
- SetupIntent expira em ~24 horas
- Crie um novo SetupIntent se necessário

### "Payment method not found"
- Verifique se o webhook foi confirmado
- Ou salve o `paymentMethodId` imediatamente após `confirmSetup()`

### "stripe is not defined"
- Verifique se `loadStripe()` foi chamado corretamente
- Confira se `VITE_STRIPE_PUBLIC_KEY` está correto

## Próximos Passos

1. ✅ Frontend: Componentes Payment Element criados
2. ⏳ Backend: Implementar endpoints de SetupIntent
3. ⏳ Backend: Configurar webhook
4. ⏳ Testes: Validar fluxo completo
5. ⏳ Deploy: Usar chaves de produção do Stripe
