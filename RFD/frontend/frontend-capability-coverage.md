# Frontend F1/F2 coverage and capability preservation

Reviewed 2026-10-14 against the current frontend RFDs and `hackathon` source at `1c2506b24`. The supplied screenshots illustrate existing navigation and tools; their labels/folders are examples, not a fixed UI or namespace inventory. This document makes feature preservation and F1/F2 traceability explicit. It is requirements/analysis coverage, not implementation verification.

## Product invariant

A virtual namespace is a full CMS workspace with scoped content, configuration and privileges. Existing supported modules and tools remain available to users whose active role permits them and to namespace admins within their authority. Switching replaces source context with target context; it does not remove CMS functionality.

The left rail retains Content, Files, local user management and Settings as product capabilities. Local user management is the member/role-assignment experience specified in C5; the final icon/name/route may differ from the current Users directory. A standard user need not see admin modules or every action. Visibility continues to follow role permissions, collection metadata and installed features, as in the current product.

The agreed privilege boundaries remain: users/global profiles are managed in the main namespace; child admins manage existing users' local role assignments; only Global Admin creates namespaces on the platform page. Local admins cannot modify shared platform configuration through local Settings. These boundaries do not justify removing unrelated file/content/layout/automation features.

Missing ownership/API decisions block completion of the affected feature. They are not permission to drop it from the final namespace workspace. A reduced temporary demo must name its missing functionality and cannot be reported as the completed feature. C6's optional scope is distinct namespace branding, not the existing Settings or Translation Strings feature.

Global user administration now also includes [namespace/role directory filtering and multi-namespace onboarding](global-admin-design.md). Creating/inviting an account may assign its initial local roles globally; general existing-user additions/role changes remain local. Each membership holds one local role; a user may have many memberships.

## F1 — switch-behaviour traceability

Every requested F1 surface was included and analysed in [frontend-switch-behaviour.md](frontend-switch-behaviour.md), with source findings in [frontend-discovery.md](frontend-discovery.md). Implementation and evidence remain pending.

| Requested surface | Analysed switch treatment | Building block |
| --- | --- | --- |
| Navigation/sidebar | Replace namespace metadata/tree/bookmarks; reset group/search/hidden state and module eligibility | C1/C2/C3 |
| List and item views | Reload target rows/schema/counts; clear selection/drafts after dirty decision; re-key even when names/IDs collide | C2 |
| Filters and presets | Reset source filters/search/sort/layout query; cancel preset autosave; load target presets/bookmarks | C2 |
| Permissions | Resolve active effective access, including inherited Global Admin without child membership; distinguish local/platform authority | C2/C4/C5 |
| Branding | Preserve shared branding if C6 is not selected; always change namespace label; clean/apply scoped branding if selected | C1/C2/C6 |
| URL and deep links | Resolve stable namespace before protected reads; carry login/reload/history intent; guard inaccessible targets | C3/C4 |
| Realtime | Re-scope existing subscriptions/extensions; stop source polling. No new core transport is implied | C2/C4 |
| Files | Reload library/folders/pickers and effective asset rights; preserve upload/edit/download features with scoped access | C2, backend D07 |
| In-flight requests | Real promise ledger, admitted source writes, read cancellation, epoch guards and original-context retry/error handling | C2/C4 |

Additional analysed surfaces include flows/webhooks/operations, Insights, notifications, audit/revisions/comments/shares, direct downloads/uploads, extensions, profile links, saved navigation, dirty forms, global management, overlays and keyboard actions. The shared coordinator applies to all switch entry points.

## F2 — foundation/skeleton handoff

F2 is included in the shared [D01–D14 decision register](frontend-implementation-plan.md#4-backend-handoff-and-unresolved-decisions) and the client building-block plan. The required interface shape is proposed and reviewed; live APIs and agreed wire DTOs are still open. Backend Foundation owns request/auth/storage enforcement; the frontend skeleton implements the client store/hooks using that contract.

| F2 requirement | Skeleton must expose | Foundation/API dependency | Frontend owner |
| --- | --- | --- | --- |
| Active-namespace store | Reactive active/pending namespace, stable ID/name/kind/readiness, available choices, phase/epoch, nullable local role/effective access and separate global authority; consumers do not mutate context directly | Session/available-namespace/effective-access payloads, including no-default/no-access/inherited-admin cases: D01/D04 | C2 store; C4 normalizes auth; C1/C3/C5/C7 consume |
| Reset/invalidate hook | Register dirty and pause/reset/resume/dispose participants; reset after partial hydration; invalidate permissions/metadata/registry after relevant edits even when namespace ID stays the same; notify supported extensions | Correct scoped reads, schema/cache invalidation and entitlement updates: D04/D05/D06/D11/D12 | C2 lifecycle; C5/C7 signal edits |
| Namespace source | Resolve requested UI URL on entry; choose authorized saved/default only when no explicit target; validate against server access. Bind every request to the issued target token/context; names/folders do not confer authority | Bootstrap/default rules, token/header precedence and errors: D01/D02/D13 | C3 intent resolution; C4 token/identity; C2 request context |
| Refresh preservation | Target-aware refresh for each tab; replace token/expiry without changing namespace; serialize installs with epoch checks; expose reduced/no-access states without false logout | Per-tab issuance, cookie rotation/concurrency and role/entitlement revocation: D02/D03/D04 | C4, integrated with C2/C3 |

Shared adapter operations and proposed client files remain in [the shared implementation plan](frontend-implementation-plan.md#5-frontend-building-blocks). These hook/operation names describe the required handoff, not finalized endpoints. F2 is ready as a contract checklist; it is not a completed API agreement.

## Workspace capability matrix

This matrix supplements the reset spec with an explicit preservation check. A missing permission/configuration may hide an action as before; merely being a virtual namespace must not disable it.

| Capability / surface | Required namespace behaviour | Completion owner / remaining decision |
| --- | --- | --- |
| Content | Collection/folder tree, lists/singletons/items, create/edit/delete, relations, field interfaces/displays and existing configured layouts operate on target data | C1/C2; D11 |
| Files | File/folder browsing, upload/replace/edit/delete/download, previews/image tools and content file pickers remain supported under effective access | C2; file ownership, direct asset/cache and export output policy D07 remain open |
| User management | Member list, existing-user search and local role assignment/change/unassignment are available to local admins; full account creation/profile/directory stays in main context | C5; D05/D10. The user-management capability remains, with intentionally scoped operations |
| Settings — Data Model | Local collection/field/relation/group/schema configuration remains available to local admins; shared control-plane schema is protected | C5 integration / C2 context; D11 |
| Settings — Roles & Permissions | Create/edit local roles and permissions, local counts and lifecycle rules; no platform escalation or unrelated user suspension | C5; D04/D05/D08 |
| Settings — Presets & Bookmarks | Target namespace's user/role/default presets and bookmark administration remain supported | C2 reset / C5 Settings integration |
| Settings — Translation Strings | Existing translation-string management/application remains supported. Resolve whether strings/settings are local or shared and who can edit each; field/collection translations remain target metadata | C5 Settings / C2 locale lifecycle; D09. This feature is not optional C6 branding |
| Settings — Webhooks | Existing webhook configuration and operations use target scope; dirty forms reset safely | C5 Settings / C2 lifecycle; D11 |
| Settings — Flows | Existing flows/operations/editor/manual actions use target scope, including source-bound execution/jobs | C5 Settings / C2 lifecycle; D11 |
| Settings — Project Settings | Project-settings functionality is preserved. D09 must define namespace-owned versus shared fields, readable projections and editable authority. Shared instance settings cannot become child-admin writes | C5; D09. Distinct per-namespace branding remains optional C6 |
| Right panel — Information | Information reflects the target collection/item/configuration; old details and open drawers reset | C2 |
| Right panel — Layout Options | Existing registered layouts and options such as table spacing/columns/ordering remain supported; initialize from target presets/metadata | C2; installed extension review D12 where applicable |
| Right panel — Archive | Archive/unarchive/filter controls remain supported when target collection has archive configuration and user has permission | C2; target metadata/ACL D11 |
| Right panel — Auto Refresh | User can enable target refresh; source timers stop and target interval loads/starts independently | C2 |
| Right panel — Import / Export | Current formats/query/settings and direct-download/export-to-file/import operations remain supported; requests/jobs stay source-bound during a switch | C2; D07/D11 |
| Search/filter/sort/paging/bulk actions | Existing search/filter/sort, paging, selection, batch edit/delete/archive and configured manual ordering remain supported in target context | C2 |
| Item tools | Existing validation/defaults, duplicate/save options, relations, revisions/comments/shares and configured manual actions remain supported within their scoped policies | C2; D08/D11 |
| Other installed modules/tools | Existing Insights dashboards/panels, Activity, notifications, supported extensions and shared help/support links remain available under their applicable permissions/configuration | C2/C5; D07–D12 where applicable; external support links are shared utilities |

Settings section labels and Users-versus-Members presentation are implementation choices. The screenshots do not require copying exact folder names, icons or visual ordering.

## Required preservation checks

- [ ] With a configured target collection and sufficient local permissions, exercise its current layouts/options, filters, paging, CRUD/bulk actions, archive, auto refresh and import/export before and after switching.
- [ ] With a local namespace admin, exercise Content, Files, local member/role administration and each applicable local Settings section. Any shared/global-only field/action has a documented scope rule rather than a blanket removal of the feature.
- [ ] Confirm ordinary-role visibility restrictions still work and local admin cannot create users/edit global profiles/create namespaces or edit shared platform settings.
- [ ] Compare both namespaces' metadata/presets/files/flows/settings through repeated switches and colliding IDs; no old state survives under the new label.
- [ ] Required module/tool coverage is complete and applicable D01–D14 decisions are resolved. Missing Files/Settings/right-side capabilities are not accepted as completion; C6 may remain optional.

These checks feed C2/C5 and overall D1/D2/D3 completion. No feature implementation or runtime test was performed during this coverage clarification.
