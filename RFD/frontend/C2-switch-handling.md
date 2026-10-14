# C2 — Switch handling

Status: **Not started**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

One coordinator handles selector, history/deep-link and platform-entry switches. It protects dirty edits, drains admitted writes, cancels reads, prevents stale effects, resets all namespace state and renders the target only after required hydration succeeds. The [shared switch transaction](frontend-implementation-plan.md#6-one-switch-transaction-for-every-entry-point) owns phase/error semantics.

## Dependencies and boundaries

- **C4 / D02/D04:** token issuance/installation, effective local/platform capabilities, original-context retry policy and lost-token-response recovery.
- **C3 / D13:** static loading host and guarded navigation permit; supplied destination intent.
- **D11:** correctly scoped schema/metadata/flows/relations and source-bound jobs.
- **D07–D12:** file/share/settings/profile/job/extension rules before their enabled surfaces are considered complete.

C2 owns context, orchestration and the real operation ledger. C4 owns auth semantics using that ledger. Agree their interfaces first; do not wait for either to be marked Done before beginning the other. C5 adapts local admin screens; C2 supplies resource-aware access/reset lifecycle.

## Core implementation checklist

- [ ] Add namespace/context store, epoch/session generation and explicit phases; separate shared identity from nullable local role and platform authority.
- [ ] Add an adapter-backed coordinator with one active switch and dirty/pause/reset/resume/dispose participant registration.
- [ ] Register item/flow/role/schema/preset/dashboard/member/create forms. Guard namespace-only query changes, not just path changes.
- [ ] Preserve drafts until commit; on Stay leave source untouched; on mint rejection resume source producers exactly once.
- [ ] Implement an operation ledger tied to real promise settlement. The existing `requestsStore` removes IDs after 3.5 seconds and is only a spinner tracker.
- [ ] Bind namespace/epoch/token at admission, classify operations and maintain a control lane for auth/bootstrap/coordinator reads.
- [ ] Stop new producers, cancel queued/abortable reads and settle canceled queue promises; let admitted writes/uploads drain in source. Do not pause the queue needed to finish those writes.
- [ ] Handle failed/unknown writes in source; use C4's auth retry rules without replaying a mutation under target credentials.
- [ ] Suppress stale success/error/finally/event effects; expose a quiet context-cancellation result rather than fake successful empty data.
- [ ] Unmount source before target commit; call C4 token installation and C3 static target URL commit, then reset scoped state/routes.
- [ ] Make required hydrate results explicit. Reset after partial failure even when `appStore.hydrated` is false; settle/invalidate sibling reads and keep target blocked on failure.
- [ ] Register permitted modules only after access/metadata is ready; validate destination and restore target polling/actions through C3.
- [ ] Integrate resource-aware local/platform capability checks. Ordinary row/field policies remain intact; local admin never grants shared-user/schema/settings/platform rights.

## Reset and exposed-surface checklist

- [ ] User/access/permissions/collections/fields/relations stores reset and hydrate under the target epoch; inherited Global Admin with no child role does not skip hydration.
- [ ] Content navigation groups/hidden state/search, cached roles and `app/src/composables/use-folders.ts` refs/loading/errors reset to target defaults.
- [ ] Cancel `use-preset.ts`'s 450 ms autosave and dispose callbacks/subscriptions without writing into target.
- [ ] Dispose `packages/composables/src/use-items.ts` controllers, throttle and loading timeout; re-key lists/items/relation pickers by namespace/epoch.
- [ ] Reset flow actions/editors and Insights variables/lastLoaded/interval metadata/data/errors/edits; clear actual refresh-sidebar timers.
- [ ] Reset notifications/inbox/unread/dialogs/snackbars/previous state; close notification drawer, full-screen/detail overlays and scoped errors. Disable old keyboard mutations during quiescing.
- [ ] Use C3's scoped saved-navigation/tracking cleanup; preserve personal shell width/theme/language according to the shared policy.
- [ ] Remove namespace-added collection/field/singular/plural locale messages, including keys absent in target; retain built-in locale messages. Reset scoped custom strings if D09 selects them.
- [ ] Guard direct export/download/upload actions as well as Axios; source-tag upload events/job notifications, close old previews and revoke app-created object URLs.
- [ ] Reload/filter audit/revisions/comments/shares and files/folders according to backend ownership/access policies; no client-only filter is an isolation boundary.
- [ ] Expose agreed context/lifecycle to extensions via `app/src/composables/use-system.ts`; reset caches/listeners/polling/subscriptions for every enabled extension.
- [ ] C6 reset/apply hook is integrated if scoped branding is selected. Existing/shared shell cleanup still belongs to C2 when C6 is not selected.
- [ ] Logout/session expiry invalidates namespace and platform state and all stale effects; content switching retains shared login.

## Capability and endpoint checks

- [ ] Verify [capability preservation](frontend-capability-coverage.md): layout/spacing/options, archive/unarchive, auto refresh, import/export, search/filter/paging/CRUD/bulk actions remain functional in target context.
- [ ] Support endpoint-specific success responses: read-back 204, empty 200 import/sort, upload object/array/204 and export submission 204 without a completion/file-ID promise.
- [ ] Resolve D07 asset-cookie precedence and cache/access across tabs; explicit image tokens alone cannot enforce namespace context.
- [ ] Exercise specialised schema/flow/revert/utility and applicable GraphQL errors through the [API handoff](frontend-api-handoff.md). Do not offer instance-wide cache clear as a local-admin operation.
- [ ] Invalidate effective permissions/schema/registry after relevant edits within the same namespace, not only on switches, and notify registered lifecycle consumers.

## Existing and proposed code

Existing: `app/src/hydrate.ts`, `api.ts`, `stores/`, `app.vue`, `extensions.ts`, `composables/use-edits-guard.ts`, `use-preset.ts`, `use-item.ts`, `use-folders.ts`, `modules/content/composables/use-navigation.ts`, `views/private/components/refresh-sidebar-detail.vue`, upload/export helpers and shared item composables. Proposed: namespace store plus `app/src/namespaces/coordinator.ts`, `requests.ts`, `lifecycle.ts` and shared adapter/types.

## Completion criteria

- [ ] Same collection/item/bookmark IDs in two namespaces never reuse source rows/columns/filters/actions.
- [ ] Dirty query-only switch, slow write/upload, canceled queue read and repeated switch attempts follow the shared state machine without deadlock.
- [ ] Stale results/errors/events cannot affect target or logged-out state; source denial recovers and partial target failure never reports false readiness.
- [ ] Every enabled required surface is covered, with the applicable D07–D12 policies resolved and direct API isolation evidence provided by Foundation.
- [ ] Coordinator/ledger/reset tests and live integration with C1/C3/C4 pass. Optional/deferred demo surfaces are explicitly listed and do not count as completed isolation.

## Completion evidence

Implementation commit/PR: —

Coordinator/reset and live checks: —

Open dependencies or limitations: D02/D04/D11, shared C3/C4 interfaces and applicable D07–D12.
