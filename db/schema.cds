namespace Benicio_1_04;

using { S4HCP_ServiceOrder_Odata } from '../srv/external/S4HCP_ServiceOrder_Odata.cds';

using { cuid, managed } from '@sap/cds/common';

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
}

annotate CustomerMessages with @assert.unique :
{
    customerMessageID : [ customerMessageID ],
};
