# Frontend discovery — audit summary

Audited 2026-10-14 against `hackathon` / `v12.0.7` (`1c2506b24`). This document records discovery findings and points to the implementation documents. It does not define a second switch sequence or an API contract.

## Audit outcome

The feature is achievable in the existing Vue/Pinia application if the backend provides namespace isolation, per-tab authentication context and effective administration capabilities. The original switch spec covered most visible surfaces but lacked a construction sequence, reliable write tracking, explicit readiness/failure states and complete local-versus-platform admin integration.

Use [frontend-switch-behaviour.md](frontend-switch-behaviour.md) for required behaviour and [frontend-implementation-plan.md](frontend-implementation-plan.md) for shared architecture, dependency decisions D01–D13 and verification, and [README.md](README.md) for C1–C7 building blocks and progress. The tracker owns delivery status/checklists; the shared plan owns unresolved decisions and the common switch lifecycle.

## Confirmed source findings

| Area | Finding and consequence | Current source |
| --- | --- | --- |
| Roleless inherited Global Admin | Hydration gates on a role; role consumers dereference IDs/flags. Shared identity, nullable local role and effective capabilities need separate handling. | `app/src/hydrate.ts`, `stores/user.ts`, `stores/permissions.ts`, module configs |
| Local versus platform admin | Unconditional admin checks expose Users/Settings actions. A local admin needs only local resource capabilities, while namespace creation requires Global Admin authority. | `app/src/utils/is-allowed.ts`, `stores/permissions.ts`, `modules/{users,settings}/index.ts` |
| Member management | Users screens create/delete/edit shared accounts, role editor invites users, and role counts use the shared primary-role relation. Create a dedicated child Members screen and adapt role UI. | `app/src/modules/users/routes/`, `modules/settings/routes/roles/`, `views/private/components/users-invite.vue` |
| New-role defaults | Recommended permissions include full shared-users read and self-profile writes. Define namespace-safe defaults; profile self-service and directory lookup are distinct contracts. | `app/src/modules/settings/routes/roles/app-permissions.ts`, `add-new.vue` |
| Hydration errors | Hydration can mark success after failure; user/flows/Insights swallow errors. Required reads must signal failure and partial state must reset. | `app/src/hydrate.ts`, `stores/{user,flows,insights}.ts` |
| Request safety | Queue requests/401 retries are not namespace-aware; request IDs expire after 3.5 seconds. Add a real operation ledger, stale-result/error handling and serialized auth. | `app/src/api.ts`, `auth.ts`, `stores/requests.ts` |
| Dirty/reset state | Path-based edits guard misses query-only switches; non-store refs, preset debounce, Insight variables and refresh timers survive ordinary reset. | `app/src/composables/`, `modules/content/composables/use-navigation.ts`, `stores/{insights,notifications}.ts` |
| Browser operations | Direct exports and image/asset loads bypass Axios; upload completion emits a global event. Action guards and context-bound URLs/events are required. | `app/src/views/private/components/export-sidebar-detail.vue`, `utils/upload-file.ts` |
| URL/navigation | First refresh occurs before namespace resolution; last collection is globally keyed; delayed page tracking writes global `last_page`; avatar links enter global user editors. | `app/src/router.ts`, `modules/content/index.ts`, `collection-or-item.vue`, `module-bar-avatar.vue` |
| Realtime/extensions | Core browser source has no obvious WebSocket/EventSource transport; existing polling still needs disposal. Custom extensions require a separate inventory/reset review. | `app/src/extensions.ts`, `composables/use-system.ts`, `views/private/components/refresh-sidebar-detail.vue` |

## What can start now

Prepare the agreed client adapter and response fixtures, context/capability types, mock coordinator scenarios, lifecycle reset inventory, and Members/platform page structure. Proposed technical files are in the shared plan; work ownership and checklists are in the C1–C7 tracker/block documents. These activities do not demonstrate live namespace isolation.

Real auth/switch integration waits for D01–D04 and the URL decision D13. Membership/platform integration waits for D05/D06. Files/public shares/settings/self-service/jobs/extensions require D07–D12 before their enabled surfaces can be considered complete.

## Source and environment boundary

The code findings were checked against commit `1c2506b24`; later Foundation changes are recorded in [frontend-api-handoff.md](frontend-api-handoff.md). Database/environment observations are dated context, not runtime status from this audit. Optional local startup instructions remain in the uncommitted `local-dev/README.md`. No application implementation, migration, build or application tests were run for this documentation audit.
