# Contributing to Skimflow

Thanks for taking the time to contribute. This guide covers how to set up the
project, the conventions we follow, and what we look for in a pull request.

## Ground rules

- **Testnet only.** Every contract and address targets Circle's Arc testnet
  (chain id `5042002`). Never point configuration or deploy scripts at mainnet —
  deploy scripts enforce this with an `assertTestnet` guard, and PRs that weaken
  it will not be merged.
- **Never commit secrets.** API keys, entity secrets, and private keys live only
  in the gitignored repo-root `.env`. If a secret is ever exposed, rotate it in
  the Circle console immediately.
- **Don't add dependencies casually.** New runtime dependencies should be called
  out in the PR description with a short justification. Prefer the utilities and
  patterns already in the codebase.
- **Treat the payment path with care.** Changes to the x402 flow, block-unlock
  logic, pay sessions, or wallet integration need extra scrutiny and a clear
  description of what was tested.

## Development setup

Requires Node ≥ 20.6 and (optionally) Docker for the local Postgres.

```bash
git clone <your-fork>
cd skimflow
cp .env.example .env      # fill in only what you need; simulate mode needs nothing
npm install
npm run up                # ensures a DB, migrates, seeds demo content, starts the server
```

The app runs end-to-end in **simulate mode** with no keys or funds, which is the
recommended way to develop and review. See the [README](README.md) for live-mode
configuration.

## Project layout

```
apps/web        Next.js app (App Router) — UI, API routes, DB access
apps/agent      LangChain buyer agent + x402 client
packages/sdk    shared SDK (arc, gateway, guardian, x402, pricing)
contracts       Solidity (Hardhat)
integrations    standalone integrations (e.g. the RSSHub route)
```

## Branching and commits

- Branch from `main`; keep each PR focused on one change.
- Use short, imperative, conventional-style commit subjects:
  `feat: …`, `fix: …`, `docs: …`, `chore: …`, `refactor: …`.
- Reference an issue when one exists.

## Database changes

- Add a new **numbered** migration in `apps/web/db/migrations/` (e.g.
  `0012_*.sql`). Never edit a migration that has already shipped.
- Apply migrations with `npm run migrate`. Keep schema changes backward
  compatible where practical.

## Before you open a pull request

Run, from `apps/web`:

```bash
npx tsc --noEmit         # type check (strict)
npm run build            # full production build
```

Both must pass. If your change touches a feature with a checking script (for
example the RSS feed), run it too:

```bash
npx tsx scripts/validate-feed.ts   # RSS rendering / escaping / no-leak checks
```

In your PR description, note what you changed and how you verified it.

## Code style

- TypeScript throughout, `strict` mode. Match the surrounding code's naming,
  formatting, and comment density rather than introducing a new style.
- Keep comments purposeful — explain the *why*, not the obvious.
- Reuse existing helpers (`lib/`) instead of duplicating logic.

## Security

- Public endpoints must never expose paid block content. Gate access at the
  query layer (the posts API and RSS feed select only free blocks).
- Please report security vulnerabilities privately to the maintainers rather
  than opening a public issue.

## Questions

Open a discussion or issue describing what you're trying to do. For larger
changes, it's worth proposing the approach before investing in the
implementation.
