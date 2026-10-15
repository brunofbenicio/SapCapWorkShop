# Customer Messages

A SAP Cloud Application Programming Model (CAP, Node.js) application to manage customer
messages. Incoming messages are enriched with generative AI: each message is translated to
English, summarized, categorized and rated for urgency and sentiment. The application was
generated with SAP Build Code (LCAP) and is exposed as an OData V4 service with a
Fiori elements UI.

[`docs/features.md`](docs/features.md) maps every CAP feature of the application to its files, the
commands to try it and the tests; a test keeps that page complete.

## What it does

- Stores customer messages with the original text (`titleCustomerLanguage`,
  `fullMessageCustomerLanguage`) and the AI-derived fields: English title, message and
  summary, a summary in the customer's language, `messageCategory` (Technical, Delivery,
  Service), `messageUrgency` (High, Medium, Low) and `messageSentiment` (Negative,
  Positive, Neutral). These three fields are enums: the service rejects other values and
  the AI answer is checked against them.
- Records `createdAt`, `createdBy`, `modifiedAt` and `modifiedBy` for every message
  (`managed` aspect).
- Derives two read-only fields: `priorityScore` (calculated on read from urgency, High 3 /
  Medium 2 / Low 1, and sentiment, Negative 2 / Neutral 1 / Positive 0) and `displayTitle`
  (English title if available, otherwise the original title; stored in the database).
- Keeps the replies sent to a customer (`CustomerMessageReplies`: author, text, sent time) as
  a composition of the message. Replies are edited in the message's draft, are saved with
  it and are deleted with it.
- Stores files attached to a message (`CustomerMessageAttachments`, for example a photo of
  the defect). Content is uploaded and downloaded as a stream
  (`.../attachments(ID=...,IsActiveEntity=true)/content`); downloads are served with
  `Content-Disposition: attachment`.
- Tags messages with free-form labels (`Tags`), a many-to-many relation realized by the link
  entity `CustomerMessageTags`. Messages can be filtered by tag, for example
  `$filter=tags/any(t:t/tag_code eq 'warranty')`.
- Provides reply text blocks as temporal data (`ResponseTemplates`). Every version has a
  validity period; reads return the versions valid now, and `sap-valid-at`,
  `sap-valid-from` and `sap-valid-to` read the texts that applied at another time.
- Keeps application-wide options in the singleton `Settings` (read: `GET /Settings`, change:
  `PATCH /service/admin/Settings` as Admin):
  `autoEnrichment` switches the GenAI enrichment on or off and `aiModelName` selects the
  AI model.
- Provides a work queue for agents, the `OperationsService` (`/service/operations`): a
  read-only view on the messages with the action `markAsResolved(resolution)`, the function
  `suggestedPriority()` (priority level Critical, High, Medium or Low derived from
  `priorityScore`) and the function `statistics()` (message counts by status, category and
  urgency). The status of a message (`Open`, `Resolved`) can only be changed by the action.
  The action `addReply(author, text)` adds a reply to a message. The service is also served as
  REST at `/rest/service/operations` (`GET /CustomerMessages/<ID>/suggestedPriority`,
  `POST /CustomerMessages/<ID>/markAsResolved`, `GET /statistics`); the same roles apply.
- Provides read-only analytics, the `AnalyticsService` (`/service/analytics`): the entity
  `MessageAnalytics` supports `$apply` (`groupby`, `aggregate`, `filter`), so clients can count
  and average on the server, for example
  `MessageAnalytics?$apply=groupby((messageCategory),aggregate($count as messages))` or
  `...groupby((originatingCountry),aggregate(priorityScore with average as averageScore))`.
  Groupable: category, urgency, sentiment, country, status. Viewer role required.
- Limits page sizes and searches selected elements (`srv/query-options.cds`): a list request
  returns 50 rows without `$top` (`AdminService` 100, `AnalyticsService` 200) and at most
  200 rows (500 / 1000), with `@odata.nextLink` for the next page. `$search` looks at the
  names, IDs and texts of a message and at the titles of its tags, not at status, language or
  audit fields. `@Capabilities` tell Fiori elements what is not sortable or filterable (long
  texts) and not searchable (analytics); expands deeper than three levels are rejected.
- Serves GraphQL at `/graphql` (`@cap-js/graphql`, `srv/graphql.cds`) for the `benicio_1_04Srv` and
  the `AdminService`. Messages, replies, tags and code lists can be queried with filter, order
  and paging, for example `{ benicio_1_04Srv { CustomerMessages(top: 5) { nodes { customerName } } } }`.
  Mutations (create, update, delete) work for the `AdminService`; messages are read-only in
  GraphQL, because they are created and changed in drafts, which GraphQL cannot activate. The
  roles and the page size are the same as in OData. GraphQL reports errors in the response body
  (HTTP 200, `errors[0].extensions.code`), also `401` without credentials in development. An agent
  can update or delete tags through GraphQL only while all tags were created by that agent
  (CAP checks the instance restriction for the whole entity); use OData otherwise. GraphiQL is
  served in development and switched off in the `production` profile.
- Documents the OData services as OpenAPI: `npm run openapi` writes `docs/openapi/<Service>.openapi3.json`
  for `benicio_1_04Srv`, `OperationsService`, `AdminService` and `AnalyticsService`
  (`scripts/openapi.js`, `@cap-js/openapi`; the folder is git-ignored). The REST variant of
  `OperationsService` is not included, the compiler describes it with OData paths; see
  `http/operations-rest.http`. A Swagger UI for development is not set up:
  `cds-swagger-ui-express` 0.11 fails on the draft-enabled model with `@sap/cds` 9 ("an element
  can't be virtual and an association"), so it is not used.
- Documents the events as AsyncAPI: `npm run asyncapi` writes `docs/asyncapi/OperationsService.json`
  (`@cap-js/asyncapi`, namespace `customer.customermessages` from `cds.export.asyncapi` in
  `package.json`, title from `@AsyncAPI.*` in `srv/api-docs.cds`; the folder is git-ignored). A test
  checks that the payload of the emitted events matches the document.
- Runs on a custom server (`srv/server.js`): every request gets an id (`X-Request-ID`, taken over
  from the caller if plausible, handed to CAP as `X-Correlation-ID`), one access log line per request
  (`[access] GET /path 200 12ms [id]`, without the query), the public health check `GET /health`
  (200 `{"status":"UP"}`, 503 `{"status":"DOWN"}` if the database does not answer or the server shuts
  down), configurable CORS and a graceful shutdown that logs and waits for the requests in progress
  (`cds.server.drain_timeout`, default 10 s). CORS is configured with `cds.cors`: `origins` (list, `*`
  for all; development allows all, other profiles none; environment `CDS_CORS_ORIGINS='["https://ui.example.com"]'`),
  `methods`, `headers`, `credentials` (never together with `*`) and `maxage`.
- Writes an audit log (`@cap-js/audit-logging`). The customer is the data subject of a message
  (`db/personal-data.cds`, `@PersonalData`): names and titles are personal, the texts of messages and
  replies are sensitive, the content of attachments is not annotated. Saving or deleting a message,
  reply or attachment emits `PersonalDataModified` (old and new value of personal attributes, sensitive
  ones masked as `***`), reading sensitive attributes emits `SensitiveDataRead` (names of the
  attributes, no values). Drafts are not logged until they are saved. The data subject is identified by
  the `customerId` (`srv/code/audit.js` completes what the plugin leaves out; events about a deleted
  message keep the ID of the message). The events are written to the task queue in the transaction of the
  request and delivered afterwards, so a failing audit log service does not fail the request and the
  events are retried. In development they are printed to the console (`[audit-log] - ...`).
- Keeps a change history (`@cap-js/change-tracking`, `db/change-tracking.cds`, database triggers):
  who changed the classification (category, urgency, sentiment) or the status of a message, the
  title and text of response templates, tag titles and the settings, from which value to which. It
  records changes of handlers too (`markAsResolved`, the AI enrichment, which is recorded as user
  `privileged`). Personal data is not tracked, see the audit log. Read it with the navigation
  `changes`, for example `OperationsService/CustomerMessages(ID=...)/changes` or
  `AdminService/Tags('warranty')/changes` (role Viewer; not offered by `benicio_1_04Srv`, whose
  Build Code base handler fails on the plugin's join view). The sample data is in the history as
  created by `anonymous`.
- Traces requests, database calls and the task queue with OpenTelemetry (`@cap-js/telemetry`, a
  development dependency, so it is not part of the production installation). In development the
  traces and metrics are printed to the console (`[telemetry] - ...`, `cds.requires.telemetry` in
  `package.json`); the health check is not traced. `NO_TELEMETRY=true` switches it off, the tests
  do so (`test/setup.js`) and start the application in a separate process to test it. To export
  traces in production, make the package a normal dependency and set the kind
  (`telemetry-to-cloud-logging`, `-to-dynatrace`, `-to-otlp`) with the service binding; this was not
  verified, there is no BTP access.
- Has a Fiori elements UI for the messages (`app/customer-messages-ui.cds`): filter bar with category,
  urgency, sentiment, status, country and product; a list with the priority and the colors of urgency,
  sentiment and status (calculated criticality elements); an object page with data points and a bullet
  chart of the priority in the header, facets for the customer, classification, resolution, message,
  replies, tags, attachments and the service order; value helps for categories and tags; side effects
  (priority and colors after a change of urgency or sentiment); the action to resolve a message in the
  header and the table (`markAsResolved` also in `benicio_1_04Srv`, role Agent, offered for saved open
  messages). The annotations build on the ones SAP Build Code generated and replace those of the same
  targets. A test looks at them in the `$metadata`; the UI itself was not run in a browser.
- Translates the UI: labels, titles of facets and columns and the action text of the Fiori annotations
  are `{i18n>Key}` keys. The texts of the UI are in `app/_i18n` (English, German, Portuguese), the ones
  of the model in `db/i18n`. The service delivers the `$metadata` in the language of the request
  (`Accept-Language` or `sap-locale`); other languages get English. The texts of the UI5 app itself
  (`webapp/i18n`, title of the app) are not translated.
- Documents programmatic queries (`srv/code/query-examples.js`): SELECT with filters, expand, path
  expressions, sub-selects, joins and aggregations; INSERT, UPDATE, UPSERT and DELETE; CQN and CQL
  text; transactions with `cds.tx` (callback, and explicit commit and rollback); row locking with
  `forUpdate()`; and a read through a service, which checks the authorization. Each example shows its
  CQL and is run by `test/srv/query-examples.test.js`. SQLite ignores row locks, so only the CQN of
  the locks is tested; the locking itself needs SAP HANA and was not verified.
- Generates TypeScript types from the model for plain JavaScript (`@cap-js/cds-typer`, a development
  dependency; it needs Node.js 22 or newer): `npm run types` writes them to `@cds-models` (not
  committed; `cds watch` creates them if they are missing), and `#cds-models/<namespace or service>` imports them
  (`imports` in `package.json`). `srv/code/typed-example.js` shows typed JSDoc, `npm run typecheck` checks it
  with TypeScript (`jsconfig.json`), and a test checks that wrong code is reported. The application does not
  load the example; `where` conditions are not checked by the types.
- Emits the events `MessageResolved` (by `markAsResolved`) and `ReplyAdded` (by `addReply`).
  Subscribers are registered in `srv/code/message-events.js`; they currently write a log
  line and are the place to add reactions such as notifications.
- Validates input. The model checks ranges, formats and references (`@assert.range`,
  `@assert.format`, `@assert.target`, `@mandatory`); handlers check that a `customerMessageID`
  is unique, that a tag is not assigned twice and that uploaded files have an allowed type
  (png, jpeg, gif, pdf, plain text) and at most 5 MB. Messages are keys in
  `srv/_i18n/messages*.properties` (English, German, Portuguese); actions report results as
  info and warning messages in the `sap-messages` header.
- Restricts access by role (Viewer reads, Agent writes, Admin does everything) and by
  instance: an Agent can only change or delete the messages (and, in the `AdminService`, the
  tags and response templates) that the Agent created. The `AdminService`
  (`/service/admin`) maintains tags, response templates and the settings; they are
  read-only in the other services.
- Offers the message categories as a code list (`MessageCategories`) with texts in English,
  German and Portuguese. The language is taken from the `Accept-Language` header or the
  `sap-locale` URL parameter; other languages fall back to English. Labels of the model
  come from `db/i18n`.
- Lets users create and edit messages in a draft before saving them (draft-enabled entity).
- Links a message to a service order of an SAP S/4HANA system (external OData V2 service). The
  entity `A_ServiceOrder` (the value help of that field) holds no data: reads are passed on to the
  remote service, in production through the destination `S4HCP-ServiceOrder-Odata`. In development
  and tests a local mock serves the orders in `srv/external/data` (8 sample service orders), so no
  network is needed; if the remote system cannot be reached, the service answers `502`.
- Enriches messages automatically after they are read: the READ schedules one task per message in
  a persistent task queue, and the queue calls the AI outside the request and retries it when it
  fails (see below).

## Architecture

```
Fiori elements UI  ->  benicio_1_04Srv (OData V4, /service/benicio_1_04)
                          |-- before READ: queue a task for each message that misses AI fields
                          |       `-- EnrichmentService (task queue cds.outbox.Messages)
                          |             `-- SAP AI SDK -> Orchestration service of SAP AI Core
                          |-- db/schema.cds: Benicio_1_04.CustomerMessages
                          |       `-- SQLite (development) / SAP HANA (production)
                          `-- S4HCP_ServiceOrder_Odata (S/4HANA service orders, OData V2)

Agents  ->  OperationsService (OData V4 /service/operations, REST /rest/service/operations)
              `-- markAsResolved, suggestedPriority, statistics

Clients ->  GraphQL (/graphql): benicio_1_04Srv (read), AdminService (read, write)

Charts  ->  AnalyticsService (OData V4, /service/analytics)
              `-- MessageAnalytics with $apply=groupby/aggregate
```

**Enrichment.** Before every `READ` of `CustomerMessages` the handler in
`srv/code/customermessage-logic-preprocessMessages.js` selects the messages that have a
customer-language text but miss at least one AI field and puts a task `enrich-<ID>` for each of
them into the persistent task queue (`cds.queued`, table `cds.outbox.Messages`). The READ does not
wait for the AI and is not affected by it: the first response shows the message as it is, the
next read shows the AI fields. The queue calls `EnrichmentService.enrichMessage`
(`srv/enrichment-service.cds`) outside the request, with at most `chunkSize` (3) calls at the
same time. If the model fails or returns an incomplete or invalid answer, the task stays in the
table with `attempts` and `lastError` and is retried with an exponential back-off (0.5 s, 1.1 s,
... up to 25 minutes) until `maxAttempts` (20) is reached. Tasks survive a restart. A task that used
up its attempts is dropped and created again by the next read of the message. A message is never
queued twice; a message that is complete or deleted when its task runs is skipped. Changing the
model or the options of the queue: `cds.requires.queue` in `package.json`.

## Prerequisites

- Node.js 20 or higher and npm
- Optional, for real AI results: an SAP AI Core instance with an orchestration deployment.
  Without it the application runs, but the AI fields stay empty and errors are logged.
- Optional, for production: SAP BTP with SAP HANA Cloud, XSUAA, the Destination service and
  a destination named `S4HCP-ServiceOrder-Odata`.

## Run locally

```sh
npm install
npm run cds-watch      # cds watch --open, serves on http://localhost:4004
```

In development the app uses an in-memory SQLite database that is filled from `test/data`,
mocked authentication with the users below (HTTP basic auth) and, with `cds watch` (or
`cds-serve --with-mocks`), a local mock of the S/4HANA service filled from `srv/external/data`.
Without the mock (`npm start`), reading `A_ServiceOrder` answers `502`, because there is no
destination.

| User | Password | Roles | May |
|------|----------|-------|-----|
| `viewer` | `viewer` | Viewer | read everything |
| `agent` | `agent` | Viewer, Agent | also create messages, change and delete the messages, tags and templates that the agent created, resolve messages and add replies |
| `admin` | `admin` | Viewer, Agent, Admin | everything, including the settings and the data of others |

These accounts exist only in the `development` profile and are for local use. Requests
without credentials get 401, a login without a role gets 403. The browser asks for the
credentials when it opens the app.

- Service document: <http://localhost:4004/service/benicio_1_04/>
- Fiori app: <http://localhost:4004/benicio_1_04.myapplication/webapp/index.html>

To get AI results locally, export a service key of your AI Core instance before starting
(do not commit it):

```sh
export AICORE_SERVICE_KEY='{ ...service key JSON... }'
```

### Try the services

`http/*.http` contains ready-to-run requests for the VS Code extension REST Client and the
IntelliJ HTTP client (OData, REST, GraphQL, analytics, admin and authorization), all with the mocked
users. Start the app, open a file and send the requests top down; `# expect: <status>` above a
request tells what to expect. `npm test` sends every request to the application as well
(`test/http-files.test.js`), so the examples stay correct.

### GenAI configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `GENAI_MODEL_NAME` or `cds.genai.model` | `gpt-4o` | Model used by the orchestration service |
| `GENAI_MODEL_PARAMS` (JSON) or `cds.genai.modelParams` | `{"temperature":0,"max_tokens":1500}` | Model parameters |
| `cds.genai.enabled` | `true` (`false` in the test profile) | `false` switches the enrichment off for the whole application, for example without AI Core |
| `cds.requires.queue.chunkSize` | `3` | Maximum parallel AI calls |
| `cds.requires.queue.maxAttempts` | `20` | Attempts per message before the task is dropped |

Environment variables win over `cds.genai` in `package.json`. The model name in the
`Settings` singleton (`aiModelName`) wins over both. With `autoEnrichment` set to `false`
the enrichment is skipped and the messages are read as they are. The tests switch the enrichment
off (`cds.genai.enabled`) and switch it on again where they test it (`test/helpers/enrichment.js`).

## Multitenancy, extensibility and feature toggles

The profile `multitenancy` (`cds.requires` in `package.json`, `@sap/cds-mtxs`) turns the application
into a multitenant SaaS application: every tenant gets its own database, tenants are subscribed
through the provisioning service, a tenant can extend the model and features can be switched on per
tenant. Without the profile nothing changes.

```sh
npx cds-serve --profile multitenancy         # development, SQLite database per tenant
curl -u yves: -X PUT http://localhost:4004/-/cds/saas-provisioning/tenant/t1 \
     -H 'Content-Type: application/json' -d '{"subscribedTenantId":"t1","eventType":"CREATE"}'
```

- **Users.** `yves` (role `internal-user`) is the provisioning user. `t1-agent`, `t2-agent`
  (password `agent`; Viewer, Agent) and `t1-developer` (password `developer`; Viewer and
  `cds.ExtensionDeveloper`) belong to the tenants `t1` and `t2`.
- **Extensibility.** An extension developer extends the customer messages of the own tenant with
  up to three fields whose names start with `x_`, for example
  `POST /-/cds/extensibility/set {"tag":"internal-ref","extension":["extend Benicio_1_04.CustomerMessages with { x_internalRef : String(40); }"]}`.
  Other entities and field names are refused (`cds.xt.ExtensibilityService` in `package.json`).
- **Feature toggles.** `fts/internal-note` adds the field `internalNote` to the customer messages of
  the tenants that have the feature (`cds.requires.auth.tenants` in development; the feature vector of the
  tenant in production). Add further features as folders under `fts/`.
- **Build.** `cds build --production --profile multitenancy` additionally writes the base model
  for the tenants (`gen/srv/resources.tgz`) and the features (`gen/srv/fts`). Run the result with
  `NODE_ENV=production CDS_ENV=multitenancy`.

`test/srv/multitenancy.test.js` checks the configuration, `cds compile` and `cds build` with the profile
and runs the application with SQLite: two tenants, isolated data, extension, feature, unsubscribing.
**Not done and not verified (no BTP access):** the deployment (`mta.yaml` is for the single-tenant profile), the SAP
HANA container per tenant (SAP Service Manager), the SaaS Provisioning service
(`saas-registry`) and its XSUAA setup: `xs-security.json` would need `"tenant-mode": "shared"`, the
scope `$XSAPPNAME.mtcallback` (granted to `sap-provisioning`) and the scope `$XSAPPNAME.cds.ExtensionDeveloper`.
There is no MTX sidecar; the MTX services run in the application. The change tracking plugin
creates triggers for each tenant database by the MTX deployment; this was tested with SQLite only.

## Test and lint

```sh
npm test        # jest + @cap-js/cds-test, in-memory SQLite, AI SDK mocked
npm run lint    # eslint with the CAP and CDS rules
npm run types   # generate the types of the model into @cds-models (cds-typer)
npm run typecheck  # TypeScript check of the typed example (needs npm run types first)
```

The tests never call AI Core: `test/setup.js` replaces the AI SDK for every test. They start the
server with the mocked S/4HANA service (`test/helpers/server.js`), so they need no network either.

## Profiles and production

| | `development` (default) | `production` |
|--|--|--|
| Database | SQLite in memory | SAP HANA (`@cap-js/hana`) |
| Authentication | `mocked` (users `viewer`, `agent`, `admin`) | `xsuaa` (see `xs-security.json`) |
| S/4HANA service | local mock (`cds watch`, tests) | destination `S4HCP-ServiceOrder-Odata` |
| Messaging | file-based (`.cds-msg-box`, git-ignored) | in-process (`local-messaging`) |
| Audit log | console | SAP Audit Log service (binding `auditlog`; not verified, no BTP access) |
| Initial data | `db/data` (code lists) and `test/data` (sample messages) | `db/data` only |

- `npm run build` runs `cds build --production` and writes the deployable artifacts to `gen/`.
- `npm start` runs `cds-serve`; use `NODE_ENV=production` to select the production profile.
- `xs-security.json` defines the scopes `Viewer`, `Agent` and `Admin`, matching role
  templates and the role collections `CustomerMessages_Viewer`, `CustomerMessages_Agent`
  and `CustomerMessages_Admin`. The roles of the CDS annotations in `srv/authorization.cds` and
  `srv/admin-service.cds` are these scopes; Admin includes Agent and Viewer.
- In production the events are delivered in-process only. To exchange events with other
  applications, bind SAP Event Mesh and set `cds.requires.messaging.kind` to
  `enterprise-messaging` for the `production` profile.
- `mta.yaml` deploys the application to Cloud Foundry, see the next section.

## Deploy to Cloud Foundry

`mta.yaml` is the deployment descriptor for SAP BTP, Cloud Foundry environment, for the single-tenant
`production` profile. It has two modules, the CAP server (`gen/srv`, health check `/health`) and the
database deployer (`gen/db`), and these services:

| Service (plan) | Purpose |
|----------------|---------|
| `hana` (`hdi-shared`) | HDI container with the tables; needs an SAP HANA Cloud instance mapped to the space |
| `xsuaa` (`application`) | Created from `xs-security.json`; assign the role collections `CustomerMessages_*` to the users |
| `destination` (`lite`) | Holds the destination `S4HCP-ServiceOrder-Odata`; create it after the deployment, its URL and credentials belong to your S/4HANA Cloud system |
| `application-logs` (`standard`) | Application logs |
| `auditlog` (`premium`) | Audit log of `@cap-js/audit-logging` |

```sh
npm install -g mbt     # Cloud MTA Build Tool
mbt build              # runs npm ci and cds build --production, writes mta_archives/Benicio_1_04_1.0.0.mtar
cf deploy mta_archives/Benicio_1_04_1.0.0.mtar
```

For real AI results bind an SAP AI Core instance to the server module (see the comment in `mta.yaml`).
The descriptor has no UI module and no approuter: the Fiori app is not deployed, and the APIs are
called with a token of the XSUAA instance. `test/deploy/mta.test.js` checks that the descriptor agrees
with `package.json`, `xs-security.json` and the output of `cds build --production`, and `mbt build` created
the archive locally. **Not verified (no BTP access):** `cf deploy`, the service plans (for example the
plan of the audit log service) and the running application on Cloud Foundry.

## Run in a container

The `Dockerfile` builds an image of the CAP server for the `production` profile. The stage `build` runs
`npm ci` and `npm run build` (`cds build --production`); the stage `runtime` holds only `gen/srv` with its
production dependencies, runs as the user `node` and starts `cds-serve` directly, so the server receives
SIGTERM and shuts down gracefully. A `HEALTHCHECK` calls `/health`. `.dockerignore` keeps secrets, installed
packages, tests and documents out of the build.

```sh
docker build -t customer-messages .
docker run --rm -p 4004:4004 <bindings> customer-messages   # PORT changes the port
```

The image contains no configuration and no secret. The production profile needs the bindings of an SAP HANA
HDI container and of XSUAA (and, as described above, the destination, the audit log and AI Core); pass them as
environment variables or service bindings when the container starts. Without a HANA binding the server stops
at startup with "no HDI container ... bound to application". The database tables are not created by the
image: deploy `gen/db` to the HDI container first (the `db-deployer` of the MTA does that on Cloud Foundry).

The image was built with a local Docker daemon, and the container started as the user `node` and ran up to
the connection to the database. `test/deploy/docker.test.js` checks the Dockerfile and the build context
without Docker. **Not verified:** a run against SAP HANA and XSUAA, the shutdown on SIGTERM in the container,
and Kubernetes or Kyma. There is no Helm chart.

## Repository layout

| Path | Purpose |
|------|---------|
| `app/` | Fiori elements app `benicio_1_04.myapplication`, UI annotations (`customer-messages-ui.cds` is the file to edit, the others are generated) and launchpad preview |
| `db/schema.cds` | Domain model: entities `CustomerMessages`, `CustomerMessageReplies`, `CustomerMessageAttachments`, `Tags`, `CustomerMessageTags`, `ResponseTemplates`, `Settings` and `MessageCategories` |
| `db/data` | Reference data deployed everywhere: texts of the message categories and the initial settings row |
| `db/i18n`, `app/_i18n` | Translated labels of the model and of the Fiori UI (English default, `_de`, `_pt`) |
| `db/src`, `db/undeploy.json` | HDI deployment configuration for HANA |
| `srv/service.cds` | Service `benicio_1_04Srv` (draft-enabled, requires an authenticated user) |
| `srv/admin-service.cds` | `AdminService` for tags, response templates and settings, with its restrictions |
| `srv/authorization.cds` | Role-based and instance-based restrictions of `benicio_1_04Srv` and `OperationsService` |
| `srv/analytics-service.cds` | `AnalyticsService`: read-only `MessageAnalytics` with `@Aggregation.ApplySupported` |
| `srv/query-options.cds` | Page sizes (`@cds.query.limit`), search elements (`@cds.search`) and `@Capabilities` of the services |
| `srv/operations-service.cds`, `srv/operations-service.js` | `OperationsService` with its action, functions and handlers |
| `srv/code/message-events.js` | Subscribers of the events `MessageResolved` and `ReplyAdded` |
| `srv/code/priority.js` | Maps the priority score to a priority level |
| `srv/code/query-examples.js` | Documented examples of CQL/CQN queries, transactions and row locking (run by the tests) |
| `srv/code/typed-example.js`, `jsconfig.json`, `test/types/` | Example of code typed with the generated `@cds-models` (`npm run types`, `npm run typecheck`) and the wrong code that the test expects errors for |
| `http/` | Request files (`*.http`) for REST Client and the IntelliJ HTTP client |
| `srv/graphql.cds` | Serves `benicio_1_04Srv` and `AdminService` with GraphQL as well |
| `srv/api-docs.cds`, `scripts/openapi.js` | Titles of the services and the generator of the OpenAPI documents (`npm run openapi`) |
| `srv/server.js`, `srv/code/server/` | Custom server: request id, access log, CORS, health check, graceful shutdown |
| `db/personal-data.cds`, `srv/code/audit.js` | `@PersonalData` annotations of the customer data and the completion of the data subject of audit events |
| `db/change-tracking.cds`, `srv/change-history.cds` | `@changelog` annotations (what is tracked) and where the history is offered |
| `fts/` | Feature toggles of the `multitenancy` profile (one folder per feature) |
| `srv/mark-as-resolved.cds` | The action `markAsResolved` of the messages in `benicio_1_04Srv` for the UI |
| `srv/service-handlers.cds`, `srv/handlers/` | Plugs in `CustomerMessagesService`, a subclass of the generated service class that validates input |
| `srv/_i18n/` | Message texts (`messages*.properties`) for errors, warnings and infos |
| `srv/service.js` | Generated by SAP Build Code ("DO NOT EDIT"); registers the before-READ handler |
| `srv/code/customermessage-logic-preprocessMessages.js` | Handler before READ that queues a task for each incomplete message |
| `srv/enrichment-service.cds`, `srv/enrichment-service.js`, `srv/code/enrichment.js` | Internal `EnrichmentService` and the logic that enriches one message (called by the task queue) |
| `srv/code/genai/orchestration.js` | Prompt and client for the SAP AI orchestration service |
| `srv/external/` | Imported S/4HANA service order OData V2 service; `data/` holds the mock data for development and tests |
| `test/` | Jest tests (`*.test.js`), `setup.js` and the sample data in `test/data` |
| `docs/features.md`, `test/docs/` | Map of the CAP features to files, commands and tests, and the tests of the generated API documents and of the map |
| `xs-security.json` | XSUAA scopes, role templates and role collections |
| `mta.yaml`, `Dockerfile`, `.dockerignore`, `test/deploy/` | Cloud Foundry deployment descriptor (MTA), container image of the server and their consistency tests |
| `eslint.config.mjs` | Lint configuration |
| `package.json` | Dependencies, scripts and the `cds` configuration |
