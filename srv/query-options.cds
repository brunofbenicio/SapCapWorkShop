using { benicio_1_04Srv, OperationsService, AdminService, AnalyticsService } from './service.cds';
using from './admin-service.cds';
using from './analytics-service.cds';
using from './operations-service.cds';

/**
 * How clients may query the services: page sizes, full-text search and capability hints.
 *
 * - @cds.query.limit: a request without $top returns "default" rows and a request with a
 *   bigger $top is cut to "max" rows; the response then carries @odata.nextLink. The limits
 *   apply to HTTP requests, not to reads from the service code.
 * - @cds.search: the elements that $search looks at. Without the annotation every plain
 *   string element is searched, including codes, names of users and long texts.
 * - @Capabilities: SearchRestrictions, SortRestrictions and FilterRestrictions are hints
 *   that Fiori elements reads from the metadata to hide what makes no sense; the server does
 *   not enforce them. ExpandRestrictions is enforced.
 */

// --- Page sizes

annotate benicio_1_04Srv with @cds.query.limit : { default : 50, max : 200 };
annotate OperationsService with @cds.query.limit : { default : 50, max : 200 };
annotate AdminService with @cds.query.limit : { default : 100, max : 500 };
annotate AnalyticsService with @cds.query.limit : { default : 200, max : 1000 };

// --- Search

// People look for a customer, a product, an ID or a word of the message or of its tags. The
// classification, status, audit fields and language codes are filtered, not searched.
annotate benicio_1_04Srv.CustomerMessages with @cds.search :
{
    titleEnglish,
    titleCustomerLanguage,
    summaryEnglish,
    summaryCustomerLanguage,
    fullMessageEnglish,
    fullMessageCustomerLanguage,
    customerName,
    productName,
    customerId,
    productId,
    tags.tag.title
};

annotate OperationsService.CustomerMessages with @cds.search :
{
    displayTitle,
    titleEnglish,
    titleCustomerLanguage,
    customerName,
    productName,
    resolution
};

annotate AdminService.Tags with @cds.search : { code, title };
annotate AdminService.ResponseTemplates with @cds.search : { code, title, text };

// The analytics view returns aggregates: there is nothing to search.
annotate AnalyticsService.MessageAnalytics with @Capabilities.SearchRestrictions.Searchable : false;

// --- Sort and filter

// Long free texts are found with $search; sorting or filtering on them is not offered.
annotate benicio_1_04Srv.CustomerMessages with
@Capabilities.SortRestrictions.NonSortableProperties :
[
    fullMessageEnglish,
    fullMessageCustomerLanguage,
    suggestedResponseEnglish,
    suggestedResponseCustomerLanguage
]
@Capabilities.FilterRestrictions.NonFilterableProperties :
[
    fullMessageEnglish,
    fullMessageCustomerLanguage,
    suggestedResponseEnglish,
    suggestedResponseCustomerLanguage
];

annotate OperationsService.CustomerMessages with
@Capabilities.SortRestrictions.NonSortableProperties : [ resolution ]
@Capabilities.FilterRestrictions.NonFilterableProperties : [ resolution ];

// --- Expand

// Fiori elements expands at most the tags of a message and the tag of each link.
annotate benicio_1_04Srv.CustomerMessages with @Capabilities.ExpandRestrictions.MaxLevels : 3;
