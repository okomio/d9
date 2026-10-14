# C6 — Per-namespace branding (optional)

Status: **Optional — not selected**. Owner if selected: Martin. Excluded from the required completion count. [Progress tracker](README.md).

## Outcome

If selected, the active namespace can supply the agreed name/color/logo/custom CSS/translation settings, with complete source cleanup and target application during switching. An explicit namespace label in C1 is required regardless of C6. The shared project label may remain Infrastructure when C6 is not selected.

Existing Settings and Translation Strings functionality is required capability coverage, owned by C5/C2 under D09. Leaving C6 unselected does not remove those features; C6 only adds distinct namespace branding.

## Dependencies and decision gate

- **D09:** choose whether C6 is included, which branding fields are namespace-owned, read/write authority and fallback semantics. Shared Settings edits must not become a local-admin capability by accident.
- **C2:** reset/apply lifecycle and hydration readiness; **C4:** effective capability policy.
- **D07:** logo/asset access and cache policy when those assets are referenced.

Do not begin scoped branding integration until the scope/storage contract is agreed. If left unselected, retain shared branding and complete C1's namespace identity plus C2's existing shell/locale cleanup.

## Checklist if selected

- [ ] Record selected fields, inheritance/fallback rules and settings authority in D09; update optional status in the tracker.
- [ ] Map agreed scoped branding reads through the adapter; avoid inferring scope from shared `/settings` storage.
- [ ] Register branding reset/apply with C2 so source CSS/logo/title/favicon/custom strings cannot survive under a target label.
- [ ] Apply target branding only under matching context/epoch; preserve personal theme/language policy.
- [ ] Cover a target lacking branding fields with deterministic fallback, not leftover source values.
- [ ] Protect any settings edit UI/API with the agreed local/platform capabilities; no broader Settings grants.
- [ ] Guard asset URLs/cache handling through D07; dispose app-created preview/object URLs.
- [ ] Verify configured/unconfigured targets, failed loads and repeated switching; record evidence.

## Existing code

`app/src/stores/server.ts`, `stores/settings.ts`, `app.vue`, `views/private/components/project-info.vue`, `module-bar-logo.vue`, `utils/set-favicon.ts` and `composables/use-translation-strings.ts`. Backend response/storage changes remain D09; C6 does not create another coordinator.

## Completion criteria if selected

- [ ] Every selected branding field changes with the active namespace and resets to correct fallback when missing.
- [ ] No source custom CSS/logo/locale strings remain after switching or failed target hydration.
- [ ] Shared identity/personal preferences remain coherent; branding visibility/edit authority matches the contract.
- [ ] Tests and live configured/unconfigured-target scenarios pass.

## Evidence or optional-scope decision

Scope selection / D09 resolution: —

Implementation commit/PR and checks if selected: —

Open dependencies or limitations: D09, D07 for assets and C2 lifecycle integration.
