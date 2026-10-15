using { Benicio_1_04 as my } from '../db/schema.cds';

/**
 * Maintenance of the shared reference data (tags and response templates) and
 * of the application settings. Everyone with a role may read; agents may
 * create entries and change or delete their own, administrators may do everything.
 * The roles correspond to the scopes in xs-security.json.
 */
@path : '/service/admin'
service AdminService
{
    entity Tags as
        projection on my.Tags excluding { messages };

    entity ResponseTemplates as
        projection on my.ResponseTemplates;

    @odata.singleton
    entity Settings as
        projection on my.Settings;
}

annotate AdminService with @requires :
[
    'authenticated-user'
];

annotate AdminService.Tags with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : 'CREATE', to : 'Agent' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Admin' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Agent', where : 'createdBy = $user' }
];

annotate AdminService.ResponseTemplates with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : 'CREATE', to : 'Agent' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Admin' },
    { grant : [ 'UPDATE', 'DELETE' ], to : 'Agent', where : 'createdBy = $user' }
];

annotate AdminService.Settings with @restrict :
[
    { grant : 'READ', to : 'Viewer' },
    { grant : 'UPDATE', to : 'Admin' }
];
