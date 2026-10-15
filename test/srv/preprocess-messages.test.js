const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');
const { enableEnrichment, settle, tasks, skipBackoff, TASKS } = require('../helpers/enrichment');

// The AI call is mocked: no AI Core binding is needed.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn()
}));

const { preprocessCustomerMessage } = require('../../srv/code/genai/orchestration');
const { INSERT, DELETE, SELECT, UPDATE } = cds.ql;

const test = startServer();
const { GET, POST } = test;

const URL = '/service/benicio_1_04/CustomerMessages';
const ENTITY = 'Benicio_1_04.CustomerMessages';
const SETTINGS = 'Benicio_1_04.Settings';
const QUEUE_LOG = cds.log('persistent-queue');

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
const taskOf = n => `enrich-${ID(n)}`;

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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Polls until the condition holds (for the retries of the queue that run on their own). */
async function waitFor(condition, timeout = 5000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await condition()) return;
        await sleep(25);
    }
    throw new Error('Timeout while waiting for a condition');
}

describe('enrichment of CustomerMessages through the task queue', () => {
    beforeAll(() => {
        enableEnrichment();
    });

    beforeEach(async () => {
        jest.spyOn(cds.log('GenAI'), 'info').mockImplementation(() => {});
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
        // A failed task is logged by the queue with its stack trace: not interesting here, see lastError.
        jest.spyOn(QUEUE_LOG, 'error').mockImplementation(() => {});
        preprocessCustomerMessage.mockReset();
        preprocessCustomerMessage.mockResolvedValue(AI_RESULT);
        await settle();
        await cds.db.run(DELETE.from(ENTITY));
        await cds.db.run(DELETE.from(TASKS));
        await cds.db.run(UPDATE(SETTINGS).set({ autoEnrichment: true, aiModelName: null }));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('after the READ', () => {
        it('enriches a message that misses AI fields', async () => {
            await insert(incomplete(1));

            const { status } = await GET(`${URL}?$filter=customerMessageID eq 1`);
            await settle();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
            expect(preprocessCustomerMessage).toHaveBeenCalledWith('Titre 1', 'Message 1', { modelName: undefined });
            expect(await readRow(1)).toMatchObject(AI_RESULT);
            expect(await tasks()).toEqual([]);
        });

        it('shows the result when the messages are read again', async () => {
            await insert(incomplete(1));

            await GET(URL);
            await settle();
            const { data } = await GET(`${URL}?$filter=customerMessageID eq 1`);

            expect(data.value[0]).toMatchObject(AI_RESULT);
        });

        it('does not wait for the AI: the READ returns the message as it is', async () => {
            await insert(incomplete(1));
            let release;
            preprocessCustomerMessage.mockImplementation(() => new Promise(resolve => { release = () => resolve(AI_RESULT); }));

            const { status, data } = await GET(`${URL}?$filter=customerMessageID eq 1`);

            expect(status).toBe(200);
            expect(data.value[0]).toMatchObject({ titleEnglish: null, messageCategory: null });
            await waitFor(() => release);
            release();
            await settle();
            expect(await readRow(1)).toMatchObject(AI_RESULT);
        });

        it('does not call the AI service again once a message is enriched', async () => {
            await insert(incomplete(1));

            await GET(URL);
            await settle();
            await GET(URL);
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
        });

        it('leaves complete messages untouched and schedules nothing', async () => {
            await insert(complete(1));

            const { status, data } = await GET(URL);
            await settle();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();
            expect(await tasks()).toEqual([]);
            expect(data.value[0]).toMatchObject({ titleEnglish: 'Already translated title', messageCategory: 'Service' });
            expect(await readRow(1)).toMatchObject(complete(1));
        });

        it('only processes the messages that are incomplete', async () => {
            await insert(complete(1), incomplete(2), complete(3, { summaryEnglish: '' }));

            await GET(URL);
            await settle();

            expect(preprocessCustomerMessage.mock.calls.map(([title]) => title).sort()).toEqual(['Titre 2', 'Titre 3']);
            expect(await readRow(1)).toMatchObject({ titleEnglish: 'Already translated title' });
            expect(await readRow(3)).toMatchObject({ summaryEnglish: AI_RESULT.summaryEnglish });
        });

        it('skips messages without a text to preprocess', async () => {
            await insert(incomplete(1, { fullMessageCustomerLanguage: null }), incomplete(2, { fullMessageCustomerLanguage: '' }));

            const { status } = await GET(URL);
            await settle();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();
            expect(await tasks()).toEqual([]);
        });

        it('is switched off for the whole application by cds.genai.enabled', async () => {
            await insert(incomplete(1));
            cds.env.genai = { enabled: false };

            const { status } = await GET(URL);
            await settle();
            enableEnrichment();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();
            expect(await tasks()).toEqual([]);
        });

        it('limits the number of parallel AI calls to the chunk size of the queue', async () => {
            expect(cds.env.requires.queue.chunkSize).toBe(3);
            await insert(...[1, 2, 3, 4, 5, 6, 7].map(n => incomplete(n)));
            let running = 0;
            let maxRunning = 0;
            preprocessCustomerMessage.mockImplementation(async () => {
                maxRunning = Math.max(maxRunning, ++running);
                await sleep(10);
                running--;
                return AI_RESULT;
            });

            await GET(URL);
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(7);
            expect(maxRunning).toBe(3);
            expect(await tasks()).toEqual([]);
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

        it('still serves the READ when the tasks cannot be scheduled', async () => {
            await insert(incomplete(1));
            const enrichment = await cds.connect.to('EnrichmentService');
            const log = jest.spyOn(cds.log('GenAI'), 'error');
            // schedule is a getter of cds.Service that replaces itself on first use: shadow it on the instance.
            Object.defineProperty(enrichment, 'schedule', { configurable: true, value: () => { throw new Error('queue unavailable'); } });

            try {
                const { status, data } = await GET(URL);

                expect(status).toBe(200);
                expect(data.value).toHaveLength(1);
                expect(log).toHaveBeenCalledWith('Failed to schedule the enrichment of customer messages', 'queue unavailable');
            } finally {
                delete enrichment.schedule;
            }
        });
    });

    describe('the queue', () => {
        it('keeps one task per message, named after the message, in a persistent table', async () => {
            await insert(incomplete(1), incomplete(2));
            preprocessCustomerMessage.mockRejectedValue(new Error('AI Core is not available'));

            await GET(URL);
            await settle();
            const waiting = await tasks();

            expect(waiting.map(task => task.task).sort()).toEqual([taskOf(1), taskOf(2)]);
            expect(JSON.parse(waiting[0].msg)).toMatchObject({ event: 'enrichMessage', service: 'EnrichmentService' });
            expect(waiting.map(task => JSON.parse(task.msg).data.ID).sort()).toEqual([ID(1), ID(2)]);
        });

        it('retries a failed task, and the retry succeeds', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValueOnce(new Error('AI Core is not available'));

            const { status } = await GET(URL);
            await settle();

            // The first attempt failed: the READ was fine, the message is unchanged, the task waits.
            expect(status).toBe(200);
            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
            expect(await readRow(1)).toMatchObject({ titleEnglish: null, messageCategory: null });
            const [waiting] = await tasks();
            expect(waiting).toMatchObject({ task: taskOf(1), attempts: 1, status: null });
            expect(waiting.lastError).toContain(`Error from completion service for CustomerMessage ID ${ID(1)}: AI Core is not available`);

            // The retry runs outside of any request, after the back-off.
            await skipBackoff();
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(2);
            expect(await readRow(1)).toMatchObject(AI_RESULT);
            expect(await tasks()).toEqual([]);
        });

        it('retries on its own after the back-off', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValueOnce(new Error('AI Core is not available'));

            await GET(URL);
            await waitFor(async () => (await readRow(1)).titleEnglish !== null); // first retry after about 0.5 s

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(2);
            expect(await readRow(1)).toMatchObject(AI_RESULT);
            await waitFor(async () => (await tasks()).length === 0);
        });

        it('lengthens the wait with every failed attempt', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValue(new Error('AI Core is not available'));

            await GET(URL);
            await settle();
            for (const attempts of [2, 3]) {
                await skipBackoff();
                await settle();
                expect(await tasks()).toEqual([expect.objectContaining({ attempts })]);
            }
            const { expBkfFix } = require('@sap/cds/libx/_runtime/common/utils/waitingTime');

            expect(expBkfFix(1)).toBeLessThan(expBkfFix(2));
            expect(expBkfFix(2)).toBeLessThan(expBkfFix(3));
        });

        it('retries one failed message without disturbing the others', async () => {
            await insert(incomplete(1), incomplete(2));
            preprocessCustomerMessage.mockImplementation(async title => {
                if (title === 'Titre 1') throw new Error('Preprocessing service failed.');
                return AI_RESULT;
            });

            const { status, data } = await GET(`${URL}?$orderby=customerMessageID`);
            await settle();

            expect(status).toBe(200);
            expect(data.value).toHaveLength(2);
            expect(await readRow(1)).toMatchObject({ messageCategory: null, titleEnglish: null });
            expect(await readRow(2)).toMatchObject(AI_RESULT);
            expect((await tasks()).map(task => task.task)).toEqual([taskOf(1)]);
        });

        it('does not add a second task when the message is read again while its task waits', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValue(new Error('AI Core is not available'));

            await GET(URL);
            await settle();
            await GET(URL);
            await GET(URL);

            const waiting = await tasks();
            expect(waiting).toHaveLength(1);
            expect(waiting[0].attempts).toBe(1); // not started afresh
        });

        it('schedules a message afresh when its task has used up all attempts', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValue(new Error('AI Core is not available'));
            await GET(URL);
            await settle();
            await cds.db.run(UPDATE(TASKS).set({ attempts: cds.env.requires.queue.maxAttempts }));
            await skipBackoff();
            await settle();
            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1); // no further attempt is made

            preprocessCustomerMessage.mockResolvedValue(AI_RESULT); // the AI service is back
            await GET(URL);
            await settle();

            expect(await readRow(1)).toMatchObject(AI_RESULT);
            expect(await tasks()).toEqual([]);
        });

        it.each([
            ['an incomplete object', { ...AI_RESULT, messageSentiment: undefined }, 'Incomplete response'],
            ['an empty object', {}, 'Incomplete response'],
            ['null', null, 'Incomplete response']
        ])('retries later when the AI service returns %s', async (_, result, error) => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockResolvedValueOnce(result);

            await GET(URL);
            await settle();

            expect(await readRow(1)).toMatchObject({ titleEnglish: null, messageCategory: null });
            expect((await tasks())[0].lastError).toContain(error);

            await skipBackoff();
            await settle();

            expect(await readRow(1)).toMatchObject(AI_RESULT);
        });

        it.each([
            ['messageCategory', 'Billing'],
            ['messageUrgency', 'Critical'],
            ['messageSentiment', 'Angry'],
            ['messageSentiment', 42]
        ])('does not store %s when it is not an allowed value (%p) and retries later', async (field, value) => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockResolvedValueOnce({ ...AI_RESULT, [field]: value });

            await GET(URL);
            await settle();

            expect(await readRow(1)).toMatchObject({ titleEnglish: null, [field]: null });
            expect((await tasks())[0].lastError).toContain(`Invalid ${field}`);

            await skipBackoff();
            await settle();

            expect(await readRow(1)).toMatchObject(AI_RESULT);
        });

        it('stores the allowed enum values when the model differs in case or blanks', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockResolvedValue({
                ...AI_RESULT,
                messageCategory: ' technical ',
                messageUrgency: 'HIGH',
                messageSentiment: 'negative'
            });

            await GET(URL);
            await settle();

            expect(await readRow(1)).toMatchObject({
                messageCategory: 'Technical',
                messageUrgency: 'High',
                messageSentiment: 'Negative'
            });
        });

        it('does not stop the application when the AI SDK fails with a programming error type', async () => {
            // The queue stops the application for a TypeError; a failing network call must not do that.
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValueOnce(new TypeError('fetch failed'));

            await GET(URL);
            await settle();

            const [waiting] = await tasks();
            expect(waiting.attempts).toBe(1);
            expect(waiting.lastError).toContain('fetch failed');
            await skipBackoff();
            await settle();
            expect(await readRow(1)).toMatchObject(AI_RESULT);
        });

        it('drops the task of a message that was deleted in the meantime', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValueOnce(new Error('AI Core is not available'));
            await GET(URL);
            await settle();
            await cds.db.run(DELETE.from(ENTITY).where({ ID: ID(1) }));

            await skipBackoff();
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
            expect(await tasks()).toEqual([]);
        });
    });

    describe('settings', () => {
        it('passes the model name of the settings to the AI service', async () => {
            await insert(incomplete(1));
            await cds.db.run(UPDATE(SETTINGS).set({ aiModelName: 'gpt-4.1-mini' }));

            await GET(URL);
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledWith('Titre 1', 'Message 1', { modelName: 'gpt-4.1-mini' });
        });

        it('does not schedule anything while automatic enrichment is off', async () => {
            await insert(incomplete(1));
            await cds.db.run(UPDATE(SETTINGS).set({ autoEnrichment: false }));

            const { status } = await GET(URL);
            await settle();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();
            expect(await tasks()).toEqual([]);
        });

        it('lets a waiting task go when automatic enrichment is switched off before its retry', async () => {
            await insert(incomplete(1));
            preprocessCustomerMessage.mockRejectedValueOnce(new Error('AI Core is not available'));
            await GET(URL);
            await settle();
            await cds.db.run(UPDATE(SETTINGS).set({ autoEnrichment: false }));

            await skipBackoff();
            await settle();

            expect(preprocessCustomerMessage).toHaveBeenCalledTimes(1);
            expect(await tasks()).toEqual([]);
            expect(await readRow(1)).toMatchObject({ titleEnglish: null });
        });
    });

    describe('EnrichmentService', () => {
        it('is not served over HTTP', async () => {
            const enrichment = await cds.connect.to('EnrichmentService');
            const { status } = await GET('/odata/v4/enrichment/', { validateStatus: () => true });

            expect(enrichment.endpoints).toEqual([]);
            expect(status).toBe(404);
        });

        it('has no action that can be called by the users of the other services', async () => {
            const { status } = await POST('/service/benicio_1_04/enrichMessage', { ID: ID(1) }, { validateStatus: () => true });

            expect(status).toBe(404);
        });
    });
});
