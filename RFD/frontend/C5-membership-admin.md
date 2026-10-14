# C5 — Membership admin UI

Status: **Not started**. Owner: Martin. Required for the prototype. [Progress tracker](README.md).

## Outcome

In a child virtual namespace, an authorized local admin sees only its members and can find an existing shared user to assign/change/unassign a local role. Unassignment removes local access only. User creation, global-profile administration and the full directory remain in the main namespace. Local schema/flow/role screens preserve these boundaries. C5 also owns Global Admin Users: All Users → virtual namespace → local role filtering, and Create User/Invite User with multiple initial namespace-role rows. Initial onboarding is the permitted global assignment exception; later additions/role edits happen locally. See [global-admin-design.md](global-admin-design.md).

## Dependencies

- **D14:** global membership-filtered directory/projections, namespace-specific role reads and coherent create/invite with initial memberships, errors/idempotency and invitation ordering. C7 supplies shared Administration navigation/create-namespace form; C3 preserves directory filters without a content switch.
- **D05:** member list/lookup/lifecycle API, allowed lookup fields, pagination, duplicates/inactive users, local counts, role deletion and self/last-admin removal policy.
- **C2–C4:** effective local/platform access, request context, reset/hydration and guarded navigation.
- **D09/D11:** shared Settings/schema restrictions and local metadata/flows. **D08:** public-role policy if exposed. **D10:** self-service/profile links.

Members/assignment page structure can start with agreed fixtures. Live assignment and local role lifecycle need backend enforcement; a filtered `/users` page alone is insufficient.

## Global user-management checklist

- [ ] Add global Users navigation: All Users, expandable virtual namespaces and scoped role filters; preserve existing directory search/layout/paging tools and explicit Create User/Invite User actions.
- [ ] Use explicit authorized platform reads for role/membership filters without changing active content token/context. Query membership filters before pagination and return distinct users/counts.
- [ ] Add repeatable namespace/role rows to global create/invite forms; changing namespace clears role, stale reads cannot populate another row and duplicate namespaces are rejected.
- [ ] Source every role from its selected namespace; require ready namespaces and existing local roles. Create roles by entering the target, not inside the global form.
- [ ] Prefill a selected directory namespace/role transparently, allow multiple rows and follow D14's no-membership-account decision.
- [ ] Handle account+initial-membership transactions, read-back 204, existing/pending emails, ambiguous retries and invitation-delivery ordering through the D14 adapter. No duplicate account or silent partial access.
- [ ] Show global-user memberships as a summary with Open namespace links; later membership changes use local Members, not a second global editor.
- [ ] Reuse C7's Create namespace form from the sidebar, and refresh namespace/role/member projections after relevant changes. Distinguish inherited Global Admin from explicit local Administrator membership.
- [ ] Verify one account with different roles in at least two namespaces; local role choices cannot grant platform authority.

## Local implementation checklist

- [ ] Define member/lookup/local-role DTOs and lifecycle adapter operations under the active namespace.
- [ ] Add a dedicated Members module/page gated by membership-management authority; ordinary content/shared-user read does not automatically expose admin controls.
- [ ] Load only active-namespace members and local role counts; clear list/filter/search/editor state through C2 on switch.
- [ ] Add **Add existing user** search picker with minimal agreed fields, pagination/loading/errors and local-role selection. Do not preload/list the entire shared directory.
- [ ] Add assign/change/unassign operations; handle existing member, inactive user, validation/concurrency and removed-access errors.
- [ ] After lifecycle operations, refresh member list/counts and current-user access if affected. Unassign removes no global profile/account/other role; it cannot revoke inherited Global Admin authority.
- [ ] Implement backend's self-unassignment/last-local-admin policy. If denied, preserve membership; if permitted and access is lost, leave protected content and offer authorized alternatives.
- [ ] Keep global account/profile/create/delete/invite actions unavailable to local-admin Members views, including direct routes/keyboard/batch actions. A Global Admin may separately open global Administration while content stays in a child; that platform view is not a local-admin privilege. Do not reuse global `useItem('directus_users')` writes for memberships.
- [ ] Adapt local role editor/counts and replace child role invitation with assigning an existing user; no `/users/invite` call from a child.
- [ ] Revise namespace-safe new-role defaults in `appRecommendedPermissions`: no automatic full-directory/profile/file rights beyond agreed policies.
- [ ] Capability-filter local Settings links AND direct route guards before side effects. Local admins can manage local schema/flows/roles, never shared user schema/project settings or platform grants.
- [ ] Handle local role deletion/last-admin protection and public-role editor under the agreed D05/D08 policies; do not suspend shared accounts as a side effect of local role removal.
- [ ] Label inherited admin access separately from ordinary membership rows; a missing row does not mean Global Admin has no access.
- [ ] Register membership/role/schema/flow dirty forms and local async state with C2, and update avatar/user-popover links through C3/D10.
- [ ] Verify positive and negative API/browser scenarios, then record evidence.

## Settings capability and endpoint checks

- [ ] Preserve local Data Model, Roles & Permissions, Presets & Bookmarks, Webhooks and Flows screens; retain Project Settings/Translation Strings functionality with D09's explicit local/shared editing rules. These are not optional C6 features.
- [ ] Handle successful read-back 204 without false failure/retry, and use the dedicated membership contract rather than writable shared users.role.
- [ ] Keep global invite/account/profile and admin TFA-reset operations outside local-admin authority; apply the [API handoff](frontend-api-handoff.md).

## Existing and proposed code

Recommended new module: `app/src/modules/members/`. Existing main-user screens: `modules/users/index.ts`, `routes/collection.vue`, `routes/item.vue`, `components/navigation.vue`, cached `composables/use-navigation.ts`. Local role/Settings adaptations: `modules/settings/index.ts`, `components/navigation.vue`, `routes/roles/add-new.vue`, `routes/roles/app-permissions.ts`, role collection/item screens and `views/private/components/users-invite.vue`. Use C2's capability/reset layer and C4's effective authority.

## Completion criteria

- [ ] Global Users filters by namespace/local role with distinct counts and preserves content context. Create User/Invite User supports multiple valid initial namespace-role pairs with coherent failure/retry behaviour.

- [ ] Child member list contains local members only; picker selects existing users without exposing unrestricted directory/profile data.
- [ ] Assign/change/unassign affect only the active namespace; global account/profile and other memberships remain intact.
- [ ] Local admin can create/edit local roles, schema and flows; direct user-create/profile/shared-settings/foreign-role/platform attempts are denied by UI and server.
- [ ] Role defaults, invite buttons, counts, role deletion and last-admin/self-removal behaviour follow the namespace contract.
- [ ] Switch/permission-revocation while a member/role form is open follows C2/C3; inherited Global Admin remains distinct from a local membership.

## Completion evidence

Implementation commit/PR: —

Member/local-admin and negative API checks: —

Open dependencies or limitations: D05/D09/D11/D14, relevant D08/D10 and core C2–C4 integration.
