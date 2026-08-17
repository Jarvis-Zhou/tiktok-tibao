# Architecture

```text
Selected products / Product IDs
    │
    ▼
product detail → opportunity query/detail → fail-closed filters → score ≥ 75
                                                     │
                                                     ▼
                                              operator confirmation
                                                     │
                                                     ▼
                                               server revalidation
                                                     │
Excel / CSV ───────────────→ normalize → validate → idempotency → SQLite task ledger
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
              A: API runner                 C: Chrome extension
              signed requests               operator login session
              throttled retries             configurable selectors
                       │                             │
                       └──────────────┬──────────────┘
                                      ▼
                              one result ledger
```

## Workspace

- `packages/core`: shared import contract, channel/status types, API payload normalization and matching scorer.
- `packages/tiktok-api`: signing and Product Opportunities HTTP client.
- `apps/server`: Fastify API, SQLite repository, queue runner and local admin page.
- `apps/extension`: Manifest V3 guided browser executor.

## Idempotency and channel safety

The database has a unique constraint on `(shop_id, opportunity_id, product_id)`. A task has exactly one active channel. Switching channels is permitted only from non-running states and resets it to `ready`; no automatic API-to-extension fallback exists.

Matching is read-only until the operator checks concrete product-opportunity pairs. Missing opportunity rules, unknown status/category, detail-fetch failures, price-range conflicts, keyword conflicts, low scores, and prior submissions fail closed. The server revalidates selected pairs before creating a batch. API tasks fetch fresh product and opportunity details again immediately before submission; extension tasks require a verified local snapshot no older than 24 hours.

## Secret boundary

- `app_secret` and the encryption key stay in environment variables.
- Seller Access Tokens are encrypted before SQLite persistence.
- The extension receives only task identifiers and never receives TikTok API credentials.
- The extension endpoint requires a separate shared key.

## Task lifecycle

```text
ready → running → submitted → pending_review → approved/rejected
          │              ▲ │
          ├──────────────┘ └→ failed
          └→ failed

failed/paused → ready (explicit retry)
rejected → re-capture and re-match (no direct retry)
```

Running tasks use a lease. If the process or popup disappears, an expired lease returns the task to `ready` instead of creating a second task.

## ReCut video domain

The AI video workspace is currently a frontend prototype. Its implementable V1 backend design is documented in [video-backend-design.md](video-backend-design.md). The video domain reuses the repository's Fastify and durable-lease patterns while keeping media assets, jobs, tables, provider adapters, and workers separate from TikTok opportunity submission.
