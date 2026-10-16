# Infrastructure back-compat suite

Executable T5 checks derived from [the compatibility plan](../../back-compat-plan.md),
[API architecture](../../api-architecture.md), [traffic ranking](../../traffic-analysis.md), and
[endpoint inventory](../../endpoint-inventory.md).

## Run

From the repository root, with dependencies installed:

```sh
nvm use
npm run test:back-compat
```

The command builds the shared types, schema inspector and API, including YAML/Liquid assets, and uses Node's test
runner. Use the Node version that matches the installed native dependencies (`isolated-vm`, in particular). The local
validation environment uses Node 22.20.0.

A reachable PostgreSQL 13+ server and a user with `CREATEDB` privileges are required. Defaults match the local
development PostgreSQL server. Override only the connection using:

| Variable                  | Default     |
| ------------------------- | ----------- |
| `BACK_COMPAT_DB_HOST`     | `127.0.0.1` |
| `BACK_COMPAT_DB_PORT`     | `5432`      |
| `BACK_COMPAT_DB_USER`     | `directus`  |
| `BACK_COMPAT_DB_PASSWORD` | `directus`  |

No Docker/Compose test stack or production credentials are required. Every run creates a new database named
`d9_back_compat_<pid>_<random>`, installs its system schema, and seeds controlled fixtures. Database names cannot be
overridden, and an existing database is never reused. The harness does not load `api/.env` or application extensions. It
stops its API processes, drops only the database it created, and removes temporary files after success or assertion
failure. A forcibly terminated runner may leave a database with that generated prefix; inspect it before removing it.

## Contracts and priorities

The same source contracts run with virtual namespaces disabled and with an enabled, unchanged `main` legacy context.
Both modes use real HTTP requests and real PostgreSQL queries. A third API process exercises defaultless identity and
content behavior. The restored Infrastructure development database is not a test target.

| Traffic rank | Priority | Executable coverage                                                                                                                                                                                                |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1            | P0       | `tracking_events`, `tracking_contexts`, `collector_event_validation_config`: names, projections, filtering, relational/deep reads, SEARCH replacement, pagination, meta, row/field ACLs and error envelopes        |
| 2            | P0       | Capital `Features`, `hooks`, configuration JSON, related projections and casing errors                                                                                                                             |
| 3            | P0       | `sponsored_listings`, `native_ad`, `banner_ad`: fields/filter/deep queries, envelopes and ACLs                                                                                                                     |
| 4            | P0       | Static and unscoped JWT credentials, Bearer/query precedence, login/refresh/logout, milliseconds, cookie/JSON modes, session continuity, `/users/me` hydration and configured OAuth2 route contracts               |
| 5            | P1       | `translation_keys`: selections, filters, textual search, envelopes and ACLs                                                                                                                                        |
| 6            | P1       | Collections/fields/relations/permissions/roles/users hydration; Tracking object/array/batch/query writes; forbidden read-back 204 with persistence checks; singleton behavior; preset updates and invalid payloads |
| 7            | P1       | Both GraphQL scopes, GET/POST reads, variables, GET mutation denial, validation errors and partial data with execution errors at HTTP 200                                                                          |
| Unmeasured   | Smoke    | File metadata, asset bytes/Range/HEAD, legacy asset-cookie precedence, shares, flows, webhooks, settings and schema snapshot shapes                                                                                |

The fields and rows in `fixtures.mjs` are synthetic. Traffic evidence establishes endpoint priority and collection
names; it does not establish production request bodies, domain schemas or token ownership. Tests assert exact
deterministic results for these fixtures rather than recording whatever the candidate returns as an expected baseline.

### Namespace acceptance

An isolated synthetic peer contains colliding collection names and item IDs, different values and one different field.
The fixture also provides a collection present only in the legacy context, different local roles for the same user, an
inherited Global Admin, a local admin, a nonmember and a write-only caller.

Active acceptance assertions cover:

- Equivalent legacy static/JWT reads without new selectors.
- Verified namespace claims, matching/conflicting tooling headers, and authorized header fallback.
- Unknown, unready and inaccessible targets, missing defaults and defaultless shared identity/bootstrap.
- Warm response, permission, metadata and GraphQL caches; absence of legacy-table fallback.
- Global Admin inheritance with no child membership or a lower child role, and denied local-admin escalation.
- Local-member visibility, membership revocation without shared-session loss, per-tab refresh and originating-namespace
  writes/audit records.
- Defaultless GraphQL identity operations, named operations/fragments, and mixed-operation rejection before side
  effects.
- Table-level metadata precedence, namespace-correct foreign keys, batch/nested shared-write denial, user aggregates and
  relational visibility, and fresh cached results after membership removal or global-admin demotion.
- Readable partitioned parent tables, inverse user relations/counts, route-casing cache checks, and local permission
  rows that must not target main-owned roles. Fresh enabled bootstrap must assign the first admin role to main without a
  fixture repair.

Agreed policy assertions are acceptance gates: failures identify unfinished behavior in Foundation/API work. They remain
ordinary regression tests rather than skipped cases or assertions widened to match an implementation defect.

## Recorded local result

Validated on 15 October 2026 with Node 22.20.0 and PostgreSQL 16: **143 tests, 143 passed, no failures, skips or
TODOs**. Both complete legacy contract suites and namespace acceptance pass. The original 125 assertions remain in
place; 18 additional regression cases cover alternate transports, nested queries, bootstrap and cache freshness.

The full API unit suite also passes: **744 passed, 2 expected failures and 1 skipped**, across 88 passing files and one
skipped file. Its app tests require the compiled admin bundle (`npm --prefix app run build`) and local socket access.
The API, schema inspector, shared types and admin app builds pass, as do ESLint, Prettier and whitespace checks on the
changed files. API unit output is recorded in `/tmp/d9-api-fixes-unit.log`.

The five previously failing gates are fixed:

| Gate                              | Verified behavior                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Missing default                   | Authenticated content fails closed; shared REST and GraphQL identity operations remain reachable                     |
| Scoped REST field metadata        | Metadata describes the owning table, with unique fields and namespace-correct foreign keys                           |
| GraphQL shared-account escalation | Local admin authority cannot authorize shared account writes, including batch and nested mutations                   |
| Instance cache administration     | REST and GraphQL cache clearing require global authority                                                             |
| Namespace-admin user visibility   | Lists, details, SEARCH, aggregates, nested relations and counts respect membership; warmed caches reflect revocation |

Generic GraphQL mutations retain their existing error-wrapper behavior, including `INTERNAL_SERVER_ERROR` for wrapped
service denials; direct utility resolvers expose `FORBIDDEN`. The denial tests also verify unchanged database rows and
the absence of successful mutation results. Hidden GraphQL user details return `null`; REST details return `403`.

Mutating regressions use synthetic accounts and restore rows in `finally`; the entire test database is then dropped.
Full output from the recorded run was written to `/tmp/d9-back-compat-fixes.log`. These results establish local source
behavior, not deployed production compatibility.

Enabled scoped response caching computes one fresh membership aggregate per cache-eligible request. The fingerprint is
not memoized: membership changes select a new cache key, while unchanged membership retains cache hits. Requests
admitted before a membership change may finish under their original authorization context. No schema migration is
needed.

## Deployment validation still required

These tests establish source contracts and synthetic isolation evidence, not deployed Infrastructure compatibility.
Representative authorized production baselines and account/default ownership mappings remain required by T3/T4.

- OAuth2 tests use a configured synthetic provider's authorization redirect, PKCE state cookie, URL-encoded POST
  callback and invalid-state rejection. They never exchange credentials with an external identity provider. Successful
  configured OpenID/OAuth2/SAML/LDAP round trips, TFA and real deployment redirects remain integration checks.
- The CMS deployment patches cookie paths and callback handling. The suite preserves core cookie/HEAD/GET contracts;
  patched cookie paths, the real `/v9/infrastructure/` gateway and effective deployment overrides need separate
  validation.
- Gateway observations include PATCH `/items/competitor_scraper_technical_config/default`. Core's documented singleton
  contract rejects key PATCH with 404 and accepts collection PATCH. The suite checks that source distinction; the
  observed deployment behavior must be reconciled with its actual schema/image before cutover.
- Scoped asset ownership/credentials, public/share isolation, file uploads/transformations, background exports/retries,
  enabled extensions, flow/webhook dispatch and cross-process invalidation require their D07–D12 policies and fixtures.
  The included smoke checks do not establish those isolation guarantees.
- Settings membership lookup and role deletion have regression coverage for bounded search, local role identity,
  shared-account preservation, foreign-role denial, and last-admin protection. Broader
  membership-management/provisioning/global-directory delivery and other CMS deployments remain outside this suite's
  Infrastructure compatibility scope. The existing token-mint route obtains real scoped credentials.
