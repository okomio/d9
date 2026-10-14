# Frontend virtual namespaces — shared implementation plan

Audited 2026-10-14 against `hackathon` / `v12.0.7`, commit `1c2506b24`. This is an implementation plan, not evidence that the feature exists or works at runtime. The source audit did not change application code or the database.

## 1. Verdict and document ownership

The frontend design is achievable in this Vue/Pinia app, conditional on backend namespace isolation, authentication and administration contracts. [frontend-switch-behaviour.md](frontend-switch-behaviour.md) is a useful behavioural foundation. It was insufficient on its own as a construction plan: it did not define the components, failure paths, integration gates or changes needed to existing admin shortcuts. The C1–C7 documents now supply the delivery checklists and completion criteria. This shared document remains the source for audited context, unresolved contracts and the common switch lifecycle.

Use section 2 for the agreed product scope, the switch spec for behaviour, this document for shared decisions/verification, and [README.md](README.md) for C1–C7 delivery/progress. [frontend-discovery.md](frontend-discovery.md) records the source findings. This committed frontend set is self-contained; optional local development notes are not required to follow the plan.

The original two-day schedule is a planning target, not a demonstrated estimate for the expanded frontend scope. Authentication, queue handling, reset coverage, member management and platform provisioning are separate work packages. Prove the switch with two namespace fixtures first, then integrate administration and all exposed surfaces. The final workspace retains Content, Files, local member management, Settings and existing tools. An incomplete demonstration is not completion of that scope. Capability preservation and F1/F2 traceability are explicit in [frontend-capability-coverage.md](frontend-capability-coverage.md).

## 2. Product requirements already settled

- Virtual namespaces are dynamic. Tracking/AAA and the other reference folders are examples, not a fixed registry or migration requirement. In a populated Tracking namespace, every content surface shows only Tracking metadata/data.
- Global Administration includes a shared-user directory filtered by namespace/local role, global Create User/Invite User with repeatable initial namespace-role rows, and namespace management. Role creation and later assignment of existing users happen inside the target; create/invite initial assignment is the explicit global exception. Directory filtering does not switch content context. Details and recommendation: [global-admin-design.md](global-admin-design.md).
- Ordinary users have one local role per membership. They can hold memberships in several namespaces, but only the active context is evaluated. Global Admin alone has administrative authority across boundaries, inherited from main-namespace admin access as agreed; no separate global-admin grant is required.
- A Global Admin has admin access in every virtual namespace without a local membership. Namespace creation is a platform operation on a separate Global Admin management page, independent of the selected namespace. Creation itself does not switch the user. Current backend provisioning can copy an existing area's table structure/metadata; the final creation mode is D06.
- A Virtual Namespace Admin sees all local content and manages local schema, flows, roles and assignment/unassignment of existing users. User creation and global-profile administration belong to Global Administration. The existing local User Directory lists members only; adding a user uses a searchable shared-user lookup.
- Removing a local membership preserves the account and memberships elsewhere. It cannot revoke inherited Global Admin authority. A local admin cannot grant platform authority by creating an admin role in their child namespace.
- Switching retains the login session and changes the scoped access token. The admin URL carries namespace identity; `/items/<collection>` paths stay unchanged. No production data migration is part of this prototype.

## 3. Audit findings and corrections

| Finding | Existing evidence | Required correction |
| --- | --- | --- |
| Roleless inherited admins cannot currently hydrate | `app/src/hydrate.ts` gates hydration on `currentUser.role`; `user.ts` and `permissions.ts` dereference role fields | Separate shared identity, active local role and effective capabilities. Support a Global Admin with no child role; do not invent a persisted child membership. |
| Local admin currently implies broad UI authority | `userStore.isAdmin`, `permissionsStore.hasPermission()`, `utils/is-allowed.ts`, Settings/Users module checks | Introduce resource-aware local capabilities and separate platform/main-user capabilities. Audit callers, not just the switcher. Local admin cannot acquire user CRUD or project-settings writes through an unconditional admin bypass. |
| Existing users/roles UI can create or delete shared users | Users list has create/batch-delete; role item has `users-invite`; role counts use `role.users` | Separate main Users directory from child Members. Remove invite/create/profile/delete actions from child screens and direct routes. Role counts come from local memberships. |
| New-role defaults can expose the entire directory | `settings/routes/roles/add-new.vue` installs `appRecommendedPermissions`; `app-permissions.ts` grants unrestricted users read and self-profile writes | Define namespace-safe role templates with the backend; user selection must use a narrow lookup. Review public-role permissions and shared file grants too. |
| Hydration can report success after failure | `hydrate.ts` catches errors then marks hydrated; `userStore.hydrate()` catches internally; flows/insights also swallow errors | Required stores must return an explicit result or throw. Use all-settled completion plus epoch guards so a sibling request cannot update state after a failed hydrate. Optional modules fail closed independently. |
| Request tracker is not a write barrier | `requests.ts` drops IDs after 3.5 seconds; `api.ts` uses a queue and retries unauthorized requests with a refreshed token | Add a real operation ledger and original-context retry rules. Never use the spinner tracker or `replaceQueue()` as switch safety. |
| Dirty guard misses query-only switches | `use-edits-guard.ts` checks path prefixes | Register dirty participants in a coordinator; a change of namespace triggers the guard even on an unchanged path. |
| Resetting Pinia alone is incomplete | Notifications lack dehydrate; Insights retains variables/history/interval map; folder/nav/role refs persist outside stores | Explicit reset/dispose registry including timers, translation messages, callbacks and drawers. Re-key protected views by namespace and context epoch. |
| First-load routing resolves authentication before namespace | `router.ts` first refreshes cookie, then hydrates; `auth.ts` refresh/idle callbacks have no namespace input | Resolve the URL namespace before protected reads. Serialize refresh/switch within a tab; backend refresh must support separate namespace contexts across tabs. |
| Direct browser operations bypass Axios safeguards | Export uses `window.open`; asset/image URLs are browser loads; upload helper emits a global upload event | Guard action entry points and snapshot their source context. Scope emitted events. An Axios interceptor alone cannot stop old browser assets or export actions. |
| Profile links/preferences have global side effects | Avatar/popovers link to `/users/:id`; `router.ts` schedules `trackPage()` after 500 ms; last collection has one global storage key | Gate profile links, cancel delayed tracking, namespace-key return paths. Agree permitted self-service/profile behaviour separately from member administration. |

## Endpoint inventory follow-up

The [frontend API handoff](frontend-api-handoff.md) maps [endpoint-inventory.md](../../endpoint-inventory.md) to C1–C7. The inventory is a baseline at `1c2506b24`; the [backend-aligned delivery plan](backend-aligned-delivery-plan.md) updates the source review to `hackathon` `ccdb4d737` and records the requested native Directus UI. Discovery, token mint/refresh and local membership routes now exist, while privilege isolation and several contracts remain open. In particular, define effective local/global flags, account for asset-cookie precedence across tabs, handle 204/empty/multipart/stream responses, and normalize 403 INVALID_TOKEN/GraphQL errors. Deployment-prefix/cookie/OAuth notes are source evidence with live overrides unverified.

## 4. Backend handoff and unresolved decisions

All entries below are **open for integration or product resolution** unless explicitly described as a frontend recommendation. D01–D05 now have partial or substantial HTTP implementations at `ccdb4d737`; D06 and D14 remain missing operation contracts. The [backend-aligned plan](backend-aligned-delivery-plan.md#current-backend-contract-and-fit) gives the exact current mapping. An endpoint name in an example is not an agreed API.

| ID / gate | Decision or dependency | Owner / needed evidence | Impact and permitted progress |
| --- | --- | --- | --- |
| D01 — before real auth integration | Session identity/bootstrap and available-namespace listing must work before a namespace is hydrated, including users with no valid default/membership | Foundation + API contract; response fixtures for member, inherited admin, no-access user | Build adapter/store against fixtures now. Real login/chooser integration waits for this. |
| D02 — before switching | Switch/refresh response returns stable active namespace, token/expiry and effective access; define errors, token/header precedence and lost-response recovery | Foundation + API contract; request/response/error examples | Proposed rule: a scoped token is authoritative; conflicting hints must not silently override it. Agree the rule. A switch mint must leave the source valid until client commit, or provide reconciliation. |
| D03 — before refresh/multi-tab verification | Per-tab namespace on cookie refresh; concurrent refresh-token rotation across tabs; revoked-access versus expired-session errors | Foundation + API contract; two-tab integration fixture | URL/context stays per tab. Never store one shared active namespace in localStorage/session cookie as authority. Server must handle concurrent refresh or agree a cookie-refresh coordination mechanism. |
| D04 — before inherited-admin integration | Effective admin/app/TFA/IP policy with no child role; response representation for `$CURRENT_ROLE`, role presets and module checks; entitlement revocation latency | Foundation; inherited admin with/without a lower local role | Do not use the main role ID as a child role or synthesize a persisted role. Nullable local-role DTO plus separate effective capabilities is the frontend recommendation; backend encoding remains open. |
| D05 — before member/role integration | Member list/lookup/assign/change/unassign operations, pagination/search fields, duplicate/inactive-user errors, local role counts, role deletion and last-local-admin policy | Foundation + API contract; lifecycle and negative fixtures | CRUD and lookup routes now exist. Adapt the **native User Directory** to their scoped projection; determine which original layouts/details/actions need richer data. Backend must stop broad local-admin `/users` reads. Last-admin denial exists and needs negative verification. |
| D06 — before creation integration | Platform registry/create/provisioning contract, uniqueness rules, first local roles, readiness, retry/idempotency and failure cleanup | Foundation + API contract; ready/pending/failed fixtures | Registry/readiness and Global Admin-visible listing exist; create/status mutation HTTP operations do not. Decide empty creation versus existing-area structure/metadata copy. An ambiguous create timeout must reconcile by operation/idempotency ID before retry. |
| D07 — before exposing files/assets/export-to-file | Shared file/folder ownership and effective ACL, asset URLs/caching, upload and generated export ownership | Foundation + API contract + product; direct-ID access verification | Files remain required. Ownership/visibility and GET asset cookie-over-token precedence across tabs are unresolved; image URLs with explicit tokens alone are insufficient. D07 blocks file/asset completion, not inclusion. |
| D08 — before exposing share/public routes | Public/share namespace resolution, share-ID uniqueness/locator, public-role scope and share-auth interaction with existing login | Foundation + API contract; signed-in and signed-out fixtures | Preserve share functionality and separate it from personal auth, including cookies set by /shares/auth. Unresolved resolution/cookie rules block acceptance; a missing feature is not completion. |
| D09 — before Settings integration | Shared/readable settings versus editable platform settings; translation strings; per-namespace branding scope | Foundation + product; resource ownership list | Settings and Translation Strings remain supported. Resolve local/shared fields and editing authority; shared-instance edits stay global. Only distinct per-namespace branding is optional C6. Scope decisions must not remove the Settings feature. |
| D10 — before profile/login-return integration | Avatar/profile link and self-service credentials/theme/language/TFA policy in a child; `last_page` tracking endpoint permissions | API contract + product; allowed-field/action list | Namespace-key last navigation in the client; no automatic child profile editor. User creation/profile administration stays in main context; personal self-service is an unresolved distinct policy. |
| D11 — before flow/job/relation verification | Metadata/schema isolation, cross-namespace relations rejected, shared user projections, manual flow execution and async jobs bind originating namespace | Foundation; two schemas plus flow/job fixtures | UI cannot repair mixed metadata or server workers using a global default. This blocks a claim that content/schema/flows are isolated. |
| D12 — before extension release | Inventory custom modules/panels/interfaces and external subscriptions; switch/reset support and injected API/store contract | Frontend + extension owners; enabled extension list | Core browser source has no obvious WebSocket/EventSource client. Existing polling still needs cleanup. Unreviewed extensions cannot be assumed safe merely because core modules reset. |
| D13 — frontend route recommendation, before C3 integration | UI URL and fallback design | Frontend with API contract review | Recommend `?ns=<stable-id>` on protected namespace routes and a static namespace chooser/landing route. Names are display labels. Adopt one format before implementation; API paths stay unchanged. |
| D14 — before global directory/onboarding integration | Global namespace/role projections and membership-filtered distinct user counts; create/invite with zero or many initial memberships; transaction/idempotency, role ownership, existing/pending emails and email ordering | Foundation + API contract + product; coherent account/membership/invitation fixtures | C5 builds global Users filters/forms; C7 supplies platform navigation only. Current single-role user/invite APIs are insufficient. See [global administration design](global-admin-design.md). |

The completed feature needs all applicable contracts, not just token minting. Decisions about file visibility, public access, roleless admins and refresh cannot be postponed while claiming full isolation.

## 5. Frontend building blocks

The following file names are **proposed new files**, not existing implementation. Keep wire-format details in an adapter so frontend work can start against agreed fixtures without inventing server endpoints.

| Building block | Suggested location / existing integration | Responsibility |
| --- | --- | --- |
| Namespace contract adapter | `app/src/namespaces/api.ts`, `types.ts` (new); shared DTOs in `packages/types/` when agreed | Operations `readSessionContext`, `listAvailable`, `mintTargetToken`, `refreshForNamespace`, member lifecycle, platform list/create/status. Validate returned target IDs and map error codes. |
| Context store | `app/src/stores/namespace.ts` (new) | Active/pending namespace, context epoch, phase, available namespaces, namespace access and separate platform authority. Shared user identity persists; local role is nullable. |
| Switch/auth coordinator | `app/src/namespaces/coordinator.ts` (new), `auth.ts` | One active switch, serialized token issuance/installation, dirty preflight, operation barrier, commit/recovery and timers. Same-context refresh must still service long source writes or target hydration without changing namespace. |
| Request context/ledger | `app/src/namespaces/requests.ts` (new), `api.ts` | Capture namespace/epoch/token when an operation is admitted; classify auth/platform/namespace/public operations; drain writes, cancel reads, settle queue promises, suppress stale responses/errors/retries. |
| Reset/dirty lifecycle | `app/src/namespaces/lifecycle.ts` (new), `hydrate.ts`, composables | Registration of dirty checks and pause/reset/resume/dispose callbacks; explicit store/translation/timer resets after partial hydrate too. Expose context/lifecycle to supported extensions through `composables/use-system.ts` and the agreed injection contract. |
| Context-aware routing | `router.ts`, `app.vue`, module registration, login routes | Bootstrap URL before reads, query propagation, Back/Forward transaction, safe static chooser/landing, guarded target routes, namespace/epoch view key. |
| Capability layer | User/permission stores, `use-permissions.ts`, `is-allowed.ts`, modules | Separate platform, main-user and namespace-resource authority. Preserve row/field filters for ordinary roles. Audit all `isAdmin`/`role.admin_access` call sites. |
| User-facing switcher | Shell `project-info.vue` and private view, new component | Explicit active label, accessible namespace picker, pending/errors, ready-only entry, zero/one/many namespace states. |
| Global user onboarding/directory | Main/global Users screens plus membership-aware navigation/forms | C5 adds All Users → namespace → local role filtering and global create/invite initial membership rows. Cross-namespace platform projections do not mutate active content context; D14 owns wire/transaction semantics. |
| Members screen | New `app/src/modules/members/` is recommended | Child-only member list/local-role assignment editor, gated by effective local membership-management authority. Ordinary content access/shared-user read does not automatically expose this admin screen. Main `users` module remains directory/profile administration; never reuse global user save/delete actions for membership. |
| Platform page | New authenticated platform route/components, separate from local Settings | Global Admin list/create/status/entry. Guard with platform capability even when active namespace is a child or no content module is available. |

Minimal internal context needs `activeNamespace { id, name, kind, readiness }`, `pendingNamespace`, `availableNamespaces`, `epoch`, `phase`, `namespaceAccess { localRole, canUseApp, isNamespaceAdmin, ... }`, and `platformAccess { isGlobalAdmin, canManageNamespaces, ... }`. These are proposed client concepts; backend DTO naming/claims are D01–D04. Never store access tokens in URLs or durable browser storage.

Do not publish a fake main-role ID as the active child role to satisfy old code. Update nullable-role consumers and role-specific presets/filters. Global Admin access may bypass local data ACL but must still request one namespace's metadata/data at a time. Shared user/profile/registry operations have their own capability checks.

Actual logout/session expiry invalidates all namespace and platform state, timers and in-flight effects through a session generation as well as the namespace epoch. A content switch preserves session identity; an old request cannot restore logged-out identity or platform registry data.

## 6. One switch transaction for every entry point

Dropdown selection, namespace URL navigation, browser Back/Forward and **Enter namespace** on the platform page all call the same coordinator. Auth bootstrap has no source view to preserve but uses the same target validation/hydration rules. A namespace-only query change must not bypass preflight.

| Phase | Actions / render policy | Failure or cancellation |
| --- | --- | --- |
| `ready(source)` → `preflight` | Validate target readiness/access, reject duplicate concurrent switch, capture destination intent, ask once for unsaved changes | Stay keeps source token/URL/drafts/timers. Choosing Discard does not destroy drafts until target commit. |
| `quiescing` | Disable namespace mutations/shortcuts, pause polling/autosave/page tracking, cancel queued/abortable reads, drain already admitted writes using source credentials | If a write fails or has an unknown outcome, remain in source and explain that operation. Do not replay it in target. Resume source on a rejected switch, exactly once. |
| `minting` | Obtain target token under serialized auth control; token issuance is exempt from the paused namespace queue | Denial preserves source. Network ambiguity uses D02 reconciliation; source validity cannot be assumed if backend mutates session context. Membership failure is not logout. |
| `committing` | Close/unmount source protected views before target label/token becomes visible; increment epoch, install matching target token/context/expiry, reset scoped state and remove old dynamic routes. Replace the URL with a static target loading/landing route carrying the target ID; preserve destination intent separately | After commit, never restore cached source data. A reset failure leaves target blocked with Retry/Choose namespace. The target URL makes reload deterministic; namespace route side effects remain disabled. |
| `hydrating(target)` | Load required context/permissions/fields/collections/relations; register permitted modules only afterward; load destination resources; settle and invalidate failed sibling requests | Required failure blocks target content; retry resets partial target first. Optional-module failure disables that module with a local error. No false empty-success state. |
| `routing(target)` → `ready(target)` | Validate destination against target metadata/capabilities, replace the loading route with the final coordinator-authorized route, reconnect scoped polling, restore focus/enable actions | Unknown/inaccessible item/collection lands safely within target, without interpreting a source ID in target. URL/navigation failure keeps the view blocked until reconciled. |

Proposed state names are implementation guidance. Maintain the invariant that token, rendered namespace, local metadata and route namespace agree whenever protected content is visible. A target failure after commit keeps the target context; returning to source is another authorized switch, not a cache rollback.

Transport requirements:

- The current request spinner is not a ledger. Track real promises and abort signals until settlement. A long upload/write stays admitted even after 3.5 seconds. Queue cancellation must reject/settle its promises, not leave hydration waiting forever.
- Stop producers before draining. Do not pause the entire queue and then await writes that can no longer dispatch. Auth/bootstrap/switch and coordinator-authorized target reads need a control lane so quiescing cannot deadlock them.
- Bind namespace/epoch/token at admission, including queued work. A mutation retries only in its original context and only under an agreed safe/idempotent policy. Stale source 401/403/INVALID_TOKEN responses must not refresh target, replay under target credentials or log out the new context.
- Cancellation/context-discard is a distinct non-user-error result handled by stores/composables without source snackbars. Returning fake successful empty data would hide integration failures. Suppress stale `finally` callbacks and event emissions as well as successful responses.
- First implementation should wait for sent writes/uploads to settle before switching. For a timeout/unknown result, remain in source and offer reconciliation. Continuing long operations in the background is a separate design requiring immutable source context and job feedback; do not introduce it silently.
- Export-to-file jobs may outlive their submitting HTTP request. Server jobs retain the captured source namespace after the submission settles. Direct downloads snapshot source token/URL; once opened, the browser download is independent of the current view. Do not promise to retract delivered files.
- Auth serialization protects mint/refresh/token-install decisions, not an unbounded lock around uploads or metadata reads. Refresh may renew the fixed source context while draining and the fixed target context after commit; verify epoch/namespace before installing its result. Otherwise a long operation can outlive its token while the only refresh path waits on that operation.

Normalize errors in the adapter before applying recovery. These are client categories, not invented wire error codes:

| Category | Recovery |
| --- | --- |
| Confirmed session expiry | Invalidate session generations, clear all contexts and return to login. Network failure alone is not proof of expiry. |
| No app access / current namespace revoked | Keep valid shared login; clear protected namespace views and show permitted alternatives/no-access state. If lower local access survives Global Admin demotion, reload those reduced capabilities. |
| Collection/item forbidden or missing | Handle that resource within the current namespace. A generic resource 403 does not mean namespace membership was revoked. |
| Context cancellation / stale source error | Settle bookkeeping quietly; never mutate current stores/auth or show source error banners. |
| Required target read failed | Keep target URL/context blocked with Retry/Choose namespace; do not present an empty successful view. |
| Unknown platform-create outcome | Reconcile the operation/idempotency ID and show pending/error status before another create attempt. |

## 7. Delivery by C block

Use [the C1–C7 progress tracker](README.md) to follow implementation. It links each block's checklist, dependencies and completion evidence, and owns progress status. Six blocks are required; C6 branding is optional. Infrastructure, local Settings, exposed-surface work and verification are all assigned to these blocks or their shared completion gates.

Start with the shared F2 contract/fixtures gate: agree D01–D04/D13 and provide two isolated namespace fixtures with colliding IDs plus member/inherited-admin/no-access response cases. Agree C2/C3/C4 adapter/context/coordinator interfaces before live integration. Frontend scaffolding can proceed with those fixtures while Foundation proves S1–S3.

Build the shared C2/C4 core with C3's minimal landing host, complete C3/C1 integration, then C5 and C7. C2 remains open through all exposed-surface work. Core C1–C4 verification is an integration milestone; the blocks must not implement independent switch algorithms. Finish shared D1/D2/D3 verification across the required blocks. Select C6 only after D09 is agreed.

Local Settings adaptations are owned by C5; the reset/exposed-surface inventory is owned by [C2](C2-switch-handling.md#reset-and-exposed-surface-checklist); URL rules and saved-navigation work are owned by C3. Shared verification remains in section 9 below. The progress tracker explains the C2/C4 request/auth handoff.

## 8. URL and route rules

[C3 — Refresh-safe URL](C3-refresh-safe-url.md#url-and-route-rules) owns the detailed URL/bootstrap/history rules. The current recommendation remains `?ns=<stable-id>` pending D13 agreement. All namespace navigation uses section 6's shared switch transaction; C3 supplies a static target loading URL at commit and validated final routing after hydration. Public/share and platform routes retain their distinct authorization contexts.

## 9. Verification plan for feature implementation

Use two demo namespaces with colliding collection/item/bookmark IDs, contrasting columns, and distinct users/roles/flows. Include a local admin, ordinary member of one, member of both with different roles, Global Admin without child membership, Global Admin with a lower child role, and user with no app namespace. Include two browser tabs and slow/erroring responses.

| Scenario | Expected evidence | Gate |
| --- | --- | --- |
| List/item/schema/flow switches | Tracking-only sidebar/search/rows; same IDs render target fields only; no stale manual action | C1/C2/C5 + D11 |
| Dirty query-only switch, rapid repeated clicks | Stay changes nothing; Discard commits only on success; at most one token transaction; keyboard writes blocked while quiescing | C1/C2/C3/C4 |
| Slow reads/writes, queue and stale 401 | No stale store/error/event updates; sent write uses source; no retry under target; auth lane does not deadlock | C2/C4 |
| Denied mint / lost mint response / partial required hydrate | Correct before/after-commit recovery, stopped source timers resume on rejection, no false ready or old view under target label | C2/C4 + D02 |
| Login, reload, SSO/TFA, Back/Forward, two tabs | Target namespace resolved before protected reads; refresh maintains each tab; denial/no-access does not invalidate a valid login | C3/C4 + D01–D04 |
| Ordinary/local/global permissions | Child admin cannot create users/namespaces, invite new users, edit profiles/shared schema/settings or grant main-admin authority; Global Admin enters without a child role | C2/C4/C5/C7 + D04/D09 |
| Global directory / new-user onboarding | Namespace/role filters do not switch tokens; distinct counts/pagination; multiple namespace-role rows source roles correctly; coherent create/invite and safe existing-email/error handling | C5/C7 + D14 |
| Member role lifecycle | Assign/change/unassign scoped correctly; local counts update; foreign role/profile write denied; self-removal and last-admin rule match contract | C5 + D05 |
| Platform creation | Ready/pending/failed handled; create does not switch; direct URL denied to local admin; ambiguous retry creates at most one registry/schema | C7 + D06 |
| Files/share/public/audit/Insight/notification/extension | Direct IDs and browser assets obey policy; drawers/timers/messages reset; share does not pollute personal context; scoped events only | C2 + D07–D12; C6 if selected |
| Legacy API and defaultless frontend user | Existing `/items/<collection>` callers keep paths/default behavior; frontend chooser works without permission to a legacy default | Backend D2 + D01/D02 |

Meaningful client tests should cover the coordinator state machine, original-context request retry, partial hydration, query-only navigation and capability distinctions. Run targeted Vitest files with `pnpm --filter @wbce-d9/app test <test-file>` once implemented; build with `pnpm --filter @wbce-d9/app build` after shared packages are available. Shared composable changes need their package checks too. Browser/API scenarios are required because client mocks cannot demonstrate server isolation or refresh-cookie behaviour.

No application tests/build/runtime verification were run for this documentation audit. Documentation links and source references are checked separately; none of the proposed building blocks or acceptance criteria should be reported as implemented.
