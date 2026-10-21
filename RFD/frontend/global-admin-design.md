# Global administration — users, namespaces and onboarding

This product clarification updates C5/C7. It defines the requested privileges and a recommended frontend arrangement; wire contracts and implementation remain pending. The screenshots show the current directory, not an existing namespace-aware interface.

## Privileges and where operations happen

| Operation | Global Admin | Virtual Namespace Admin | Location |
| --- | --- | --- | --- |
| Create virtual namespace | Yes | No | Global Administration → Virtual Namespaces |
| Create/edit local roles | Yes, after entering target | Own namespace only | Target Settings → Roles & Permissions |
| Add existing user / change or remove local assignment | Yes, from the global user profile or after entering the target | Own namespace only | Global Users → user profile → Namespace Access; target User Directory/role editor |
| Create shared user / invite new user | Yes | No | Global Users; select initial namespace/role assignments |
| Edit global user profile | Yes | No | Global Users |
| Set preferred landing namespace | Own preference; may manage another user's preference through Global Users | Own preference | Native user profile |
| Browse users grouped by namespace/local role | Yes, across namespaces | Local members only | Global Users filters versus local Members |

The Global Admin user editor also manages that user's explicit namespace memberships. This updates the earlier local-only interpretation: a Global Admin can assign an existing namespace, change its local role, or remove that membership from the shared user's native profile. A local namespace admin still manages only the active namespace, and ordinary users cannot grant themselves roles. Creating/inviting an account with initial memberships remains a separate onboarding operation.

Global Admin authority continues to inherit from main-namespace admin access. It remains separate from any child role's `admin_access` flag. Global profile/account operations and directory visibility retain platform/main authority even when the active content namespace is a child.

## Recommended frontend

Use one Global Administration area, reached through its **own icon in the vertical module rail**, with **Users** and **Virtual Namespaces** views. Their routes/capabilities stay distinct. Namespace creation is confined to the Virtual Namespaces view. Keep the existing Directus directory/list styling and behaviors; the former mock screen is not the target UI.

The global Users sidebar follows this hierarchy:

```text
Users
  All Users
  Virtual Namespaces
    Tracking
      Administrator
      Editor
      Viewer
    AAA
      Administrator
      Editor
Virtual Namespaces                   [management view]
```

- **All Users** displays each shared account once, including users without a local membership.
- Selecting a **namespace** lists its explicit members. Expanding it lazily loads roles belonging to that namespace; selecting a **role** filters the center list by that local assignment.
- Keep search, paging, existing supported layouts and directory tools. A global user's summary may show several namespace/role chips instead of one misleading primary role.
- Distinguish navigation expansion from filter selection with separate expand controls. Use stable namespace/role IDs, independent of names; bookmark/deep-link the filter without changing the active content namespace.
- Browsing this tree is a platform read. It does **not** mint a target content token, hydrate Content or trigger the namespace switcher. Only **Open/Enter namespace** invokes C2/C3/C4.
- The Users sidebar has no create-namespace action. C7's Virtual Namespaces view owns creation and refreshes the directory tree/switcher after readiness. Neither creation nor filtering automatically enters a namespace.
- Preserve Invite User and Create User actions. “Create User” is a clearer label for the screenshot's generic “Create Item”; final labels/icons are a UI choice.

The Virtual Namespaces view owns registry/readiness/create/error/reconciliation and explicit entry. Its list, row selection and supported contextual actions should use the original Directus patterns. Role creation is reached by entering the target; existing-user assignment is also available from a Global Admin's user profile, never as a role editor in the global sidebar. Older backend inventories in this design set predate namespace-management endpoints; check the current branch before treating a listed D06 gap as current.

## Existing user profile: Namespace Access

Keep the native Directus `directus_users` item route, profile fields, save controls, information sidebar and keyboard behavior. Add one **Namespace Access** relationship section in the form, visually following the existing Platformplus Teams relation in the reference screenshot. Render a compact native-style table/list with **Virtual Namespace** and **Role** columns. Each explicit membership appears once; the role is the local role in that namespace. Show inherited Global Admin access separately from explicit membership rows so a missing row does not look like loss of authority.

The only add action is **Add Existing**, matching the native relation pattern. It opens a native selector of existing ready virtual namespaces the Global Admin may manage, then presents only roles owned by the chosen namespace. There is no **Create New** namespace or role action in the profile. An existing row can change its role or remove that one membership using native relation controls and confirmation patterns. Removal never deletes the shared account or memberships in other namespaces. The backend must enforce role ownership, duplicates, last-admin/self-removal rules and authorization; disabled or unavailable operations should explain the missing contract rather than fabricate success. Refresh the table and directory filters after a successful change.

This relationship section is for Global Admin user editing, including their own record subject to the backend's self/last-admin guards. An ordinary user's self-profile may show memberships read-only, but self-service must not expose role assignment. The native profile route must remain editable for permitted personal fields; neither route should fall back to the child User Directory merely because a virtual namespace is active.

## Own profile and default landing namespace

Clicking the avatar opens the signed-in user's **native editable profile directly**, as in production. Global Admin may use the Global Users item route for their own record; a child user needs a namespace-safe self-profile route backed by an explicit permitted `/users/me` read/write contract. It must not expose shared user directory or global profile fields through a child token. Keep the existing native form and allowed actions rather than replacing it with a custom profile page.

Add **Default Virtual Namespace** as a personal profile field. It selects one existing, ready namespace the user may enter and use in the app; Global Admins may choose among ready children through inherited access. The signed-in user can change their own preference, and a Global Admin can change it on another user's profile. With exactly one eligible namespace, select and save it automatically so it remains the default if the user later gains another membership. With several and no valid saved preference, show the chooser at sign-in. With none, show the no-access state. Saving a preference changes the next initial landing, not the active namespace in the current tab; an explicit `?ns=` URL still takes precedence for that navigation. A revoked, deleted, unready or otherwise inaccessible saved choice must never grant access or silently expose `main` content: clear or ignore it and resolve to another sole eligible namespace or the chooser. The preference is stored and validated server-side so it survives login, refresh and devices. It is distinct from the current environment/fallback value returned as `GET /namespaces.default`.

Global Admins have inherited access without membership rows. A namespace member filter lists explicit memberships; show inherited Global Admin access separately as a banner or section. A local role filter means assignment to that role, not every account with effective inherited admin authority. This prevents an “Administrator” filter from silently mixing two different access sources.

## Create User and Invite User

Add a repeatable **Namespace access** section to each form:

| Virtual namespace | Local role |
| --- | --- |
| Tracking | Editor |
| AAA | Viewer |

Each selected namespace loads its own roles. No combined role list or role-name matching is allowed. Changing/removing a namespace clears its selected role and cancels/discards stale lookup results. Allow additional rows, prevent duplicate namespace selection, and validate `(namespace_id, role_id)` ownership on the server too. Do not offer a role from another namespace or a namespace still provisioning.

When launching from a namespace/role filter, prefill that initial assignment but show it explicitly; the admin can add other rows. The recommendation is to allow creating a global account with no initial memberships, then add access from its Global Admin profile or inside a target namespace later. Whether empty assignments are allowed is a product/API decision in D14, not an implemented rule. An empty namespace with no local roles directs the admin to enter it and create roles first; the global form must not create a role as a shortcut.

For invitation, the selected rows determine initial access for the invited account. Account creation/invitation and initial memberships need one coherent backend operation or explicit recoverable transaction semantics. Send the invitation only after memberships are committed. Existing-account emails must not create duplicates or silently change existing memberships: show the existing-account result and the local Add User path. Pending invitations, resend, batch invite and uniqueness/conflict behaviour require the D14 contract.

Global onboarding forms participate in the shared dirty/request lifecycle; capture their full namespace-role payload at submission so navigation or content switching cannot reinterpret it.

Show the result clearly: account/invitation status, successful initial assignments and any actionable errors. Do not retry an uncertain request blindly or report a failed profile read-back as a failed creation. A failed namespace role validation should not leave an undisclosed partially configured account.

## Local Add User

Inside a virtual namespace, a local admin selects **Add User** from the native User Directory, searches eligible existing shared accounts through the narrow lookup endpoint, and selects one of the active namespace's roles. The local directory never becomes the full shared directory. This picker creates a membership, not an account/invitation/global-profile change. Server lookup returns only agreed identity fields and validates eligibility/role ownership. Removing this assignment affects only this namespace.

## Membership model

A user has zero or many namespace memberships; a namespace has many users. Overall this is a **many-to-many** user↔namespace relationship through `(user_id, namespace_id, role_id)`, unique per user/namespace. The user-facing statement “one user → many namespaces” is correct. Each membership currently has **one** local role, e.g. Editor in Tracking and Viewer in AAA. Multiple roles within the same namespace are not introduced by this clarification.

Global filters query memberships rather than `directus_users.role`. Filter before pagination and return distinct users/counts; deduplicating a returned page in the browser produces incorrect counts/paging. Global filters must not leak through reused local-member query/state. Newly created roles/assignments invalidate the corresponding scoped role lists/member counts and global directory projections.

## Ownership and open dependency

- **C5:** global user directory/tree, native global user-profile membership section, global create/invite initial-assignment forms, local Members/roles and their strict operation boundaries.
- **C7:** global Administration rail entry, namespace-management view and its Create Namespace form/registry changes. Global user authority and namespace-management authority remain separate capability checks.
- **C3:** global directory filter URL and explicit entry; filter selection never becomes active content namespace selection.
- **C2/C4:** scoped state/request/access isolation and actual Enter transactions; global directory reads use explicit authorized projections, not content-token switching.
- **D14:** global directory namespace/role reads, distinct counts, per-user membership projection and cross-namespace role options for the profile, account/invite with initial memberships, cross-namespace role validation, no-membership accounts, existing/pending emails, transaction/idempotency and invitation-delivery ordering. Existing per-namespace membership writes do not by themselves provide the complete global profile read and onboarding contracts.
- **D10/default preference:** a namespace-safe self-profile read/write route and a persistent, server-validated preferred namespace field. The current `/namespaces.default` fallback is not this preference.

## Acceptance checks

- [ ] A Global Admin creates one account with Tracking Editor and AAA Viewer, using role options from each selected namespace; All Users shows it once and both filters show the correct membership.
- [ ] Invite has the same assignment controls; partial/invalid/uncertain results and existing emails never duplicate accounts or silently modify memberships.
- [ ] Changing a namespace row clears its role; stale lookup cannot select a role for another namespace.
- [ ] A local admin adds an existing user locally and cannot create/invite/edit a global profile or operate on another namespace.
- [ ] Global namespace/role filters preserve the active content token/context; Open namespace uses the real switch transaction.
- [ ] Global Admin can view, add, change and remove a user's explicit membership from the native user profile; local administrators remain confined to the target namespace. Namespace creation occurs only in C7 without implicit switching.
- [ ] The avatar opens the signed-in user's native editable profile. A saved eligible default bypasses the sign-in chooser; explicit deep links take precedence and an invalid preference grants no access.
- [ ] Inherited Global Admin access is labelled separately from explicit local role membership, and pagination/counts reflect the selected membership filter.

No application implementation, account creation, email sending or runtime verification is performed by this design update.
