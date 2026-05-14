# Shared Library

This directory contains the core business logic, database models, and common utilities shared across both the `client` (Next.js) and `server` (Express) applications.

## Directory Structure

- **`ai/`**: AI signal parsing and analysis schemas.
- **`exchange/`**: Exchange API adapters (Binance, Bybit, OKX, MEXC, MetaTrader, Paper) and the `ExchangeFactory`.
- **`source/`**: External data sources (primarily Discord message fetching).
- **`proxy/`**: Proxy configurations and management.
- **`types/`**: TypeScript type definitions.

## Key Files

- **`database.ts`**: Mongoose models and database connection logic (`ProcessedMessage`, `DraftTrade`, `Position`, etc.).
- **`executor.ts`**: The main execution orchestrator. Handles signal checking, duplicate prevention, and trade execution. *(Note: This file is currently very large and handles many concerns. Read carefully).*
- **`executor-ai.ts`**: Integration with OpenAI for parsing raw messages into structured `TradingSignal`s.
- **`executor-drafts.ts`**: Logic for managing the `DraftTrade` lifecycle (create, accept, reject).
- **`executor-signal-utils.ts`**: Utilities for calculating TP/SL from Risk/Reward, sanitizing leverage, etc.
- **`process-log.ts`**: The logging system that ties related operations together using a `processId`.
- **`risk.ts`**: Position sizing and risk calculation based on user settings.
- **`monitor.ts` & `tp-sl-monitor.ts`**: Logic for tracking active positions and executing Stop Loss / Take Profit conditions.

## Guidelines
- Do not add React components or Next.js specific code here.
- If modifying types, ensure both `client` and `server` build successfully. Use `pnpm build` or `tsc`.
- Keep the `processId` tracing intact when adding new asynchronous workflows.
