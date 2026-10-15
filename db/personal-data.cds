using { Benicio_1_04 as my } from './schema.cds';

/**
 * Personal data of the customers. The annotations drive the audit logging (@cap-js/audit-logging):
 * - Changes of annotated data (create, update, delete) are logged as PersonalDataModified with the
 *   data subject (the customer), the object and the changed attributes. Potentially personal
 *   attributes are logged with their old and new value, sensitive ones with the value masked as ***.
 * - Reads of sensitive data are logged as SensitiveDataRead with the names of the attributes.
 * The customer is the data subject, identified by the customerId of the message. Replies and
 * attachments belong to a message and are logged for the customer of that message.
 */

annotate my.CustomerMessages with
@PersonalData.EntitySemantics : 'DataSubject'
@PersonalData.DataSubjectRole : 'Customer'
{
    customerId @PersonalData.FieldSemantics : 'DataSubjectID';
    customerName @PersonalData.IsPotentiallyPersonal;
    titleCustomerLanguage @PersonalData.IsPotentiallyPersonal;
    // The texts of the customer, and their translation, can contain anything.
    fullMessageCustomerLanguage @PersonalData.IsPotentiallySensitive;
    fullMessageEnglish @PersonalData.IsPotentiallySensitive;
};

annotate my.CustomerMessageReplies with
@PersonalData.EntitySemantics : 'Other'
{
    author @PersonalData.IsPotentiallyPersonal;
    text @PersonalData.IsPotentiallySensitive;
};

annotate my.CustomerMessageAttachments with
@PersonalData.EntitySemantics : 'Other'
{
    // Photos and documents of the customers; the content itself is never copied into the audit log.
    fileName @PersonalData.IsPotentiallyPersonal;
};
