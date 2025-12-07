import dotenvFlow from "dotenv-flow";
import express from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import mongoose from "mongoose";
import QRCode from "qrcode";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

dotenvFlow.config();

const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp());

const port = process.env.PORT || 4003;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27019/whatsapp";
const apiKey = process.env.API_KEY || "";

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};

// Session Status Lifecycle:
// pending: Aguardando escanear QR code
// connected: Ativo e respondendo (IA responde 24/7 mesmo após logout do usuário)
// inactive: Inativado manualmente pelo cliente (IA não responde mais)
// failed: Erro durante setup inicial

const sessionSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "connected", "inactive", "failed"], default: "pending" },
    qrCode: { type: String },
    lastMessage: { type: String }
  },
  { timestamps: true }
);

const Session = mongoose.model("Session", sessionSchema);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "whatsapp" });
});

app.use(requireApiKey);

app.get("/whatsapp/sessions", async (_req, res) => {
  const sessions = await Session.find().lean();
  res.json(sessions);
});

app.post("/whatsapp/sessions", async (req, res) => {
  try {
    const { customerId, phone } = req.body;
    
    // Validar: não permitir criar sessão se o número já existe em status pending ou connected
    const existingSession = await Session.findOne({
      phone,
      status: { $in: ["pending", "connected"] }
    });
    
    if (existingSession) {
      return res.status(400).json({ 
        message: "Número já possui uma sessão ativa ou aguardando ativação" 
      });
    }
    
    const session = await Session.create({ customerId, phone, status: "pending" });
    void startBaileysSession(session.id, customerId, phone);
    res.status(202).json(session);
  } catch (err) {
    logger.error({ err }, "create session failed");
    res.status(400).json({ message: "Invalid payload" });
  }
});

// Deletar sessão (apenas se aguardando ou falhou)
app.delete("/whatsapp/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    // Permitir deletar apenas se estiver pending, failed ou inactive
    if (session.status === "connected") {
      return res.status(400).json({ 
        message: "Não é possível deletar uma sessão ativa. Desative-a primeiro." 
      });
    }
    
    await Session.findByIdAndDelete(sessionId);
    res.json({ message: "Session deleted successfully" });
  } catch (err) {
    logger.error({ err }, "delete session failed");
    res.status(400).json({ message: "Failed to delete session" });
  }
});

// Desativar sessão (inativar uma sessão ativa)
app.patch("/whatsapp/sessions/:sessionId/deactivate", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    if (session.status !== "connected") {
      return res.status(400).json({ 
        message: "Apenas sessões ativas podem ser desativadas" 
      });
    }
    
    await Session.findByIdAndUpdate(sessionId, { 
      status: "inactive", 
      qrCode: null 
    });
    
    res.json({ message: "Session deactivated successfully" });
  } catch (err) {
    logger.error({ err }, "deactivate session failed");
    res.status(400).json({ message: "Failed to deactivate session" });
  }
});

// Reativar sessão inativa (gera novo QR)
app.patch("/whatsapp/sessions/:sessionId/reactivate", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    if (session.status !== "inactive") {
      return res.status(400).json({ 
        message: "Apenas sessões inativas podem ser reativadas" 
      });
    }
    
    // Verificar se há alguma sessão ativa com o mesmo número
    const activeSession = await Session.findOne({
      phone: session.phone,
      status: "connected"
    });
    
    if (activeSession) {
      return res.status(400).json({ 
        message: "Este número já possui uma sessão ativa" 
      });
    }
    
    // Atualizar status para pending e iniciar nova sessão
    await Session.findByIdAndUpdate(sessionId, { status: "pending", qrCode: null });
    void startBaileysSession(sessionId, session.customerId, session.phone);
    
    res.status(202).json({ message: "Session reactivation started" });
  } catch (err) {
    logger.error({ err }, "reactivate session failed");
    res.status(400).json({ message: "Failed to reactivate session" });
  }
});

async function startBaileysSession(sessionId: string, customerId: string, phone: string) {
  try {
    logger.info({ sessionId, customerId, phone }, "starting Baileys session...");
    const { state, saveCreds } = await useMultiFileAuthState(`./.wa-sessions/${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();
    logger.info({ sessionId, version }, "Baileys version fetched");

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["SmartIA", "Desktop", "1.0"],
      getMessage: async (key) => {
        return { conversation: "" };
      }
    });
    logger.info({ sessionId }, "WhatsApp socket created");

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
      const { connection, qr, lastDisconnect } = update;
      logger.info({ sessionId, update: { connection, qr: qr ? "present" : "null", lastDisconnect } }, "connection update received");

      if (qr) {
        try {
          logger.info({ sessionId, qrValue: qr.substring(0, 50) }, "generating QR code from value");
          const qrDataUrl = await QRCode.toDataURL(qr);
          logger.info({ sessionId, qrLength: qrDataUrl.length }, "QR code generated as data URL");
          await Session.findByIdAndUpdate(sessionId, { qrCode: qrDataUrl, status: "pending" });
          logger.info({ sessionId }, "QR code saved to database");
        } catch (err) {
          logger.error({ err, sessionId }, "failed to generate or save QR");
        }
      }

      if (connection === "open") {
        await Session.findByIdAndUpdate(sessionId, { status: "connected", qrCode: null });
        logger.info({ sessionId, phone }, "WhatsApp session connected successfully");
      }

      if (connection === "close") {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          logger.warn({ sessionId, error: (lastDisconnect?.error as any)?.output?.statusCode }, "Reconnecting...");
          // Connection was lost but not logged out - try to reconnect
          await new Promise(r => setTimeout(r, 3000)); // Wait 3 seconds before reconnecting
          void startBaileysSession(sessionId, customerId, phone);
        } else {
          // User logged out - keep session connected so IA can continue responding 24/7
          // Only mark as inactive when user manually deactivates it
          logger.info({ sessionId }, "WhatsApp client logged out but session remains active for IA responses");
          // Don't change status - session remains connected
        }
      }
    });

    sock.ev.on("messages.upsert", async msg => {
      logger.info({ sessionId }, "Message received");
    });

    logger.info({ sessionId, customerId, phone }, "Baileys session started");
  } catch (err) {
    logger.error({ err, sessionId }, "failed to start Baileys session");
    // On error during initial setup, mark as inactive
    await Session.findByIdAndUpdate(sessionId, { status: "inactive", qrCode: null });
  }
}

async function start() {
  try {
    await mongoose.connect(mongoUri);
    app.listen(port, () => {
      logger.info({ port }, "whatsapp service running");
    });
  } catch (err) {
    logger.error({ err }, "failed to start whatsapp service");
    process.exit(1);
  }
}

start();
