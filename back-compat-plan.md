# T3 — Infrastructure backward compatibility plan

Scope reviewed 2026-10-14. Status: **Infrastructure compatibility policy and validation plan documented; implementation and runtime verification pending**.

## 1. Scope and evidence

This plan covers the existing **Infrastructure CMS instance**, including its Tracking, Features/hooks, advertising, translations and editor traffic. Infrastructure identifies the existing deployment; the future virtual namespaces are workspaces inside it. Coverage, B2B and BI deployments are outside this T3 scope.

T3 defines preservation requirements and T5 checks for Infrastructure callers. Shared authentication, authorization, caching and frontend contracts are relevant where they affect those callers. Global directory/onboarding features, namespace provisioning, other CMS deployments and production collection migration remain separate work. Their full delivery is not a condition for completing Infrastructure T3.

Isolation checks use a synthetic second namespace in a controlled Infrastructure test environment. They do not expand the production compatibility baseline to another CMS deployment.

References:

- [Task breakdown](tasks.md): T3 owns compatibility policy; T4 owns API architecture notes; T5 implements the compatibility tests; T6 supports default-namespace and header resolution.
- [Endpoint inventory](endpoint-inventory.md): native source contracts, specialized response behavior and deployment-source notes.
- [Traffic analysis](traffic-analysis.md): sanitized Infrastructure-only ranking for the 30 September–14 October 2026 gateway sample.
- [Architecture](architecture.md): control plane, namespace planes and prototype boundaries.
- [Frontend implementation plan](RFD/frontend/frontend-implementation-plan.md), [API handoff](RFD/frontend/frontend-api-handoff.md) and [capability coverage](RFD/frontend/frontend-capability-coverage.md): switch behavior, required functionality and shared contract gates.

Traffic establishes test priority, not exact request/response contracts. Caller A–D are anonymous signature cohorts, not verified accounts or token identities. Token owners and static-token/JWT classification remain unresolved. No URL-token observations were found for Infrastructure; query-token support remains part of the source baseline. Unranked routes are unmeasured, not proven unused.

## 2. What must remain compatible

| Surface | Required guarantee |
| --- | --- |
| Paths | Preserve `/items/<collection>`, collection-name casing, keys and methods. Preserve the configured Infrastructure API base URL and `/v9/infrastructure/` deployment prefix. Existing callers require no new namespace path, header, query parameter or payload field. |
| Queries and data | Preserve field/relation projections, filters, deep selections, search, sorting, pagination, metadata, aggregates, singleton behavior, batch payloads and SEARCH semantics. Equivalent legacy data and permissions produce equivalent authorized results. |
| Responses and errors | Preserve envelopes, object/array cardinality, status/error-code behavior and empty bodies. Successful writes can return 204 when read-back is forbidden; this must not trigger a duplicate write. Imports, manual sort, schema operations, flows and other specialized endpoints retain their inventory contracts. Preserve existing inaccessible/missing-resource behavior rather than normalizing it to 404. |
| Authentication | Preserve static tokens, valid unscoped JWTs, sessions, login/refresh/logout, cookie/JSON modes, configured providers, SSO/TFA and redirects. `expires` remains a duration in milliseconds. Introducing namespaces requires no forced token rotation or logout. |
| Credential extraction | Preserve query-token support and valid Bearer precedence over the query token. For legacy asset GET requests, the configured access-token cookie currently overrides query/Bearer credentials; HEAD does not have that cookie rule. Scoped asset behavior must also satisfy the isolation gate below. |
| GraphQL | Preserve `/graphql` and `/graphql/system`, GET query/POST mutation rules, existing legacy operations and permission-filtered schemas. Preserve partial data and execution errors at HTTP 200, plus transport and validation errors. Preserve configured introspection behavior. |
| Editor and tools | Preserve Infrastructure metadata/ACL hydration, presets, supported writes and existing enabled Content, Files, Settings, layouts, flows, webhooks, Insights, import/export and other configured tools under applicable permissions. The broader frontend capability matrix supplies requirements for enabled Infrastructure surfaces; it does not add new modules to this T3 scope. |
| Files and assets | Preserve upload object/array/read-back-204 variants, download URLs, bytes, transformations, content headers, Range and HEAD semantics. Export-to-file submission remains distinct from job completion. |

Deployment cookie/OAuth patches, configured token lifetimes and error-handler overrides must be checked against the running Infrastructure deployment. Core defaults alone do not establish its effective behavior. Preserve working prefixed redirects and cookie behavior.

## 3. Namespace resolution and the legacy context

### Agreed prototype behavior

- **Disabled mode:** `VIRTUAL_NAMESPACES_ENABLED=false` preserves existing single-context behavior.
- **Keep the legacy context intact:** existing Infrastructure collections remain together during the prototype. Use separately prepared namespace fixtures for isolation checks, without moving production collections. Existing callers keep their tokens, URLs and access to that legacy context.
- **Legacy defaults:** claim-less authenticated callers without an explicit selector use a deterministic owner-default mapping that preserves existing Infrastructure access. Resolve ownership from authenticated accounts, never caller labels or user agents. An instance default is sufficient only where that mapping and equivalent access are demonstrated.
- **Explicit selection:** a verified namespace claim is authoritative. Accept a matching `x-namespace`; reject a conflicting header before data access or side effects. Claim-less authenticated tokens may use an authorized header fallback. The header is a selector, not an authorization grant.
- **Failed selection:** unknown, inaccessible or unready explicit targets fail closed without falling back to another namespace. Namespace denial remains distinguishable from confirmed session expiry. Exact new error DTOs belong to the shared contract.
- **Shared control operations:** authentication, identity/bootstrap, available-namespace discovery and token issuance remain reachable without membership in a default namespace. A valid login with no accessible content namespace is not an expired session.
- **Effective authorization:** resolve local role, admin/app flags and applicable IP/TFA policy consistently. Global Admin authority inherits from main-namespace admin access; a child admin role cannot grant platform authority. Global Admin can enter a child without a persisted membership, while content requests still address one namespace at a time.

Switching mints/installs target access while preserving the shared login session. Refresh preserves each tab's namespace. Admitted writes, retries, exports and background jobs retain their originating namespace; switching cannot reinterpret them under target credentials.

### Future Infrastructure migration consideration

The updated traffic evidence does **not** prove that any individual token accesses collections belonging to multiple future namespaces. This is not a further decision blocking the prototype, because the legacy collections remain together.

Before a later migration moves existing Infrastructure collections into separate namespaces, identify affected tokens and verify whether their callers need access across namespace boundaries. Resolve any such dependencies before that cutover. A default mapping alone cannot preserve a caller's access to collections or relations that have moved into different namespaces. This is a future migration requirement, not an additional gate for the current no-migration prototype.

If such dependencies exist, separately plan either a compatibility bridge that preserves existing calls after separation, or coordinated client changes using scoped credentials/selectors. No automatic cross-namespace search or collection-based fallback is authorized by this plan.

## 4. Permitted changes and Infrastructure integration dependencies

Permit additive namespace APIs, verified token claims, optional selectors and explicit effective-access responses. Internal schema routing, membership storage, cache keys and job context may change. Legacy request shapes and authorized behavior remain the compatibility baseline.

The Infrastructure admin app may carry stable namespace identity in its URL and replace scoped state on switch. Existing enabled workspace capabilities remain available under their applicable permissions. New member/global administration screens belong to their frontend work packages.

Preserve the meaning of existing Infrastructure user requests: existing `role` fields must not silently become membership writes. Consume agreed local/shared authority boundaries when validating Infrastructure access. New global directory/create/invite APIs remain in the separate D14 contract.

Use the existing frontend decision register for ownership and exact interfaces. The following dependencies apply only when the corresponding Infrastructure behavior is enabled or changed:

| Gates | Contract needed before accepting the affected behavior |
| --- | --- |
| D01–D04 | Bootstrap, switch/refresh, token/context errors, nullable local roles, inherited authority, entitlement changes and concurrent refresh. |
| D05 | Effective Infrastructure membership/role changes and their effect on access; full membership-management delivery remains in its owning work package. |
| D07–D10 | Existing enabled Infrastructure file/asset, share/public, settings/translation and profile behavior affected by namespace changes. |
| D11–D13 | Infrastructure metadata/relations, existing flows/jobs/extensions, and admin URL behavior affected by switching. |

D06 provisioning and D14 global directory/onboarding remain separate delivery contracts. Infrastructure T3 does not require implementing them. If they later alter an existing Infrastructure endpoint, that change must satisfy this compatibility baseline.

Require isolation across metadata, generated GraphQL schemas, response caches, assets, audit/revisions and background work. Two concrete source gaps need acceptance evidence:

- [Response-cache keys](api/src/utils/get-cache-key.ts) currently include version, user, path and query, without namespace. Identical requests in separate namespaces must not reuse each other's results, and permission changes must not serve stale unauthorized responses.
- [Asset credential extraction](api/src/middleware/extract-token.ts) currently lets an asset GET cookie replace an explicit token. Two tabs must not display another namespace's assets because of shared cookies or browser/server caching. Preserve the legacy baseline and agree the scoped solution through D07; explicit URL tokens alone do not prove safe selection.

Follow-up for T3: link this plan from the task and hand off Infrastructure-affecting contract decisions to the existing Foundation/frontend owners. Main-admin inheritance and header-mismatch rejection are agreed inputs here. Broader architecture, task B5 and frontend document alignment remains owned by the shared contract work; this plan does not add those edits to Infrastructure T3. Keep affected integration dependencies visible with their existing owners.

## 5. T5 validation priorities and completion

T3 specifies checks; T5 implements and runs them against controlled fixtures and representative authorized callers. Gateway observations establish priority; missing request/response bodies must not be reconstructed as production facts.

| Priority | Infrastructure scenarios |
| --- | --- |
| **P0 — Tracking** | `tracking_events`, `tracking_contexts`, `collector_event_validation_config`: names, relational queries, envelopes, ACLs and unchanged legacy defaults. |
| **P0 — Features/hooks** | Preserve capital `Features`, filters, configuration projections and correct context. |
| **P0 — Ads** | `sponsored_listings`, `native_ad`, `banner_ad`: field/filter/deep selections, response shapes and permission behavior. |
| **P0 — Authentication** | Login, refresh, `/users/me`, SSO callbacks, session continuity, cookie/JSON modes, expiry units and credential precedence. A 200 `/users/me` returning only an ID is not sufficient context for app hydration. |
| **P1 — Translations** | `translation_keys`: fields, filtering, envelopes and namespace selection. |
| **P1 — Editor/schema/writes** | Collections/fields/relations/permissions/roles/users hydration; Tracking POST/PATCH; `competitor_scraper_technical_config/default` PATCH; preset updates; permitted/denied and 200/204 behavior. |
| **P1 — GraphQL** | Both scopes, representative operations, validation/execution errors and namespace-specific schemas. Inspect result bodies as well as HTTP status. |

Infrastructure acceptance scenarios:

- Compare equivalent legacy fixtures for data, ACLs, statuses, envelopes, error codes and relevant headers. Test specialized successful empty responses without duplicate writes.
- Exercise disabled mode, unchanged legacy defaults, matching/conflicting selectors, missing defaults and unknown/inaccessible/unready explicit targets.
- Put colliding collection names and item IDs in Infrastructure namespace fixtures, including one synthetic peer namespace. Warm schema/response caches before alternating identical requests, including the same user with different local roles. Check that Infrastructure metadata, GraphQL and direct assets cannot leak into or from that peer.
- Verify Infrastructure access for a member, local admin and inherited Global Admin, including no child membership, a lower child role and attempted platform escalation. This checks authorization effects; it does not require new global administration screens.
- Verify no-logout switching, source-bound writes/jobs/retries, required hydration failure, two-tab refresh and namespace revocation without false logout.
- Smoke existing enabled Infrastructure file/share/settings/tool surfaces using inventory contracts even when their usage is unmeasured. Review Infrastructure's enabled extensions before accepting isolation. Unmeasured usage does not authorize removing an existing capability.

T3 is complete when its Infrastructure policy, exceptions, applicable integration dependencies and prioritized checks are documented and linked from the task. Deployed Infrastructure compatibility requires representative Infrastructure baselines, authenticated owner/default mappings and T5 evidence. Other deployments, provisioning/global-onboarding delivery and the future migration consideration do not extend this completion boundary. This document records no runtime verification, application tests, migrations or production changes.
