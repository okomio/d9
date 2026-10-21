# C3 — Refresh-safe URL

Status: **Not started**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

Resolve the requested namespace before protected reads. Stable identity survives login/SSO/TFA, reload, copied links and browser Back/Forward. Static chooser/loading/landing routes work independently of dynamic modules. API collection paths remain unchanged.

## Dependencies

- **D13:** adopt one admin URL format. `?ns=<stable-id>` is the current frontend recommendation, not an agreed contract.
- **D01–D04 / C4:** bootstrap identity/default/no-access states, target-scoped refresh and effective app/TFA policy.
- **C2:** coordinator state machine and navigation transaction permit.
- **D10:** permitted native self-service/profile route and `last_page` tracking. The profile's saved default namespace requires a separate server-side preference contract. **D08:** share/public resolution before those routes are exposed.

Provide the minimal static loading/landing host and permit interface during the shared C2/C4 skeleton. Full routing integration follows; this avoids a circular wait for a dynamic target module.

## URL and route rules

For namespace routes missing `ns`, canonicalize the current authorized namespace on internal navigation. On initial entry, an explicit safe internal destination/`?ns=` target takes precedence. Otherwise use the signed-in user's saved **Default Virtual Namespace** only if it is ready and still enterable, automatically select and persist a sole eligible namespace, or show the chooser for several eligible namespaces without a valid preference. Zero eligible namespaces reach no-access. The current `GET /namespaces.default` environment/fallback value is not a saved user preference and must not silently send users to shared `main` content. A different explicit namespace invokes C2. Use stable IDs, not display names, and never place a token in the admin URL.

The avatar opens the signed-in user's native editable profile directly. The current `/users/:id` link redirects to the directory in a child because the shared user item route is protected there; replace this shortcut with a permitted self-profile route, while retaining a separate Global Admin path to the native shared-user item. A child user's self-profile must read/write only explicitly permitted personal fields through a server-enforced contract and must not reveal the shared directory or local-role editor. Saving a preferred landing namespace does not switch the current tab; it governs the next initial sign-in/session resolution. An explicit target deep link remains authoritative after validation. Revoked, deleted or unready preferences cannot grant access and resolve to the sole eligible choice or chooser instead.

Intentional picker switches open a safe target landing and discard source item/bookmark/query state. Explicit copied target deep links retain their destination intent only after target validation. Same-namespace links preserve unrelated query parameters. Browser Back/Forward across namespaces uses the same dirty-aware transaction; cancellation restores source location without minting a target token.

During commit, C2/C4 install target context while C3 replaces the URL with a static target loading route; keep the intended destination separately. After hydration validates the destination, replace the loading route with the final route. A transaction permit prevents the coordinator's own navigation from triggering another switch. Target failure keeps the target URL so reload is deterministic.

Login/password/SSO redirects retain an internal protected destination until authentication completes. Resolve target before protected hydration; validate redirect paths as app-local. TFA follows the effective target policy. Public share authentication has a distinct context and must not silently replace personal namespace credentials.

Chooser/landing/platform routes remain reachable without dynamic Content routes. No-access, API-only (`app_access=false`), empty namespace and failed hydration are different states. Platform route authorization uses C4 global authority; a content namespace may be kept only as return context.

## Implementation checklist

- [ ] Global Users namespace/role filters use distinct platform filter state/URL keys, never the active content namespace hint. Preserve filter deep links without token switching; only Open namespace calls the coordinator. See [global administration design](global-admin-design.md).

- [ ] Agree D13 and add parser/canonicalizer for stable namespace IDs and internal destination intents.
- [ ] Add static chooser/loading/landing routes and transaction permit; ensure route guards can run before dynamic module registration.
- [ ] Refactor first-load `router.ts` ordering: resolve target, obtain matching access via C4, then authorize C2 hydration.
- [ ] Carry destination through password/LDAP/SSO login and TFA redirect paths; handle missing/invalid default and no authorized app namespace.
- [ ] Propagate `ns` through hard-coded internal links without losing same-namespace query parameters.
- [ ] Route explicit namespace changes and Back/Forward through C2's dirty-aware transaction; prevent guard loops and restore URL on cancellation.
- [ ] Commit static target URL before protected routing; verify missing/inaccessible collection/item/bookmark produces a safe target route.
- [ ] Replace unscoped last-collection/return navigation with `(user, namespace)` storage at both read/write sites; ignore old unscoped values.
- [ ] Cancel router's delayed `trackPage()` write on switch and implement the D10 choice for personal tracking/profile links.
- [ ] Make the avatar open the native editable self-profile from every virtual namespace, with backend-enforced personal-field access; no redirect through the child member directory.
- [ ] Resolve initial login from validated explicit target, then saved per-user default, then sole eligible namespace, then chooser/no-access. Persist the preference server-side and keep it separate from the active namespace and the `GET /namespaces.default` fallback.
- [ ] Keep public/share route resolution separate; apply platform-route global guards before side effects.
- [ ] Verify copied links, reload, login/TFA/SSO, history and two-tab behaviour with C2/C4.

## Endpoint inventory checks

- [ ] Preserve configured base URL and /v9/<instance>/ deployment prefix; virtual namespace selection must not change that deployment identity. Verify actual cookie/OAuth patches/configuration before claiming deployed compatibility.
- [ ] Keep /shares/auth cookie effects separate from personal login, and explicitly handle /users/me/track/page writes to shared last_page under D10.
- [ ] Coordinate with C4 on no-default bootstrap and namespace middleware exemptions; current Foundation groundwork does not provide these complete contracts. See [API handoff](frontend-api-handoff.md).

## Existing and proposed code

Existing: `app/src/router.ts`, `routes/login/`, `routes/shared/`, `routes/tfa-setup.vue`, `modules/index.ts`, `modules/content/index.ts`, `modules/content/routes/collection-or-item.vue`, `stores/user.ts`, `composables/use-local-storage.ts`, `views/private/components/module-bar-avatar.vue`, user popovers and `app.vue`. Static context routes and URL helpers are proposed new code.

## Completion criteria

- [ ] Protected requests never run with a default/source token before a requested target is resolved.
- [ ] Reload/copied deep links show only the authorized target; no redirect loops or source ID interpretation in another namespace.
- [ ] Back/Forward and query-only switches respect Stay/Discard; target hydration failure reloads the target safely.
- [ ] Namespace-specific saved navigation, no-access/API-only/empty states and two tabs behave distinctly and correctly.
- [ ] Public/platform routes preserve their separate authorization rules; legacy API paths are unaffected.
- [ ] The avatar reaches the signed-in user's editable native profile; a saved eligible default skips the chooser on a fresh login, while an invalid preference cannot expose `main` or another unauthorized namespace.

## Completion evidence

Implementation commit/PR: —

Router/bootstrap/browser checks: —

Open dependencies or limitations: D01–D04/D10/D13, C2/C4 integration and D08 for share routes.
