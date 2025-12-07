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

const port = process.env.PORT || 4005;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27021/prompts";
const apiKey = process.env.API_KEY || "";

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};

const promptSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    whatsappNumber: { type: String, required: true, index: true },
    prompt: { type: String, required: true },
    status: { type: String, enum: ["active", "inactive"], default: "inactive", index: true },
    originPromptId: { type: mongoose.Schema.Types.ObjectId, required: false }
  },
  { timestamps: true }
);

const Prompt = mongoose.model("Prompt", promptSchema);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "prompts" });
});

app.use(requireApiKey);

// Lista prompts do cliente
app.get("/prompts", async (req, res) => {
  const customerId = req.query.customerId as string;
  if (!customerId) return res.status(400).json({ message: "customerId is required" });
  const docs = await Prompt.find({ customerId }).sort({ updatedAt: -1 }).lean();
  res.json(docs);
});

// Cria prompt (inicia como inativo)
app.post("/prompts", async (req, res) => {
  try {
    const { customerId, whatsappNumber, prompt } = req.body;
    if (!customerId || !whatsappNumber || !prompt) return res.status(400).json({ message: "missing fields" });
    const doc = await Prompt.create({ customerId, whatsappNumber, prompt, status: "inactive" });
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ message: "Invalid payload" });
  }
});

// Atualiza prompt (apenas se inativo)
app.patch("/prompts/:id", async (req, res) => {
  try {
    const doc = await Prompt.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    if (doc.status === "active") return res.status(400).json({ message: "Cannot edit active prompt" });
    const { prompt, whatsappNumber } = req.body;
    if (prompt !== undefined) doc.prompt = prompt;
    if (whatsappNumber !== undefined) doc.whatsappNumber = whatsappNumber;
    await doc.save();
    res.json(doc.toObject());
  } catch (err) {
    res.status(400).json({ message: "Invalid payload" });
  }
});

// Copia prompt (sempre nasce inativo)
app.post("/prompts/:id/copy", async (req, res) => {
  const src = await Prompt.findById(req.params.id);
  if (!src) return res.status(404).json({ message: "Not found" });
  const copy = await Prompt.create({
    customerId: src.customerId,
    whatsappNumber: src.whatsappNumber,
    prompt: src.prompt,
    status: "inactive",
    originPromptId: src._id
  });
  res.status(201).json(copy);
});

// Ativa prompt, inativando outros do mesmo número
app.patch("/prompts/:id/activate", async (req, res) => {
  const doc = await Prompt.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: "Not found" });

  await Prompt.updateMany(
    { customerId: doc.customerId, whatsappNumber: doc.whatsappNumber, status: "active", _id: { $ne: doc._id } },
    { status: "inactive" }
  );

  doc.status = "active";
  await doc.save();
  res.json(doc.toObject());
});

// Inativa prompt
app.patch("/prompts/:id/deactivate", async (req, res) => {
  const doc = await Prompt.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: "Not found" });
  doc.status = "inactive";
  await doc.save();
  res.json(doc.toObject());
});

// Remove prompt inativo
app.delete("/prompts/:id", async (req, res) => {
  const doc = await Prompt.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: "Not found" });
  if (doc.status === "active") return res.status(400).json({ message: "Cannot delete active prompt" });
  await Prompt.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

async function start() {
  try {
    await mongoose.connect(mongoUri);
    app.listen(port, () => {
      logger.info({ port }, "prompts service running");
    });
  } catch (err) {
    logger.error({ err }, "failed to start prompts service");
    process.exit(1);
  }
}

start();
