# C4 — No-logout token swap

Status: **Not started**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

Switch by issuing/installing a target access token while preserving shared login. Refresh respects each tab's namespace. Inherited Global Admin works without a child role. Namespace denial/revocation differs from actual session expiry; retries cannot cross namespace boundaries.

## Dependencies and boundaries

- **D01–D04:** bootstrap identity, token/expiry/effective-access DTOs, denial/reconciliation codes, header precedence, refresh-cookie concurrency, inherited-admin/app/TFA/IP policy and revocation latency.
- **C2:** operation admission/ledger/epoch, phase coordination and stale-effect suppression.
- **C3:** initial requested namespace and per-tab URL/destination; no shared browser-storage active namespace authority.

C4 owns authentication operations and token/access normalization. C2 owns the switch coordinator and queue mechanics. Define their interfaces together; serialize token mint/refresh/install decisions without locking refresh behind a long write or hydrate operation.

## Implementation checklist

- [ ] Implement agreed session/bootstrap, mint-target and refresh-for-namespace adapter operations with target-ID validation and normalized errors.
- [ ] Separate shared identity, nullable active local role, namespace app/admin policy and Global Admin authority. Do not fake a persisted child role or use main role ID for child presets/permissions.
- [ ] Add atomic token/context/expiry installation called by C2; clear/replace old refresh timers and update idle/show/active refresh callbacks.
- [ ] Serialize token decisions with namespace/epoch validation. Allow fixed-source refresh while draining and fixed-target refresh after commit if operations are long.
- [ ] Keep refresh selection per tab, and integrate the agreed cross-tab cookie rotation/concurrency mechanism from D03.
- [ ] Bind retry authentication to C2's captured source context; stale source requests cannot obtain target credentials, refresh target or log it out.
- [ ] Preserve source on normal denial before commit; reconcile ambiguous mint outcomes according to D02 rather than assuming session state.
- [ ] Distinguish context cancellation, resource forbidden/missing, namespace/app access loss and confirmed session expiry. Generic 403/network failure is not logout.
- [ ] Revalidate inherited authority/local access on refresh; retain valid reduced local access after Global Admin demotion if backend grants it.
- [ ] Invalidate session generation and all contexts/timers on actual logout/expiry; old effects cannot restore identity or platform data.
- [ ] Complete targeted token/retry and live multi-tab/core-switch checks; record evidence below.

## Endpoint inventory checks

- [ ] Treat login/refresh expires as milliseconds of duration; check 200 /users/me responses for required context fields because the current handler may return only an ID.
- [ ] Use the agreed scoped permissions contract; current /permissions/me is not a dedicated endpoint and minimum permissions may be synthetic.
- [ ] Normalize 403 INVALID_TOKEN as well as 401 responses; do not infer session expiry from ordinary resource 403 or network failure.
- [ ] Verify share-auth cookie separation, asset-cookie precedence and deployed refresh/callback behaviour with C3/D03/D07/D08.
- [ ] Do not equate current middleware's accountability.admin bypass or role-ID-only replacement with the finalized local/global policy. See [API handoff](frontend-api-handoff.md).

## Existing and proposed code

Existing: `app/src/auth.ts`, `api.ts`, `router.ts`, `stores/app.ts`, `stores/user.ts`, `stores/permissions.ts`, permission/filter helpers and idle refresh handling. Proposed: auth operations in the shared namespace adapter plus access DTOs/normalization consumed by C2/C3/C5/C7. Every role-dependent consumer needs the agreed nullable/effective representation; changing the switcher alone is insufficient.

## Completion criteria

- [ ] Successful switch changes target token/context/expiry without logout or destroying the shared login cookie.
- [ ] Global Admin without child membership hydrates correctly; a lower local role cannot reduce inherited authority, and local `admin_access` cannot grant platform authority.
- [ ] Two tabs maintain different namespaces through concurrent refresh and reload.
- [ ] Slow source writes/target hydration can refresh safely without deadlock; stale 401/INVALID_TOKEN cannot retry/logout the target.
- [ ] Current namespace revocation clears protected access but retains a valid session; true expiry/logout clears every context.

## Completion evidence

Implementation commit/PR: —

Auth/retry/multi-tab checks: —

Open dependencies or limitations: D01–D04; shared C2/C3 interfaces and backend refresh/entitlement enforcement.
