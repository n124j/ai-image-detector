import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import { createServer } from "http";

const app  = express();
const PORT = process.env.PORT || 3001;

// Trust one proxy layer (nginx) so rate-limiting reads X-Forwarded-For correctly
app.set("trust proxy", 1);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/* ── security middleware ───────────────────────────────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
  methods: ["POST", "GET"],
}));
app.use(express.json({ limit: "20mb" }));

/* ── rate limiting ────────────────────────────────────────── */
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 20,               // 20 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment." },
});
app.use("/api/", limiter);

/* ── health check ─────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiConfigured: !!ANTHROPIC_API_KEY,
  });
});

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/* ── analyse endpoint ─────────────────────────────────────── */
app.post("/api/analyse", async (req, res) => {
  const { imageSource, metadata } = req.body;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
  }

  if (!imageSource) {
    return res.status(400).json({ error: "Missing imageSource in request body." });
  }

  if (imageSource.type === "base64") {
    if (!SUPPORTED_MEDIA_TYPES.has(imageSource.media_type)) {
      return res.status(400).json({
        error: `Unsupported image format: "${imageSource.media_type || "(none)"}". Use JPEG, PNG, GIF, or WebP.`,
      });
    }
    const rawBytes = (imageSource.data?.length ?? 0) * 0.75;
    if (rawBytes > 5 * 1024 * 1024) {
      return res.status(400).json({
        error: `Image too large (${(rawBytes / 1024 / 1024).toFixed(1)} MB). Anthropic's limit is 5 MB.`,
      });
    }
  }

  const SYSTEM_PROMPT = `You are an expert forensic analyst specialising in detecting AI-generated images.
Analyse the provided image thoroughly and determine if it is AI-generated or a real photograph.

Examine:
1. VISUAL ARTIFACTS – unnatural blurring, over-smoothed textures, halation around edges, inconsistent lighting
2. ANATOMY & PHYSICS – distorted hands/fingers/teeth, warped backgrounds, physically impossible elements
3. TEXTURE PATTERNS – repetitive or "plastic" textures, lack of genuine imperfections
4. METADATA CONTEXT – file name, type, size, modification date
5. SCENE COHERENCE – background consistency, shadow direction, perspective accuracy
6. FINE DETAILS – text rendering, facial symmetry artefacts
7. COMPRESSION & NOISE – lack of natural camera noise, unusual compression artefacts
8. STYLE MARKERS – known AI aesthetic patterns (Midjourney glow, DALL-E smoothness, SD artefacts)

Respond ONLY in this exact JSON (no markdown, no backticks):
{
  "verdict": "YES" or "NO",
  "confidence": <0-100>,
  "summary": "One clear sentence verdict",
  "reasons": ["reason 1","reason 2","reason 3"],
  "indicators": {
    "visual_artifacts": "brief finding",
    "anatomy_physics": "brief finding",
    "texture_quality": "brief finding",
    "scene_coherence": "brief finding",
    "fine_details": "brief finding"
  }
}`;

  const metaStr = metadata ? `\n\nFile metadata: ${JSON.stringify(metadata)}` : "";

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text",  text: `Analyse this image for AI generation indicators.${metaStr}\nReturn JSON only.` },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      let message = "Anthropic API error.";
      try { message = JSON.parse(errText)?.error?.message || message; } catch {}
      return res.status(anthropicRes.status).json({ error: message });
    }

    const data   = await anthropicRes.json();
    const text   = data.content?.find((b) => b.type === "text")?.text || "";
    const clean  = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.json(parsed);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error.", detail: err.message });
  }
});

/* ── 404 fallback ─────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: "Not found." }));

/* ── start ────────────────────────────────────────────────── */
const server = createServer(app);
server.listen(PORT, () => {
  console.log(`✅  Backend running on port ${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY is not set — requests will fail.");
  }
});
