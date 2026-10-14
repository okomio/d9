# T1 — Existing API endpoint inventory and contract

Source baseline for the virtual namespace prototype. This document describes current behavior; namespace classifications describe the intended architecture, not isolation already implemented.

## 1. Provenance and coverage

| Property | Inspected value |
| --- | --- |
| Inspection date | 2026-10-14 |
| Branch | `hackathon` |
| Commit | `1c2506b2464bb3384fc37ce344dee33a71863559` |
| Distribution version | `directus/package.json`: `12.0.7` |
| API package version | `api/package.json`: `12.4.5` |
| Base-tag verification | `v12.0.7` is unavailable locally. Package version alone does not prove equivalence to the deployed image. |
| Explicit controller routes | 181 method/path registrations in 26 REST controllers; includes 17 `SEARCH` registrations |
| Other built-in API mounts | GraphQL: two router mounts, each accepting GET and POST |
| Total built-in route mounts | 27 in `api/src/app.ts` |
| Additional surfaces | App-level routes, conditional auth-driver routes, static admin assets, extension endpoints and initialization hooks |
| Bundled OpenAPI | 65 path templates, 107 operations; not a complete route inventory |
| Verification level | Source inspection and route reconciliation; no running instance queried |

Source precedence: [route mounting](api/src/app.ts) → controllers → middleware and services → system definitions/types → bundled specifications and reference documentation. Counts describe registrations, not deployed URLs or collection-specific endpoints. Auth providers, collection names, extension IDs and flow IDs are runtime-dependent.

Paths below are relative to the API base URL. The controller inventory in section 7 lists every explicit method/path with its source line and contract profile. `:pk`, `:collection`, and `:field` are path parameters. `?` denotes an optional segment; `:pk(${UUID_REGEX})` denotes the actual router constraint, a lowercase hexadecimal UUID pattern defined in [constants.ts](api/src/constants.ts).

## 2. Shared request, authorization and response contracts

### Request pipeline and authentication

[app.ts](api/src/app.ts) installs JSON parsing and cookie parsing, then token extraction. Root, robots, admin serving and `/server/ping` precede authentication. The remaining built-in API routes run through authentication → IP checks → query sanitization → response cache → schema middleware → permission loading. Rate limiting is configurable; ping passes the configured limiters, while root/robots/admin handlers precede them. An invalid supplied token can fail even a route whose own handler permits anonymous access.

[extract-token.ts](api/src/middleware/extract-token.ts) applies this precedence:

1. Query parameter `access_token` supplies an initial token.
2. A validly structured `Authorization: Bearer <token>` replaces it; the Bearer scheme is case-insensitive.
3. For **GET requests under `/assets/` only**, the configured access-token cookie replaces either value. Cookie authentication is not generally applied to REST or GraphQL. HEAD assets do not meet this cookie condition.

[authenticate.ts](api/src/middleware/authenticate.ts) distinguishes:

| Identity | Current resolution |
| --- | --- |
| No token | Public accountability: no user/role; permissions whose role is null |
| Directus JWT | Verify signature/expiry; require an unexpired session with the JWT's `session_id`; use JWT role, admin/app flags and optional user/share claims |
| Static API token | Find an active user by `directus_users.token`; join `directus_users.role` to `directus_roles` for admin/app flags |
| Authentication extension | The `authenticate` filter can supply custom accountability |

Core login JWT claims include `id`, `role`, `app_access`, `admin_access`, `session_id`, issuer and expiry. The `auth.jwt` filter can customize them. Refresh reloads the user/role or share context, rotates the refresh token with overlap/fallback handling, and retains session identity. Login/refresh `expires` is a duration in **milliseconds**, not an absolute timestamp. Defaults are a 15-minute access token and 7-day refresh token; environment settings override them. See [authentication service](api/src/services/authentication.ts), [JWT helpers](api/src/utils/jwt.ts), [cookie settings](api/src/constants.ts), and [environment defaults](api/src/env.ts).

Authorization is collection/action/field/row based. Public permissions, app minimum permissions and share restrictions affect results. Current admin access is an instance-level role flag; there is no core namespace membership lookup, namespace header, default-namespace fallback or switch endpoint. See [permission resolution](api/src/utils/get-permissions.ts), [authorization service](api/src/services/authorization.ts), and [Items service](api/src/services/items.ts). An ordinary route's ACL depends on its configured system/domain permissions; a route mount alone does not require a logged-in user.

### Queries, payloads and envelopes

JSON bodies use `application/json`, subject to `MAX_PAYLOAD_SIZE`. Multipart and URL-encoded exceptions are described below. Query parsing uses `qs` with depth/array/parameter limits; filtering accepts nested query syntax and JSON strings. Supported common options are:

| Option | Contract |
| --- | --- |
| `fields` | Comma-separated or array field selection; global middleware defaults to `*`; relational selections remain permission-filtered |
| `filter`, `search` | Structured filter/JSON string and textual search; dynamic variables include `$CURRENT_USER`, `$CURRENT_ROLE`, `$NOW` |
| `sort` | Comma-separated or array sort fields; `-field` for descending |
| `limit`, `offset`, `page` | Numeric pagination; ordinary item queries default to 100 records when limit is absent. Validation accepts integer limit ≥ -1 and nonnegative offset/page; configured maximum limits apply; `limit=-1` requests no limit unless capped |
| `meta` | `total_count`, `filter_count`, or `*`; applicable list handlers populate the `meta` envelope |
| `deep`, `alias` | Nested relation query options and field aliases, including JSON-string input; validation restricts aliases and relational depth |
| `aggregate`, `groupBy` | Aggregations and grouping; `groupBy` becomes the internal `group` query option |
| `export` | `json`, `csv`, `xml`, `yaml`; the shared responder returns a download of payload data instead of its normal envelope |

These options are parsed globally, but metadata and specialized handlers do not necessarily apply them. A `SEARCH` body containing `query` replaces the sanitized URL query; it does not merge with it or automatically preserve the URL's default field selection. See [sanitizer](api/src/utils/sanitize-query.ts), [query validation](api/src/utils/validate-query.ts), [batch validation](api/src/middleware/validate-batch.ts), [query execution](api/src/database/run-ast.ts), and [meta service](api/src/services/meta.ts).

The profiles used in the route inventory are:

| Profile | Request and ordinary success response |
| --- | --- |
| `list` | GET with query options → 200 `{ data: [...], meta?: ... }`; the family notes specify omitted meta or singleton behavior |
| `search` | SEARCH JSON `{ keys?: [string-or-number], query?: {...} }` → list response; family notes identify handlers that ignore keys or query |
| `detail` | GET by path key, with query selection where used → 200 `{ data: record-or-null }` |
| `create` | POST record or record array → 200 `{ data: record }` or `{ data: [...] }` matching input cardinality |
| `update` | PATCH one record → 200 `{ data: record-or-null }` |
| `batch-update` | PATCH an array of records with primary keys, `{ keys: [...], data: {...} }`, or `{ query: {...}, data: {...} }` → 200 `{ data: [...] }` |
| `delete` | DELETE a path key → 204, empty body |
| `batch-delete` | DELETE key array, `{ keys: [...] }`, or `{ query: {...} }` → 204, empty body |
| Named special profile | Contract in section 3, 4 or 5; do not infer ordinary CRUD behavior |

Batch update/delete validation requires exactly one of `keys`/`query` for object payloads and requires `data` for updates. Arrays bypass that object validation. DELETE collection handlers for dashboards, flows, operations, panels, shares and webhooks omit `validateBatch('delete')` despite dispatching these same forms; invalid-body behavior must not be assumed identical to validated families.

Many create/update handlers catch a **read-back** `ForbiddenException` after a successful write and produce **204** instead of returned data. This does not mean the write failed. There is no general 201 response. Detail reads often conceal missing/inaccessible records with 403 rather than promise a 404. Sources: family controllers and [respond.ts](api/src/middleware/respond.ts).

JSON responses normally use `{ data }`, optionally a sibling `meta`. List handlers with meta support omit it when no meta was requested; assigning an undefined meta value does not serialize a key. Exceptions include raw OpenAPI, GraphQL results, health payloads, auth-provider discovery's sibling `disableDefault`, flow output, downloads and streams. The shared responder returns 204 when no truthy payload is set; this also affects falsy flow output. It sets `Cache-Control: no-cache` by default or configured cache headers for cacheable reads, and `Vary: Origin, Cache-Control`. Auth responses are excluded from shared response caching; mutations and GraphQL errors disable it. Direct handlers have their own header behavior.

### Errors and implicit HTTP behavior

[error-handler.ts](api/src/middleware/error-handler.ts) serializes errors as `{ errors: [{ message, extensions: { code, ... } }] }`. Development responses can include stacks; unexpected errors expose their message to admins and a generic message to others. The `request.error` extension filter can alter errors. Relevant codes include:

| Status | Code / circumstance |
| --- | --- |
| 400 | `INVALID_PAYLOAD`, `INVALID_QUERY`, `FAILED_VALIDATION`, `GRAPHQL_VALIDATION_EXCEPTION`; malformed JSON, invalid parameters/payloads or GraphQL schema validation |
| 401 | `INVALID_CREDENTIALS`; invalid user/static token/session credentials |
| 403 | `FORBIDDEN`, `INVALID_TOKEN`; inaccessible or nonexistent collections/records, invalid token contexts |
| 404 | `ROUTE_NOT_FOUND`; unmatched route or unsupported singleton mutation route |
| 405 | `METHOD_NOT_ALLOWED`; GraphQL method/operation mismatch, with `Allow` header |
| 415 | `UNSUPPORTED_MEDIA_TYPE`; unsupported import/diff content type |
| 416 | `RANGE_NOT_SATISFIABLE`; invalid asset range |
| 422 | `UNPROCESSABLE_ENTITY`; e.g. removing the last admin role/user |
| 429 | Configured rate-limit failures |
| 500 | `INTERNAL_SERVER_ERROR`; unexpected failures |

This is a representative error list; service/driver-specific validation, constraints and authentication errors also apply. See [exceptions](api/src/exceptions) and [shared exceptions](packages/exceptions/src).

Express supplies HEAD handling for GET registrations and route-derived OPTIONS behavior. GraphQL's explicit method check rejects HEAD with 405. The assets handler has a HEAD branch returning headers without a body. With CORS enabled, preflight is handled by [cors.ts](api/src/middleware/cors.ts); the default method list is `GET,POST,PATCH,DELETE`, so browser SEARCH requests require a suitable `CORS_METHODS` configuration. Do not count these implicit methods as explicit registrations or assume every wrong REST method returns 405; the final fallback is the not-found handler.

## 3. REST family details and exceptions

Record fields depend on system definitions, schema and permissions. For system resources, use [system field definitions](api/src/database/system-data/fields), [system collection definitions](api/src/database/system-data/collections/collections.yaml), and the corresponding [component descriptions](packages/specs/src/components) as field references. Specifications are supporting descriptions, not guaranteed exact schemas. Domain collection fields, defaults, relations and primary-key types cannot be enumerated from this source checkout alone.

### Items and metadata

| Family | Current contract and authorization |
| --- | --- |
| Items | Ordinary profiles apply to `/items/:collection` and `/:pk`; collection existence is checked against the request schema. Nonexistent collections produce 403. Collection GET/SEARCH of a singleton returns an object; collection PATCH upserts it using an ordinary record body. Singleton POST and key PATCH explicitly return 404. Key GET and DELETE have no equivalent singleton guard in the controller; do not assume them unsupported. |
| System Items exception | Collection GET/SEARCH allows `directus_collections` through the normal Items service. Other `directus_*` collection reads, all system key reads and all system Items writes are forbidden. This exception is specific to this fork. |
| Collections | GET/SEARCH list metadata, including system collections merged from code; SEARCH supports keys but its body query does not drive the collection read, and meta is calculated with an empty query (omitted). POST accepts a collection definition or array (`collection`, optional `meta`, `schema`, `fields`); PATCH root uses an array of collection definitions, not the generic `{ keys, data }` form. Key PATCH updates metadata; key DELETE drops the collection. Writes require current admin access; reads are permission-filtered. No root DELETE. |
| Fields | GET all/by collection/by collection+field returns field metadata/schema. POST to a collection requires `field`, with optional supported `type`, `schema`, `meta`. PATCH collection requires an array of field definitions; PATCH field accepts its definition and requires `type` when `schema` is supplied. DELETE addresses collection+field. Writes require admin access; reads are permission-filtered. These are specialized metadata operations, not ordinary list queries. |
| Relations | GET all/by collection/by collection+field returns relation definitions. POST requires `collection`, `field`, with optional `related_collection`, `schema`, `meta`; PATCH and DELETE address collection+field. Relation schema supports `on_delete`. Writes require admin access; reads are permission-filtered. `/relations/:collection` is a collection lookup, not a relation ID lookup. |
| Schema | GET `/snapshot` → 200 `{ data: snapshot }` (collections, fields, relations and version/vendor information). POST `/diff` accepts a snapshot as JSON or one multipart JSON/YAML file; presence of `force` query bypasses version/vendor matching. Returns `{ data: { hash, diff } }`, or 204 when no difference exists. POST `/apply` accepts `{ hash, diff }`, checks against the current snapshot, applies the diff and returns 204. All require admin access. |

Sources: [Items](api/src/controllers/items.ts), [collection check](api/src/middleware/collection-exists.ts), [Collections](api/src/controllers/collections.ts)/[service](api/src/services/collections.ts), [Fields](api/src/controllers/fields.ts)/[service](api/src/services/fields.ts), [Relations](api/src/controllers/relations.ts)/[service](api/src/services/relations.ts), [Schema](api/src/controllers/schema.ts)/[service](api/src/services/schema.ts). System metadata is merged at runtime; the database table alone is not its complete inventory.

### System CRUD resources

Dashboards, flows, folders, notifications, operations, panels, permissions, presets, roles and webhooks expose the eight ordinary profiles. Shares and users also expose these profiles with special routes; files modify creation/upload behavior. ACL applies to the corresponding `directus_*` collection/action; do not label all system writes admin-only without checking permissions.

| Families | List/SEARCH behavior and other differences |
| --- | --- |
| Folders, notifications, permissions, presets, files | SEARCH `keys` selects records; URL/body query applies; list responses include meta |
| Dashboards, flows, operations, panels, roles, webhooks | SEARCH is validated and its body query applies, but the handler ignores `keys`; list responses include meta |
| Users | SEARCH body query applies but keys are ignored; list response includes meta; read/update behavior has user service checks |
| Shares | SEARCH body query applies but keys are ignored; list response has `{ data }` with no meta |
| Activity | GET/SEARCH/detail reads; SEARCH supports keys and query; list includes meta. Writes exist only under `/comment` and `/comment/:pk` |
| Revisions | GET/SEARCH/detail only; SEARCH body query applies but keys are ignored; list includes meta. Revert is under `/utils/revert/:revision` |
| Permissions | App-access reads can append synthetic minimum permissions; results are not purely rows from the table. No dedicated `/permissions/me` handler |
| Roles/users | Last-admin safeguards apply. Deleting a role also removes permissions/presets and suspends remaining users in it. `users.role` is currently a writable ordinary relation, not a namespace membership |
| Flows/operations/webhooks | Writes reload the relevant runtime manager/hooks; metadata changes can affect executable behavior |
| Notifications | Creation can send email; not just a stored record |
| Settings | Singleton GET/PATCH only: PATCH upserts a settings record and reads it back with query selection; configured ACL applies |

Source references for every family appear in section 7. Additional behavior: [roles service](api/src/services/roles.ts), [users service](api/src/services/users.ts), [permissions service](api/src/services/permissions.ts), [notifications service](api/src/services/notifications.ts), [flows service](api/src/services/flows.ts), [operations service](api/src/services/operations.ts), and [webhooks service](api/src/services/webhooks.ts).

### Specialized REST contracts

Named profiles below are used for nonstandard routes in section 7. Responses are ordinary successful outcomes; the shared error rules and middleware still apply.

| Profile | Inputs / purpose | Response and access |
| --- | --- | --- |
| `auth-providers` | GET `/auth` | 200 `{ data: providers, disableDefault }`; no handler login requirement; configured providers/default availability |
| `auth-refresh` | POST `/auth/refresh`; body `refresh_token` or refresh cookie; optional `mode` | 200 `{ data: { access_token, expires, refresh_token? } }`; requires a valid refresh token. Body token defaults mode to JSON, otherwise cookie. Cookie mode sets access/refresh cookies and omits refresh token in JSON |
| `auth-logout` | POST `/auth/logout`; body `refresh_token` or refresh cookie | Clears present auth cookies; 204. Missing token is 400; unknown token is a no-op. For a matched user session, calls provider logout and deletes token/fallback-related session rows; this service does not match share-only sessions through its user join |
| `password-request` | POST `/auth/password/request`; required string `email`, optional `reset_url` | 204; does not require login; most delivery/lookup errors are concealed, while invalid payload errors propagate; reset URL allow-list applies |
| `password-reset` | POST `/auth/password/reset`; required string `token`, `password` | 204; valid password-reset token and password policy required |
| `comment-create` | POST `/activity/comment`; `comment`, `collection`, numeric/string `item` | 200 `{ data: activity }` or read-back 204; activity create ACL; mentions can generate notifications |
| `comment-update` | PATCH `/activity/comment/:pk`; required `comment` | 200 `{ data: activity }` or read-back 204; activity update ACL |
| `comment-delete` | DELETE `/activity/comment/:pk` | 204; record must have comment action and activity delete ACL |
| `files-create` | POST `/files`; single JSON metadata record or multipart file(s) | Single file → 200 object; multiple uploaded files → array; read-back may yield 204. Multipart metadata must precede file parts. Filename required, metadata resets between files; file create/upload ACL |
| `files-import` | POST `/files/import`; required `url`, optional metadata `data` | Imports one remote file → 200 `{ data: file }` or read-back 204; file create ACL and import/storage restrictions |
| `files-update` | PATCH `/files/:pk`; JSON metadata or multipart replacement | 200 `{ data: file }` or read-back 204; file update ACL. Root PATCH retains ordinary batch updates, without multipart handler |
| `asset` | GET `/assets/:pk/:filename?`; `download`, optional transformation query and Range header | Streams bytes (200/206), not JSON; file read authorization. Optional filename controls presentation; key is truncated to first 36 characters. Headers include file Content-Type/Length, Accept-Ranges, optional Content-Range/Last-Modified and Content-Disposition |
| `flow-trigger` | GET/POST `/flows/trigger/:pk`; UUID constraint, arbitrary query/body | Raw configured flow output through shared responder (200 or 204 for falsy/no output); requires a matching registered method+flow trigger, otherwise 403. Execution accountability is configured by the flow; do not infer admin-only or ordinary flow CRUD ACL |
| `extensions-list` | GET `/extensions/:type`; recognized singular/plural extension type | 200 `{ data: extension-list }`; no handler login requirement; supported types defined in constants |
| `extensions-source` | GET `/extensions/sources/:chunk` | JavaScript bytes with Content-Type and configured cache headers, or 404; registered app extension chunk required |
| `user-me` | GET `/users/me` | 200 current-user record; falls back to `{ data: { id } }` on forbidden read. Share context returns a share/role summary. Otherwise requires user identity |
| `user-me-update` | PATCH `/users/me`; user update fields | 200 current-user record; requires user identity and update ACL; read-back forbidden is not caught here |
| `user-track` | PATCH `/users/me/track/page`; required truthy `last_page` | 204; requires user identity; updates its last page through a service without normal update accountability |
| `user-invite` | POST `/users/invite`; email or email array, UUIDv4 `role`, optional `invite_url` | 204; uses user create/update ACL for invited users; role and invitation URL checks; may send email |
| `user-invite-accept` | POST `/users/invite/accept`; `token`, `password` | 204; no login required; valid invitation token, invited user and password policy required |
| `tfa-generate` | POST `/users/me/tfa/generate/`; `password` | 200 `{ data: { secret, otpauth_url } }`; user identity and password verification required |
| `tfa-enable` | POST `/users/me/tfa/enable/`; `secret`, `otp` | 204; user identity, OTP and relevant update access; enforced-TFA role can grant the narrowly scoped self-update permission |
| `tfa-disable` | POST `/users/me/tfa/disable`; `otp` | 204; user identity and OTP; enforced-TFA permission handling as above |
| `tfa-admin-disable` | POST `/users/:pk/tfa/disable`; target user key | 204; logged-in admin required; no OTP payload required |
| `share-auth` | POST `/shares/auth`; `share`, optional `password` | 200 `{ data: { access_token, expires } }` and access/refresh cookies; no user login required; share availability/password/use limits apply |
| `share-invite` | POST `/shares/invite`; `share`, `emails` array | 204; service requires a user and readable share; sends invitation mail |
| `share-info` | GET `/shares/info/:pk`; UUID constraint | 200 `{ data: share-info }`; no normal read accountability; fixed field selection and active date filters apply. A stored password is represented as `**********`, otherwise null |
| `server-oas` | GET `/server/specs/oas` | 200 raw OpenAPI 3.0.1 document, without `{ data }`; permission/schema-dependent generation from the incomplete static base |
| `server-graphql-spec` | GET `/server/specs/graphql/:scope?`; default `items`, allowed `items`/`system` | SDL download with project/date filename; permission-dependent schema; invalid scope gives 404 |
| `server-info` | GET `/server/info` | 200 `{ data: info }`; public project settings, user-specific rate-limit info, extra admin environment/version details |
| `server-health` | GET `/server/health` | Raw health JSON, `application/health+json`, no cache; 200 unless overall status is error (503). Nonadmins receive status only; admins receive checks/details |
| `random-string` | GET `/utils/random/string`; `length` integer 1–500, default 32 | 200 `{ data: string }`; no handler login requirement |
| `hash-generate` | POST `/utils/hash/generate`; required truthy `string` | 200 `{ data: hash }`; no handler login requirement |
| `hash-verify` | POST `/utils/hash/verify`; required truthy `string`, `hash` | 200 `{ data: boolean }`; no handler login requirement; malformed hash can throw |
| `sort` | POST `/utils/sort/:collection`; numeric/string `item`, `to` | **200 empty body**; valid collection sort field and update permission on that field, or admin |
| `revert` | POST `/utils/revert/:revision` | 204; revision read and target item update access through services |
| `import` | POST `/utils/import/:collection`; multipart file | **200 empty body** after import; nonadmins need both collection create and update permissions and cannot import system collections. Supports JSON arrays and CSV (`text/csv` or `application/vnd.ms-excel`) |
| `export-file` | POST `/utils/export/:collection`; required `query`, `format`, optional `file` metadata | 204 after scheduling background export to a file; no file ID or completion guarantee in response; collection read/file creation permissions apply |
| `cache-clear` | POST `/utils/cache/clear` | **200 empty body** after flushing caches; admin required |

Assets accept `key`, `transforms`, `width`, `height`, `format`, `fit`, `quality`, `withoutEnlargement`. Preset `key` cannot combine with other transformation options. `transforms` is a JSON array restricted to allowed methods and configured operation count. Settings govern allowed presets/dynamic transforms. `format=auto` negotiates using Accept and adds `Vary: Accept`. Asset cache headers are independent of the ordinary JSON response cache. A stream failure can return JSON 500 before bytes are sent; after streaming starts it cannot be assumed to return a clean JSON error. See [assets controller](api/src/controllers/assets.ts) and [assets service](api/src/services/assets.ts).

## 4. Authentication providers and GraphQL

### Conditional login routes

[auth.ts](api/src/controllers/auth.ts) mounts configured providers under `/auth/login/:provider`. The default local login `/auth/login` is present unless `AUTH_DISABLE_DEFAULT` is true. These route patterns add to the 181 controller registrations; provider names are configuration, not literal route parameters matched by a single controller.

| Driver | Methods and path suffixes | Contract |
| --- | --- | --- |
| Default/local | POST `/auth/login`; POST `/auth/login/:provider` for configured local providers | JSON `email`, `password`, optional `otp`, `mode` (`json` default or `cookie`); 200 `{ data: { access_token, expires, refresh_token? } }`. Cookie mode sets both cookies and omits JSON refresh token. Credentials/status/TFA/attempt-policy checks apply. [Source](api/src/auth/drivers/local.ts) |
| LDAP | POST `/auth/login/:provider` | JSON provider credentials (`identifier`, `password`), optional `otp`, `mode`; same token/cookie response convention. LDAP connection/bind/config checks apply. [Source](api/src/auth/drivers/ldap.ts) |
| OAuth2 | GET `/auth/login/:provider`; POST and GET `/auth/login/:provider/callback` | Login accepts allowed `redirect` and `prompt`, sets provider state cookie and redirects to IdP. POST callback accepts URL-encoded data and redirects 303 to GET callback. GET exchanges code/state and verifies cookie; with redirect it sets auth cookies and redirects, otherwise returns token JSON including refresh token. [Source](api/src/auth/drivers/oauth2.ts) |
| OpenID | GET `/auth/login/:provider`; POST and GET `/auth/login/:provider/callback` | IdP redirect and callback flow with driver-specific validation; POST callback uses URL-encoded data and redirects 303 to GET callback. With redirect, completion sets cookies and redirects; otherwise returns token JSON including refresh token. [Source](api/src/auth/drivers/openid.ts) |
| SAML | GET `/auth/login/:provider/metadata`; GET `/auth/login/:provider`; POST `/auth/login/:provider/logout`; POST `/auth/login/:provider/acs` | Metadata XML; IdP login/logout redirects; ACS accepts URL-encoded SAMLResponse/RelayState, verifies response, then returns token JSON or sets cookies and redirects. RelayState redirect is checked on login. Logout clears present auth cookies/session. [Source](api/src/auth/drivers/saml.ts) |

Provider allow-lists, callback state, cookie security/path/domain/SameSite and error redirects depend on configuration. No `/auth/oauth` mount exists in the core checkout. Source defaults and provider schemas must be distinguished from the enabled providers of a deployment.

### GraphQL transport and generated schema

| Methods | Path | Scope |
| --- | --- | --- |
| GET, POST | `/graphql` | Domain items; system collections excluded |
| GET, POST | `/graphql/system` | System collections except the deny-list, plus injected system operations |

GET requires `query` and optionally JSON-encoded `variables` and `operationName`. POST uses JSON `{ query, variables?, operationName? }`. GET only permits query operations; mutations require POST. Other methods return 405 with `Allow`; absent/invalid query strings and malformed GET variables produce REST transport errors. The handlers are Express `use` mounts, so these are canonical scope paths, not strict terminal path matches.

Schema generation filters available types/fields/operations by accountability and action permissions. System collection names remove the `directus_` prefix. The ordinary system collection deny-list is collections, fields, relations, migrations and sessions; activity/revisions have no generated CRUD mutations. Non-singleton queries include collection, `_by_id` and `_aggregated` forms; generated mutations use `create_`, `update_` and `delete_` collection operations. System resolvers also expose operations such as authentication, schema, server and utilities; they use service-specific checks and generated signatures. `GRAPHQL_INTROSPECTION` controls introspection. Exact SDL depends on the database and caller; it is not inferable from this repository alone.

Successful execution returns the GraphQL result directly (`{ data, errors? }`, optionally `extensions`) with ordinary status 200; execution errors can coexist with data. Parsing/middleware errors and schema validation failures instead use the REST error handler and its status (schema validation returns 400 `GRAPHQL_VALIDATION_EXCEPTION`). Do not expect a REST list/meta envelope or an HTTP error status for every GraphQL execution failure. Mutations and responses containing errors disable shared response caching.

Sources: [GraphQL controller](api/src/controllers/graphql.ts), [transport parser](api/src/middleware/graphql.ts), [GraphQL service and injected resolvers](api/src/services/graphql/index.ts), [GraphQL error conversion](api/src/services/graphql/utils/process-error.ts), and [specification generation](api/src/services/specifications.ts).

## 5. App-level and extension routes

| Registration | Current contract / availability |
| --- | --- |
| GET `/` | 302 redirect to `ROOT_REDIRECT` if configured; otherwise continues to later routes, ultimately 404 unless a hook/extension handles it |
| GET `/robots.txt` | 200 `text/plain`, body from `ROBOTS_TXT` |
| GET `/server/ping` | 200 plain `pong`; before authentication/schema/permission loading |
| GET `/admin` | When `SERVE_APP` is enabled: admin HTML with configured base URL/embeds, no-cache |
| USE `/admin` | When enabled: Express static assets, configured one-year immutable cache headers; static serving provides GET/HEAD rather than a single API operation |
| USE `/admin/*` | When enabled: SPA HTML fallback, no-cache |
| USE `/:extension-id` | Runtime endpoint extensions mount their own routers; exact methods/paths/payloads are unknown without extension packages |
| Initialization hooks | `app.*`, `middlewares.*`, `routes.*` hooks can introduce routes, custom middleware, or modify behavior beyond the built-in inventory |

Sources: [app.ts](api/src/app.ts), [endpoint registration](api/src/extensions.ts), and [server initialization](api/src/server.ts). Extension endpoints are mounted after built-in routes and share the earlier middleware unless an initialization hook changes registration. An extension handler receives services, exceptions, env, database, emitter, logger and `getSchema`; isolation cannot be assumed from the route path. No built-in client WebSocket/realtime endpoint or GraphQL subscription transport was found in this checkout's server setup. Runtime extensions remain an explicit gap; the product's realtime description is not evidence of a built-in route.

## 6. Namespace relevance, specification gaps and handoff

### Intended namespace classification

These classifications describe the intended namespace architecture. They do not change the current paths, payloads or permission semantics.

| Resource / surface | Intended classification | Relevance to later namespace work |
| --- | --- | --- |
| Items; collections, fields, relations, schema | Namespace-local | Resolve both metadata and domain data for the active namespace; retain collection names and paths |
| Flows/triggers, operations, webhooks, presets, dashboards, panels, notifications, shares | Namespace-local | Re-scope definitions, execution and related records; share authentication also touches shared sessions |
| Roles, permissions | Shared with namespace filtering | Resolve role/ACL from membership; ordinary system endpoints must not expose another namespace |
| Activity, revisions and revert | Shared with namespace filtering | Include originating namespace and resolve target collection/item in that context |
| Users, auth, sessions | Shared | Preserve accounts, static tokens and refresh sessions; user role exposure/update currently assumes a single role |
| Files/folders/assets | Shared; file namespace column conditional | File isolation policy is unresolved in the input design and needs coordination, not an invented T1 rule |
| Settings | Optional shared, deferred | Branding/asset policy and singleton reads affect both API and app behavior |
| GraphQL and generated specifications | Mixed, according to resource | Generated schema and operations must reflect active context; transport contract remains unchanged |
| Utilities | Mixed | Sort/import/export follow the selected collection; revert follows activity/revision context; cache clear is currently instance-wide |
| Server, extensions, root/admin/static routes | Instance-level | Verify specification scope, caches, hooks and extension behavior separately |

### Known documentation discrepancies

| Bundled specification claim | Implemented source contract |
| --- | --- |
| OpenAPI lists 107 operations | 181 explicit REST controller registrations, plus GraphQL/providers/app routes; generated OpenAPI inherits omissions from the static base |
| No SEARCH operations in bundled spec | 17 collection-level SEARCH registrations, with body queries and differing key behavior |
| `/auth/oauth`, `/auth/oauth/{provider}` | Provider login and callbacks are under `/auth/login/:provider`; default local login and GET `/auth` also exist |
| GET `/permissions/me` | No dedicated current-permissions handler; `/permissions/:pk` treats `me` as an ordinary record key |
| `/relations/{id}` as relation CRUD | One-segment GET reads relations for a collection; detail/PATCH/DELETE use collection+field |
| POST `/fields/{collection}` in spec | Source also has PATCH at that path for an array of field updates |
| Files only CRUD in spec | `/files/import` and multipart replacement/upload details need independent coverage |
| Missing families/special routes | GraphQL, dashboards, panels, notifications, shares; flow triggers, TFA generation/admin disable, specification downloads, health, extension sources and revision revert |
| Static info version `9.0.0` | Distribution reports `12.0.7`, API package `12.4.5`; generated spec uses runtime package version |

### Validation record and unresolved deployment gaps

The inventory was reconciled against all explicit controller registrations, all 27 built-in mounts, auth-driver registrations, both GraphQL scopes and the app-level handlers. Contract descriptions were traced through shared middleware and endpoint/service exceptions. No application tests, build or live API calls were run for this documentation change.

The following remain deployment-dependent and must not be presented as verified current production contracts:

- Base-tag/deployed-image equivalence and deploy Dockerfile patches, especially error/config/OAuth behavior.
- Actual collection field/PK/relationship schemas and permission-filtered OpenAPI/GraphQL SDL.
- Enabled authentication providers, cookie/TTL settings, CORS/rate limits, public permissions, configured flows, storage and extension packages/hooks.
- Reverse-proxy base paths, header rewriting, cache and browser behavior.
- Any realtime transport supplied by extensions or another deployment component.

For a later live baseline, use read-only dedicated system endpoints and capture `/server/specs/oas`, both GraphQL SDL scopes and permitted collection metadata with representative caller roles. Treat the generated specs as supplements to this source inventory, not complete enumeration. Exclude tokens, credentials, personal records and raw database dumps from the artifact.

T2 owns traffic evidence/criticality. T3/T4 and the shared Track 1/2 contract own compatibility decisions and namespace-switch design. T5 owns executable compatibility tests; this document identifies useful scenarios: object/array list/detail responses, singleton reads/upserts, bulk payloads and SEARCH key exceptions, denied/missing resources, successful writes without readable results, JSON/cookie login and refresh rotation, GraphQL GET queries/POST mutations/errors, metadata mutations and schema no-diff, file upload cardinality, asset range/HEAD behavior, and raw health/spec/flow outputs. None of these scenarios were exercised against a running instance here.

## 7. Explicit controller route inventory

Each row is one registration. Profiles refer to sections 2–3; family exceptions override the ordinary profiles. Source links retain the actual registered parameter spelling and optional/UUID constraints. Provider routes (section 4), GraphQL methods (section 4) and app/extension surfaces (section 5) are additional to these rows.

### Activity

Intended namespace classification: **Shared with namespace filtering**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| SEARCH | `/activity` | `search` | [activity:48](api/src/controllers/activity.ts#L48) |
| GET | `/activity` | `list` | [activity:49](api/src/controllers/activity.ts#L49) |
| GET | `/activity/:pk` | `detail` | [activity:51](api/src/controllers/activity.ts#L51) |
| POST | `/activity/comment` | `comment-create` | [activity:76](api/src/controllers/activity.ts#L76) |
| PATCH | `/activity/comment/:pk` | `comment-update` | [activity:122](api/src/controllers/activity.ts#L122) |
| DELETE | `/activity/comment/:pk` | `comment-delete` | [activity:157](api/src/controllers/activity.ts#L157) |

### Assets

Intended namespace classification: **Shared files; file isolation policy unresolved**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/assets/:pk/:filename?` | `asset` | [assets:25](api/src/controllers/assets.ts#L25) |

### Auth

Intended namespace classification: **Shared identity/sessions**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/auth/refresh` | `auth-refresh` | [auth:68](api/src/controllers/auth.ts#L68) |
| POST | `/auth/logout` | `auth-logout` | [auth:120](api/src/controllers/auth.ts#L120) |
| POST | `/auth/password/request` | `password-request` | [auth:160](api/src/controllers/auth.ts#L160) |
| POST | `/auth/password/reset` | `password-reset` | [auth:195](api/src/controllers/auth.ts#L195) |
| GET | `/auth` | `auth-providers` | [auth:224](api/src/controllers/auth.ts#L224) |

### Collections

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/collections` | `collections` | [collections:12](api/src/controllers/collections.ts#L12) |
| GET | `/collections` | `collections` | [collections:60](api/src/controllers/collections.ts#L60) |
| SEARCH | `/collections` | `collections` | [collections:61](api/src/controllers/collections.ts#L61) |
| GET | `/collections/:collection` | `collections` | [collections:63](api/src/controllers/collections.ts#L63) |
| PATCH | `/collections` | `collections` | [collections:79](api/src/controllers/collections.ts#L79) |
| PATCH | `/collections/:collection` | `collections` | [collections:105](api/src/controllers/collections.ts#L105) |
| DELETE | `/collections/:collection` | `collections` | [collections:131](api/src/controllers/collections.ts#L131) |

### Dashboards

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/dashboards` | `create` | [dashboards:16](api/src/controllers/dashboards.ts#L16) |
| GET | `/dashboards` | `list` | [dashboards:73](api/src/controllers/dashboards.ts#L73) |
| SEARCH | `/dashboards` | `search` | [dashboards:74](api/src/controllers/dashboards.ts#L74) |
| GET | `/dashboards/:pk` | `detail` | [dashboards:76](api/src/controllers/dashboards.ts#L76) |
| PATCH | `/dashboards` | `batch-update` | [dashboards:92](api/src/controllers/dashboards.ts#L92) |
| PATCH | `/dashboards/:pk` | `update` | [dashboards:128](api/src/controllers/dashboards.ts#L128) |
| DELETE | `/dashboards` | `batch-delete` | [dashboards:154](api/src/controllers/dashboards.ts#L154) |
| DELETE | `/dashboards/:pk` | `delete` | [dashboards:176](api/src/controllers/dashboards.ts#L176) |

### Extensions

Intended namespace classification: **Instance-level**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/extensions/:type` | `extensions-list` | [extensions:15](api/src/controllers/extensions.ts#L15) |
| GET | `/extensions/sources/:chunk` | `extensions-source` | [extensions:37](api/src/controllers/extensions.ts#L37) |

### Fields

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/fields` | `fields` | [fields:17](api/src/controllers/fields.ts#L17) |
| GET | `/fields/:collection` | `fields` | [fields:33](api/src/controllers/fields.ts#L33) |
| GET | `/fields/:collection/:field` | `fields` | [fields:50](api/src/controllers/fields.ts#L50) |
| POST | `/fields/:collection` | `fields` | [fields:84](api/src/controllers/fields.ts#L84) |
| PATCH | `/fields/:collection` | `fields` | [fields:119](api/src/controllers/fields.ts#L119) |
| PATCH | `/fields/:collection/:field` | `fields` | [fields:171](api/src/controllers/fields.ts#L171) |
| DELETE | `/fields/:collection/:field` | `fields` | [fields:212](api/src/controllers/fields.ts#L212) |

### Files

Intended namespace classification: **Shared; file namespace column conditional**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/files` | `files-create` | [files:124](api/src/controllers/files.ts#L124) |
| POST | `/files/import` | `files-import` | [files:174](api/src/controllers/files.ts#L174) |
| GET | `/files` | `list` | [files:233](api/src/controllers/files.ts#L233) |
| SEARCH | `/files` | `search` | [files:234](api/src/controllers/files.ts#L234) |
| GET | `/files/:pk` | `detail` | [files:236](api/src/controllers/files.ts#L236) |
| PATCH | `/files` | `batch-update` | [files:251](api/src/controllers/files.ts#L251) |
| PATCH | `/files/:pk` | `files-update` | [files:287](api/src/controllers/files.ts#L287) |
| DELETE | `/files` | `batch-delete` | [files:314](api/src/controllers/files.ts#L314) |
| DELETE | `/files/:pk` | `delete` | [files:337](api/src/controllers/files.ts#L337) |

### Flows

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/flows/trigger/:pk(${UUID_REGEX})` | `flow-trigger` | [flows:40](api/src/controllers/flows.ts#L40) |
| POST | `/flows/trigger/:pk(${UUID_REGEX})` | `flow-trigger` | [flows:41](api/src/controllers/flows.ts#L41) |
| POST | `/flows` | `create` | [flows:43](api/src/controllers/flows.ts#L43) |
| GET | `/flows` | `list` | [flows:100](api/src/controllers/flows.ts#L100) |
| SEARCH | `/flows` | `search` | [flows:101](api/src/controllers/flows.ts#L101) |
| GET | `/flows/:pk` | `detail` | [flows:103](api/src/controllers/flows.ts#L103) |
| PATCH | `/flows` | `batch-update` | [flows:119](api/src/controllers/flows.ts#L119) |
| PATCH | `/flows/:pk` | `update` | [flows:155](api/src/controllers/flows.ts#L155) |
| DELETE | `/flows` | `batch-delete` | [flows:181](api/src/controllers/flows.ts#L181) |
| DELETE | `/flows/:pk` | `delete` | [flows:203](api/src/controllers/flows.ts#L203) |

### Folders

Intended namespace classification: **Shared**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/folders` | `create` | [folders:16](api/src/controllers/folders.ts#L16) |
| GET | `/folders` | `list` | [folders:82](api/src/controllers/folders.ts#L82) |
| SEARCH | `/folders` | `search` | [folders:83](api/src/controllers/folders.ts#L83) |
| GET | `/folders/:pk` | `detail` | [folders:85](api/src/controllers/folders.ts#L85) |
| PATCH | `/folders` | `batch-update` | [folders:101](api/src/controllers/folders.ts#L101) |
| PATCH | `/folders/:pk` | `update` | [folders:137](api/src/controllers/folders.ts#L137) |
| DELETE | `/folders` | `batch-delete` | [folders:163](api/src/controllers/folders.ts#L163) |
| DELETE | `/folders/:pk` | `delete` | [folders:186](api/src/controllers/folders.ts#L186) |

### Items

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/items/:collection` | `create` | [items:14](api/src/controllers/items.ts#L14) |
| SEARCH | `/items/:collection` | `search` | [items:98](api/src/controllers/items.ts#L98) |
| GET | `/items/:collection` | `list` | [items:99](api/src/controllers/items.ts#L99) |
| GET | `/items/:collection/:pk` | `detail` | [items:101](api/src/controllers/items.ts#L101) |
| PATCH | `/items/:collection` | `batch-update` | [items:123](api/src/controllers/items.ts#L123) |
| PATCH | `/items/:collection/:pk` | `update` | [items:170](api/src/controllers/items.ts#L170) |
| DELETE | `/items/:collection` | `batch-delete` | [items:203](api/src/controllers/items.ts#L203) |
| DELETE | `/items/:collection/:pk` | `delete` | [items:229](api/src/controllers/items.ts#L229) |

### Notifications

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/notifications` | `create` | [notifications:16](api/src/controllers/notifications.ts#L16) |
| GET | `/notifications` | `list` | [notifications:82](api/src/controllers/notifications.ts#L82) |
| SEARCH | `/notifications` | `search` | [notifications:83](api/src/controllers/notifications.ts#L83) |
| GET | `/notifications/:pk` | `detail` | [notifications:85](api/src/controllers/notifications.ts#L85) |
| PATCH | `/notifications` | `batch-update` | [notifications:101](api/src/controllers/notifications.ts#L101) |
| PATCH | `/notifications/:pk` | `update` | [notifications:137](api/src/controllers/notifications.ts#L137) |
| DELETE | `/notifications` | `batch-delete` | [notifications:163](api/src/controllers/notifications.ts#L163) |
| DELETE | `/notifications/:pk` | `delete` | [notifications:186](api/src/controllers/notifications.ts#L186) |

### Operations

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/operations` | `create` | [operations:16](api/src/controllers/operations.ts#L16) |
| GET | `/operations` | `list` | [operations:73](api/src/controllers/operations.ts#L73) |
| SEARCH | `/operations` | `search` | [operations:74](api/src/controllers/operations.ts#L74) |
| GET | `/operations/:pk` | `detail` | [operations:76](api/src/controllers/operations.ts#L76) |
| PATCH | `/operations` | `batch-update` | [operations:92](api/src/controllers/operations.ts#L92) |
| PATCH | `/operations/:pk` | `update` | [operations:128](api/src/controllers/operations.ts#L128) |
| DELETE | `/operations` | `batch-delete` | [operations:154](api/src/controllers/operations.ts#L154) |
| DELETE | `/operations/:pk` | `delete` | [operations:176](api/src/controllers/operations.ts#L176) |

### Panels

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/panels` | `create` | [panels:16](api/src/controllers/panels.ts#L16) |
| GET | `/panels` | `list` | [panels:73](api/src/controllers/panels.ts#L73) |
| SEARCH | `/panels` | `search` | [panels:74](api/src/controllers/panels.ts#L74) |
| GET | `/panels/:pk` | `detail` | [panels:76](api/src/controllers/panels.ts#L76) |
| PATCH | `/panels` | `batch-update` | [panels:92](api/src/controllers/panels.ts#L92) |
| PATCH | `/panels/:pk` | `update` | [panels:128](api/src/controllers/panels.ts#L128) |
| DELETE | `/panels` | `batch-delete` | [panels:154](api/src/controllers/panels.ts#L154) |
| DELETE | `/panels/:pk` | `delete` | [panels:176](api/src/controllers/panels.ts#L176) |

### Permissions

Intended namespace classification: **Shared with namespace filtering**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/permissions` | `create` | [permissions:16](api/src/controllers/permissions.ts#L16) |
| GET | `/permissions` | `list` | [permissions:82](api/src/controllers/permissions.ts#L82) |
| SEARCH | `/permissions` | `search` | [permissions:83](api/src/controllers/permissions.ts#L83) |
| GET | `/permissions/:pk` | `detail` | [permissions:85](api/src/controllers/permissions.ts#L85) |
| PATCH | `/permissions` | `batch-update` | [permissions:103](api/src/controllers/permissions.ts#L103) |
| PATCH | `/permissions/:pk` | `update` | [permissions:139](api/src/controllers/permissions.ts#L139) |
| DELETE | `/permissions` | `batch-delete` | [permissions:165](api/src/controllers/permissions.ts#L165) |
| DELETE | `/permissions/:pk` | `delete` | [permissions:188](api/src/controllers/permissions.ts#L188) |

### Presets

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/presets` | `create` | [presets:16](api/src/controllers/presets.ts#L16) |
| GET | `/presets` | `list` | [presets:82](api/src/controllers/presets.ts#L82) |
| SEARCH | `/presets` | `search` | [presets:83](api/src/controllers/presets.ts#L83) |
| GET | `/presets/:pk` | `detail` | [presets:85](api/src/controllers/presets.ts#L85) |
| PATCH | `/presets` | `batch-update` | [presets:101](api/src/controllers/presets.ts#L101) |
| PATCH | `/presets/:pk` | `update` | [presets:137](api/src/controllers/presets.ts#L137) |
| DELETE | `/presets` | `batch-delete` | [presets:163](api/src/controllers/presets.ts#L163) |
| DELETE | `/presets/:pk` | `delete` | [presets:186](api/src/controllers/presets.ts#L186) |

### Relations

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/relations` | `relations` | [relations:14](api/src/controllers/relations.ts#L14) |
| GET | `/relations/:collection` | `relations` | [relations:29](api/src/controllers/relations.ts#L29) |
| GET | `/relations/:collection/:field` | `relations` | [relations:46](api/src/controllers/relations.ts#L46) |
| POST | `/relations` | `relations` | [relations:75](api/src/controllers/relations.ts#L75) |
| PATCH | `/relations/:collection/:field` | `relations` | [relations:119](api/src/controllers/relations.ts#L119) |
| DELETE | `/relations/:collection/:field` | `relations` | [relations:152](api/src/controllers/relations.ts#L152) |

### Revisions

Intended namespace classification: **Shared with namespace filtering**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/revisions` | `list` | [revisions:31](api/src/controllers/revisions.ts#L31) |
| SEARCH | `/revisions` | `search` | [revisions:32](api/src/controllers/revisions.ts#L32) |
| GET | `/revisions/:pk` | `detail` | [revisions:34](api/src/controllers/revisions.ts#L34) |

### Roles

Intended namespace classification: **Shared with namespace filtering**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/roles` | `create` | [roles:16](api/src/controllers/roles.ts#L16) |
| GET | `/roles` | `list` | [roles:73](api/src/controllers/roles.ts#L73) |
| SEARCH | `/roles` | `search` | [roles:74](api/src/controllers/roles.ts#L74) |
| GET | `/roles/:pk` | `detail` | [roles:76](api/src/controllers/roles.ts#L76) |
| PATCH | `/roles` | `batch-update` | [roles:92](api/src/controllers/roles.ts#L92) |
| PATCH | `/roles/:pk` | `update` | [roles:128](api/src/controllers/roles.ts#L128) |
| DELETE | `/roles` | `batch-delete` | [roles:154](api/src/controllers/roles.ts#L154) |
| DELETE | `/roles/:pk` | `delete` | [roles:177](api/src/controllers/roles.ts#L177) |

### Schema

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/schema/snapshot` | `schema` | [schema:16](api/src/controllers/schema.ts#L16) |
| POST | `/schema/apply` | `schema` | [schema:27](api/src/controllers/schema.ts#L27) |
| POST | `/schema/diff` | `schema` | [schema:103](api/src/controllers/schema.ts#L103) |

### Server

Intended namespace classification: **Instance-level; generated specifications follow resource scope**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/server/specs/oas` | `server-oas` | [server:11](api/src/controllers/server.ts#L11) |
| GET | `/server/specs/graphql/:scope?` | `server-graphql-spec` | [server:25](api/src/controllers/server.ts#L25) |
| GET | `/server/info` | `server-info` | [server:51](api/src/controllers/server.ts#L51) |
| GET | `/server/health` | `server-health` | [server:66](api/src/controllers/server.ts#L66) |

### Settings

Intended namespace classification: **Optional shared, deferred**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/settings` | `settings` | [settings:12](api/src/controllers/settings.ts#L12) |
| PATCH | `/settings` | `settings` | [settings:27](api/src/controllers/settings.ts#L27) |

### Shares

Intended namespace classification: **Namespace-local; authentication uses shared sessions**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/shares/auth` | `share-auth` | [shares:23](api/src/controllers/shares.ts#L23) |
| POST | `/shares/invite` | `share-invite` | [shares:54](api/src/controllers/shares.ts#L54) |
| POST | `/shares` | `create` | [shares:75](api/src/controllers/shares.ts#L75) |
| GET | `/shares` | `list` | [shares:126](api/src/controllers/shares.ts#L126) |
| SEARCH | `/shares` | `search` | [shares:127](api/src/controllers/shares.ts#L127) |
| GET | `/shares/info/:pk(${UUID_REGEX})` | `share-info` | [shares:129](api/src/controllers/shares.ts#L129) |
| GET | `/shares/:pk(${UUID_REGEX})` | `detail` | [shares:178](api/src/controllers/shares.ts#L178) |
| PATCH | `/shares` | `batch-update` | [shares:194](api/src/controllers/shares.ts#L194) |
| PATCH | `/shares/:pk(${UUID_REGEX})` | `update` | [shares:230](api/src/controllers/shares.ts#L230) |
| DELETE | `/shares` | `batch-delete` | [shares:256](api/src/controllers/shares.ts#L256) |
| DELETE | `/shares/:pk(${UUID_REGEX})` | `delete` | [shares:278](api/src/controllers/shares.ts#L278) |

### Users

Intended namespace classification: **Shared**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/users` | `create` | [users:21](api/src/controllers/users.ts#L21) |
| GET | `/users` | `list` | [users:78](api/src/controllers/users.ts#L78) |
| SEARCH | `/users` | `search` | [users:79](api/src/controllers/users.ts#L79) |
| GET | `/users/me` | `user-me` | [users:81](api/src/controllers/users.ts#L81) |
| GET | `/users/:pk` | `detail` | [users:124](api/src/controllers/users.ts#L124) |
| PATCH | `/users/me` | `user-me-update` | [users:142](api/src/controllers/users.ts#L142) |
| PATCH | `/users/me/track/page` | `user-track` | [users:163](api/src/controllers/users.ts#L163) |
| PATCH | `/users` | `batch-update` | [users:182](api/src/controllers/users.ts#L182) |
| PATCH | `/users/:pk` | `update` | [users:218](api/src/controllers/users.ts#L218) |
| DELETE | `/users` | `batch-delete` | [users:244](api/src/controllers/users.ts#L244) |
| DELETE | `/users/:pk` | `delete` | [users:267](api/src/controllers/users.ts#L267) |
| POST | `/users/invite` | `user-invite` | [users:288](api/src/controllers/users.ts#L288) |
| POST | `/users/invite/accept` | `user-invite-accept` | [users:310](api/src/controllers/users.ts#L310) |
| POST | `/users/me/tfa/generate/` | `tfa-generate` | [users:327](api/src/controllers/users.ts#L327) |
| POST | `/users/me/tfa/enable/` | `tfa-enable` | [users:358](api/src/controllers/users.ts#L358) |
| POST | `/users/me/tfa/disable` | `tfa-disable` | [users:417](api/src/controllers/users.ts#L417) |
| POST | `/users/:pk/tfa/disable` | `tfa-admin-disable` | [users:477](api/src/controllers/users.ts#L477) |

### Utils

Intended namespace classification: **Mixed: collection/revision scope and instance utilities**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| GET | `/utils/random/string` | `random-string` | [utils:27](api/src/controllers/utils.ts#L27) |
| POST | `/utils/hash/generate` | `hash-generate` | [utils:42](api/src/controllers/utils.ts#L42) |
| POST | `/utils/hash/verify` | `hash-verify` | [utils:55](api/src/controllers/utils.ts#L55) |
| POST | `/utils/sort/:collection` | `sort` | [utils:77](api/src/controllers/utils.ts#L77) |
| POST | `/utils/revert/:revision` | `revert` | [utils:95](api/src/controllers/utils.ts#L95) |
| POST | `/utils/import/:collection` | `import` | [utils:109](api/src/controllers/utils.ts#L109) |
| POST | `/utils/export/:collection` | `export-file` | [utils:150](api/src/controllers/utils.ts#L150) |
| POST | `/utils/cache/clear` | `cache-clear` | [utils:179](api/src/controllers/utils.ts#L179) |

### Webhooks

Intended namespace classification: **Namespace-local**. See section 6.

| Method | Registered path | Contract profile | Source |
| --- | --- | --- | --- |
| POST | `/webhooks` | `create` | [webhooks:16](api/src/controllers/webhooks.ts#L16) |
| GET | `/webhooks` | `list` | [webhooks:73](api/src/controllers/webhooks.ts#L73) |
| SEARCH | `/webhooks` | `search` | [webhooks:74](api/src/controllers/webhooks.ts#L74) |
| GET | `/webhooks/:pk` | `detail` | [webhooks:76](api/src/controllers/webhooks.ts#L76) |
| PATCH | `/webhooks` | `batch-update` | [webhooks:92](api/src/controllers/webhooks.ts#L92) |
| PATCH | `/webhooks/:pk` | `update` | [webhooks:126](api/src/controllers/webhooks.ts#L126) |
| DELETE | `/webhooks` | `batch-delete` | [webhooks:152](api/src/controllers/webhooks.ts#L152) |
| DELETE | `/webhooks/:pk` | `delete` | [webhooks:174](api/src/controllers/webhooks.ts#L174) |

## 8. CMS deployment compatibility notes

The CMS deployment adds the following compatibility requirements to the core source baseline:

- **External URL prefix:** CMS exposes `/v9/<instance>/` and strips that prefix before forwarding to the API. For example, `/v9/infrastructure/items/<collection>` reaches `/items/<collection>`. The prefix identifies an existing deployment; virtual namespace selection happens within that deployment through tokens/headers. See the [routing template](cms/ops/templates/directus-v9.yaml:64).
- **Cookies and OAuth:** build-time patches remove hardcoded `/auth` and `/assets` cookie paths, so Express emits authentication cookies with `Path=/`; the manually constructed refresh-cookie header is also patched to `/`. OAuth2/OpenID token exchange preserves the configured callback URL's path and copies the actual request's query parameters. Namespace switching must preserve working login and refresh behavior behind the prefixed gateway. See the [cookie-path patch](cms/directus-v9/patch-oauth2-cookie-path.cjs:29), [callback-URL patch](cms/directus-v9/patch-oauth2-callback-url.cjs:23), and [image build](cms/directus-v9/Dockerfile:14).
- **Authentication defaults:** CMS configuration specifies 60-minute access tokens, `<instance>_refresh_token` cookie names, and Google OpenID authentication with consent prompting, verified emails and public registration disabled. These defaults can be overridden by default/instance secrets and environment configuration. See [CMS configuration](cms/directus-v9/config.js:64).
- **Error responses:** the CMS replacement error handler exposes unexpected exception messages in 500 responses to nonadmins as well as admins, using the existing error envelope. This overrides the core generic-message behavior described above for images containing the replacement. See the [CMS error handler](cms/directus-v9/error-handler.js:50).

These findings describe inspected deployment source. Effective configuration overrides, the running image and active gateway behavior remain unverified.
