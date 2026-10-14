# C7 — Global Admin namespace-management page

Status: **Not started**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

Global Administration is a **new vertical rail module** with Users and Virtual Namespaces views as described in [global-admin-design.md](global-admin-design.md). C5 owns the global directory/onboarding; C7 owns shared navigation and the dedicated namespace-management view. Global Admins list virtual namespaces, create one, inspect provisioning status and explicitly enter a ready namespace. Create Namespace belongs on the Virtual Namespaces view, not in the Users sidebar. Use the existing Directus list, selection and contextual action conventions. Global authority alone gates the page/API, independent of selected namespace. Creation does not switch context. Current backend provisioning copies an existing area's structure; the intended new-namespace creation mode is a backend/product decision in the [backend-aligned plan](backend-aligned-delivery-plan.md).

## Dependencies

- **D06:** platform registry/create/status operations, stable ID/uniqueness, readiness/initial roles, failure cleanup and idempotency/reconciliation.
- **C4/D04:** Global Admin capability independent of child `admin_access`; revocation/reduced-access handling.
- **C2/C3:** explicit Enter transaction and static authenticated platform route available without dynamic Content modules.
- **C1:** invalidate/refresh authorized switcher choices after registry readiness changes; no forced selection.

Page/list/create fixtures can be developed once the platform adapter is agreed. Real schema provisioning is Foundation work; the frontend reports its result.

## Implementation checklist

- [ ] Provide shared Administration navigation for global Users and Virtual Namespaces with separate capability checks; a local admin cannot acquire either global capability through child admin_access.
- [ ] Put Create Namespace on the Virtual Namespaces view. Keep role creation and existing-user additions inside the target namespace after explicit entry.

- [ ] Define platform list/create/status adapter operations and Global Admin capability; do not infer it from current child role.
- [ ] Add a separate authenticated platform route/navigation entry, guarded before any data/action side effects, including direct URL entry.
- [ ] Load the current Global Admin-visible namespace list with loading/error/empty/readiness states; keep platform registry state separate from C2's local metadata. Confirm whether `GET /namespaces` is sufficient for the final management list or requires a distinct platform projection.
- [ ] Add create form with backend-aligned name/identifier/uniqueness validation, dirty guard and duplicate-submit prevention.
- [ ] Submit creation through platform authority from any selected namespace. Retain selected content context while the request completes.
- [ ] Report provisioning/pending/ready/failed status. Dispose any status polling when leaving/signing out; retain authorized platform data through ordinary content switches.
- [ ] Reconcile ambiguous create outcomes by agreed operation/idempotency ID before retry; never create a second namespace merely because the first response was lost.
- [ ] Refresh list and signal C1 options after create/readiness. Do not auto-enter or treat a legacy same-named folder as migrated content.
- [ ] Enable **Enter namespace** only when ready/permitted; send intent to C2/C3/C4, never install a token or hydrate directly from this page.
- [ ] Remove page/actions/data if Global Admin authority is lost; distinguish this from a generic provisioning/network error.
- [ ] Handle the agreed new-namespace provisioning mode through C1/C3; local role/member setup uses C5 after entry under inherited admin access.
- [ ] Verify platform authorization, creation/reconciliation and explicit entry with browser/API evidence.

## Existing and proposed code

New platform route/components and namespace registry adapter are proposed. Integration points: `app/src/router.ts`, shell navigation/module bar, C4 access normalization, C2 context/lifecycle and C1 invalidation signal. The page must not rely on registering the active namespace's Settings module.

## Completion criteria

- [ ] Global Admin can open the page/create while viewing Tracking or another child; local admin cannot access page/API through an `admin_access` role.
- [ ] Pending/failed namespace cannot be entered; ready creation updates choices without changing active context.
- [ ] Duplicate clicks and unknown outcomes do not provision duplicate namespaces; status/errors follow the backend contract.
- [ ] Explicit Enter uses the shared switch transaction and inherits admin access without a child membership.
- [ ] The page reports the actual backend provisioning result; authority loss/sign-out clears platform access/data.

Namespace rename/delete/reparent operations are not part of this block's currently agreed scope.

## Completion evidence

Implementation commit/PR: —

Platform/provisioning/negative API checks: —

Open dependencies or limitations: D06/D04; Foundation provisioning; shared C1–C4 interfaces.
