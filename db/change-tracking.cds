using { Benicio_1_04 as my } from './schema.cds';
using { sap.changelog.ChangeView } from '@cap-js/change-tracking';

// Change history (@cap-js/change-tracking). The plugin records every change of an annotated element
// in sap.changelog.Changes with database triggers, so changes made by handlers (the status set by
// markAsResolved, the classification set by the AI) are recorded as well as changes made by users.
// The entity annotation names the elements that identify the object in the history.
//
// Personal and sensitive data (names, texts, see personal-data.cds) is not tracked: reading the
// history would circumvent the audit log.

annotate my.CustomerMessages with @changelog : [ customerMessageID ]
{
    messageCategory @changelog;
    messageUrgency @changelog;
    messageSentiment @changelog;
    status @changelog;
};

annotate my.ResponseTemplates with @changelog : [ code ]
{
    title @changelog;
    text @changelog;
    messageCategory @changelog;
    validFrom @changelog;
    validTo @changelog;
};

annotate my.Tags with @changelog : [ code ]
{
    title @changelog;
};

annotate my.Settings with @changelog : [ ID ]
{
    autoEnrichment @changelog;
    aiModelName @changelog;
};

// The history is read by navigation from the tracked entities (changes) and is exposed in the services
// as an auto-exposed view. Everybody who may read the data may read its history, nobody else.
annotate ChangeView with @restrict : [ { grant : 'READ', to : 'Viewer' } ];
