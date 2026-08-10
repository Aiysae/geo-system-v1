This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Workspace persistence

Customer workspaces use the server as the source of truth so the same account can continue on another device. Local development falls back to `.data/workspaces.json`; production should set `WORKSPACE_STORE=postgres` and `DATABASE_URL` as shown in `.env.production.example`.

Initialize or update the PostgreSQL tables before starting a production release:

```bash
npm run db:migrate:workspace
npm run db:migrate:penetration-history
npm run db:migrate:system-outputs
```

The browser cache is namespaced by user and legacy `geo:clients` data is only imported after the signed-in user confirms ownership.

Every terminal penetration run is stored as an immutable history snapshot. The list API reads summaries only, while full model answers, source URLs, and dashboard aggregates are loaded on demand. To preview and then backfill each client's latest pre-history result:

```bash
npm run penetration-history:backfill
MIGRATION_CONFIRM=PENETRATION_HISTORY_BACKFILL npm run penetration-history:backfill -- --apply
```

Submitted system outputs are append-only cloud records. Penetration records
reference the existing full history snapshot, while research, diagnosis, and
difficulty jobs retain their frozen request and result snapshots. Repeated
worker callbacks use the task id as an idempotency key and cannot overwrite an
earlier output. List APIs return metadata only; full payloads are loaded on
demand after module permission checks.

Preview and then register existing workspace results in the unified cloud
history without changing the original records:

```bash
npm run system-outputs:backfill
MIGRATION_CONFIRM=SYSTEM_OUTPUT_BACKFILL npm run system-outputs:backfill -- --apply
```

Long-running operations use isolated BullMQ lanes in production: penetration,
content generation, and report export no longer block one another. The Next.js
web process creates jobs and serves status APIs; the independent `geo-worker`
PM2 process consumes every lane and also retains the legacy queue until old jobs
have drained. Pending indexes and dispatch claims are stored in Redis so
switching pages or accounts does not cancel a job, and both processes recover
unfinished work after restart. Per-lane concurrency can be tuned with
`TASK_WORKER_PENETRATION_CONCURRENCY`,
`TASK_WORKER_GENERATION_CONCURRENCY`, and
`TASK_WORKER_UTILITY_CONCURRENCY`. Use
`pm2 startOrReload ecosystem.config.cjs --update-env` to run both services.
Local development defaults to the in-process fallback.

Penetration scheduler V3 routes strict web sampling only to an account whose
exact model has passed auditable web verification. It reserves independent API
account lanes globally, starts each job with a fair six-lane share, and can use
idle capacity up to the configured elastic limit. Settled sampling batches are
persisted and immediately refilled; the non-web judge runs in a separate narrow
pipeline so it cannot hold a web-search account lease. Capacity waits do not
consume retry attempts, and the task UI reports retries only after a real
provider attempt failed. Set `PENETRATION_SCHEDULER_V3=false` to fall back to V2.

Verify one exact account/model without touching other keys:

```bash
npm run ai-credentials:verify -- --all --strict-web --strict-only \
  --vendor doubao --account "2号账号" --model "your-endpoint-model-id"
```

Qualify production concurrency in stages. Every request must keep the original
answer, a provider request id, confirmed web execution, and at least one
readable source URL; the command fails when the success-rate or p95 threshold is
missed:

```bash
PENETRATION_STRESS_MODELS=doubao PENETRATION_STRESS_CONCURRENCY=9 \
PENETRATION_STRESS_REQUESTS=36 npm run stress:penetration-live
```

Use 1, 3, 6, and 9 lanes in order. Enable 12 only after the 9-lane run passes
and each independent provider account has also passed its own staged pressure
test. Credential leases and the global provider semaphore remain the final
limits even when the elastic job ceiling is higher.

## GEO content methodology

Long-form article generation uses a versioned Shitu GEO content compiler. Ten
user-facing creation types now resolve into one of seven authoritative content
recipes. A recipe owns the compatible article formats, evidence requirements,
brand layout, title direction, platform adapter, preflight checks, and quality
gates, so independently saved controls cannot produce contradictory structures.
Single and batch jobs use the same compiler and preserve the resolved recipe in
their lineage. Completed articles remain available to weekly and monthly
execution feedback as attributable content actions.

The customer knowledge base uses schema v2 with a revision, entities, claims,
sources, review states, and the compatible legacy asset list. Schema v1 data is
migrated in memory whenever a workspace is read and written back on the next
normal save; no destructive database migration is required. Retrieval combines
question overlap, subject aliases, evidence level, review state, source links,
freshness, requested asset ids, and evidence-type diversity. Conflicted,
expired, pending-review, and archived assets are excluded from generation.
Every generated article records the exact knowledge-base revision plus asset,
claim, and source ids used.

Users can manage the structured knowledge base from **My Account > My Clients**.
Team-shared records use the existing module permissions and optimistic workspace
versions, preventing a stale device from silently overwriting a newer edit.

The batch importer accepts Word, Excel, CSV, PDF, text, Markdown, and image
files. Originals are kept in private server storage; extraction produces review
candidates and never writes directly into generation data. Exact duplicates,
same-topic conflicts, subject mismatches, and instruction-like text are marked
before approval. Approved candidates are versioned with their source file and
locator. Article compilation then selects only related, reviewed facts under a
format-specific item and character budget; comparison data stays excluded unless
the chosen article format explicitly supports comparisons.

Production should set `KNOWLEDGE_IMPORT_STORE=postgres` and place
`KNOWLEDGE_IMPORT_FILES_DIR` on a private, backed-up directory writable only by
the application user. Set `GEO_KNOWLEDGE_RETRIEVAL_VERSION=legacy` only as a
temporary rollback for the previous broad retrieval behavior.

Set `GEO_METHODOLOGY_VERSION=legacy` and restart the web and worker processes to
restore the previous long-form prompts during an emergency rollback. The
short-video script template and article rewrite flow remain outside this
compiler and are unchanged.


Production PostgreSQL backups are defined in `deploy/postgres/` and retain 14 days of compressed custom-format dumps.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
