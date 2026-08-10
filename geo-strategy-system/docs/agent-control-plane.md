# Shitu GEO Agent Control Plane

## Goal

Expose the existing GEO workspace to authorized agents without creating a
second execution path. Browser UI, Agent REST, CLI, and MCP must share the same
permission checks, credit ledger, queues, model readiness gates, quality gates,
and immutable cloud outputs.

## Existing foundations

- PostgreSQL-backed customer workspaces and immutable output snapshots.
- BullMQ lanes for penetration, content generation, and report export.
- Task-center status, cancellation, restoration, and completion notifications.
- Idempotent request identifiers for long-running jobs.
- Per-client and per-team module permissions.
- Credit reservation, settlement, and refund handling.

## Public machine surface

The versioned machine API lives under `/api/agent/v1`. It accepts only Bearer
tokens created from the signed-in account center. It never accepts browser
session cookies as Agent credentials and never exposes provider API keys.

Initial read operations:

- capabilities
- clients and selected client sections
- task list and task detail
- system output list and detail

Current typed execution operations:

- Analysis: `penetration.run`, `research.run`, `research.compare`,
  `diagnosis.run`, and `difficulty.run`.
- Keyword strategy: `keyword.extract`, `keyword.advantages`,
  `keyword.strategy.run`, `keyword.website-prompt.run`, and
  `keyword.questions.run`.
- Content: `article.generate`, `article.rewrite`, and
  `article.batch.run`.
- Delivery: `feedback.action.create`, `feedback.actions.import`,
  `feedback.report.create`, and `report.create`.
- Knowledge: `knowledge.import` followed by human-reviewed
  `knowledge.commit`.

`background.run` remains available only for compatibility. New clients use the
typed operation matching the actual business module.

Every execution supports a caller-generated request id and a dry-run preflight.
Successful asynchronous submissions return canonical `taskId`, `sourceJobId`,
`statusUrl`, and `resultUrl` values immediately; agents use task APIs instead
of holding a gateway request open. Synchronous feedback and knowledge-commit
operations return their result directly.

## Implemented clients

- `cli/shitu-geo.mjs` is a dependency-light Node.js CLI for macOS, Linux, and
  Windows. It supports typed action aliases, cursor pagination, task result
  restoration, background watching, cancellation, protected report downloads,
  article batch ZIP downloads, feedback reads, and knowledge review.
- `src/agent/mcp-stdio.ts` exposes the same contract to local MCP clients.
- `/api/agent/mcp` is a stateless Streamable HTTP MCP endpoint. Each request is
  authenticated with the same Agent Bearer Token and each tool delegates to the
  versioned REST API.

MCP and CLI never call provider model APIs directly. This guarantees that API
credential pools, strict web-search requirements, credit settlement, output
persistence, and concurrency controls remain centralized in the application.

## Approval and workflow convention

Machine workflows are intentionally client-orchestrated instead of stored as a
second server-side workflow engine:

1. call an action with `dryRun: true`;
2. present the returned scope, unit count, and estimated credits to the user;
3. reuse the same stable `requestId` for the approved execution;
4. poll the returned task through the task API;
5. read immutable outputs or download the completed report.

The same flow applies to PDF and article ZIP resources. MCP exposes protected
resource templates, while REST and CLI stream the binary response only when it
is explicitly requested.

MCP marks cancellation as destructive and execution tools as non-read-only, so
compatible Agent hosts can show their native confirmation UI. Replaying an
approved `requestId` is idempotent and does not create a second business task.

## Authorization model

Effective access is the intersection of:

1. current account status and membership entitlement;
2. current personal, client-account, or team permission;
3. token scope;
4. token client grant;
5. per-task and daily credit budget;
6. runtime rate and concurrency limits.

Removing a team share or disabling an account invalidates access even when a
previously issued token is still cryptographically valid.

## Compatibility policy

- `/api/agent/v1` is additive and versioned.
- Action definitions, OpenAPI request schemas, MCP tools, and server-side
  dispatch all derive from the same action registry.
- Machine errors include stable codes and retryability.
- Large results are returned as protected resource links, not embedded blobs.
- CLI and MCP are thin clients over the Agent REST contract.
- New MCP deployments use stateless Streamable HTTP; local integrations use
  stdio.

## Rollout

1. Administrator read-only tokens.
2. Administrator execution tokens with small budgets.
3. Internal team tokens.
4. Selected customer and service-account tokens.
5. Commercial VIP or enterprise access after load qualification.

The entire surface is guarded by `AGENT_API_ENABLED`; token creation is guarded
independently by `AGENT_TOKEN_MANAGEMENT_ENABLED`.
