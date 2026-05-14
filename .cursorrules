# Project: CopyTrade
AI-powered Discord signal copier for cryptocurrency trading.

## Quick Reference
- **Monorepo Structure**: `client` (Next.js), `server` (Express), `shared` (common lib).
- **Database**: MongoDB via Mongoose.
- **Exchanges Supported**: Bybit, OKX, Binance, MEXC, MetaTrader, Paper.
- **Core Engine**: `shared/src/lib/executor.ts` (Handles signal check, trade execution).
- **AI Agent Engine**: OpenAI GPT for signal analysis + Agent Loop (`server/src/lib/agent/loop.ts`).

## Key Patterns & Lifecycles
- **Process IDs**: Every significant operation is tagged with a `processId` for end-to-end tracing across services.
- **Draft Lifecycle**: `pending` → `accepted` / `rejected` / `expired`.
- **Trading Pipeline**: Source (Discord) → AI Signal Analysis → Draft Trade → User Approval (Manual mode) / Execution (Auto mode) → Exchange Position.

## AI Assistant Guidelines (Token Optimization)
- **Do not read the entire `page.tsx` or `executor.ts` blindly.** These files are very large (>2000 lines). Focus your reads using line numbers (`view_file` with `StartLine` and `EndLine`) or rely on `grep_search`.
- **Read module `README.md` files first.** Before making changes in a directory, read the `README.md` if it exists (e.g., in `shared/src/lib`, `server/src/lib/agent`, `client/src/app`).
- **Check `executor-types.ts` for shared interfaces** before re-defining any types. Do not duplicate types between client and shared code.
- **Keep new files small.** Adhere to a maximum of ~500 lines per file. Break down large components or logical blocks into smaller, focused files.
- **Maintain imports.** Be careful when moving files; update imports accordingly to prevent breaking changes.

## Testing & Verification
- Always run `pnpm test` in the root or specific workspace before committing changes.
- Do not introduce breaking changes to the database schemas without a corresponding data migration strategy.
