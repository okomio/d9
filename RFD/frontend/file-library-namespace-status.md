# Native File Library in virtual namespaces

The existing `/files` module, collection and item routes, layouts, navigation, upload dialog, folder picker, preview,
image editor, metadata form and action controls remain in use. The module is registered in a virtual namespace when the
caller has effective admin access or `directus_files` read permission. Its existing file and folder requests keep their
Directus paths.

## Ownership contract

- `directus_files` and `directus_folders` remain shared tables with a `namespace` owner. Migration `20261016A` assigns
  all existing rows to `main`. It does not guess an area from folder names or historical uploaders. If historical files
  should move to a child, their exact IDs need a reviewed data mapping.
- File and folder list, detail, search, and count reads use the active namespace. Anonymous file and folder reads use
  `main`. Creates are stamped with the active namespace. Direct and batch updates and deletes check every target ID;
  folder and parent references must belong to the same namespace. These checks run in the services, including nested and
  alternate transport writes.
- An instance-wide default storage folder is used only when it belongs to the active namespace. Child uploads otherwise
  go to that child's File Library root.
- `/assets/:id` now resolves the authenticated namespace and checks file ownership before streaming bytes or a
  thumbnail. Anonymous asset requests can access only main-owned files, except the existing public
  project-logo/background assets. Explicit asset tokens take precedence over a cookie from another tab. Browser media
  and download links from the native UI use a five-minute grant for one file and its exact requested asset URL. The grant
  is minted with the active namespace's Authorization header, carries no role or admin privilege, and is accepted only
  for that asset GET; access and namespace ownership are checked again when it is used. Axios image requests continue
  to use the Authorization header. Grant responses are private and non-cacheable, with a no-referrer policy; application
  HTTP logs redact the grant query parameter. Reverse-proxy access logs still need their own query redaction policy.
  Asset responses vary on Authorization and Cookie so a browser cache cannot reuse one tab's response for another tab's
  credentials.

Apply the database migration before running this API build with virtual namespaces enabled. The migration and ownership
checks were exercised in a separate temporary PostgreSQL database, which was removed afterward.
