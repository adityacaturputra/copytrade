# CopyTrade AI Rules

## Project
- Monorepo: `client` (Next.js), `server` (Express), `shared` (common lib).
- Database: MongoDB via Mongoose.
- Exchanges: Bybit, OKX, Binance, MEXC, MetaTrader, Paper.
- Core engine: `shared/src/lib/executor/index.ts`.
- AI agent loop: `server/src/lib/agent/loop/index.ts`.

## Architecture
- Process lifecycle uses `processId` end-to-end for tracing.
- Draft lifecycle: `pending` → `accepted` / `rejected` / `expired`.
- Trading flow: source → AI analysis → draft/execute → exchange position.
- Trade logging is a first-class subsystem under `shared/src/lib/trade-log/`.
- Trade/process logs must preserve `processId` tracing so draft, executor, monitor, and agent flows can be correlated in UI and debugging.
- Logging/storage refactors are sensitive because they affect dashboard logs, per-process logs, cleanup APIs, Mongo legacy reads, and optional remote backend proxy mode.
- Exchange/proxy error logs should preserve actionable HTTP context whenever possible: status, parsed response body, and selected proxy metadata (provider/IP/country/city) so proxy-rotation and exchange failures can be debugged without reproducing blindly.

## Structure Rules
- Folder-first organization. Group related files into domain folders.
- Every source/test file must be `<= 300` lines.
- Avoid flat `foo-bar-baz.ts` sprawl when a domain folder is more appropriate.
- Prefer thin `index.ts` entrypoints and focused child modules.
- Co-locate tests with their domain folders.
- Remove temp/scratch/generated source artifacts from `src/` unless intentionally required.
- Put ad-hoc debug, scratch, and one-off local test files in `.temp/`, not in the repo root.
- Do not scatter provider identity/config strings across multiple files when a domain has pluggable providers.
- For AI providers, keep provider metadata owned by the analyzer class or a single analyzer registry, then make factories/resolvers consume that one source of truth.
- Avoid repeated provider-specific `if/else` chains for base URLs, env keys, models, or aliases in multiple layers.

## Shared Library Layout Target
- Use domain folders in `shared/src/lib` such as `cron/`, `database/`, `enums/`, `executor/`, `exchange/`, `proxy/`, `source/`, `risk/`, `process/`, `signal/`, `monitor/`, `trade-log/`, `ai/`.
- Under provider-heavy domains, create provider folders, e.g. `exchange/okx/`, `ai/openai/`.

## Working Rules
- Do not read giant files blindly; inspect targeted slices.
- Reuse shared types before creating new ones.
- Update imports immediately when moving files.
- Keep compatibility wrappers only if truly necessary and temporary.
- Refactors must be behavior-preserving by default; do not mix file-splitting work with logic changes unless a fix is explicitly required.
- When splitting large files, prefer small surgical extracts by domain responsibility, then verify after each step before continuing.
- Avoid broad move-only refactors that change many paths at once without immediate validation.
- If a file is above the limit, split it into real focused modules until each source/test file is `<= 300` lines.
- Do not introduce fake wrapper files just to satisfy the line limit.
- For mixed-runtime shared modules used by both `shared` build and Next.js app routes, avoid import patterns that only satisfy one resolver. Prefer patterns compatible with both `Node16` build output and Next bundler resolution.
- If a helper is referenced by tests/mocks, preserve that seam unless the tests are updated in the same change.

## Trade Log Notes
- `shared/src/lib/trade-log/store.ts` is the orchestration layer; keep child modules focused on file storage, Mongo access, filtering, normalization, config, or summaries.
- Supported log storage modes include file, mongo, dual, and remote-backend proxy behavior.
- `processId` must remain available across create/list/process-log retrieval flows.
- Cleanup behavior must preserve both file and Mongo deletion semantics and support retention/noisy-json modes.
- Legacy Mongo reads are still important for compatibility; do not remove them accidentally during refactors.
- Any trade-log refactor should be verified with:
  - `pnpm --filter @copytrade/shared build`
  - `pnpm --filter @copytrade/shared exec vitest run src/lib/trade-log/store.test.ts src/lib/process/log.test.ts`

## Verification Rules
- After changes, run relevant builds/typechecks/tests.
- Start `client` and `server` locally.
- Open the website and verify no visible/runtime error.
- If an error appears, fix it, rerun validation, reopen the site.
- Do not stop at “build passed” if the runtime page is broken.
- Before declaring a task done, always perform the most relevant final verification for the touched area and record any remaining unrelated blockers explicitly instead of silently stopping early.

## Task Notes
- Active notes live in `.ai/tasks/open/`.
- Finished notes move to `.ai/tasks/closed/`.
- Image context lives in `.ai/tasks/images/`.

## References
- Architecture doc: `.ai/docs/architecture.md`
- Deployment doc: `.ai/docs/deployment.md`
