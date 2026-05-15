# Shared Library

This directory contains the core business logic, database models, and common utilities shared across both the `client` (Next.js) and `server` (Express) applications.

## Directory Structure

- **`ai/`**: AI analyzers grouped by provider plus shared AI core helpers.
- **`cron/`**: Cron config and status helpers.
- **`database/`**: Mongoose models and DB connection logic.
- **`enums/`**: Shared enums and normalization helpers.
- **`exchange/`**: Exchange adapters grouped by provider plus shared factory/runtime files.
- **`executor/`**: Signal-check + execution pipeline split by concern.
- **`monitor/`**: Position monitor, TP/SL monitor, and pending-order sync.
- **`process/`**: Process ID and structured process logging helpers.
- **`proxy/`**: Proxy providers plus proxy factory.
- **`risk/`**: Risk config + risk calculation logic.
- **`signal/`**: Signal config storage and retrieval.
- **`source/`**: Source providers grouped by platform.
- **`trade-log/`**: Trade log storage and retrieval.
- **`types/`**: Global TypeScript shims and shared type defs.

## Key Files

- **`database/index.ts`**: Mongoose models and database connection logic (`ProcessedMessage`, `DraftTrade`, `Position`, etc.).
- **`executor/index.ts`**: Main execution orchestrator. Handles signal checking, duplicate prevention, and trade execution.
- **`executor/ai.ts`**: AI parsing pipeline for raw messages → structured `TradingSignal`s.
- **`executor/drafts.ts`**: Draft lifecycle helpers (create, accept, reject, resolve).
- **`executor/utils/signal.ts`**: TP/SL, leverage, and signal sanitation helpers.
- **`process/log.ts`**: Structured logging tied together with `processId`.
- **`risk/index.ts`**: Risk config and position-sizing behavior.
- **`monitor/index.ts`** and **`monitor/tp-sl.ts`**: Position monitor + TP/SL execution logic.

## Guidelines
- Do not add React components or Next.js specific code here.
- If modifying types, ensure both `client` and `server` build successfully. Use `pnpm build` or `tsc`.
- Keep the `processId` tracing intact when adding new asynchronous workflows.
