using { S4HCP_ServiceOrder_Odata } from './external/S4HCP_ServiceOrder_Odata.cds';

using { Benicio_1_04 as my } from '../db/schema.cds';

@path : '/service/benicio_1_04'
service benicio_1_04Srv
{
    @odata.draft.enabled
    entity CustomerMessages as
        projection on my.CustomerMessages;

    entity A_ServiceOrder as
        projection on S4HCP_ServiceOrder_Odata.A_ServiceOrder
        {
            ServiceOrder,
            ServiceOrderDescription
        };
}

annotate benicio_1_04Srv with @requires :
[
    'authenticated-user'
];
