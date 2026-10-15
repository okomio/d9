# Frontend implications of the endpoint inventory

Reviewed 2026-10-14. [endpoint-inventory.md](../../endpoint-inventory.md) is the source-owned T1 baseline at `1c2506b24`; it describes existing route contracts, not completed virtual namespace APIs. The current backend check is `hackathon` `ccdb4d737`; the [backend-aligned delivery plan](backend-aligned-delivery-plan.md) maps the new routes and product gaps. The inventory's deployment notes are inspected-source evidence, not verified running configuration.

## Baseline versus current Foundation work

T6 update, 2026-10-15: with `VIRTUAL_NAMESPACES_ENABLED=true`, middleware resolves a verified token's `namespace` claim,
then the optional tooling `x-namespace` header, then the authenticated owner's current primary-role namespace, then
`VIRTUAL_NAMESPACES_DEFAULT` only when no owner mapping exists. The header requires
`VIRTUAL_NAMESPACES_ALLOW_HEADER=true` and is always ignored in production. Conflicting enabled token/header selectors
return `400 INVALID_PAYLOAD`; invalid or inaccessible selections return `403 FORBIDDEN` without fallback. Main uses the
current shared main role; children resolve local role/access flags from membership. Global Admin retains cross-namespace
authority. The existing discovery, scoped token, refresh and member APIs remain available. Frontend C1–C7 delivery
status is unchanged.

`GET /namespaces.default` and login/refresh context now agree with claim-less content routing. They report `null` when
the selected default is missing, unready or inaccessible, even if another namespace is available. This is a
compatibility mapping, not a saved profile preference. Defaultless identity/discovery remain available, and
login/refresh without an explicit target keep issuing claim-less tokens. The frontend must use the chooser for another
target and obtain a scoped token; it must not treat the tooling header as its switch mechanism.

The middleware recomputes local role/admin/app flags for a namespace member and records membership-derived admin
authority for the control-plane write guard. Main-derived Global Admin crosses ready children without a membership;
effective `can_use_app` also includes inherited Global Admin authority. The frontend must consume effective context
rather than infer platform authority from a child role. D04 still owns the broader TFA/IP policy verification.

The middleware now exempts explicit control-plane paths, including `/auth`, `/users/me`, `/namespaces` and `/assets`,
from namespace resolution. The first three support recovery/bootstrap; `/assets` remaining outside namespace routing is
an isolation issue for D07, not proof that previews are safe. The debug header is not the agreed UI switch mechanism.
T6 now has local synthetic HTTP coverage for defaultless REST/GraphQL bootstrap and selection errors; deployed
examples and frontend recovery remain D01/D02 acceptance work.

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
