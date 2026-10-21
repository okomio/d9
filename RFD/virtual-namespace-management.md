# Virtual namespace management contract

Global Administrators manage virtual namespaces through the existing Global Administration page. `POST /namespaces`
accepts a display `name` and a UUID `Idempotency-Key` header. The server assigns an immutable random registry ID and a
physical schema name, creates only namespace-owned Directus system tables, and returns the ready registry record. No
area collections, area data, roles, or memberships are copied. PostgreSQL DDL and registry updates share one
transaction, so a failed create is rolled back. A retry with the same request key returns the same namespace.

`PATCH /namespaces/:id` accepts only `name`. `DELETE /namespaces/:id` checks the database again inside a transaction. It
refuses deletion when the schema has user tables or any system-table rows, or when shared memberships, roles,
permissions, activity, revisions, files, or folders belong to the namespace. It locks the checked tables through removal
and uses restrictive drops so additional database objects cannot be silently removed. A Global Administrator can enter a
new namespace without a local membership; local namespace administrators cannot use these control-plane mutations.

The `20261019A` migration adds the request key to `directus_namespaces`. Apply that migration before serving these
endpoints. File Library PR #12 adds a `namespace` column to shared `directus_files` and `directus_folders`; deletion
checks those columns when present. Until that migration is present, the existing File Library contract has no
child-namespace ownership field. This branch does not merge or change File Library behavior.
