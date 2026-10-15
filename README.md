# Customer Messages

A SAP Cloud Application Programming Model (CAP, Node.js) application to manage customer
messages. Incoming messages are enriched with generative AI: each message is translated to
English, summarized, categorized and rated for urgency and sentiment. The application was
generated with SAP Build Code (LCAP) and is exposed as an OData V4 service with a
Fiori elements UI.

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
  The action `addReply(author, text)` adds a reply to a message.
- Provides read-only analytics, the `AnalyticsService` (`/service/analytics`): the entity
  `MessageAnalytics` supports `$apply` (`groupby`, `aggregate`, `filter`), so clients can count
  and average on the server, for example
  `MessageAnalytics?$apply=groupby((messageCategory),aggregate($count as messages))` or
  `...groupby((originatingCountry),aggregate(priorityScore with average as averageScore))`.
  Groupable: category, urgency, sentiment, country, status. Viewer role required.
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
- Links a message to a service order of an SAP S/4HANA system (external OData V2 service).
- Enriches messages automatically the first time they are read (see below).

## Architecture

```
Fiori elements UI  ->  benicio_1_04Srv (OData V4, /service/benicio_1_04)
                          |-- before READ: enrich messages that miss AI fields
                          |       `-- SAP AI SDK -> Orchestration service of SAP AI Core
                          |-- db/schema.cds: Benicio_1_04.CustomerMessages
                          |       `-- SQLite (development) / SAP HANA (production)
                          `-- S4HCP_ServiceOrder_Odata (S/4HANA service orders, OData V2)

Agents  ->  OperationsService (OData V4, /service/operations)
              `-- markAsResolved, suggestedPriority, statistics

Charts  ->  AnalyticsService (OData V4, /service/analytics)
              `-- MessageAnalytics with $apply=groupby/aggregate
```

**Enrichment.** On every `READ` of `CustomerMessages` the handler in
`srv/code/customermessage-logic-preprocessMessages.js` selects the messages that have a
customer-language text but miss at least one AI field, calls the model with at most 3
parallel requests and stores the result. Messages that are complete are not touched. If the
model fails or returns an incomplete answer, the error is logged, the message stays as it
is and the READ still succeeds; the message is retried on the next read.

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
mocked authentication with the users below (HTTP basic auth) and, with `cds watch`, a local
mock of the S/4HANA service.

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

### GenAI configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `GENAI_MODEL_NAME` or `cds.genai.model` | `gpt-4o` | Model used by the orchestration service |
| `GENAI_MODEL_PARAMS` (JSON) or `cds.genai.modelParams` | `{"temperature":0,"max_tokens":1500}` | Model parameters |
| `cds.genai.concurrency` | `3` | Maximum parallel AI calls per request |

Environment variables win over `cds.genai` in `package.json`. The model name in the
`Settings` singleton (`aiModelName`) wins over both. With `autoEnrichment` set to `false`
the enrichment is skipped and the messages are read as they are.

## Test and lint

```sh
npm test        # jest + @cap-js/cds-test, in-memory SQLite, AI SDK mocked
npm run lint    # eslint with the CAP and CDS rules
```

The tests never call AI Core: `test/setup.js` replaces the AI SDK for every test.

## Profiles and production

| | `development` (default) | `production` |
|--|--|--|
| Database | SQLite in memory | SAP HANA (`@cap-js/hana`) |
| Authentication | `mocked` (users `viewer`, `agent`, `admin`) | `xsuaa` (see `xs-security.json`) |
| S/4HANA service | local mock (`cds watch`) | destination `S4HCP-ServiceOrder-Odata` |
| Messaging | file-based (`.cds-msg-box`, git-ignored) | in-process (`local-messaging`) |
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
- A deployment descriptor (for example `mta.yaml`) is not part of the repository yet.

## Repository layout

| Path | Purpose |
|------|---------|
| `app/` | Fiori elements app `benicio_1_04.myapplication`, UI annotations and launchpad preview |
| `db/schema.cds` | Domain model: entities `CustomerMessages`, `CustomerMessageReplies`, `CustomerMessageAttachments`, `Tags`, `CustomerMessageTags`, `ResponseTemplates`, `Settings` and `MessageCategories` |
| `db/data` | Reference data deployed everywhere: texts of the message categories and the initial settings row |
| `db/i18n` | Translated labels of the model (English default, `_de`, `_pt`) |
| `db/src`, `db/undeploy.json` | HDI deployment configuration for HANA |
| `srv/service.cds` | Service `benicio_1_04Srv` (draft-enabled, requires an authenticated user) |
| `srv/admin-service.cds` | `AdminService` for tags, response templates and settings, with its restrictions |
| `srv/authorization.cds` | Role-based and instance-based restrictions of `benicio_1_04Srv` and `OperationsService` |
| `srv/analytics-service.cds` | `AnalyticsService`: read-only `MessageAnalytics` with `@Aggregation.ApplySupported` |
| `srv/operations-service.cds`, `srv/operations-service.js` | `OperationsService` with its action, functions and handlers |
| `srv/code/message-events.js` | Subscribers of the events `MessageResolved` and `ReplyAdded` |
| `srv/code/priority.js` | Maps the priority score to a priority level |
| `srv/service-handlers.cds`, `srv/handlers/` | Plugs in `CustomerMessagesService`, a subclass of the generated service class that validates input |
| `srv/_i18n/` | Message texts (`messages*.properties`) for errors, warnings and infos |
| `srv/service.js` | Generated by SAP Build Code ("DO NOT EDIT"); registers the before-READ handler |
| `srv/code/customermessage-logic-preprocessMessages.js` | Handler that enriches incomplete messages |
| `srv/code/genai/orchestration.js` | Prompt and client for the SAP AI orchestration service |
| `srv/code/util/map-limit.js` | Helper to run async work with bounded concurrency |
| `srv/external/` | Imported S/4HANA service order OData V2 service |
| `test/` | Jest tests (`*.test.js`), `setup.js` and the sample data in `test/data` |
| `xs-security.json` | XSUAA scopes, role templates and role collections |
| `eslint.config.mjs` | Lint configuration |
| `package.json` | Dependencies, scripts and the `cds` configuration |
