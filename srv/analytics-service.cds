using { Benicio_1_04 as my } from '../db/schema.cds';

/**
 * Read-only analytics on the customer messages. The entity MessageAnalytics supports the
 * OData data aggregation extension ($apply), so a client can group and aggregate on the
 * server, for example:
 *
 *   MessageAnalytics?$apply=groupby((messageCategory),aggregate($count as messages))
 *   MessageAnalytics?$apply=groupby((originatingCountry),aggregate(priorityScore with average as averagePriority))
 *
 * The groupable and aggregatable properties are advertised in the metadata through
 * @Aggregation.ApplySupported, which Fiori elements charts and analytical tables read.
 */
@path : '/service/analytics'
service AnalyticsService
{
    @readonly
    @Aggregation.ApplySupported :
    {
        Transformations : [ 'aggregate', 'groupby', 'filter' ],
        GroupableProperties : [ messageCategory, messageUrgency, messageSentiment, originatingCountry, status ],
        AggregatableProperties :
        [
            { Property : messageCount, SupportedAggregationMethods : [ 'sum' ] },
            { Property : priorityScore, SupportedAggregationMethods : [ 'min', 'max', 'average', 'sum' ] }
        ]
    }
    entity MessageAnalytics as
        projection on my.CustomerMessages
        {
            key ID,
            customerMessageID,
            messageCategory,
            messageUrgency,
            messageSentiment,
            originatingCountry,
            status,
            /** Every row counts once, so the sum of messageCount is the number of messages. */
            1 as messageCount : Integer,
            priorityScore
        };
}

annotate AnalyticsService with @requires :
[
    'authenticated-user'
];

annotate AnalyticsService.MessageAnalytics with @restrict :
[
    { grant : 'READ', to : 'Viewer' }
];
