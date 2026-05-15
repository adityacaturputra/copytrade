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

## Structure Rules
- Folder-first organization. Group related files into domain folders.
- Every source/test file must be `<= 300` lines.
- Avoid flat `foo-bar-baz.ts` sprawl when a domain folder is more appropriate.
- Prefer thin `index.ts` entrypoints and focused child modules.
- Co-locate tests with their domain folders.
- Remove temp/scratch/generated source artifacts from `src/` unless intentionally required.
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

## Verification Rules
- After changes, run relevant builds/typechecks/tests.
- Start `client` and `server` locally.
- Open the website and verify no visible/runtime error.
- If an error appears, fix it, rerun validation, reopen the site.
- Do not stop at “build passed” if the runtime page is broken.

## Task Notes
- Active notes live in `.ai/tasks/open/`.
- Finished notes move to `.ai/tasks/closed/`.
- Image context lives in `.ai/tasks/images/`.

## References
- Architecture doc: `.ai/docs/architecture.md`
- Deployment doc: `.ai/docs/deployment.md`
