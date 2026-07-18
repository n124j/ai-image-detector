const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });

async function handleHealth(env) {
  return json({
    status: "ok",
    timestamp: new Date().toISOString(),
    apiConfigured: !!env.ANTHROPIC_API_KEY,
  });
}

async function handleAnalyse(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY is not configured on the server." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { imageSource, metadata } = body || {};

  if (!imageSource) {
    return json({ error: "Missing imageSource in request body." }, 400);
  }

  if (imageSource.type === "base64") {
    if (!SUPPORTED_MEDIA_TYPES.has(imageSource.media_type)) {
      return json({
        error: `Unsupported image format: "${imageSource.media_type || "(none)"}". Use JPEG, PNG, GIF, or WebP.`,
      }, 400);
    }
    const rawBytes = (imageSource.data?.length ?? 0) * 0.75;
    if (rawBytes > 5 * 1024 * 1024) {
      return json({
        error: `Image too large (${(rawBytes / 1024 / 1024).toFixed(1)} MB). Anthropic's limit is 5 MB.`,
      }, 400);
    }
  }

  const metaStr = metadata ? `\n\nFile metadata: ${JSON.stringify(metadata)}` : "";

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: imageSource },
            { type: "text", text: `Analyse this image for AI generation indicators.${metaStr}\nReturn JSON only.` },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      let message = "Anthropic API error.";
      try { message = JSON.parse(errText)?.error?.message || message; } catch {}
      return json({ error: message }, anthropicRes.status);
    }

    const data = await anthropicRes.json();
    const text = data.content?.find((b) => b.type === "text")?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return json(parsed);
  } catch (err) {
    console.error("Worker error:", err);
    return json({ error: "Internal server error.", detail: err.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return handleHealth(env);
    }

    if (url.pathname === "/api/analyse") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      // 20 requests/minute per IP, mirroring the original express-rate-limit config
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: "Too many requests. Please wait a moment." }, 429);
      }

      return handleAnalyse(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
