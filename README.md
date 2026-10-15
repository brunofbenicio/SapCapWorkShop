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
dummy authentication (every request is allowed) and, with `cds watch`, a local mock of the
S/4HANA service.

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

Environment variables win over `cds.genai` in `package.json`.

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
| Authentication | `dummy` | `xsuaa` (see `xs-security.json`) |
| S/4HANA service | local mock (`cds watch`) | destination `S4HCP-ServiceOrder-Odata` |
| Initial data | `db/data` (code lists) and `test/data` (sample messages) | `db/data` only |

- `npm run build` runs `cds build --production` and writes the deployable artifacts to `gen/`.
- `npm start` runs `cds-serve`; use `NODE_ENV=production` to select the production profile.
- `xs-security.json` defines the scopes `Viewer`, `Agent` and `Admin`, matching role
  templates and the role collections `CustomerMessages_Viewer`, `CustomerMessages_Agent`
  and `CustomerMessages_Admin`. The service itself still only requires an authenticated user.
- A deployment descriptor (for example `mta.yaml`) is not part of the repository yet.

## Repository layout

| Path | Purpose |
|------|---------|
| `app/` | Fiori elements app `benicio_1_04.myapplication`, UI annotations and launchpad preview |
| `db/schema.cds` | Domain model: entities `CustomerMessages` and `MessageCategories` |
| `db/data` | Reference data deployed everywhere: texts of the message categories |
| `db/i18n` | Translated labels of the model (English default, `_de`, `_pt`) |
| `db/src`, `db/undeploy.json` | HDI deployment configuration for HANA |
| `srv/service.cds` | Service `benicio_1_04Srv` (draft-enabled, requires an authenticated user) |
| `srv/service.js` | Generated by SAP Build Code ("DO NOT EDIT"); registers the before-READ handler |
| `srv/code/customermessage-logic-preprocessMessages.js` | Handler that enriches incomplete messages |
| `srv/code/genai/orchestration.js` | Prompt and client for the SAP AI orchestration service |
| `srv/code/util/map-limit.js` | Helper to run async work with bounded concurrency |
| `srv/external/` | Imported S/4HANA service order OData V2 service |
| `test/` | Jest tests (`*.test.js`), `setup.js` and the sample data in `test/data` |
| `xs-security.json` | XSUAA scopes, role templates and role collections |
| `eslint.config.mjs` | Lint configuration |
| `package.json` | Dependencies, scripts and the `cds` configuration |
