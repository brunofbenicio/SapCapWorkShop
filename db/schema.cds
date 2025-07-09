namespace Benicio_1_04;
using { cuid } from '@sap/cds/common';

@assert.unique: { customerMessageID: [customerMessageID] }
entity CustomerMessages : cuid {
  customerMessageID: Integer @mandatory;
  titleEnglish: String(100);
  customerName: String(100);
  productName: String(100);
  summaryEnglish: String(500);
  messageCategory: String(50);
  messageUrgency: String(20);
  messageSentiment: String(20);
  titleCustomerLanguage: String(100);
  customerId: String(50);
  productId: String(50);
  summaryCustomerLanguage: String(500);
  originatingCountry: String(100);
  sourceLanguage: String(10);
  fullMessageCustomerLanguage: String(1000);
  fullMessageEnglish: String(1000);
  suggestedResponseEnglish: String(1000);
  suggestedResponseCustomerLanguage: String(1000);
}

