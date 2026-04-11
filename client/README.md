# 📈 CopyTrade — AI-Powered Discord Signal Copier

Automated trading system that fetches signals from Discord channels, parses them with AI, and executes trades on MEXC exchange.

## Features

- **Discord Integration**: Fetches trading signals from Discord server channels
- **AI Signal Parsing**: Uses OpenAI / GLM / Kimi to parse messages into structured trading signals
- **Auto & Manual Trading Modes**: Toggle between automatic execution and manual draft review
- **MEXC Exchange**: Places orders via MEXC Futures API with leverage support
- **Position Monitoring**: AI-powered position monitor checks TP/SL/close decisions every 30 minutes
- **Dashboard**: Real-time web dashboard to monitor positions, signals, drafts, and logs
- **Draft Review System**: In manual mode, signals become drafts you can accept or reject

## Architecture

```
Discord Server → Cron (5 min) → AI Parser → JSON Signal → MEXC API → Dashboard
                                    ↓
                              Auto Mode → Execute Trade
                              Manual Mode → Draft (Accept/Reject)

Open Positions → Cron (30 min) → AI Analysis → TP/SL/Close Decision → MEXC API
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy root `.env.example` to root `.env` and fill in your credentials:

```bash
cp ../.env.example ../.env
```

**Required Environment Variables:**

| Variable              | Description                                   |
| --------------------- | --------------------------------------------- |
| `DISCORD_TOKEN`       | Discord Bot Token                             |
| `DISCORD_GUILD_ID`    | Discord Server ID                             |
| `DISCORD_CHANNEL_IDS` | Comma-separated channel IDs to monitor        |
| `MEXC_API_KEY`        | MEXC API Key                                  |
| `MEXC_SECRET_KEY`     | MEXC API Secret                               |
| `OPENAI_API_KEY`      | OpenAI API Key (required for OpenAI analyzer) |
| `CRON_SECRET`         | Secret token to secure cron endpoints         |
| `DATABASE_URL`        | MongoDB connection string                     |

**Optional Environment Variables:**

| Variable                | Default  | Description                              |
| ----------------------- | -------- | ---------------------------------------- |
| `AI_PROVIDER`           | `openai` | AI provider: `openai`, `glm`, `kimi`, `codex`, `patungin` |
| `GLM_API_KEY`           | -        | Required if AI_PROVIDER=glm              |
| `KIMI_API_KEY`          | -        | Required if AI_PROVIDER=kimi             |
| `PATUNGIN_API_KEY`      | -        | Required if AI_PROVIDER=codex/patungin (or via `~/.codex/config.toml`) |
| `PATUNGIN_BASE_URL`     | `https://ai.patungin.id/v1` | CodexPatungin API base URL |
| `PATUNGIN_MODEL`        | `gpt-5.3-codex` | CodexPatungin model |
| `PATUNGIN_HTTP_REFERER` | - | Optional `HTTP-Referer` header for Patungin requests |
| `PATUNGIN_X_TITLE`      | - | Optional `X-Title` header for Patungin requests |
| `PATUNGIN_ORIGIN`       | - | Optional `Origin` header for Patungin requests |
| `PATUNGIN_USER_AGENT`   | - | Optional `User-Agent` header for Patungin requests |
| `PATUNGIN_EXTRA_HEADERS`| - | Optional extra Patungin headers (JSON or `Header: value` lines) |
| `VISION_AI_PROVIDER`    | auto     | Image pre-layer provider: `gemini`, `codex`, `patungin` |
| `DEFAULT_LEVERAGE`      | `10`     | Default leverage for trades              |
| `DEFAULT_POSITION_SIZE` | `50`     | Default position size (USDT)             |
| `TRADING_MODE`          | `manual` | Initial trading mode: `auto` or `manual` |
| `PORT`                  | `3000`   | Server port                              |

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

## Cron Jobs

### Signal Check (Every 5 Minutes)

Fetches recent Discord messages, parses them with AI, and executes or drafts trades.

**Endpoint:** `POST /api/cron/signal-check`
**Header:** `Authorization: Bearer <CRON_SECRET>`

### Position Monitor (Every 30 Minutes)

Checks all open positions against current market conditions and AI analysis for TP/SL/close decisions.

**Endpoint:** `POST /api/cron/position-monitor`
**Header:** `Authorization: Bearer <CRON_SECRET>`

### Setting Up Cron (Vercel)

The `vercel.json` is pre-configured. Just deploy and add your environment variables.

### Setting Up Cron (Local/Server)

Use a cron scheduler like `crontab`:

```bash
# Every 5 minutes - signal check
*/5 * * * * curl -X POST -H "Authorization: Bearer YOUR_SECRET" http://localhost:3000/api/cron/signal-check

# Every 30 minutes - position monitor
*/30 * * * * curl -X POST -H "Authorization: Bearer YOUR_SECRET" http://localhost:3000/api/cron/position-monitor
```

## API Endpoints

| Endpoint                     | Method   | Description                |
| ---------------------------- | -------- | -------------------------- |
| `/api/dashboard`             | GET      | Full dashboard data        |
| `/api/settings`              | GET/POST | Get/set trading mode       |
| `/api/drafts`                | GET      | List all drafts            |
| `/api/drafts/[id]/accept`    | POST     | Accept and execute a draft |
| `/api/drafts/[id]/reject`    | POST     | Reject a draft             |
| `/api/cron/signal-check`     | POST     | Run signal check           |
| `/api/cron/position-monitor` | POST     | Run position monitor       |

## AI Signal Parsing

The AI parses Discord messages and returns structured JSON:

```json
{
  "action": "BUY",
  "symbol": "BTC_USDT",
  "entryPrice": 65000,
  "takeProfitTargets": [66000, 67000],
  "stopLoss": 64000,
  "leverage": 20,
  "orderType": "market",
  "confidence": 85,
  "reasoning": "Strong bullish momentum with support at 64500"
}
```

**Supported Actions:**

- `BUY` / `SELL` — Open a position
- `CLOSE` — Close an existing position
- `UPDATE_TP` / `UPDATE_SL` — Update take profit or stop loss
- `HOLD` — No action (signal ignored)

## Trading Modes

### 🤖 Auto Mode

Signals are automatically parsed and executed on MEXC. Positions are monitored by AI every 30 minutes.

### 👆 Manual Mode

Signals are parsed and saved as drafts. You review and accept/reject each trade from the dashboard. This gives you full control over which signals to execute.

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Enable **Message Content Intent** in Bot settings
4. Invite the bot to your server with these permissions:
   - Read Messages
   - Read Message History
5. Copy the bot token to `DISCORD_TOKEN`
6. Right-click your server name → Copy Server ID → `DISCORD_GUILD_ID`
7. Right-click each channel → Copy Channel ID → `DISCORD_CHANNEL_IDS`

## MEXC API Setup

1. Log in to [MEXC](https://www.mexc.com)
2. Go to API Management
3. Create a new API key with **Futures Trading** permissions
4. Copy the API Key and Secret to your `.env`

## Tech Stack

- **Framework**: Next.js 16 (App Router + Turbopack)
- **Database**: MongoDB (Mongoose)
- **AI**: OpenAI / GLM / Kimi
- **Exchange**: MEXC Futures API
- **Styling**: Tailwind CSS
- **Deployment**: Vercel (with cron jobs)

## License

MIT
# copytrade
