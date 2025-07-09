using benicio_1_04Srv as service from '../../srv/service';
using from '../annotations';

annotate service.CustomerMessages with @(
    UI.FieldGroup #Main : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : customerMessageID,
            },
            {
                $Type : 'UI.DataField',
                Value : titleEnglish,
            },
            {
                $Type : 'UI.DataField',
                Value : customerName,
            },
            {
                $Type : 'UI.DataField',
                Value : productName,
            },
            {
                $Type : 'UI.DataField',
                Value : summaryEnglish,
            },
            {
                $Type : 'UI.DataField',
                Value : messageCategory,
            },
            {
                $Type : 'UI.DataField',
                Value : messageUrgency,
            },
            {
                $Type : 'UI.DataField',
                Value : messageSentiment,
            },
            {
                $Type : 'UI.DataField',
                Value : titleCustomerLanguage,
            },
            {
                $Type : 'UI.DataField',
                Value : customerId,
            },
            {
                $Type : 'UI.DataField',
                Value : productId,
            },
            {
                $Type : 'UI.DataField',
                Value : summaryCustomerLanguage,
            },
            {
                $Type : 'UI.DataField',
                Value : originatingCountry,
            },
            {
                $Type : 'UI.DataField',
                Value : sourceLanguage,
            },
            {
                $Type : 'UI.DataField',
                Value : fullMessageCustomerLanguage,
            },
            {
                $Type : 'UI.DataField',
                Value : fullMessageEnglish,
            },
            {
                $Type : 'UI.DataField',
                Value : suggestedResponseEnglish,
            },
            {
                $Type : 'UI.DataField',
                Value : suggestedResponseCustomerLanguage,
            },
            {
                $Type : 'UI.DataField',
                Value : S4HCP_ServiceOrder_ServiceOrder,
                Label : 'ServiceOrder',
            },
        ],
    }
);

annotate service.CustomerMessages with {
    S4HCP_ServiceOrder @(
        UI.MultiLineText : false,
        Common.Text : S4HCP_ServiceOrder.ServiceOrder,
        Common.Text.@UI.TextArrangement : #TextLast,
        Common.ValueList : {
            $Type : 'Common.ValueListType',
            CollectionPath : 'A_ServiceOrder',
            Parameters : [
                {
                    $Type : 'Common.ValueListParameterInOut',
                    LocalDataProperty : S4HCP_ServiceOrder_ServiceOrder,
                    ValueListProperty : 'ServiceOrder',
                },
            ],
            Label : 'Service Order',
        },
        Common.ValueListWithFixedValues : true,
    )
};

annotate service.A_ServiceOrder with {
    ServiceOrder @(
        Common.Text : ServiceOrderDescription,
        Common.Text.@UI.TextArrangement : #TextSeparate,
)};

