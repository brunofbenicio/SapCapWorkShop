using { benicio_1_04Srv } from './service.cds';

// The change history (db/change-tracking.cds) is offered by the OperationsService (the history of a
// message) and the AdminService (the history of tags, templates and settings), through the
// navigation property "changes".
//
// It is not offered by benicio_1_04Srv: the plugin's view of the changes joins several tables, and
// the handler of SAP Build Code (@sap/low-code-event-handler), which this service inherits from,
// fails with a TypeError on every request for an entity that has an association to such a view.
annotate benicio_1_04Srv.CustomerMessages with @changelog.disable_assoc;
annotate benicio_1_04Srv.Tags with @changelog.disable_assoc;
annotate benicio_1_04Srv.ResponseTemplates with @changelog.disable_assoc;
annotate benicio_1_04Srv.Settings with @changelog.disable_assoc;

// The analytics view only aggregates; it offers no history.
using { AnalyticsService } from './analytics-service.cds';
annotate AnalyticsService.MessageAnalytics with @changelog.disable_assoc;
