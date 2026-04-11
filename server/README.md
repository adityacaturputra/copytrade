# CopyTrade Backend

Express.js backend for the CopyTrade application. Handles long-running cron jobs and trading operations.

## Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp ../.env.example ../.env
# Edit ../.env with your configuration

# Development
npm run dev

# Production build
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Health check endpoint

### Cron Jobs
All cron endpoints require the `Authorization: Bearer YOUR_CRON_SECRET` header if `CRON_SECRET` is set.

- `GET|POST /api/cron/signal-check` - Check Discord for new trading signals
- `GET|POST /api/cron/position-monitor` - Monitor open positions
- `GET|POST /api/cron/tp-sl-monitor` - Place TP/SL orders for filled positions
- `GET /api/cron/status` - Get status of all cron jobs

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment mode | development |
| `MONGODB_URI` | MongoDB connection string | required |
| `CRON_SECRET` | Secret for cron job authentication | optional |
| `FRONTEND_URL` | Frontend URL for CORS | required |
| `AI_PROVIDER` | AI provider (glm/kimi/openai/codex/patungin) | glm |
| `GLM_API_KEY` | GLM API key | required |
| `PATUNGIN_API_KEY` | CodexPatungin API key (or via `~/.codex/config.toml`) | optional |
| `PATUNGIN_BASE_URL` | CodexPatungin base URL | https://ai.patungin.id/v1 |
| `PATUNGIN_MODEL` | CodexPatungin model | gpt-5.3-codex |
| `PATUNGIN_HTTP_REFERER` | Optional `HTTP-Referer` header for Patungin requests | optional |
| `PATUNGIN_X_TITLE` | Optional `X-Title` header for Patungin requests | optional |
| `PATUNGIN_ORIGIN` | Optional `Origin` header for Patungin requests | optional |
| `PATUNGIN_USER_AGENT` | Optional `User-Agent` header for Patungin requests | optional |
| `PATUNGIN_EXTRA_HEADERS` | Optional extra Patungin headers (JSON or `Header: value` lines) | optional |
| `VISION_AI_PROVIDER` | Image pre-layer provider (gemini/codex/patungin) | auto |
| `CRON_JOB_API_KEY` | cron-job.org API key | optional |

## Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for detailed deployment instructions.
