const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

// The AI call is mocked: the tests check whether it is made, and with which model.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn()
}));

const { preprocessCustomerMessage } = require('../../srv/code/genai/orchestration');
const { DELETE } = cds.ql;

const test = startServer();
const { GET, PATCH, PUT, DELETE: HTTP_DELETE } = test;

const SERVICE = '/service/benicio_1_04';
const SETTINGS = `${SERVICE}/Settings`; // read-only in this service
const ADMIN_SETTINGS = '/service/admin/Settings';
const MESSAGES = `${SERVICE}/CustomerMessages`;
const ANY_STATUS = { validateStatus: () => true };

const AI_RESULT = {
    fullMessageEnglish: 'The compressor is broken.',
    titleEnglish: 'Defective compressor',
    summaryCustomerLanguage: 'Le compresseur est en panne.',
    summaryEnglish: 'The compressor is broken.',
    messageCategory: 'Technical',
    messageUrgency: 'High',
    messageSentiment: 'Negative'
};

describe('application settings (singleton)', () => {
    beforeEach(async () => {
        jest.spyOn(cds.log('GenAI'), 'info').mockImplementation(() => {});
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
        preprocessCustomerMessage.mockReset();
        preprocessCustomerMessage.mockResolvedValue(AI_RESULT);
        await test.data.reset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('service', () => {
        it('is declared as a singleton in the metadata', async () => {
            const { data } = await GET(`${SERVICE}/$metadata`);

            expect(data).toContain('<Singleton Name="Settings" Type="benicio_1_04Srv.Settings"/>');
        });

        it('is delivered with the initial data: enrichment on, no model name', async () => {
            const { status, data } = await GET(SETTINGS);

            expect(status).toBe(200);
            expect(data).toMatchObject({ ID: 1, autoEnrichment: true, aiModelName: null });
        });

        it('updates single options and keeps the others', async () => {
            const { status, data } = await PATCH(ADMIN_SETTINGS, { aiModelName: 'gpt-4.1-mini' });

            expect(status).toBe(200);
            expect(data).toMatchObject({ autoEnrichment: true, aiModelName: 'gpt-4.1-mini' });
            const { data: stored } = await GET(`${SETTINGS}?$select=aiModelName,autoEnrichment`);
            expect(stored).toMatchObject({ autoEnrichment: true, aiModelName: 'gpt-4.1-mini' });
        });

        it('records who changed the settings and when', async () => {
            const { data: before } = await GET(SETTINGS);

            const { data: after } = await PUT(ADMIN_SETTINGS, { autoEnrichment: false });

            expect(Date.parse(after.modifiedAt)).toBeGreaterThan(Date.parse(before.modifiedAt));
            expect(after.modifiedBy).toBe('admin');
        });

        it('cannot be deleted', async () => {
            const { status, data } = await HTTP_DELETE(ADMIN_SETTINGS, ANY_STATUS);

            expect(status).toBe(403); // nobody is granted DELETE, not even an administrator
            expect(data.error.code).toBe('403');
            expect((await GET(SETTINGS)).status).toBe(200);
        });

        it('rejects a value of the wrong type', async () => {
            const { status, data } = await PATCH(ADMIN_SETTINGS, { autoEnrichment: 'maybe' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_DATA_TYPE');
        });
    });

    describe('enrichment handler', () => {
        const readMessage = () => GET(`${MESSAGES}?$filter=customerMessageID eq 3166&$select=titleEnglish,messageCategory`);

        it('enriches messages while automatic enrichment is on', async () => {
            const { data } = await readMessage();

            expect(preprocessCustomerMessage).toHaveBeenCalled();
            expect(data.value[0]).toMatchObject({ titleEnglish: 'Defective compressor', messageCategory: 'Technical' });
        });

        it('does not call the AI service while automatic enrichment is off', async () => {
            await PATCH(ADMIN_SETTINGS, { autoEnrichment: false });

            const { status, data } = await readMessage();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();
            expect(data.value[0]).toMatchObject({ titleEnglish: null, messageCategory: null });
        });

        it('enriches the missing messages after the option is switched on again', async () => {
            await PATCH(ADMIN_SETTINGS, { autoEnrichment: false });
            await readMessage();
            expect(preprocessCustomerMessage).not.toHaveBeenCalled();

            await PATCH(ADMIN_SETTINGS, { autoEnrichment: true });
            const { data } = await readMessage();

            expect(preprocessCustomerMessage).toHaveBeenCalled();
            expect(data.value[0].titleEnglish).toBe('Defective compressor');
        });

        it('passes the configured model name to the AI service', async () => {
            await PATCH(ADMIN_SETTINGS, { aiModelName: 'gpt-4.1-mini' });

            await readMessage();

            expect(preprocessCustomerMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String), { modelName: 'gpt-4.1-mini' });
        });

        it('leaves the model to the configuration when the model name is cleared', async () => {
            await PATCH(ADMIN_SETTINGS, { aiModelName: 'gpt-4.1-mini' });
            await PATCH(ADMIN_SETTINGS, { aiModelName: null });

            await readMessage();

            expect(preprocessCustomerMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String), { modelName: undefined });
        });

        it('falls back to the defaults when the settings row is missing', async () => {
            await cds.db.run(DELETE.from('Benicio_1_04.Settings'));

            const { status } = await readMessage();

            expect(status).toBe(200);
            expect(preprocessCustomerMessage).toHaveBeenCalledWith(expect.any(String), expect.any(String), { modelName: undefined });
        });
    });
});
