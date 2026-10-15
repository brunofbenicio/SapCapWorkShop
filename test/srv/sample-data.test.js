const cds = require('@sap/cds');

// No AI Core in tests: the enrichment fails, so the AI fields stay as seeded.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn().mockRejectedValue(new Error('AI Core is not available'))
}));

const { GET } = cds.test(__dirname + '/../..');

const AI_FIELDS = [
    'fullMessageEnglish',
    'titleEnglish',
    'summaryCustomerLanguage',
    'summaryEnglish',
    'messageCategory',
    'messageUrgency',
    'messageSentiment'
];

describe('sample data in development', () => {
    let messages;

    beforeAll(async () => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
        const { data } = await GET('/service/benicio_1_04/CustomerMessages?$top=100&$count=true');
        messages = data.value;
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it('loads at least 8 customer messages from test/data', () => {
        expect(messages.length).toBeGreaterThanOrEqual(8);
    });

    it('covers French, German, Portuguese and Spanish messages', () => {
        const languages = new Set(messages.map(message => message.sourceLanguage));

        expect([...languages]).toEqual(expect.arrayContaining(['French', 'German', 'Portuguese', 'Spanish']));
    });

    it('provides the customer-side fields of every message', () => {
        for (const message of messages) {
            expect(message).toEqual(expect.objectContaining({
                customerMessageID: expect.any(Number),
                customerName: expect.any(String),
                productName: expect.any(String),
                titleCustomerLanguage: expect.any(String),
                fullMessageCustomerLanguage: expect.any(String),
                originatingCountry: expect.any(String)
            }));
            expect(message.fullMessageCustomerLanguage.length).toBeGreaterThan(20);
        }
    });

    it('leaves the AI-derived fields empty so that they can be generated', () => {
        for (const message of messages) {
            for (const field of AI_FIELDS) {
                expect(message[field] ?? null).toBeNull();
            }
        }
    });

    it('has unique customer message IDs', () => {
        const ids = messages.map(message => message.customerMessageID);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
