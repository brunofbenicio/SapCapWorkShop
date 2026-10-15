namespace Benicio_1_04;

using { S4HCP_ServiceOrder_Odata } from '../srv/external/S4HCP_ServiceOrder_Odata.cds';

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

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
        @mandatory;
    titleEnglish : String(100);
    customerName : String(100);
    productName : String(100);
    summaryEnglish : String(500);
    messageCategory : MessageCategory;
    messageUrgency : MessageUrgency;
    messageSentiment : MessageSentiment;
    titleCustomerLanguage : String(100);
    customerId : String(50);
    productId : String(50);
    summaryCustomerLanguage : String(500);
    originatingCountry : String(100);
    sourceLanguage : String(10);
    fullMessageCustomerLanguage : String(1000);
    fullMessageEnglish : String(1000);
    suggestedResponseEnglish : String(1000);
    suggestedResponseCustomerLanguage : String(1000);
    S4HCP_ServiceOrder : Association to one S4HCP_ServiceOrder_Odata.A_ServiceOrder;
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
     * English title when available, otherwise the title in the customer's
     * language. Stored in the database, so it can be sorted and searched cheaply.
     */
    @title : '{i18n>DisplayTitle}'
    displayTitle : String(100) = coalesce(titleEnglish, titleCustomerLanguage) stored;

    replies : Composition of many CustomerMessageReplies
        on replies.message = $self
        @title : '{i18n>Replies}';
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

annotate CustomerMessages with @assert.unique :
{
    customerMessageID : [ customerMessageID ],
};
