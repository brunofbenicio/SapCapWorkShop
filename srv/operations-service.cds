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

    /** Emitted when an agent has resolved a customer message. */
    event MessageResolved
    {
        messageID : UUID;
        customerMessageID : Integer;
        resolvedBy : String(255);
        resolvedAt : Timestamp;
        resolution : String(1000);
    }

    /** Emitted when a reply has been added to a customer message. */
    event ReplyAdded
    {
        messageID : UUID;
        customerMessageID : Integer;
        replyID : UUID;
        author : String(100);
        sentAt : Timestamp;
    }

    @readonly
    entity CustomerMessageReplies as
        projection on my.CustomerMessageReplies
        {
            ID,
            message,
            author,
            text,
            sentAt
        };

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
            /** Closes the message and emits MessageResolved. Fails with 409 if it is already resolved. */
            action markAsResolved(resolution : String(1000)) returns CustomerMessages;
            /** Adds a reply to the message and emits ReplyAdded. */
            action addReply(author : String(100) @mandatory, text : String(2000) @mandatory) returns CustomerMessageReplies;
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
