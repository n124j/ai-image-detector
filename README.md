# 🔍 AI Image Authenticator

A full-stack web application that uses Claude's vision AI to detect AI-generated images through forensic analysis. Fully Dockerised, mobile-friendly, and production-ready.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser / App                  │
└──────────────────────┬──────────────────────────┘
                       │ :80
┌──────────────────────▼──────────────────────────┐
│          Frontend  (nginx + React/Vite)          │
│  • Serves static SPA                            │
│  • Proxies  /api/*  →  backend:3001             │
└──────────────────────┬──────────────────────────┘
                       │ internal :3001
┌──────────────────────▼──────────────────────────┐
│         Backend  (Node.js + Express)            │
│  • Holds ANTHROPIC_API_KEY server-side          │
│  • Rate-limiting (20 req/min per IP)            │
│  • Calls Anthropic API                          │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS
                 api.anthropic.com
```

---

## Quick Start

### 1 — Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/install/) ≥ 2.20
- An [Anthropic API key](https://console.anthropic.com)

### 2 — Clone & configure

```bash
git clone <your-repo-url>
cd ai-image-detector

# Copy and fill in your API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

### 3 — Build & run (production)

```bash
docker compose up --build -d
```

App is now live at **<http://localhost:6001>**.

### 4 — Stop

```bash
docker compose down
```

---

## Development Mode (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| Service   | URL                     |
|-----------|-------------------------|
| Frontend  | <http://localhost:6002> |

---

## Configuration

All config lives in `.env` (never commit this file):

| Variable          | Required | Default | Description                          |
|-------------------|----------|---------|--------------------------------------|
| `ANTHROPIC_API_KEY` | ✅ Yes  | —       | Your Anthropic API key               |
| `FRONTEND_PORT`   | No       | `80`    | Host port to expose the app on       |
| `ALLOWED_ORIGIN`  | No       | `*`     | CORS origin restriction in production|
| `NODE_ENV`        | No       | `production` | Node environment               |

---

## Scaling

### Scale backend horizontally (Docker Compose)

```bash
docker compose up --scale backend=3 -d
```

Add a load balancer (e.g. Traefik or HAProxy) in front for production multi-instance deployments.

### Deploy to cloud

#### Cloudflare (Worker + static assets)

This repo also includes a Cloudflare deployment that needs no Docker/nginx: a single Worker
(`worker/src/index.js`, configured by the root `wrangler.toml`) serves the built React app as
static assets and handles `/api/analyse` + `/health` itself, using Cloudflare's native Rate
Limiting binding (20 req/min/IP) instead of `express-rate-limit`. Same origin, so no CORS needed.

```bash
npm install                          # installs wrangler
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy                       # builds frontend/dist, then wrangler deploy
```

Local dev: `npm run dev` (builds once, then runs `wrangler dev` — hit `http://127.0.0.1:8787`).
`backend/` and `frontend/`'s Docker setup are unaffected and still work independently.

#### Fly.io
```bash
fly launch          # detects docker-compose automatically
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

#### Railway
```bash
railway up
railway variables set ANTHROPIC_API_KEY=sk-ant-...
```

#### AWS ECS / Google Cloud Run
Both support `docker-compose` deployments via their respective CLI tools (`ecs-cli`, `gcloud run deploy`). Point them at this repo and set `ANTHROPIC_API_KEY` as a secret.

#### Kubernetes
Use `kompose convert` to generate Kubernetes manifests from `docker-compose.yml`:
```bash
kompose convert -f docker-compose.yml
kubectl apply -f .
```

---

## Project Structure

```
ai-image-detector/
├── docker-compose.yml          # Production orchestration
├── docker-compose.dev.yml      # Dev overrides (hot reload)
├── .env.example                # Environment template
│
├── backend/
│   ├── server.js               # Express API server
│   ├── package.json
│   ├── Dockerfile              # Multi-stage Node.js image
│   └── .dockerignore
│
└── frontend/
    ├── src/
    │   ├── main.jsx            # React entry point
    │   └── App.jsx             # Main application component
    ├── public/
    │   └── favicon.svg
    ├── index.html              # HTML shell with viewport meta
    ├── vite.config.js          # Vite + dev proxy config
    ├── nginx.conf              # nginx SPA + API proxy config
    ├── package.json
    ├── Dockerfile              # Build: Node → Serve: nginx
    └── .dockerignore
```

---

## Security notes

- The `ANTHROPIC_API_KEY` **never leaves the backend container** — the browser only talks to `/api/analyse` on your own server.
- Rate limiting is applied per-IP (20 requests/minute) — adjust in `backend/server.js`.
- Security headers (Helmet.js) are set on all API responses.
- nginx adds `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` headers.
- The backend runs as a **non-root user** inside its container.

---

## Supported image sources

| Source | Method | Notes |
|--------|--------|-------|
| Local file (JPEG, PNG, WebP, GIF…) | Drag & drop / file picker | Converted to base64 |
| Any public URL | Paste URL | Fetched server-side |
| Google User Content (`lh3.googleusercontent.com`) | Paste URL | Server-side fetch, bypasses CORS |
| S3 / CDN URLs | Paste URL | Direct server-side fetch |

---

## License

MIT
