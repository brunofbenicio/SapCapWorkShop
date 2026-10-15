using { benicio_1_04Srv, AdminService, AnalyticsService, OperationsService } from './service.cds';
using from './admin-service.cds';
using from './analytics-service.cds';
using from './operations-service.cds';

// Title and description of the services. They appear in the OpenAPI documents (npm run openapi)
// as info.title, info.description and the short text of the API, and, for the events of the
// OperationsService, in the AsyncAPI document (npm run asyncapi).

annotate benicio_1_04Srv with
@title : 'Customer Messages'
@Core.Description : 'Customer messages with replies, attachments and tags'
@Core.LongDescription : 'Customer messages enriched by generative AI (translation, summary, category, urgency, sentiment). Messages are created and changed in drafts: edit, patch the draft, then call draftActivate.';

annotate OperationsService with
@title : 'Customer Messages Operations'
@Core.Description : 'Work queue of the agents'
@Core.LongDescription : 'Read-only view on the customer messages with the actions markAsResolved and addReply and the functions suggestedPriority and statistics.'
@AsyncAPI.Title : 'Customer Messages Events'
@AsyncAPI.SchemaVersion : '1.0.0'
@AsyncAPI.Description : 'Events about customer messages: a message was resolved, a reply was added.';

annotate AdminService with
@title : 'Customer Messages Administration'
@Core.Description : 'Tags, response templates and settings'
@Core.LongDescription : 'Maintenance of the tags, the temporal response templates and the application settings.';

annotate AnalyticsService with
@title : 'Customer Messages Analytics'
@Core.Description : 'Aggregations of the customer messages'
@Core.LongDescription : 'Read-only view with $apply (groupby, aggregate, filter) to count and average the customer messages by category, urgency, sentiment, country and status.';
