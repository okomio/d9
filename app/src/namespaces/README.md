# Frontend namespace foundation

`ensureNamespaceRuntime()` in `live.ts` creates the single per-tab runtime. C1 and C7 should call
`getNamespaceRuntime()` and use its read-only `state`, `refreshChoices()`, `registry.invalidate(...)`, and
`coordinator.requestSwitch({ namespaceId, source, destination })`. The supported sources are `picker`, `platform`,
`history`, `deep-link`, `bootstrap`, and `recovery`. C1 should pass a safe target landing such as `/content`; C7's
**Enter** action should call the same coordinator. Neither surface should mint or install a token itself. An
administrative namespace filter must use its own URL key; `ns` selects the active content context.

The admin UI labels virtual namespaces **areas**. The persistent rail button above Notifications opens the native
chooser dialog; project and active area remain visible in the header. Once the coordinator has guarded and validated a
change from an active area, its final navigation performs a full browser page load at the target `?ns=` URL. Initial
bootstrap does not reload again. The static chooser and recovery routes reuse the same card list when no protected shell
exists.

Enable this frontend with `VITE_VIRTUAL_NAMESPACES_ENABLED=true` in a build or dev session only when the backend has
`VIRTUAL_NAMESPACES_ENABLED=true`, registry migrations, and ready children. The frontend flag defaults off because the
backend does not yet expose a reliable feature flag in `/server/info`; disabled deployments keep the original Directus
auth/router behavior.

The backend adapter uses `GET /namespaces`, `POST /namespaces/:namespace/token`, and `POST /auth/refresh` with a per-tab
`namespace` body. It does not change collection API paths. Access tokens remain in memory. `?ns=<stable-id>` is the
frontend URL hint. The static `/namespace/loading`, `/namespace/choose`, `/namespace/recover`, and `/namespace` routes
exist before dynamic Directus modules are registered. The existing native Content module is hydrated under the selected
token. Settings keeps its native screens: namespace-owned Data Model, local Roles & Permissions, Presets, Flows and
Webhooks are available to effective namespace admins; shared Project Settings shows a contract notice and Translation
Strings are read-only for child admins pending D09. The native User Directory uses namespace membership for its list and
local role actions. Files and Activity remain withheld until their shared resources and audit feed have namespace-safe
backend reads and actions. See `RFD/frontend/virtual-namespace-settings-status.md` for the remaining Settings gaps.

Views and extensions can register dirty, pause, reset, resume, and dispose hooks through `runtime.lifecycle`.
`useSystem()` provides `{ getRuntime }` under the `namespace-runtime` injection key. Axios requests are admitted with a
fixed namespace, epoch and bearer token; reads are aborted at switch, writes drain before mint, and failed writes block
the switch until the source outcome is reconciled. Direct upload/export helpers also guard stale effects.

The backend returns effective app access for an inherited Global Admin without requiring a child membership. The
frontend uses that response without inventing a child role. Effective TFA/IP policy, cookie rotation across tabs,
asset-cookie precedence, remaining shared Files/Settings policies, public shares, and extension-owned state still need
their backend contracts and live integration checks before those behaviors can be claimed.
