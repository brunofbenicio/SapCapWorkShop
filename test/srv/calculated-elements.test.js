const cds = require('@sap/cds');

// The AI call is mocked and fails by default, so the seeded values stay as they are.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn()
}));

const { preprocessCustomerMessage } = require('../../srv/code/genai/orchestration');
const { INSERT, DELETE } = cds.ql;

const test = cds.test(__dirname + '/../..');
const { GET, POST, PATCH } = test;

const URL = '/service/benicio_1_04/CustomerMessages';
const ENTITY = 'Benicio_1_04.CustomerMessages';
const ANY_STATUS = { validateStatus: () => true };

const URGENCY_WEIGHT = { High: 3, Medium: 2, Low: 1, none: 0 };
const SENTIMENT_WEIGHT = { Negative: 2, Neutral: 1, Positive: 0, none: 0 };

describe('calculated elements of CustomerMessages', () => {
    beforeEach(async () => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
        jest.spyOn(cds.log('GenAI'), 'info').mockImplementation(() => {});
        preprocessCustomerMessage.mockReset();
        preprocessCustomerMessage.mockRejectedValue(new Error('AI Core is not available'));
        await test.data.reset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('priorityScore (calculated on read)', () => {
        const combinations = Object.keys(URGENCY_WEIGHT).flatMap(urgency =>
            Object.keys(SENTIMENT_WEIGHT).map(sentiment => [urgency, sentiment])
        );

        it('is not stored in the database', () => {
            const element = cds.model.definitions[ENTITY].elements.priorityScore;

            expect(element.value).toBeDefined();
            expect(element.value.stored).toBeFalsy();
        });

        it.each(combinations)('adds the weights of urgency %s and sentiment %s', async (urgency, sentiment) => {
            const row = {
                ID: '11111111-1111-4111-8111-111111111111',
                customerMessageID: 7001,
                messageUrgency: urgency === 'none' ? null : urgency,
                messageSentiment: sentiment === 'none' ? null : sentiment
            };
            await cds.db.run(INSERT.into(ENTITY).entries(row));

            const { data } = await GET(`${URL}?$filter=customerMessageID eq 7001&$select=priorityScore`);

            expect(data.value[0].priorityScore).toBe(URGENCY_WEIGHT[urgency] + SENTIMENT_WEIGHT[sentiment]);
        });

        it('can be used to sort and filter', async () => {
            await cds.db.run(INSERT.into(ENTITY).entries([
                { ID: '22222222-2222-4222-8222-222222222221', customerMessageID: 7101, messageUrgency: 'High', messageSentiment: 'Negative' },
                { ID: '22222222-2222-4222-8222-222222222222', customerMessageID: 7102, messageUrgency: 'Medium', messageSentiment: 'Neutral' },
                { ID: '22222222-2222-4222-8222-222222222223', customerMessageID: 7103, messageUrgency: 'Low', messageSentiment: 'Positive' }
            ]));

            const { data: sorted } = await GET(`${URL}?$select=customerMessageID,priorityScore&$orderby=priorityScore desc&$top=3`);
            const { data: filtered } = await GET(`${URL}?$select=customerMessageID&$filter=priorityScore ge 3 and priorityScore le 5&$orderby=customerMessageID`);

            expect(sorted.value.map(message => message.customerMessageID)).toEqual([7101, 7102, 7103]);
            expect(sorted.value.map(message => message.priorityScore)).toEqual([5, 3, 1]);
            expect(filtered.value.map(message => message.customerMessageID)).toEqual([7101, 7102]);
        });

        it('is calculated for drafts and cannot be written', async () => {
            const { data: created } = await POST(URL, {
                customerMessageID: 7201,
                messageUrgency: 'Medium',
                messageSentiment: 'Negative'
            });
            expect(created.priorityScore).toBe(4);

            await PATCH(`${URL}(ID=${created.ID},IsActiveEntity=false)`, { messageUrgency: 'High', priorityScore: 99 });
            const { data: draft } = await GET(`${URL}(ID=${created.ID},IsActiveEntity=false)?$select=priorityScore`);
            expect(draft.priorityScore).toBe(5);

            const { status, data: activated } = await POST(`${URL}(ID=${created.ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, {});
            expect(status).toBe(201);
            expect(activated.priorityScore).toBe(5);
        });

        it('follows the AI enrichment of a message', async () => {
            const select = `${URL}?$filter=customerMessageID eq 3166&$select=priorityScore`;
            const { data: before } = await GET(select);
            expect(before.value[0].priorityScore).toBe(0);

            preprocessCustomerMessage.mockResolvedValue({
                fullMessageEnglish: 'The compressor is broken.',
                titleEnglish: 'Defective compressor',
                summaryCustomerLanguage: 'Le compresseur est en panne.',
                summaryEnglish: 'The compressor is broken.',
                messageCategory: 'Technical',
                messageUrgency: 'High',
                messageSentiment: 'Negative'
            });
            const { data: after } = await GET(select);

            expect(after.value[0].priorityScore).toBe(5);
        });
    });

    describe('displayTitle (stored)', () => {
        it('is stored as a generated column in the database', async () => {
            const element = cds.model.definitions[ENTITY].elements.displayTitle;
            const sql = cds.compile.to.sql(await cds.load('*')).join('\n');

            expect(element.value.stored).toBe(true);
            expect(sql).toContain('displayTitle NVARCHAR(100) GENERATED ALWAYS AS (coalesce(titleEnglish, titleCustomerLanguage)) STORED');
        });

        it('shows the title in the customer language until an English title exists', async () => {
            const select = `${URL}?$filter=customerMessageID eq 3166&$select=displayTitle,titleEnglish`;
            const { data: before } = await GET(select);
            expect(before.value[0]).toMatchObject({ displayTitle: 'Problème de compresseur défectueux', titleEnglish: null });

            await cds.db.run(cds.ql.UPDATE(ENTITY).set({ titleEnglish: 'Defective compressor' }).where({ customerMessageID: 3166 }));
            const { data: after } = await GET(select);

            expect(after.value[0].displayTitle).toBe('Defective compressor');
        });

        it('can be used to sort and filter', async () => {
            await cds.db.run(DELETE.from(ENTITY));
            await cds.db.run(INSERT.into(ENTITY).entries([
                { ID: '33333333-3333-4333-8333-333333333331', customerMessageID: 7301, titleCustomerLanguage: 'Zeta', titleEnglish: 'Beta' },
                { ID: '33333333-3333-4333-8333-333333333332', customerMessageID: 7302, titleCustomerLanguage: 'Alpha' },
                { ID: '33333333-3333-4333-8333-333333333333', customerMessageID: 7303, titleCustomerLanguage: 'Gamma' }
            ]));

            const { data: sorted } = await GET(`${URL}?$select=displayTitle&$orderby=displayTitle`);
            const { data: filtered } = await GET(`${URL}?$select=customerMessageID&$filter=displayTitle eq 'Beta'`);

            expect(sorted.value.map(message => message.displayTitle)).toEqual(['Alpha', 'Beta', 'Gamma']);
            expect(filtered.value.map(message => message.customerMessageID)).toEqual([7301]);
        });

        it('cannot be written by a client', async () => {
            const { data: created } = await POST(URL, { customerMessageID: 7401, titleCustomerLanguage: 'Titre' });

            const { status, data } = await PATCH(`${URL}(ID=${created.ID},IsActiveEntity=false)`, { displayTitle: 'Hacked' }, ANY_STATUS);

            expect(status).toBe(200);
            expect(data.displayTitle).toBe('Titre');
        });
    });
});
