# AGENTS.md

## Before any work on `hackathon`: check the namespace migration

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
