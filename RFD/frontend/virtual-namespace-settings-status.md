# Virtual namespace Settings integration status

This slice starts at `codex/frontend-switch-foundation` (`8b6cbe818`). It preserves the native Settings module and uses the foundation's active namespace token, effective access, full reload on switch, and store reset. It does not introduce another switch mechanism.

## Supported in the current frontend/backend pair

| Section | Current behavior |
| --- | --- |
| Data Model | The existing collection, field and relation screens operate in the selected schema through the scoped token. Child routes for the backend's shared control-plane tables are blocked before their write-capable view runs; local collections, including namespace-owned system tables, remain available. Backend D11 isolation and cross-namespace relation checks still need integration verification. |
| Roles & Permissions | The native editor uses the selected namespace's `/roles` and `/permissions`. Child role counts come from `/namespaces/:id/members` `role_counts`, not `directus_roles.users` (the shared main-role relation). The child editor shows its namespace as read only, lists local role members and offers Add Existing through the membership API, without creating or inviting a shared user. Role deletion removes local memberships and refuses cross-namespace roles, shared main-role assignments and removal of the last local admin role or member. The public role editor remains unavailable. New-role and recommended-reset defaults omit shared user/file/folder/settings/share grants; those permission rows and direct editor URLs are unavailable in a child pending backend policy. |
| Presets & Bookmarks | The native screens remain mounted and use the active token. Admin checks use effective namespace admin access, including inherited Global Admin. |
| Flows & Webhooks | The native screens remain mounted; requests use the active namespace token. Their tables are in the namespace schema. The foundation clears the flow store when switching, and its request ledger keeps submitted writes in their original context. |
| Project Settings | The native route remains visible. Local child admins see a contract notice instead of the shared form; only effective platform settings authority can view and submit that form. |
| Translation Strings | The native list remains visible. Local child admins cannot open its editor or submit updates, which currently write `directus_settings.translation_strings`. Global Admin keeps the existing editor. |

## Backend contracts still required

- **D09 Project Settings:** `directus_settings` is a single shared control-plane row. The backend currently lets local child admins read the whole settings object but blocks their `/settings` writes. Define field ownership, a safe readable projection, and per-field edit authority before local Project Settings viewing/editing can be enabled. Hiding the form does not make the broad `/settings` read safe; the backend must enforce the projection. Distinct per-namespace branding is optional C6; the existing Project Settings capability is not.
- **D09 Translation Strings:** custom strings also live in the shared settings row. Define whether they stay global or become namespace-owned, their read projection, edit authority, and locale reset behavior. Until then, child admins can read the existing strings but cannot edit them; translation of local collection/field metadata continues through scoped metadata.
- **D05 local roles:** The child role editor now reads and assigns users through `/namespaces/:id/members` and the existing-user lookup. Deletion removes local memberships without suspending shared users. Broader user creation and invitation remain part of the global directory work.
- **D04/D07/D09 permission grants:** the UI withholds child role grants for shared users, files/folders, settings and other control-plane resources whose child access policy is unresolved. Direct API calls and existing permissions still require server-side ownership and authorization checks; the UI cannot enforce that boundary. Inherited Global Admin without a child role also depends on the backend returning effective `can_use_app` correctly.
- **D08 public permissions:** no namespace-safe public/share resolution contract is established. The public role editor is unavailable in a child until this is defined.
- **D07/D09 shared defaults:** the ordinary new-role preset grants broad shared Files, Folders, Users and Shares rights. Child role creation excludes those grants until ownership, ACL and profile policies are agreed. This does not close the full Files capability.
- **D11 isolation:** verify collection/field/relation changes against two schemas, reject cross-namespace relations, and bind manual flow execution and asynchronous jobs to their originating namespace. Frontend token scoping alone does not prove background work isolation.

This slice does not claim the complete Settings capability. The D09 readable projection, local Settings writes, public permissions and D11 end-to-end verification remain backend-dependent.
