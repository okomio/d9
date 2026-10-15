# Namespace-local user profiles

Status: Design proposal. Implementation is deferred.

## Summary

Keep shared identity in `directus_users`, and store app-specific attributes in a
`user_profiles` collection inside each virtual namespace.

```text
public.directus_users
  id, email, name, authentication fields

Tracking namespace → user_profiles
  id, user, team, tier

Platform_Plus namespace → user_profiles
  id, user, teams → local teams/junction collection
```

The existing namespace architecture already separates data schemas and field
metadata while sharing user accounts. Namespace-local profiles fit that model.

## Design

- Give each profile an `id` primary key and a required, unique `user` relation to
  `public.directus_users.id`. Directus supports this through an M2O relation with
  a uniqueness constraint. See the
  [Directus relationship documentation](https://docs.directus.io/app/data-model/relationships).
- Keep profile fields, relation metadata and junction tables inside their owning
  namespace. Preserve the existing fields' types and relationship cardinality.
- Tracking's profile holds `team` and `tier`, corresponding to the existing
  `tracking_team` and `tracking_tier` fields. Platform_Plus's profile holds `teams`,
  corresponding to `platformplus_teams`.
- Use the existing `/items/user_profiles` endpoint and Content editor. The active
  namespace selects the collection; its collection permissions govern access.
  Namespace admins can manage local attributes through these permissions without
  gaining authority to edit shared account fields.
- Profiles are optional. One shared account can have independent profiles in
  several namespaces, with at most one profile per account in each namespace.

## Compatibility and timing

- Adopt this pattern for new namespace-specific user attributes.
- Defer converting the existing fields until after the prototype, whose scope
  excludes data migration.
- Before converting existing fields, identify and update affected API consumers,
  permission rules, validation, presets and other configured references using
  paths such as `$CURRENT_USER.tracking_team`. Such references are supported by
  Directus and need explicit handling when fields move. See the
  [Directus filter documentation](https://docs.directus.io/reference/filter-rules).
- Changing existing user-field paths is acceptable. A transparent compatibility
  layer preserving those paths is outside this proposal.

## Proposed validation

- The same account can hold different profile values in two namespaces.
- Profile data, fields and relations are visible only in the owning namespace.
- Duplicate profiles for one user in one namespace are rejected.
- Editing a profile leaves the shared account intact.
- An absent profile does not prevent login or namespace access otherwise allowed
  by membership and permissions.
- Local profile editing follows the active namespace's collection permissions.

## Assumptions

- Shared accounts retain their existing identity and authentication lifecycle.
- Namespace-local profiles are preferred over transparent extensions to `/users`.
- This document records a follow-up design; it does not authorize implementation
  or conversion of existing records.
