using { Benicio_1_04 as my } from '../db/schema.cds';

/**
 * Work queue of the agents: read-only view on the customer messages with the
 * operations that change their processing state.
 */
@path : '/service/operations'
service OperationsService
{
    type PriorityLevel : String enum
    {
        Critical;
        High;
        Medium;
        Low;
    }

    type SuggestedPriority
    {
        score : Integer;
        level : PriorityLevel;
    }

    type CountPerValue
    {
        value : String;
        count : Integer;
    }

    type Statistics
    {
        total : Integer;
        open : Integer;
        resolved : Integer;
        byCategory : many CountPerValue;
        byUrgency : many CountPerValue;
    }

    @readonly
    entity CustomerMessages as
        projection on my.CustomerMessages
        {
            ID,
            customerMessageID,
            customerName,
            productName,
            displayTitle,
            titleEnglish,
            titleCustomerLanguage,
            messageCategory,
            messageUrgency,
            messageSentiment,
            priorityScore,
            status,
            resolvedAt,
            resolvedBy,
            resolution,
            createdAt,
            createdBy,
            modifiedAt,
            modifiedBy
        }
        actions
        {
            /** Closes the message. Fails with 409 if it is already resolved. */
            action markAsResolved(resolution : String(1000)) returns CustomerMessages;
            /** Suggests how urgently the message should be handled, based on priorityScore. */
            function suggestedPriority() returns SuggestedPriority;
        };

    /** Number of messages in total, per status, per category and per urgency. */
    function statistics() returns Statistics;
}

annotate OperationsService with @requires :
[
    'authenticated-user'
];
