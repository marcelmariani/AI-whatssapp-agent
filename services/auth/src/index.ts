import dotenvFlow from "dotenv-flow";
import express from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { z } from "zod";

dotenvFlow.config();

const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp());

const port = process.env.PORT || 4001;
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/auth";
const jwtSecret = process.env.JWT_SECRET || "replace-me";
const apiKey = process.env.API_KEY || "";

// User schema: email, password (hash), role (admin|customer), customerId (ref opcional)
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // em produção: bcrypt
  role: { type: String, enum: ["admin", "customer"], required: true },
  customerId: { type: String } // para role=customer
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!apiKey) return res.status(500).json({ message: "API key not configured" });
  if (req.headers["x-api-key"] !== apiKey) return res.status(401).json({ message: "unauthorized" });
  next();
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "customer"]),
  customerId: z.string().optional()
});

const changePasswordSchema = z.object({
  userId: z.string(),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6)
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth" });
});

app.use(requireApiKey);

// Register (criar usuário)
app.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "validation error", issues: parsed.error.issues });
  const { email, password, role, customerId } = parsed.data;
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ message: "user already exists" });
  const user = await User.create({ email, password, role, customerId });
  res.status(201).json({ userId: user._id, email: user.email, role: user.role });
});

// Login (retorna JWT)
app.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "validation error", issues: parsed.error.issues });
  const { email, password } = parsed.data;
  const user = await User.findOne({ email });
  if (!user || user.password !== password) return res.status(401).json({ message: "invalid credentials" });
  const token = jwt.sign(
    { userId: user._id.toString(), email: user.email, role: user.role, customerId: user.customerId },
    jwtSecret,
    { expiresIn: "7d" }
  );
  res.json({ token, role: user.role, customerId: user.customerId });
});

// Change password (requires API key, validated upstream for user identity)
app.patch("/password", async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "validation error", issues: parsed.error.issues });
  const { userId, currentPassword, newPassword } = parsed.data;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "user not found" });
  if (user.password !== currentPassword) return res.status(401).json({ message: "current password invalid" });
  user.password = newPassword;
  await user.save();
  res.json({ message: "password updated" });
});

async function start() {
  try {
    await mongoose.connect(mongoUri);
    app.listen(port, () => {
      logger.info({ port }, "auth service running");
    });
  } catch (err) {
    logger.error({ err }, "failed to start auth service");
    process.exit(1);
  }
}

start();
