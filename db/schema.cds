namespace Benicio_1_04;

using { S4HCP_ServiceOrder_Odata } from '../srv/external/S4HCP_ServiceOrder_Odata.cds';

using { cuid, managed, temporal, sap.common.CodeList } from '@sap/cds/common';

/**
 * Values of the AI-derived classification fields. The GenAI prompt in
 * srv/code/genai/orchestration.js must list exactly these values.
 * With @assert.range the service rejects other values (ASSERT_ENUM).
 */
@assert.range
type MessageCategory : String(50) enum
{
    Technical;
    Delivery;
    Service;
}

@assert.range
type MessageUrgency : String(20) enum
{
    High;
    Medium;
    Low;
}

@assert.range
type MessageSentiment : String(20) enum
{
    Negative;
    Positive;
    Neutral;
}

/**
 * Processing status of a customer message. It is set by the action
 * markAsResolved of the OperationsService, not edited directly.
 */
@assert.range
type MessageStatus : String(20) enum
{
    Open;
    Resolved;
}

/**
 * Code list with the localized names of the message categories. The codes are
 * the values of MessageCategory; the texts live in db/data (*.csv, *.texts.csv).
 */
@title : '{i18n>MessageCategories}'
entity MessageCategories : CodeList
{
    key code : MessageCategory;
}

@title : '{i18n>CustomerMessages}'
entity CustomerMessages : cuid, managed
{
    customerMessageID : Integer
        @mandatory
        @assert.range : [ 1, 999999999 ];
    titleEnglish : String(100);
    customerName : String(100);
    productName : String(100);
    summaryEnglish : String(500);
    messageCategory : MessageCategory;
    messageUrgency : MessageUrgency;
    messageSentiment : MessageSentiment;
    titleCustomerLanguage : String(100);
    customerId : String(50)
        @assert.format : '^[A-Za-z0-9][A-Za-z0-9._-]*$'
        @assert.format.message : 'ID_FORMAT';
    productId : String(50)
        @assert.format : '^[A-Za-z0-9][A-Za-z0-9._-]*$'
        @assert.format.message : 'ID_FORMAT';
    summaryCustomerLanguage : String(500);
    originatingCountry : String(100);
    sourceLanguage : String(10);
    fullMessageCustomerLanguage : String(1000);
    fullMessageEnglish : String(1000);
    suggestedResponseEnglish : String(1000);
    suggestedResponseCustomerLanguage : String(1000);
    S4HCP_ServiceOrder : Association to one S4HCP_ServiceOrder_Odata.A_ServiceOrder;
    @readonly
    @title : '{i18n>Status}'
    status : MessageStatus default 'Open';
    @readonly
    @title : '{i18n>ResolvedAt}'
    resolvedAt : Timestamp;
    @readonly
    @title : '{i18n>ResolvedBy}'
    resolvedBy : String(255);
    @readonly
    @title : '{i18n>Resolution}'
    resolution : String(1000);
    category : Association to one MessageCategories
        on category.code = messageCategory
        @title : '{i18n>Category}';

    /**
     * Priority derived from the urgency (High 3, Medium 2, Low 1) and the
     * sentiment (Negative 2, Neutral 1, Positive 0). Calculated on read.
     */
    @title : '{i18n>PriorityScore}'
    priorityScore : Integer = (
        case
            when messageUrgency = 'High' then 3
            when messageUrgency = 'Medium' then 2
            when messageUrgency = 'Low' then 1
            else 0
        end
        + case
            when messageSentiment = 'Negative' then 2
            when messageSentiment = 'Neutral' then 1
            else 0
        end
    );

    /**
     * Criticality of the urgency, the sentiment, the status and the priority for the UI
     * (0 neutral, 1 negative/red, 2 critical/orange, 3 positive/green). Calculated on read.
     */
    @UI.Hidden
    urgencyCriticality : Integer = (
        case
            when messageUrgency = 'High' then 1
            when messageUrgency = 'Medium' then 2
            when messageUrgency = 'Low' then 3
            else 0
        end
    );

    @UI.Hidden
    sentimentCriticality : Integer = (
        case
            when messageSentiment = 'Negative' then 1
            when messageSentiment = 'Positive' then 3
            else 0
        end
    );

    @UI.Hidden
    statusCriticality : Integer = (
        case
            when status = 'Open' then 2
            when status = 'Resolved' then 3
            else 0
        end
    );

    @UI.Hidden
    priorityCriticality : Integer = (
        case
            when priorityScore >= 4 then 1
            when priorityScore >= 2 then 2
            else 3
        end
    );

    /**
     * English title when available, otherwise the title in the customer's
     * language. Stored in the database, so it can be sorted and searched cheaply.
     */
    @title : '{i18n>DisplayTitle}'
    displayTitle : String(100) = coalesce(titleEnglish, titleCustomerLanguage) stored;

    replies : Composition of many CustomerMessageReplies
        on replies.message = $self
        @title : '{i18n>Replies}';
    attachments : Composition of many CustomerMessageAttachments
        on attachments.message = $self
        @title : '{i18n>Attachments}';
    tags : Composition of many CustomerMessageTags
        on tags.message = $self
        @title : '{i18n>Tags}';
}

/**
 * Reply that an agent sent to a customer message. Replies are part of the
 * message: they are created, edited and deleted together with it.
 */
@title : '{i18n>CustomerMessageReplies}'
entity CustomerMessageReplies : cuid, managed
{
    message : Association to one CustomerMessages;
    author : String(100)
        @mandatory;
    text : String(2000)
        @mandatory;
    sentAt : Timestamp
        @cds.on.insert : $now;
}

/**
 * File attached to a customer message, for example a photo of the defect.
 * The binary content is streamed: it is not part of the entity JSON and is
 * served as a download (Content-Disposition: attachment).
 */
@title : '{i18n>CustomerMessageAttachments}'
entity CustomerMessageAttachments : cuid, managed
{
    message : Association to one CustomerMessages;
    fileName : String(255)
        @mandatory;
    mediaType : String(100)
        @Core.IsMediaType;
    content : LargeBinary
        @Core.MediaType : mediaType
        @Core.ContentDisposition.Filename : fileName
        @Core.ContentDisposition.Type : 'attachment';
}

/**
 * Free-form label that can be put on many messages, for example "warranty".
 * Together with CustomerMessageTags it forms a many-to-many relation.
 */
@title : '{i18n>Tags}'
entity Tags : managed
{
    key code : String(40)
        @assert.format : '^[a-z0-9]+(-[a-z0-9]+)*$'
        @assert.format.message : 'SLUG_FORMAT';
    title : String(100)
        @mandatory;
    messages : Association to many CustomerMessageTags
        on messages.tag = $self;
}

/**
 * Link entity of the many-to-many relation between messages and tags.
 * A tag can be put on a message only once.
 */
@title : '{i18n>CustomerMessageTags}'
entity CustomerMessageTags : cuid
{
    message : Association to one CustomerMessages;
    tag : Association to one Tags
        @mandatory
        @assert.target;
}

/**
 * Text blocks for replies to customers. Templates are temporal: every version
 * is valid for a period (validFrom inclusive, validTo exclusive), so the text
 * that applied on a given date can still be read ("time travel").
 */
@title : '{i18n>ResponseTemplates}'
entity ResponseTemplates : temporal, managed
{
    key code : String(40)
        @assert.format : '^[a-z0-9]+(-[a-z0-9]+)*$'
        @assert.format.message : 'SLUG_FORMAT';
    // Without an explicit period a version is valid from now on and without end.
    validFrom : Timestamp default $now @cds.valid.from;
    validTo : Timestamp default '9999-12-31T23:59:59.999Z' @cds.valid.to;
    title : String(100)
        @mandatory;
    messageCategory : MessageCategory;
    text : String(2000)
        @mandatory;
}

/**
 * Application-wide options. The table holds exactly one row (ID 1), which is
 * delivered with the initial data in db/data and exposed as an OData singleton.
 */
@title : '{i18n>Settings}'
entity Settings : managed
{
    key ID : Integer default 1;
    /** Enrich customer messages with GenAI when they are read. */
    @title : '{i18n>AutoEnrichment}'
    autoEnrichment : Boolean default true;
    /** Name of the AI model; if empty, the model from the configuration is used. */
    @title : '{i18n>AiModelName}'
    aiModelName : String(100)
        @assert.format : '^[A-Za-z0-9][A-Za-z0-9._-]*$'
        @assert.format.message : 'MODEL_NAME_FORMAT';
}

annotate CustomerMessageTags with @assert.unique :
{
    messageTag : [ message, tag ],
};

annotate CustomerMessages with @assert.unique :
{
    customerMessageID : [ customerMessageID ],
};
