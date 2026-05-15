# CopyTrade Architecture

CopyTrade is a monorepo application that acts as an AI-powered signal copier from Discord to various cryptocurrency exchanges.

## Monorepo Structure

- **`/client`**: Next.js frontend dashboard. Handles user configuration, log viewing, and manual draft approval.
- **`/server`**: Express.js backend. Serves API endpoints, runs background cron jobs, and hosts the AI Agent system.
- **`/shared`**: Common libraries, database models (Mongoose), type definitions, and core business logic (execution engine).

## Core Data Flow

1. **Source Collection**: The system connects to Discord (via `shared/src/lib/source`) to fetch new messages from configured channels.
2. **AI Analysis**: Messages are parsed using OpenAI GPT (`shared/src/lib/executor-ai.ts`) to detect trading signals (LONG/SHORT, TP targets, SL, leverage).
3. **Draft Creation**: Parsed signals are stored as a `DraftTrade`.
4. **Execution Decision**: 
   - *Manual Mode*: Draft stays `pending` until user approves via dashboard.
   - *Auto Mode*: System automatically executes the draft.
5. **Exchange Execution**: Trade is placed via Exchange adapters (`shared/src/lib/exchange/*`). Supported exchanges: OKX, Bybit, Binance, MEXC, MT4, Paper.
6. **Position Monitoring**: The system tracks open positions, managing Take Profits and Stop Losses based on real-time market data.

## Key Subsystems

- **Process Tracker**: `shared/src/lib/process-log.ts` tags all related operations with a unique `processId` to allow tracing an action from Discord message all the way to exchange execution.
- **AI Agent**: `server/src/lib/agent/loop.ts` allows conversational interaction to manage trades, check logs, and monitor positions.
- **Exchange Factory**: `shared/src/lib/exchange/ExchangeFactory.ts` provides a unified interface to interact with multiple exchange APIs.
- **Cron Jobs**: Configured to run periodically for signal checking, orphan cleanup, and position monitoring.

## Database Schema Highlights

- `ProcessedMessage`: Tracks Discord messages so they aren't processed twice.
- `DraftTrade`: A signal that is ready for execution or user review.
- `Position`: An active trade on an exchange.
- `Account`: Exchange API credentials and configuration.

## Design Principles
- Separation of Concerns: The `shared` library contains all core logic so it can be used by both the dashboard API and the backend cron jobs.
- Idempotency: Duplicate checks (`executor.ts`) prevent the same signal from opening multiple identical positions.
