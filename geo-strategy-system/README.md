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
```

The browser cache is namespaced by user and legacy `geo:clients` data is only imported after the signed-in user confirms ownership.

Every terminal penetration run is stored as an immutable history snapshot. The list API reads summaries only, while full model answers, source URLs, and dashboard aggregates are loaded on demand. To preview and then backfill each client's latest pre-history result:

```bash
npm run penetration-history:backfill
MIGRATION_CONFIRM=PENETRATION_HISTORY_BACKFILL npm run penetration-history:backfill -- --apply
```

Penetration detection uses a user-fair persistent queue. Pending job IDs and job
leases are stored in the configured KV backend, and `src/instrumentation.ts`
recovers unfinished jobs when the Node.js server starts. Provider and judge
concurrency can be tuned with the `PENETRATION_*_CONCURRENCY` variables in
`.env.production.example`; keep one PM2 web process unless all workers share
the same distributed concurrency controls.

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
