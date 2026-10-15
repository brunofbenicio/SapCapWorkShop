using { benicio_1_04Srv, OperationsService } from './service.cds';
using from './operations-service.cds';

/**
 * Authorization of the existing services. The roles are the scopes of xs-security.json:
 * Viewer reads, Agent also creates and edits, Admin may do everything. Because the
 * role templates include the lower roles, an Admin also has the roles Agent and Viewer.
 * Instance-based rule: an Agent may only change or delete messages that the Agent created.
 */

// --- benicio_1_04Srv: the app of the agents

annotate benicio_1_04Srv.CustomerMessages with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : 'CREATE', to : 'Agent' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Admin' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Agent', where : 'createdBy = $user' }
];

// The parts of a message are changed in the draft of the message, which is restricted above.
annotate benicio_1_04Srv.CustomerMessageReplies with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : [ 'CREATE', 'UPDATE', 'DELETE' ], to : 'Agent' }
];

annotate benicio_1_04Srv.CustomerMessageAttachments with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : [ 'CREATE', 'UPDATE', 'DELETE' ], to : 'Agent' }
];

annotate benicio_1_04Srv.CustomerMessageTags with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : [ 'CREATE', 'UPDATE', 'DELETE' ], to : 'Agent' }
];

// Reference data and settings are maintained in the AdminService.
annotate benicio_1_04Srv.Tags with @readonly @restrict : [ { grant : 'READ', to : 'Viewer' } ];
annotate benicio_1_04Srv.ResponseTemplates with @readonly @restrict : [ { grant : 'READ', to : 'Viewer' } ];
annotate benicio_1_04Srv.Settings with @readonly @restrict : [ { grant : 'READ', to : 'Viewer' } ];
annotate benicio_1_04Srv.MessageCategories with @restrict : [ { grant : 'READ', to : 'Viewer' } ];
annotate benicio_1_04Srv.A_ServiceOrder with @restrict : [ { grant : 'READ', to : 'Viewer' } ];

// --- OperationsService: the work queue of the agents

// A @restrict on an entity must also grant its bound actions and functions.
annotate OperationsService.CustomerMessages with @restrict :
[
    { grant : [ 'READ', 'suggestedPriority' ], to : 'Viewer' },
    { grant : [ 'markAsResolved', 'addReply' ], to : 'Agent' }
];

annotate OperationsService.CustomerMessageReplies with @restrict : [ { grant : 'READ', to : 'Viewer' } ];

annotate OperationsService.statistics with @(requires : 'Viewer');
