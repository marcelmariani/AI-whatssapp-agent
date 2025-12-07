import dotenvFlow from "dotenv-flow";
import express from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import axios from "axios";
import { z } from "zod";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import { OAuth2Client } from "google-auth-library";

dotenvFlow.config();

const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp());

const port = process.env.PORT || 4000;
const apiKey = process.env.API_KEY || "";
const jwtSecret = process.env.JWT_SECRET || "replace-me";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" }) : null;
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
const services = {
  auth: process.env.AUTH_SERVICE_URL || "http://localhost:4001",
  customers: process.env.CUSTOMERS_SERVICE_URL || "http://localhost:4002",
  whatsapp: process.env.WHATSAPP_SERVICE_URL || "http://localhost:4003",
  billing: process.env.BILLING_SERVICE_URL || "http://localhost:4004",
  prompts: process.env.PROMPTS_SERVICE_URL || "http://localhost:4005"
};

const apiClient = axios.create();
apiClient.interceptors.request.use((config) => {
  if (apiKey) config.headers["x-api-key"] = apiKey;
  return config;
});

interface JwtPayload {
  userId: string;
  email: string;
  role: "admin" | "customer";
  customerId?: string;
}

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};

const requireJwt = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ message: "missing token" });
  const token = auth.substring(7);
  try {
    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "invalid token" });
  }
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user as JwtPayload;
  if (user.role !== "admin") return res.status(403).json({ message: "admin only" });
  next();
};

const requireCustomer = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user as JwtPayload;
  if (user.role !== "customer") return res.status(403).json({ message: "customer only" });
  next();
};

const customerSchema = z.object({
  name: z.string().min(1),
  document: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  type: z.enum(["PF", "PJ"]),
  address: z
    .object({ street: z.string().optional(), number: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), country: z.string().optional() })
    .optional(),
  paymentMethodId: z.string().optional(),
  tokensRemaining: z.number().int().nonnegative().optional()
});

const promptSchema = z.object({
  customerId: z.string().min(1),
  prompt: z.string().min(1),
  whatsappNumber: z.string().optional()
});

const sessionSchema = z.object({
  customerId: z.string().min(1),
  phone: z.string().min(5)
});

const chargeSchema = z.object({
  customerId: z.string().min(1),
  tokens: z.number().int().positive()
});

const validate = (schema: z.ZodSchema<any>) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "validation error", issues: parsed.error.issues });
  req.body = parsed.data;
  next();
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gateway" });
});

app.use(requireApiKey);

// Auth proxy (public, não requer JWT)
app.post("/api/auth/register", async (req, res) => {
  try {
    const r = await apiClient.post(`${services.auth}/register`, req.body);
    res.status(r.status).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json(err.response?.data || { message: "upstream error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const r = await apiClient.post(`${services.auth}/login`, req.body);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json(err.response?.data || { message: "upstream error" });
  }
});

// Google OAuth callback
app.post("/api/auth/google-callback", async (req, res) => {
  if (!googleClient) return res.status(500).json({ message: "Google OAuth não configurado" });
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ message: "credential obrigatório" });
  
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential });
    const payload = ticket.getPayload();
    if (!payload) return res.status(400).json({ message: "token inválido" });
    
    const { email, name } = payload;
    if (!email) return res.status(400).json({ message: "email não encontrado no token" });
    
    // Tentar fazer login com o email; se não existe, registrar novo
    const loginRes = await apiClient.post(`${services.auth}/login`, { 
      email, 
      password: `google-${email}` // Senha dummy para Google OAuth
    }).catch(err => {
      if (err.response?.status === 401) return null; // Usuário não existe
      throw err;
    });
    
    if (loginRes) {
      // Usuário existe, retornar token
      return res.json(loginRes.data);
    }
    
    // Usuário não existe, registrar novo
    const registerRes = await apiClient.post(`${services.auth}/register`, {
      email,
      password: `google-${email}`,
      role: "customer",
      name: name || email.split("@")[0]
    });
    
    // Fazer login com a conta criada
    const newLoginRes = await apiClient.post(`${services.auth}/login`, {
      email,
      password: `google-${email}`
    });
    
    res.json(newLoginRes.data);
  } catch (err: any) {
    logger.error({ err }, "Google OAuth verification failed");
    res.status(err.response?.status || 500).json({ message: "Google authentication failed" });
  }
});
// Rotas protegidas com JWT
app.use(requireJwt);

// ADMIN routes: full CRUD customers
app.get("/api/admin/customers", requireAdmin, async (_req, res) => {
  const r = await apiClient.get(`${services.customers}/customers`);
  res.json(r.data);
});

app.get("/api/admin/customers/:id", requireAdmin, async (req, res) => {
  try {
    const r = await apiClient.get(`${services.customers}/customers/${req.params.id}`);
    res.json(r.data);
  } catch (err: any) {
    if (err.response?.status === 404) return res.status(404).json({ message: "Not found" });
    res.status(500).json({ message: "upstream error" });
  }
});

app.post("/api/admin/customers", requireAdmin, validate(customerSchema), async (req, res) => {
  try {
    const r = await apiClient.post(`${services.customers}/customers`, req.body);
    res.status(201).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.put("/api/admin/customers/:id", requireAdmin, validate(customerSchema.partial()), async (req, res) => {
  try {
    const r = await apiClient.put(`${services.customers}/customers/${req.params.id}`, req.body);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.delete("/api/admin/customers/:id", requireAdmin, async (req, res) => {
  try {
    await apiClient.delete(`${services.customers}/customers/${req.params.id}`);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

// ADMIN: ver todas sessões WhatsApp
app.get("/api/admin/whatsapp/sessions", requireAdmin, async (_req, res) => {
  const r = await apiClient.get(`${services.whatsapp}/whatsapp/sessions`);
  res.json(r.data);
});

// CUSTOMER routes: acesso apenas aos próprios dados
app.get("/api/customer/me", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId in token" });
  try {
    const r = await apiClient.get(`${services.customers}/customers/${user.userId}`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/me", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId in token" });
  try {
    const r = await apiClient.put(`${services.customers}/customers/${user.userId}`, req.body);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/password", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ message: "missing fields" });
  try {
    const r = await apiClient.patch(`${services.auth}/password`, {
      userId: user.userId,
      currentPassword,
      newPassword
    });
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.message || "upstream error" });
  }
});

app.get("/api/customer/prompt", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.get(`${services.prompts}/prompts`, { params: { customerId: user.userId } });
    res.json(r.data?.[0] || {});
  } catch (err: any) {
    if (err.response?.status === 404) return res.status(404).json({ message: "Not found" });
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.put("/api/customer/prompt", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.customerId) return res.status(400).json({ message: "no customerId" });
  const body = { ...req.body, customerId: user.customerId };
  try {
    const r = await apiClient.post(`${services.prompts}/prompts`, body);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

// PROMPTS collection endpoints (novo fluxo)
app.get("/api/customer/prompts", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.get(`${services.prompts}/prompts`, { params: { customerId: user.userId } });
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.post("/api/customer/prompts", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  const { whatsappNumber, prompt } = req.body;
  if (!whatsappNumber || !prompt) return res.status(400).json({ message: "missing fields" });
  try {
    // validar que o número tem sessão ativa do cliente
    const sessionsResp = await apiClient.get(`${services.whatsapp}/whatsapp/sessions`);
    const sessions = (sessionsResp.data || []).filter((s: any) => s.customerId === user.userId);
    const hasActive = sessions.some((s: any) => s.phone === whatsappNumber && s.status === "connected");
    if (!hasActive) return res.status(400).json({ message: "Número sem sessão ativa" });

    const body = { customerId: user.userId, whatsappNumber, prompt };
    const r = await apiClient.post(`${services.prompts}/prompts`, body);
    res.status(201).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.post("/api/customer/prompts/:id/copy", requireCustomer, async (req, res) => {
  try {
    const r = await apiClient.post(`${services.prompts}/prompts/${req.params.id}/copy`);
    res.status(201).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/prompts/:id", requireCustomer, async (req, res) => {
  try {
    const r = await apiClient.patch(`${services.prompts}/prompts/${req.params.id}`, req.body);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/prompts/:id/activate", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  try {
    const current = await apiClient.get(`${services.prompts}/prompts`, { params: { customerId: user.userId } });
    const target = (current.data || []).find((p: any) => p._id === req.params.id);
    if (!target) return res.status(404).json({ message: "Prompt not found" });

    // validar sessão ativa para o número
    const sessionsResp = await apiClient.get(`${services.whatsapp}/whatsapp/sessions`);
    const sessions = (sessionsResp.data || []).filter((s: any) => s.customerId === user.userId);
    const hasActive = sessions.some((s: any) => s.phone === target.whatsappNumber && s.status === "connected");
    if (!hasActive) return res.status(400).json({ message: "Número sem sessão ativa" });

    const r = await apiClient.patch(`${services.prompts}/prompts/${req.params.id}/activate`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/prompts/:id/deactivate", requireCustomer, async (req, res) => {
  try {
    const r = await apiClient.patch(`${services.prompts}/prompts/${req.params.id}/deactivate`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.delete("/api/customer/prompts/:id", requireCustomer, async (req, res) => {
  try {
    await apiClient.delete(`${services.prompts}/prompts/${req.params.id}`);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.get("/api/customer/sessions", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    // Retorna apenas sessões do cliente
    const r = await apiClient.get(`${services.whatsapp}/whatsapp/sessions`);
    const filtered = r.data.filter((s: any) => s.customerId === user.userId);
    res.json(filtered);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.post("/api/customer/sessions", requireCustomer, validate(sessionSchema.omit({ customerId: true })), async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  const body = { ...req.body, customerId: user.userId };
  try {
    const cust = await apiClient.get(`${services.customers}/customers/${user.userId}`);
    if (!cust.data?.paymentMethodId) return res.status(402).json({ message: "É necessário um cartão ativo para criar sessões." });
    const r = await apiClient.post(`${services.whatsapp}/whatsapp/sessions`, body);
    res.status(202).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.delete("/api/customer/sessions/:sessionId", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.delete(`${services.whatsapp}/whatsapp/sessions/${req.params.sessionId}`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/sessions/:sessionId/deactivate", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.patch(`${services.whatsapp}/whatsapp/sessions/${req.params.sessionId}/deactivate`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.patch("/api/customer/sessions/:sessionId/reactivate", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.patch(`${services.whatsapp}/whatsapp/sessions/${req.params.sessionId}/reactivate`);
    res.status(202).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.get("/api/customer/balance", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  try {
    const r = await apiClient.get(`${services.billing}/balances/${user.userId}`);
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

app.post("/api/customer/charges", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  const body = { customerId: user.userId, tokens: req.body.tokens };
  try {
    const r = await apiClient.post(`${services.billing}/charges`, body);
    res.status(202).json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: "upstream error" });
  }
});

// Stripe Checkout (setup mode) para cadastrar cartão
app.post("/api/customer/billing/checkout-session", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!stripe) return res.status(500).json({ message: "Stripe não configurado" });
  const { successUrl, cancelUrl } = req.body || {};
  if (!successUrl || !cancelUrl) return res.status(400).json({ message: "successUrl e cancelUrl são obrigatórios" });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email,
      metadata: { customerId: user.userId }
    });
    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err }, "erro ao criar checkout Stripe");
    res.status(err.statusCode || 500).json({ message: err.message || "stripe error" });
  }
});

// Finaliza checkout: recupera paymentMethod e salva no serviço de clientes
app.get("/api/customer/payment-method/checkout-complete", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!stripe) return res.status(500).json({ message: "Stripe não configurado" });
  const sessionId = req.query.session_id as string;
  if (!sessionId) return res.status(400).json({ message: "session_id obrigatório" });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
    if (session.mode !== "setup") return res.status(400).json({ message: "modo de checkout inválido" });
    if (session.status !== "complete") return res.status(400).json({ message: "checkout não concluído" });
    if (session.metadata?.customerId && session.metadata.customerId !== user.userId) return res.status(403).json({ message: "checkout não pertence ao usuário" });

    const setupIntent = session.setup_intent;
    let paymentMethodId: string | undefined;
    if (typeof setupIntent === "string") {
      const si = await stripe.setupIntents.retrieve(setupIntent, { expand: ["payment_method"] });
      paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    } else if (setupIntent) {
      paymentMethodId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
    }

    if (!paymentMethodId) return res.status(400).json({ message: "paymentMethodId não encontrado" });

    await apiClient.put(`${services.customers}/customers/${user.userId}`, { paymentMethodId });
    res.json({ paymentMethodId });
  } catch (err: any) {
    logger.error({ err }, "erro ao finalizar checkout");
    res.status(err.statusCode || 500).json({ message: err.message || "stripe error" });
  }
});

// Payment method update
app.patch("/api/customer/payment-method", requireCustomer, async (req, res) => {
  const user = (req as any).user as JwtPayload;
  if (!user.userId) return res.status(400).json({ message: "no userId" });
  const { paymentMethodId } = req.body || {};
  if (!paymentMethodId) return res.status(400).json({ message: "missing paymentMethodId" });
  try {
    const r = await apiClient.put(`${services.customers}/customers/${user.userId}`, { paymentMethodId });
    res.json(r.data);
  } catch (err: any) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.message || "upstream error" });
  }
});

app.use((req, res) => {
  res.status(501).json({ message: `No route configured for ${req.method} ${req.path}` });
});

app.listen(port, () => {
  logger.info({ port }, "gateway running");
});
