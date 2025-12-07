import dotenvFlow from "dotenv-flow";
import express from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import mongoose from "mongoose";

dotenvFlow.config();

const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp());

const port = process.env.PORT || 4004;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27020/billing";
const apiKey = process.env.API_KEY || "";

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};

const balanceSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    tokensRemaining: { type: Number, default: 0 },
    lastCharge: { type: Date }
  },
  { timestamps: true }
);

const Balance = mongoose.model("Balance", balanceSchema);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "billing" });
});

app.use(requireApiKey);

app.get("/balances/:customerId", async (req, res) => {
  const bal = await Balance.findOne({ customerId: req.params.customerId }).lean();
  if (!bal) return res.status(404).json({ message: "Not found" });
  res.json(bal);
});

app.post("/charges", async (req, res) => {
  // TODO: integrar gateway de pagamento real; por ora só credita tokens
  const { customerId, tokens } = req.body;
  if (!customerId || !tokens) return res.status(400).json({ message: "customerId and tokens required" });
  const bal = await Balance.findOneAndUpdate(
    { customerId },
    { $inc: { tokensRemaining: tokens }, lastCharge: new Date() },
    { new: true, upsert: true }
  ).lean();
  res.status(202).json({ status: "credited", balance: bal });
});

async function start() {
  try {
    await mongoose.connect(mongoUri);
    app.listen(port, () => {
      logger.info({ port }, "billing service running");
    });
  } catch (err) {
    logger.error({ err }, "failed to start billing service");
    process.exit(1);
  }
}

start();
