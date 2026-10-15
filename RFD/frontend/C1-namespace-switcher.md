# C1 — Dynamic namespace switcher

The PR #1 decision for the rail entry, modal chooser, UI term **area**, and full page reload is recorded in [switcher-review-decision.md](switcher-review-decision.md).

Status: **In progress in PR #1**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

The admin shell shows the active virtual namespace and offers only children the user may enter. Global Admin can enter every ready child without a local membership. Options update after namespace creation or access changes. Provisioning/failed/unavailable namespaces cannot be entered. Namespace creation is on C7's platform page. Whether the internal legacy `main` workspace should be offered to Global Admins during migration remains an explicit decision.

The project name and selected area appear as two levels in the upper-left header. A persistent left-rail button above Notifications opens the native chooser modal. The backend `main` entry is internal compatibility state; never present it as “Main Virtual Namespace”. A user without an enterable child sees a static no-access/chooser state with no inherited main content. See the [backend-aligned plan](backend-aligned-delivery-plan.md) for the remaining legacy-main decision and current API fit.

## Dependencies

- **D01/D04:** namespace listing, stable IDs, readiness, app access and inherited-admin entitlement.
- **C2/C4:** reactive context and `requestSwitch` interface; the selector never installs a token itself.
- **C3:** destination intent and safe target landing behaviour.
- **C7:** registry-change signal after create/status changes. This is a signal to refresh authorized choices, not permission to expose the full platform registry to ordinary users.

Component layout/fixtures can start after the listing/context shape is agreed. Live switching waits for the shared core integration.

## Implementation checklist

- [ ] Agree the adapter projection for available namespaces: ID, display name, main/virtual kind, readiness and effective enter/app access.
- [ ] Show project and active area as a two-line label in `project-info.vue`; place the persistent switch action above Notifications and use the native chooser modal.
- [ ] Keep the backend's `main` state available for compatible token/routing behavior; settle if Global Admin needs a visible legacy-main entry. Do not route ordinary users without child access to main content.
- [ ] Cover zero, one and many available **virtual** namespaces, initial loading, list failure and removed active namespace; handle saved default when its profile contract exists.
- [ ] Display provisioning/failed states and prevent entry before readiness; use stable IDs for selection.
- [ ] Submit intent to C2; lock repeated selection during a switch and show source/target loading labels according to the shared lifecycle.
- [ ] Refresh options after C7 creation/readiness and membership/authority revalidation. Reject stale listing responses and preserve the active stable ID if still permitted.
- [ ] Support keyboard selection, focus restoration and announced pending/error states.
- [ ] Complete component and live core-switch checks; record evidence below.

## Existing and proposed code

Existing shell entry points: `app/src/views/private/components/project-info.vue`, private shell components and `app/src/app.vue`. Proposed switcher component is new. Consume C2's proposed namespace store and C4's normalized effective-access result; API paths remain adapter-owned.

## Completion criteria

- [ ] Local member sees authorized choices only; Global Admin sees ready children without a membership row.
- [ ] Creating a namespace through C7 refreshes the picker without changing the active context; it becomes enterable only when ready.
- [ ] Switching to populated Tracking displays only Tracking content; changing the selector alone never renders source content under a target label.
- [ ] Repeated clicks, list errors, empty choices and access removal produce a coherent UI without bypassing C2 or invalidating a valid login.

## Completion evidence

Implementation commit/PR: —

Component/integration checks: —

Open dependencies or limitations: D01/D04; core C2/C3/C4 integration; C7 signal wiring.
