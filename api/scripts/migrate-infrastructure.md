# Infrastructure → virtual namespaces

One-way. Moves each area's tables out of the shared `public` schema and into its
own virtual namespace, so the areas stop sharing one schema. Idempotent — wiping
the database and running it again is the normal loop.

    node scripts/migrate-infrastructure.mjs            dry run, changes nothing
    node scripts/migrate-infrastructure.mjs --apply    performs the migration
    node scripts/migrate-infrastructure.mjs --verify   lists anything still in public
    node scripts/migrate-infrastructure.mjs --status   says whether this database needs the
                                                       migration; exit 0 only when it does not

Run from `api/`. Connection settings come from the environment, defaulting to the
local stack.

## How to run it

1. Restore the Infrastructure instance to be transformed. The migration reads
   `public` as its source:

       cd cms/directus-v9/development
       ./run.sh --apply-backup-from=…/infrastructure-<timestamp>.backup

2. Build and apply the namespace migrations. The registry table, the `namespace`
   columns and the membership table come from there:

       cd api
       npx tsc --build
       node dist/cli/run.js database migrate:latest

3. Read the dry run before applying.

       node scripts/migrate-infrastructure.mjs

   It prints every table, metadata row and role it would move, the memberships it
   would create, the foreign keys crossing two areas, and a blockers list.

4. Apply.

       node scripts/migrate-infrastructure.mjs --apply

## What it does

For each area (AAA, Tracking, Scraper, Platform_Plus, Translations, SRE, Test):

- corrects two groupings first: `collector_event_validation_config_tracking_events`
  → Tracking, and `hooks_Features` → Platform_Plus;
- registers the namespace (`ns_<id>`, kind `virtual`) and creates its schema plus
  the system tables it owns;
- moves the area's tables with `ALTER TABLE … SET SCHEMA` — data, indexes,
  sequences and constraints come along, and owned sequences follow the table so
  nothing keeps drawing from `public`;
- moves the `directus_collections`, `directus_fields` and `directus_relations`
  rows into that namespace **and deletes them from `public`**. Without the delete,
  `main` and every other namespace keep serving the area;
- sets each role's `namespace`, and derives memberships from the role users
  already hold. Nothing new is granted: the same authority is expressed per
  namespace.

## What it does not do

- **`tracking_teams` and `tracking_tiers` stay in `public`.** `directus_users`
  holds foreign keys into both, and the shared user table must not depend on a
  namespace.
- **Flows, operations and webhooks are not moved** — they stay in `main`. The
  externally-calling ones are disabled in `flows-disabled.sql`.
- **Foreign keys are not rewritten.** An area's tables keep their constraints into
  `public` (`directus_users`, `directus_files`), which still resolve because
  `public` is in every namespace's `search_path`.

The role → namespace map, the two excluded tables and the grouping corrections are
constants in `src/virtual-namespace/migrate-infrastructure.ts`.
