# Frontend namespace foundation

`ensureNamespaceRuntime()` in `live.ts` creates the single per-tab runtime. C1 and C7 should call
`getNamespaceRuntime()` and use its read-only `state`, `refreshChoices()`, `registry.invalidate(...)`, and
`coordinator.requestSwitch({ namespaceId, source, destination })`. The supported sources are `picker`, `platform`,
`history`, `deep-link`, `bootstrap`, and `recovery`. C1 should pass a safe target landing such as `/content`; C7's
**Enter** action should call the same coordinator. Neither surface should mint or install a token itself. An
administrative namespace filter must use its own URL key; `ns` selects the active content context.

The admin UI labels virtual namespaces **areas**. Hovering the user icon reveals **Switch area** beside **Sign out**; it
opens the native chooser dialog, and project and active area remain visible in the header. Once the coordinator has
guarded and validated a change from an active area, its final navigation performs a full browser page load at the target
`?ns=` URL. Initial bootstrap does not reload again. The static chooser and recovery routes reuse the same card list
when no protected shell exists. Global Administration lists a namespace's members through the membership API; its **All
Users** entry opens the native Users module in the project scope, because the shared directory is only readable there.

Enable this frontend with `VITE_VIRTUAL_NAMESPACES_ENABLED=true` in a build or dev session only when the backend has
`VIRTUAL_NAMESPACES_ENABLED=true`, registry migrations, and ready children. The frontend flag defaults off because the
backend does not yet expose a reliable feature flag in `/server/info`; disabled deployments keep the original Directus
auth/router behavior.

The backend adapter uses `GET /namespaces`, `POST /namespaces/:namespace/token`, and `POST /auth/refresh` with a per-tab
`namespace` body. It does not change collection API paths. Access tokens remain in memory. `?ns=<stable-id>` is the
frontend URL hint. The static `/namespace/loading`, `/namespace/choose`, `/namespace/recover`, and `/namespace` routes
exist before dynamic Directus modules are registered. The existing native Content module is hydrated under the selected
token. Settings keeps its native screens: namespace-owned Data Model, local Roles & Permissions, Presets, Flows and
Webhooks are available to effective namespace admins; Project Settings is hidden from callers without platform settings
authority, and Translation Strings are read-only for child admins pending D09. Native Users and Files are withheld in
virtual namespaces until child-scoped backend reads and writes exist; the native Activity module is also withheld until
the shared audit feed is filtered by namespace. See `RFD/frontend/virtual-namespace-settings-status.md` for the
remaining Settings gaps.

Views and extensions can register dirty, pause, reset, resume, and dispose hooks through `runtime.lifecycle`.
`useSystem()` provides `{ getRuntime }` under the `namespace-runtime` injection key. Axios requests are admitted with a
fixed namespace, epoch and bearer token; reads are aborted at switch, writes drain before mint, and failed writes block
the switch until the source outcome is reconciled. Direct upload/export helpers also guard stale effects.

An inherited Global Admin without child membership enters a child namespace with `can_use_app: true`:
`hasEffectiveAppAccess()` in `api/src/virtual-namespace/access.ts` returns true for `caller.admin === true`, so entry
and app entitlement no longer contradict each other. Effective TFA/IP policy, explicit denial codes, cookie rotation
across tabs, asset-cookie precedence, child-safe Users/Files/Settings, public shares, and extension-owned state still
need backend contracts and live integration checks before those behaviors can be claimed.
