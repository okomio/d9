# Frontend implementation — C1–C7 progress

This is the starting page for following frontend delivery. Each block has its own checklist, dependencies and completion evidence. The [shared implementation plan](frontend-implementation-plan.md) retains the audited architecture, D01–D14 decision register, common switch lifecycle and overall verification requirements. The [switch specification](frontend-switch-behaviour.md) defines expected behaviour.

**Current planning baseline:** [Backend-aligned delivery plan](backend-aligned-delivery-plan.md) records the requested native Directus experience, the contracts present at `hackathon` `ccdb4d737`, gaps and the implementation order. It supersedes earlier mock UI assumptions. This is documentation work only; it does not mark any C block complete.

## Coverage and API references

[Capability coverage](frontend-capability-coverage.md) confirms F1/F2 and required module/tool preservation. [API handoff](frontend-api-handoff.md) incorporates the endpoint inventory and current backend groundwork. These references do not mark frontend implementation complete.

[Global administration design](global-admin-design.md) updates privileges, the namespace/role directory tree and multi-namespace create/invite forms. C5 owns user workflows; C7 owns namespace management and the shared Administration entry. Namespace creation belongs only to the Virtual Namespaces view. D14 records the additional onboarding/directory API contract.

## Progress tracker

Initial status: **0 of 6 required blocks completed.** Documentation is prepared; application implementation and verification have not started in this plan. C6 is optional and excluded from the required count.

| Block | Scope | Status | Dependencies / integration gates | Evidence |
| --- | --- | --- | --- | --- |
| [C1 — Dynamic namespace switcher](C1-namespace-switcher.md) | Available namespaces, active label, readiness and refreshed choices | Not started | C2/C4 context and switch interfaces; C3 navigation; D01/D04 | — |
| [C2 — Switch handling](C2-switch-handling.md) | Coordinator, operation ledger, dirty state, reset/hydration and exposed surfaces | Not started | Shared C4/C3 interfaces; D02/D04/D11; applicable D07–D12 | — |
| [C3 — Refresh-safe URL](C3-refresh-safe-url.md) | Bootstrap, login redirects, history, chooser/landing and saved navigation | Not started | C2/C4 interfaces; D01–D04/D10/D13; D08 for shares | — |
| [C4 — No-logout token swap](C4-token-swap.md) | Mint/refresh/install, effective authority, retry context and per-tab auth | Not started | C2 ledger/coordinator interface; D01–D04 | — |
| [C5 — Membership admin UI](C5-membership-admin.md) | Global directory/create/invite with initial memberships; local members/roles | Not started | Core C2–C4 integration; D05/D09/D11/D14; relevant D08/D10 | — |
| [C7 — Global Admin namespace-management page](C7-global-admin-page.md) | Administration shell, platform namespace list/create/provisioning/entry | Not started | C4 platform capabilities; C2/C3 entry; C1 list invalidation; D06 | — |
| [C6 — Per-namespace branding](C6-branding.md) | Optional scoped branding and cleanup | Optional — not selected | D09 decision; C2 reset hooks | — |

Frontend owner: Martin, as agreed in the project task breakdown. Foundation/API/product owners for each open contract are recorded in the shared decision register; this tracker does not assign them new work.

Use statuses **Not started → In progress → In verification → Done**. Use **Blocked** only with a concrete missing dependency and next action recorded. For C6, use **Optional — not selected**, then the same statuses if included. Tick checklist items only when their work is performed. Mark Done only when the block's required integration checks pass; mock-only work is not live integration evidence. Record the commit/PR, checks and limitations in the evidence section; update the block's status line and this table together. Do not use document completion as implementation progress.

## Recommended work order

1. Finish F2 contract fixtures for D01–D04 and choose the URL format in D13. Agree adapter/context/coordinator interfaces shared by C2/C3/C4.
2. Build C2/C4 together with a minimal static loading/landing host owned by C3. Neither block needs the other marked Done to begin; their interfaces are agreed first.
3. Complete C2 reset/readiness and C4 auth/error handling, then C3 bootstrap/history/login integration and C1 switcher integration.
4. Prove the **core switch milestone** across C1–C4 with two namespaces, slow requests, failed hydration and two tabs.
5. Complete C5 local administration/membership and C7 platform management. Page layouts may be prepared with fixtures earlier; their live APIs remain gated.
6. Finish C2's remaining exposed-surface coverage and the shared D1/D2/D3 acceptance checks. Include C6 only if its scope is selected and D09 is agreed.

The C IDs describe responsibility, not chronological order. C2 spans core infrastructure and later surface integration, so keep its checklist open until every enabled required surface is covered. C1–C4 use **one** switch transaction; selector, history and platform entry must not create separate switching implementations.

## Responsibility boundaries

| Shared concern | Primary owner | Consumers / boundary |
| --- | --- | --- |
| Namespace context store, epoch and coordinator | C2 | C1 renders; C3 supplies destination intent; C4 supplies auth results |
| Token mint/refresh/installation and access normalization | C4 | C2 coordinates phases; C3 resolves initial target; C5/C7 consume distinct local/platform capabilities |
| Operation ledger and queue/cancellation mechanics | C2 | C4 implements original-context authentication retry/error policy against that ledger |
| URL, route guards, static landing host and saved navigation | C3 | C2 requests guarded commit/final navigation; C1/C7 submit destination intent |
| Local Settings/user-directory/member action separation | C5 | C2 supplies resource-aware access/reset lifecycle; backend enforces privileges |
| Namespace creation/provisioning and registry refresh signal | C7 | C1 refreshes authorized choices; C2/C3/C4 handle explicit Enter action |
| Branding cleanup lifecycle | C2 for existing/shared shell, C6 for optional scoped branding | C6 registers its reset/apply hook; it never implements another switch |

All shared contracts remain in the [D01–D14 register](frontend-implementation-plan.md#4-backend-handoff-and-unresolved-decisions). Block documents reference those IDs rather than defining competing API endpoints or product rules.

## Overall completion

- [ ] C1, C2, C3, C4, C5 and C7 are Done with integration evidence.
- [ ] Existing Content, Files, local user management, Settings sections and right-side tools pass the capability-preservation matrix, switch specification and shared isolation checks.
- [ ] Required backend decisions are resolved and documented; remaining optional work is named.
- [ ] Existing API paths/default-token behaviour pass backend compatibility checks.
- [ ] C6 is verified if selected; otherwise its optional status is explicit.
