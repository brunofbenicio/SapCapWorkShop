using benicio_1_04Srv as service from '../srv/service';
using from './benicio_1_04.myapplication/annotations';

// Fiori elements UI of the customer messages for the model of the app: filter bar, list with
// criticality, object page with header data points and chart, facets for the parts of a message,
// value helps, side effects and the action to resolve a message. It builds on the annotations that SAP
// Build Code generated (app/annotations.cds and benicio_1_04.myapplication/annotations.cds) and replaces
// the ones for the same targets. The texts are literals here; db/i18n and app/_i18n translate them.

annotate service.CustomerMessages with @(

    // --- Header

    UI.HeaderInfo : {
        TypeName : 'Customer Message',
        TypeNamePlural : 'Customer Messages',
        Title : { Value : displayTitle },
        Description : { Value : customerName },
    },

    // --- Filter bar and list

    UI.SelectionFields : [
        customerMessageID,
        messageCategory,
        messageUrgency,
        messageSentiment,
        status,
        originatingCountry,
        productName,
    ],

    UI.LineItem : [
        { $Type : 'UI.DataField', Value : customerMessageID, @UI.Importance : #High },
        { $Type : 'UI.DataField', Value : displayTitle, @UI.Importance : #High },
        { $Type : 'UI.DataField', Value : customerName, @UI.Importance : #High },
        { $Type : 'UI.DataField', Value : productName },
        { $Type : 'UI.DataField', Value : messageCategory },
        { $Type : 'UI.DataField', Value : messageUrgency, Criticality : urgencyCriticality, CriticalityRepresentation : #WithIcon, @UI.Importance : #High },
        { $Type : 'UI.DataField', Value : messageSentiment, Criticality : sentimentCriticality, CriticalityRepresentation : #WithIcon },
        { $Type : 'UI.DataField', Value : priorityScore, Criticality : priorityCriticality },
        { $Type : 'UI.DataField', Value : status, Criticality : statusCriticality, @UI.Importance : #High },
        { $Type : 'UI.DataField', Value : originatingCountry },
        { $Type : 'UI.DataFieldForAction', Action : 'benicio_1_04Srv.markAsResolved', Label : 'Mark as resolved', @UI.Importance : #High },
    ],

    // --- Object page: header with data points and a chart

    UI.DataPoint #Urgency : {
        Value : messageUrgency,
        Title : 'Urgency',
        Criticality : urgencyCriticality,
    },
    UI.DataPoint #Sentiment : {
        Value : messageSentiment,
        Title : 'Sentiment',
        Criticality : sentimentCriticality,
    },
    UI.DataPoint #Status : {
        Value : status,
        Title : 'Status',
        Criticality : statusCriticality,
    },
    UI.DataPoint #Priority : {
        Value : priorityScore,
        Title : 'Priority score',
        Criticality : priorityCriticality,
        MinimumValue : 0,
        MaximumValue : 5,
        TargetValue : 5,
    },
    UI.Chart #Priority : {
        $Type : 'UI.ChartDefinitionType',
        Title : 'Priority',
        ChartType : #Bullet,
        Measures : [ priorityScore ],
        MeasureAttributes : [
            {
                $Type : 'UI.ChartMeasureAttributeType',
                Measure : priorityScore,
                Role : #Axis1,
                DataPoint : '@UI.DataPoint#Priority',
            },
        ],
    },
    UI.HeaderFacets : [
        { $Type : 'UI.ReferenceFacet', ID : 'UrgencyHeader', Target : '@UI.DataPoint#Urgency' },
        { $Type : 'UI.ReferenceFacet', ID : 'SentimentHeader', Target : '@UI.DataPoint#Sentiment' },
        { $Type : 'UI.ReferenceFacet', ID : 'StatusHeader', Target : '@UI.DataPoint#Status' },
        { $Type : 'UI.ReferenceFacet', ID : 'PriorityHeader', Target : '@UI.Chart#Priority' },
    ],

    // --- Object page: the action in the header (only for a saved, open message, see below)

    UI.Identification : [
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'benicio_1_04Srv.markAsResolved',
            Label : 'Mark as resolved',
            Criticality : #Positive,
            @UI.Importance : #High,
        },
    ],

    // --- Object page: field groups and facets

    UI.FieldGroup #Customer : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : customerName },
            { $Type : 'UI.DataField', Value : customerId },
            { $Type : 'UI.DataField', Value : originatingCountry },
            { $Type : 'UI.DataField', Value : sourceLanguage },
            { $Type : 'UI.DataField', Value : productName },
            { $Type : 'UI.DataField', Value : productId },
        ],
    },
    UI.FieldGroup #Classification : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : messageCategory },
            { $Type : 'UI.DataField', Value : messageUrgency, Criticality : urgencyCriticality },
            { $Type : 'UI.DataField', Value : messageSentiment, Criticality : sentimentCriticality },
            { $Type : 'UI.DataField', Value : priorityScore, Criticality : priorityCriticality },
        ],
    },
    UI.FieldGroup #Resolution : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : status, Criticality : statusCriticality },
            { $Type : 'UI.DataField', Value : resolvedAt },
            { $Type : 'UI.DataField', Value : resolvedBy },
            { $Type : 'UI.DataField', Value : resolution },
        ],
    },
    UI.FieldGroup #Message : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : titleCustomerLanguage },
            { $Type : 'UI.DataField', Value : fullMessageCustomerLanguage },
            { $Type : 'UI.DataField', Value : titleEnglish },
            { $Type : 'UI.DataField', Value : fullMessageEnglish },
        ],
    },
    UI.FieldGroup #Summary : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : summaryEnglish },
            { $Type : 'UI.DataField', Value : summaryCustomerLanguage },
            { $Type : 'UI.DataField', Value : suggestedResponseEnglish },
            { $Type : 'UI.DataField', Value : suggestedResponseCustomerLanguage },
        ],
    },
    UI.FieldGroup #ServiceOrder : {
        $Type : 'UI.FieldGroupType',
        Data : [
            { $Type : 'UI.DataField', Value : S4HCP_ServiceOrder_ServiceOrder, Label : 'Service order' },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.CollectionFacet',
            ID : 'General',
            Label : 'General Information',
            Facets : [
                { $Type : 'UI.ReferenceFacet', ID : 'Customer', Label : 'Customer and Product', Target : '@UI.FieldGroup#Customer' },
                { $Type : 'UI.ReferenceFacet', ID : 'Classification', Label : 'Classification', Target : '@UI.FieldGroup#Classification' },
                { $Type : 'UI.ReferenceFacet', ID : 'Resolution', Label : 'Resolution', Target : '@UI.FieldGroup#Resolution' },
            ],
        },
        { $Type : 'UI.ReferenceFacet', ID : 'Message', Label : 'Message', Target : '@UI.FieldGroup#Message' },
        { $Type : 'UI.ReferenceFacet', ID : 'Summary', Label : 'Summary and Suggested Response', Target : '@UI.FieldGroup#Summary' },
        { $Type : 'UI.ReferenceFacet', ID : 'Replies', Label : 'Replies', Target : 'replies/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'Tags', Label : 'Tags', Target : 'tags/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'Attachments', Label : 'Attachments', Target : 'attachments/@UI.LineItem' },
        { $Type : 'UI.ReferenceFacet', ID : 'ServiceOrder', Label : 'Service Order', Target : '@UI.FieldGroup#ServiceOrder' },
    ],

    // --- Side effects: what the UI reloads after a change

    // The priority and the colors are calculated from urgency and sentiment.
    Common.SideEffects #Classification : {
        SourceProperties : [ messageUrgency, messageSentiment ],
        TargetProperties : [ 'priorityScore', 'priorityCriticality', 'urgencyCriticality', 'sentimentCriticality' ],
    },
    // The title of the header is the English title, or the original one.
    Common.SideEffects #Title : {
        SourceProperties : [ titleEnglish, titleCustomerLanguage ],
        TargetProperties : [ 'displayTitle' ],
    },
);

// --- Elements: value helps and texts

annotate service.CustomerMessages with {
    messageCategory @(
        Common.Text : category.name,
        Common.Text.@UI.TextArrangement : #TextFirst,
        Common.ValueListWithFixedValues : true,
        Common.ValueList : {
            $Type : 'Common.ValueListType',
            CollectionPath : 'MessageCategories',
            Parameters : [
                { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : messageCategory, ValueListProperty : 'code' },
                { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'name' },
                { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'descr' },
            ],
        },
    );
    fullMessageCustomerLanguage @UI.MultiLineText;
    fullMessageEnglish @UI.MultiLineText;
    summaryEnglish @UI.MultiLineText;
    summaryCustomerLanguage @UI.MultiLineText;
    suggestedResponseEnglish @UI.MultiLineText;
    suggestedResponseCustomerLanguage @UI.MultiLineText;
    resolution @UI.MultiLineText;
};

// --- The action to resolve a message

annotate service.CustomerMessages actions {
    // Offered for a saved message that is open; the server refuses a resolved one with 409 anyway.
    markAsResolved @(
        Core.OperationAvailable : ($draft.IsActiveEntity and $self.status = 'Open'),
        Common.SideEffects : {
            TargetProperties : [ 'in/status', 'in/statusCriticality', 'in/resolvedAt', 'in/resolvedBy', 'in/resolution' ],
        },
    ) (
        resolution @(Common.Label : 'Resolution', UI.MultiLineText : true)
    );
};

// --- Replies, tags and attachments of a message

annotate service.CustomerMessageReplies with @(
    UI.HeaderInfo : {
        TypeName : 'Reply',
        TypeNamePlural : 'Replies',
    },
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : author },
        { $Type : 'UI.DataField', Value : text },
        { $Type : 'UI.DataField', Value : sentAt },
    ],
);

annotate service.CustomerMessageTags with @(
    UI.HeaderInfo : {
        TypeName : 'Tag',
        TypeNamePlural : 'Tags',
    },
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : tag_code, Label : 'Tag' },
    ],
);

annotate service.CustomerMessageTags with {
    tag @(
        Common.Text : tag.title,
        Common.Text.@UI.TextArrangement : #TextFirst,
        Common.ValueListWithFixedValues : true,
        Common.ValueList : {
            $Type : 'Common.ValueListType',
            CollectionPath : 'Tags',
            Parameters : [
                { $Type : 'Common.ValueListParameterInOut', LocalDataProperty : tag_code, ValueListProperty : 'code' },
                { $Type : 'Common.ValueListParameterDisplayOnly', ValueListProperty : 'title' },
            ],
        },
    );
};

annotate service.CustomerMessageAttachments with @(
    UI.HeaderInfo : {
        TypeName : 'Attachment',
        TypeNamePlural : 'Attachments',
    },
    UI.LineItem : [
        { $Type : 'UI.DataField', Value : content, Label : 'File' },
        { $Type : 'UI.DataField', Value : fileName },
        { $Type : 'UI.DataField', Value : mediaType },
        { $Type : 'UI.DataField', Value : createdAt },
        { $Type : 'UI.DataField', Value : createdBy },
    ],
);
