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

const port = process.env.PORT || 4002;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27018/customers";
const apiKey = process.env.API_KEY || "";

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};
 
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    document: { type: String, required: true, index: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    type: { type: String, enum: ["PF", "PJ"], required: true },
    address: {
      street: String,
      number: String,
      city: String,
      state: String,
      zip: String,
      country: String
    },
    paymentMethodId: { type: String },
    tokensRemaining: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Customer = mongoose.model("Customer", customerSchema);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "customers" });
});

app.use(requireApiKey);

app.get("/customers", async (_req, res) => {
  const customers = await Customer.find().lean();
  res.json(customers);
});

app.get("/customers/:id", async (req, res) => {
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) return res.status(404).json({ message: "Not found" });
  res.json(customer);
});

app.post("/customers", async (req, res) => {
  try {
    const doc = await Customer.create(req.body);
    res.status(201).json(doc);
  } catch (err) {
    logger.error({ err }, "create customer failed");
    res.status(400).json({ message: "Invalid payload" });
  }
});

app.put("/customers/:id", async (req, res) => {
  try {
    const updated = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "update customer failed");
    res.status(400).json({ message: "Invalid payload" });
  }
});

app.delete("/customers/:id", async (req, res) => {
  const deleted = await Customer.findByIdAndDelete(req.params.id).lean();
  if (!deleted) return res.status(404).json({ message: "Not found" });
  res.status(204).send();
});

async function start() {
  try {
    await mongoose.connect(mongoUri);
    app.listen(port, () => {
      logger.info({ port }, "customers service running");
    });
  } catch (err) {
    logger.error({ err }, "failed to start customers service");
    process.exit(1);
  }
}

start();
