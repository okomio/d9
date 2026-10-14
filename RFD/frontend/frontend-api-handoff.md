# Frontend implications of the endpoint inventory

Reviewed 2026-10-14. [endpoint-inventory.md](../../endpoint-inventory.md) is the source-owned T1 baseline at `1c2506b24`; it describes existing route contracts, not completed virtual namespace APIs. The current backend check is `hackathon` `ccdb4d737`; the [backend-aligned delivery plan](backend-aligned-delivery-plan.md) maps the new routes and product gaps. The inventory's deployment notes are inspected-source evidence, not verified running configuration.

## Baseline versus current Foundation work

Current source contains `api/src/virtual-namespace/` groundwork. With `VIRTUAL_NAMESPACES_ENABLED=true`, middleware resolves a token's `namespace` claim, then the optional debug `x-namespace` header when enabled, then `VIRTUAL_NAMESPACES_DEFAULT`. Non-global users resolve role and app/admin flags from `directus_user_namespaces`; requests without membership receive generic `FORBIDDEN`. The current backend also exposes `GET /namespaces`, `POST /namespaces/:id/token`, optional-namespace `POST /auth/refresh`, and local member list/lookup/assign/change/unassign. This is meaningful Foundation progress, not a completed frontend handoff. The frontend C1–C7 status is unchanged.

The middleware now recomputes role/admin/app flags for a namespace member and records membership-derived admin authority for a separate control-plane write guard. Main-derived Global Admin still crosses children without a membership. The access DTO's child `can_use_app` currently comes only from `membership?.app_access`, however, so an inherited Global Admin with no child role gets a false app flag in the response. D04 must reconcile that DTO with the intended effective authority and verify TFA/IP policy; the frontend must not infer platform authority from the selected child role.

The middleware now exempts explicit control-plane paths, including `/auth`, `/users/me`, `/namespaces` and `/assets`, from namespace resolution. The first three support recovery/bootstrap; `/assets` remaining outside namespace routing is an isolation issue for D07, not proof that previews are safe. The debug header is not the agreed UI switch mechanism. D01/D02 still need no-access/default behavior and error examples verified with live requests.

## Relevant current contracts and required frontend treatment

| Inventory finding | Frontend consequence / owner |
| --- | --- |
| `GET /users/me` can return only `{ id }` when the full record is forbidden | C2/C4 must not mark context ready merely because this request is 200. D01/D04 must provide checked effective-access/identity DTOs, including inherited admin without a child role. |
| No dedicated `/permissions/me` handler; app permissions may include synthetic minimum grants | C2/C4 use the agreed scoped `/permissions` or a new explicit contract. Do not invent `/permissions/me` or assume results equal database rows. Preserve effective ordinary-role policies. |
| Login/refresh `expires` is a duration in milliseconds | C4 computes absolute expiry from receipt time and replaces timers. Refresh rotation already has overlap handling, but two-tab namespace preservation still needs D03 verification. |
| Asset GET access-token cookie overrides query/Bearer token; REST generally uses Bearer rather than cookie | D07/D03 must fix or define safe asset authentication across tabs. A target token in an image URL alone cannot guarantee target context while a shared cookie overrides it. C2 must cover previews/avatars/downloads; client cache reset alone is insufficient. |
| Successful writes can return 204 when read-back is forbidden | C2/C5 adapters treat successful no-content as a committed write, not failure or missing-record data. Re-fetch when authorized; do not blindly retry or dereference `response.data.data`. |
| Import/manual sort can return 200 with no body; export-to-file returns 204 after scheduling, with no file ID/completion guarantee | C2 preserves tools and handles each operation's success shape. Await source submission; jobs stay source-bound. Do not promise job completion from the export response. |
| File creation can return one object, an array or read-back 204; assets stream bytes with separate cache/range rules | C2 upload/file adapters preserve current cardinality/stream behaviour; D07 covers access/cache/ownership. No generic JSON-envelope assumption for every operation. |
| `INVALID_TOKEN` is 403 in core; inaccessible/missing records often use 403; GraphQL execution can return 200 with `errors` | C4 normalizes status AND error code/context. The existing Axios 401-only INVALID_TOKEN branch is insufficient. Generic 403 is not proof of namespace revocation/session expiry; C2/extension clients must inspect GraphQL errors as applicable. |
| `/users/me/track/page` updates shared `last_page`; invites/global user CRUD and admin TFA-disable are separate account operations | C3 retains/cancels scoped navigation tracking per D10. C5 does not reuse account writes for assignment or expose invites/TFA admin-reset through local role authority. |
| `/shares/auth` sets access and refresh cookies | C3/C4 require explicit personal-session/share-context separation under D08; a separate Vue store alone cannot prevent shared-cookie replacement. |
| Schema mutations/snapshot/diff/apply, flow triggers, revert, import/export and cache clear have specialised contracts | C2/C5 scope each operation, including jobs/manual actions; preserve functionality without treating every POST as generic CRUD. Current cache clear is instance-wide and requires platform authority unless a local variant is defined. |
| Singleton reads/upserts differ from ordinary item CRUD; SEARCH has family-specific payload/key handling | Preserve existing method/payload semantics in C2/C5. Use controller contracts, not incomplete OpenAPI, when adapting current tools. |
| CMS uses `/v9/<instance>/` gateway prefixes and build-time cookie/OAuth patches | C3/C4 must preserve configured base URL and redirects/cookie behaviour; do not confuse deployment prefix with virtual namespace ID or hard-code root `/admin`/`/auth` URLs. Running deployed overrides remain unverified. |

The inventory confirms existing Content/Files/Settings/tool endpoints. Later backend source now defines listing, token mint/refresh and local membership CRUD, while platform namespace create/status and global onboarding remain absent as HTTP contracts. D01–D05 therefore need integration/effective-access checks rather than being treated as wholly missing; D06 and D14 require new operations. Current local-admin policy also leaves broad shared-user reads open and blocks `/files` and `/settings` writes. This conflicts with the requested child-only directory and full native capability. Existing Settings singleton classification does not authorize dropping Settings or Translation Strings; capability preservation is specified in [frontend-capability-coverage.md](frontend-capability-coverage.md).

## Global user onboarding contract update

[global-admin-design.md](global-admin-design.md) extends C5/C7: global directory reads/filtering and Create User/Invite User need multiple `(namespace_id, role_id)` initial assignments. Current `/users` and `/users/invite` expose a single global primary role; sending that field does not implement membership onboarding. D14 must define explicit global projections, server-side pair validation/distinct pagination, coherent account+memberships transaction/idempotency and invitation ordering. General existing-user additions/role changes and role creation stay local.

## Integration acceptance additions

- [ ] Verify representative permitted and forbidden current endpoints with a member, local admin and inherited Global Admin; validate effective flags/identity before hydration.
- [ ] Verify both tabs' asset requests with different active namespace tokens and shared cookies; no source-cookie override or cache leakage.
- [ ] Verify successful writes/import/sort/upload/export response variants without false failure, duplicate writes or incorrect completion messages.
- [ ] Verify 403 INVALID_TOKEN, ordinary missing-resource 403, explicit namespace denial and GraphQL errors map to distinct recovery.
- [ ] Verify shared-profile/track/TFA/share-cookie operations respect the agreed boundaries and existing gateway/login redirects.

No application code, configuration or database was changed; no live endpoint calls or application tests were run for this follow-up. These are handoff requirements, not proof of runtime correctness.
