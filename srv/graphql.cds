using { benicio_1_04Srv, AdminService } from './service.cds';
using from './admin-service.cds';

annotate benicio_1_04Srv with @protocol : [ 'odata-v4', 'graphql' ];
annotate AdminService with @protocol : [ 'odata-v4', 'graphql' ];
