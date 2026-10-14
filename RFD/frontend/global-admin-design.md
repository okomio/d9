# Global administration — users, namespaces and onboarding

This product clarification updates C5/C7. It defines the requested privileges and a recommended frontend arrangement; wire contracts and implementation remain pending. The screenshots show the current directory, not an existing namespace-aware interface.

## Privileges and where operations happen

| Operation | Global Admin | Virtual Namespace Admin | Location |
| --- | --- | --- | --- |
| Create virtual namespace | Yes | No | Global Administration; namespace-management view or its shared create form |
| Create/edit local roles | Yes, after entering target | Own namespace only | Target Settings → Roles & Permissions |
| Add existing user / change or remove local assignment | Yes, after entering target | Own namespace only | Target Users/Members → Add User / assignment editor |
| Create shared user / invite new user | Yes | No | Global Users; select initial namespace/role assignments |
| Edit global user profile | Yes | No | Global Users |
| Browse users grouped by namespace/local role | Yes, across namespaces | Local members only | Global Users filters versus local Members |

Creating/inviting an account with initial memberships is the explicit exception to local-only assignment workflows. General additions of existing users and subsequent local-role changes remain inside the virtual namespace. The global user editor shows memberships and **Open namespace** links; it does not introduce an unrestricted second membership editor. This interpretation reconciles the user's two requirements and should be retained unless product scope explicitly expands.

Global Admin authority continues to inherit from main-namespace admin access. It remains separate from any child role's `admin_access` flag. Global profile/account operations and directory visibility retain platform/main authority even when the active content namespace is a child.

## Recommended frontend

Use one Global Administration area with **Users** and **Virtual Namespaces** views. Their routes/capabilities stay distinct, but they share navigation and a reusable namespace-create form. This retains C7's dedicated management view while providing the directory shortcut requested by the user.

The global Users sidebar follows this hierarchy:

```text
Users
  All Users
  Virtual Namespaces                 [+ Create namespace]
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
- The sidebar **Create namespace** action opens C7's reusable form, returns to the current filter, and refreshes the directory tree/switcher after readiness. Provisioning remains on the namespace-management view. Neither creation nor filtering automatically enters a namespace.
- Preserve Invite User and Create User actions. “Create User” is a clearer label for the screenshot's generic “Create Item”; final labels/icons are a UI choice.

The Virtual Namespaces view owns registry/readiness/create/error/reconciliation and explicit entry. Role creation and existing-user addition are reached by entering the target, not by adding role editors to the global sidebar.

Global Admins have inherited access without membership rows. A namespace member filter lists explicit memberships; show inherited Global Admin access separately as a banner or section. A local role filter means assignment to that role, not every account with effective inherited admin authority. This prevents an “Administrator” filter from silently mixing two different access sources.

## Create User and Invite User

Add a repeatable **Namespace access** section to each form:

| Virtual namespace | Local role |
| --- | --- |
| Tracking | Editor |
| AAA | Viewer |

Each selected namespace loads its own roles. No combined role list or role-name matching is allowed. Changing/removing a namespace clears its selected role and cancels/discards stale lookup results. Allow additional rows, prevent duplicate namespace selection, and validate `(namespace_id, role_id)` ownership on the server too. Do not offer a role from another namespace or a namespace still provisioning.

When launching from a namespace/role filter, prefill that initial assignment but show it explicitly; the admin can add other rows. The recommendation is to allow creating a global account with no initial memberships, then add it locally later. Whether empty assignments are allowed is a product/API decision in D14, not an implemented rule. An empty namespace with no local roles directs the admin to enter it and create roles first; the global form must not create a role as a shortcut.

For invitation, the selected rows determine initial access for the invited account. Account creation/invitation and initial memberships need one coherent backend operation or explicit recoverable transaction semantics. Send the invitation only after memberships are committed. Existing-account emails must not create duplicates or silently change existing memberships: show the existing-account result and the local Add User path. Pending invitations, resend, batch invite and uniqueness/conflict behaviour require the D14 contract.

Global onboarding forms participate in the shared dirty/request lifecycle; capture their full namespace-role payload at submission so navigation or content switching cannot reinterpret it.

Show the result clearly: account/invitation status, successful initial assignments and any actionable errors. Do not retry an uncertain request blindly or report a failed profile read-back as a failed creation. A failed namespace role validation should not leave an undisclosed partially configured account.

## Local Add User

Inside a virtual namespace, a local admin selects **Add User**, searches eligible existing accounts in the main namespace's shared directory, and selects one of the active namespace's roles. The local member list never becomes the full shared directory. This picker creates a membership, not an account/invitation/global-profile change. Server lookup returns only agreed identity fields and validates eligibility/role ownership. Removing this assignment affects only this namespace.

## Membership model

A user has zero or many namespace memberships; a namespace has many users. Overall this is a **many-to-many** user↔namespace relationship through `(user_id, namespace_id, role_id)`, unique per user/namespace. The user-facing statement “one user → many namespaces” is correct. Each membership currently has **one** local role, e.g. Editor in Tracking and Viewer in AAA. Multiple roles within the same namespace are not introduced by this clarification.

Global filters query memberships rather than `directus_users.role`. Filter before pagination and return distinct users/counts; deduplicating a returned page in the browser produces incorrect counts/paging. Global filters must not leak through reused local-member query/state. Newly created roles/assignments invalidate the corresponding scoped role lists/member counts and global directory projections.

## Ownership and open dependency

- **C5:** global user directory/tree, global create/invite initial-assignment forms, local Members/roles and their strict operation boundaries.
- **C7:** global Administration entry/namespace-management view and reusable Create namespace form/registry changes. Global user authority and namespace-management authority remain separate capability checks.
- **C3:** global directory filter URL and explicit entry; filter selection never becomes active content namespace selection.
- **C2/C4:** scoped state/request/access isolation and actual Enter transactions; global directory reads use explicit authorized projections, not content-token switching.
- **D14:** global directory namespace/role reads, distinct counts, account/invite with initial memberships, cross-namespace role validation, no-membership accounts, existing/pending emails, transaction/idempotency and invitation-delivery ordering. Endpoint inventory's current single-role invite/create operations do not provide this contract.

## Acceptance checks

- [ ] A Global Admin creates one account with Tracking Editor and AAA Viewer, using role options from each selected namespace; All Users shows it once and both filters show the correct membership.
- [ ] Invite has the same assignment controls; partial/invalid/uncertain results and existing emails never duplicate accounts or silently modify memberships.
- [ ] Changing a namespace row clears its role; stale lookup cannot select a role for another namespace.
- [ ] A local admin adds an existing user locally and cannot create/invite/edit a global profile or operate on another namespace.
- [ ] Global namespace/role filters preserve the active content token/context; Open namespace uses the real switch transaction.
- [ ] Global role creation and later membership edits occur in the target namespace; sidebar create reuses C7 without implicit switching.
- [ ] Inherited Global Admin access is labelled separately from explicit local role membership, and pagination/counts reflect the selected membership filter.

No application implementation, account creation, email sending or runtime verification is performed by this design update.
