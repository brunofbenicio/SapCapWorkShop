const cds = require('@sap/cds');

// The AI call is mocked: no AI Core binding is needed.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn()
}));

const { preprocessCustomerMessage } = require('../../srv/code/genai/orchestration');
const { INSERT, DELETE, SELECT } = cds.ql;

const test = cds.test(__dirname + '/../..');
const { GET } = test;

const URL = '/service/benicio_1_04/CustomerMessages';
const ENTITY = 'Benicio_1_04.CustomerMessages';
const LOG = cds.log('GenAI');

const AI_RESULT = {
    fullMessageEnglish: 'The freezer compressor is broken.',
    titleEnglish: 'Defective compressor',
    summaryCustomerLanguage: 'Le compresseur est en panne.',
    summaryEnglish: 'The compressor is broken.',
    messageCategory: 'Technical',
    messageUrgency: 'High',
    messageSentiment: 'Negative'
};

const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A message as it is created by a user: the AI-derived fields are still empty.
const incomplete = (n, overrides = {}) => ({
    ID: ID(n),
    customerMessageID: n,
    titleCustomerLanguage: `Titre ${n}`,
    fullMessageCustomerLanguage: `Message ${n}`,
    ...overrides
});

// A message that was already enriched.
const complete = (n, overrides = {}) => ({
    ...incomplete(n),
    fullMessageEnglish: 'Already translated',
    titleEnglish: 'Already translated title',
    summaryCustomerLanguage: 'Déjà résumé',
    summaryEnglish: 'Already summarized',
    messageCategory: 'Service',
    messageUrgency: 'Low',
    messageSentiment: 'Neutral',
    ...overrides
});

const insert = (...rows) => cds.db.run(INSERT.into(ENTITY).entries(rows));
const readRow = n => cds.db.run(SELECT.one.from(ENTITY).where({ ID: ID(n) }));

describe('before READ enrichment of CustomerMessages', () => {
    beforeEach(async () => {
        jest.spyOn(LOG, 'info').mockImplementation(() => {});
        jest.spyOn(LOG, 'error').mockImplementation(() => {});
        preprocessCustomerMessage.mockReset();
        preprocessCustomerMessage.mockResolvedValue(AI_RESULT);
        delete cds.env.genai;
        await cds.db.run(DELETE.from(ENTITY));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('enriches a message that misses AI fields', async () => {
        await insert(incomplete(1));

        const { status, data } = await GET(`${URL}?$filter=customerMessageID eq 1`);

        expect(status).toBe(200);
        expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
        expect(preprocessCustomerMessage).toHaveBeenCalledWith('Titre 1', 'Message 1');
        expect(data.value[0]).toMatchObject(AI_RESULT);
        expect(await readRow(1)).toMatchObject(AI_RESULT);
    });

    it('does not call the AI service again once a message is enriched', async () => {
        await insert(incomplete(1));

        await GET(URL);
        await GET(URL);

        expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
    });

    it('leaves complete messages untouched', async () => {
        await insert(complete(1));

        const { status, data } = await GET(URL);

        expect(status).toBe(200);
        expect(preprocessCustomerMessage).not.toHaveBeenCalled();
        expect(data.value).toHaveLength(1);
        expect(data.value[0]).toMatchObject({ titleEnglish: 'Already translated title', messageCategory: 'Service' });
        expect(await readRow(1)).toMatchObject(complete(1));
    });

    it('only processes the messages that are incomplete', async () => {
        await insert(complete(1), incomplete(2), complete(3, { summaryEnglish: '' }));

        await GET(URL);

        expect(preprocessCustomerMessage.mock.calls.map(([title]) => title).sort()).toEqual(['Titre 2', 'Titre 3']);
        expect(await readRow(1)).toMatchObject({ titleEnglish: 'Already translated title' });
        expect(await readRow(3)).toMatchObject({ summaryEnglish: AI_RESULT.summaryEnglish });
    });

    it('skips messages without a text to preprocess', async () => {
        await insert(incomplete(1, { fullMessageCustomerLanguage: null }), incomplete(2, { fullMessageCustomerLanguage: '' }));

        const { status } = await GET(URL);

        expect(status).toBe(200);
        expect(preprocessCustomerMessage).not.toHaveBeenCalled();
    });

    it('still serves the READ when the AI call fails for one message', async () => {
        await insert(incomplete(1), incomplete(2));
        preprocessCustomerMessage.mockImplementation(async title => {
            if (title === 'Titre 1') throw new Error('Preprocessing service failed.');
            return AI_RESULT;
        });

        const { status, data } = await GET(`${URL}?$orderby=customerMessageID`);

        expect(status).toBe(200);
        expect(data.value).toHaveLength(2);
        expect(await readRow(1)).toMatchObject({ messageCategory: null, titleEnglish: null });
        expect(await readRow(2)).toMatchObject(AI_RESULT);
        expect(LOG.error).toHaveBeenCalledWith(expect.stringContaining(ID(1)));
    });

    it.each([
        ['an incomplete object', { ...AI_RESULT, messageSentiment: undefined }],
        ['an empty object', {}],
        ['null', null]
    ])('keeps the message unchanged when the AI service returns %s', async (_, result) => {
        await insert(incomplete(1));
        preprocessCustomerMessage.mockResolvedValue(result);

        const { status } = await GET(URL);

        expect(status).toBe(200);
        expect(await readRow(1)).toMatchObject({ titleEnglish: null, messageCategory: null });
        expect(LOG.error).toHaveBeenCalledWith(expect.stringContaining('Incomplete response'));
    });

    it('limits the number of parallel AI calls', async () => {
        cds.env.genai = { concurrency: 2 };
        await insert(...[1, 2, 3, 4, 5].map(n => incomplete(n)));
        let running = 0;
        let maxRunning = 0;
        preprocessCustomerMessage.mockImplementation(async () => {
            maxRunning = Math.max(maxRunning, ++running);
            await new Promise(resolve => setTimeout(resolve, 10));
            running--;
            return AI_RESULT;
        });

        const { status } = await GET(URL);

        expect(status).toBe(200);
        expect(preprocessCustomerMessage).toHaveBeenCalledTimes(5);
        expect(maxRunning).toBe(2);
    });

    it('rejects the request when the messages cannot be retrieved', async () => {
        const run = cds.db.run.bind(cds.db);
        jest.spyOn(cds.db, 'run').mockImplementation(query => {
            if (query?.SELECT?.from?.ref?.[0] === ENTITY && query.SELECT.where) throw new Error('database unavailable');
            return run(query);
        });

        const { status, data } = await GET(URL, { validateStatus: () => true });

        expect(status).toBe(500);
        expect(data.error.message).toBe('Failed to retrieve customer messages');
    });
});
