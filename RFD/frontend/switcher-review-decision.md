# Area chooser review decision for PR #1

This decision addresses the two switcher review comments on PR #1. **Virtual namespace** remains the API and code term;
the admin UI calls a selectable virtual namespace an **area**. No area is inferred from a collection folder.

## Entry and presentation

- Keep the project name and active area as two readable lines in the existing upper-left header. That header is a label,
  not a control.
- Add a persistent `swap_horiz` **Switch area** button in the left module rail immediately above Notifications. The
  hover-only Sign Out control remains attached to the avatar.
- The button opens a Directus `v-dialog`/`v-card` modal, following the native Invite Users pattern. Opening, closing or
  refreshing the modal does not change the active area.
- Use the same chooser content on the standalone no-access and recovery routes, because those routes have no protected
  CMS view behind a modal.
- Show one area per row. The display name is above the stable machine ID; a role pill is pinned at the right and a check
  follows it for the current area. An inherited main-role administrator is labelled **Global Admin** rather than shown
  with a missing child role. Long names wrap; the list scrolls; search appears when the list grows.
- Refresh is a low-emphasis action in the chooser header. Show loading, listing failure, empty, provisioning, failed and
  API-only states. Unavailable and current cards cannot initiate a switch. Keep focus and keyboard operation usable.

## Switching and reload

Choosing another area uses the existing coordinator for dirty-form preflight, cancellation of source reads, draining of
admitted writes/uploads, target token validation, source unmount/reset and target hydration. A rejected preflight or
token mint leaves the source available; a failure after committing the target enters the existing recovery state. The
shared login session is retained.

After a successful **cross-area** switch from an already active CMS context, commit a stable `?ns=<id>` target URL and
perform a full browser page load before exposing the target module. Browser startup resolves that requested ID before
protected reads and rehydrates from its scoped token. Initial bootstrap into the first area does not reload again. Area
changes initiated from the rail, Global Administration, or Back/Forward follow the same guarded path. A missing/revoked
area opens the static chooser or recovery state, never legacy main content.

The guarded transition still matters with a page load: reloading during an unsettled save could leave its outcome
ambiguous, and a reload alone does not enforce namespace authorization. The current coordinator validates and hydrates
the target before the final browser navigation. This deliberately performs a second hydrate on startup; it keeps the
existing recovery contract and avoids exposing unvalidated target content during this review change. Reducing duplicate
work can be considered after the reload path has live coverage.

## Review acceptance

- In a populated area, the rail icon opens a native-looking modal; the header shows project and active area without a
  dropdown.
- The chooser has no horizontal choice row and scales to many and long area names.
- Cancel/close leaves the current CMS view untouched. Stay on a dirty prompt leaves the current area intact. A denied
  target keeps the valid source session.
- A successful switch to another area causes a browser document load at the target `?ns=` URL; reload, copied links and
  Back/Forward resolve the correct area.
- Content and other enabled modules continue to use their existing routes and capabilities under the selected area. This
  decision does not enable currently withheld Users, Files, Settings or Activity modules before their backend isolation
  contracts are ready.
