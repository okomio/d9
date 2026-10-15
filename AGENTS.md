# AGENTS.md

## Preserve the native Directus UI

For changes to an existing frontend section, inspect the original Directus route,
components, modal, actions, and relevant interaction flow **before editing it**.
Tell the user what the existing UI does and list the smallest changes needed for
virtual namespace data, permissions, or navigation.

Keep the native page structure, components, modals, layouts, controls, styling,
keyboard behavior, and supported functionality. Implement namespace scoping in
the existing data and authorization paths wherever possible. Do not replace a
native page or modal with a custom version merely to add namespace support.

If a required operation cannot be supported safely by the current backend,
identify the missing contract and leave that operation incomplete. Do not hide
an existing capability or substitute a custom UI to conceal the gap. Review the
finished change against the original screen and explain every intentional UI
difference. A broader redesign requires an explicit user request.

## Before application or database work on `hackathon`: check the namespace migration

Documentation-only edits, including changes to this file and `RFD/`, may proceed
without a successful migration status check. This exception does not permit
application or database changes while the migration status is not `migrated`.

This branch expects the database to be split into virtual namespaces. Check first:

    cd api && node scripts/migrate-infrastructure.mjs --status

`--status` exits `0` **only** when the migration is done.

| status | meaning |
| --- | --- |
| `migrated` | carry on with your task |
| `not-ready` | the branch is newer than this database — the namespace migrations have not been applied |
| `needs-migration` | the areas are still in the shared `public` schema |
| `partial` | half-applied; it names what is missing |

If the status is anything but `migrated`: **stop.** Tell the human what `--status`
reported, agree the restore with them, and continue only once they say so — step 1
drops the current local database. Do not start other work on this branch until it
reports `migrated`.

    # 1. restore the Infrastructure instance (destroys the current local database)
    cd cms/directus-v9/development
    ./run.sh --apply-backup-from=<dumps>/infrastructure-<timestamp>.backup

    # 2. disable the flows that make external requests
    psql -h localhost -U directus -d directus -f api/scripts/flows-disabled.sql

    # 3. apply the namespace migrations
    cd api && npx tsc --build && node dist/cli/run.js database migrate:latest

    # 4. migrate
    node scripts/migrate-infrastructure.mjs --apply

Re-running is safe: the migration is idempotent. What it does and does not move:
`api/scripts/migrate-infrastructure.md`.
