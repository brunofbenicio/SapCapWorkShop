const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

const test = startServer();
const { POST, PATCH, PUT } = test;

const SERVICE = '/service/benicio_1_04';
const URL = `${SERVICE}/CustomerMessages`;
const OPERATIONS = '/service/operations';
const ADMIN = '/service/admin';
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ANY_STATUS = { validateStatus: () => true };

const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;
const inLanguage = language => ({ ...ANY_STATUS, headers: { 'Accept-Language': language } });

const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // 3166, open
const POSITIVE_FEEDBACK = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e06'; // 2302, resolved

// Creates a draft with the given data and tries to save it.
async function save(data, config = ANY_STATUS) {
    const { data: created } = await POST(URL, data);
    return POST(`${draft(created.ID)}/${ACTIVATE}`, {}, config);
}

// The errors of a response; details of a response with several errors, or the single error.
const errors = ({ data }) => data.error.details ?? [data.error];
const messagesOf = response => JSON.parse(response.headers['sap-messages'] ?? '[]');

describe('input validation', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('annotations', () => {
        it.each([0, -5, 1000000000])('rejects the customerMessageID %i (@assert.range)', async customerMessageID => {
            const response = await save({ customerMessageID });

            expect(response.status).toBe(400);
            expect(errors(response)).toEqual([expect.objectContaining({ code: 'ASSERT_RANGE', target: 'in/customerMessageID' })]);
        });

        it.each([1, 999999999])('accepts the customerMessageID %i', async customerMessageID => {
            expect((await save({ customerMessageID })).status).toBe(201);
        });

        it.each([
            ['customerId', '-bad'],
            ['customerId', 'has space'],
            ['productId', 'ümlaut'],
            ['productId', '.hidden']
        ])('rejects the %s "%s" (@assert.format)', async (field, value) => {
            const response = await save({ customerMessageID: 9801, [field]: value });

            expect(response.status).toBe(400);
            expect(errors(response)).toEqual([expect.objectContaining({
                code: 'ASSERT_FORMAT',
                target: `in/${field}`,
                message: 'Use only letters, digits, dots, hyphens and underscores, and start with a letter or digit.'
            })]);
        });

        it('accepts well-formed customer and product IDs', async () => {
            const response = await save({ customerMessageID: 9802, customerId: 'C-10021', productId: 'FRZ_200.v2' });

            expect(response.status).toBe(201);
        });

        it.each(['Bad Code', 'UPPER', 'trailing-', '-leading', 'double--hyphen'])('rejects the tag code "%s"', async code => {
            const { status, data } = await POST(`${ADMIN}/Tags`, { code, title: 'Tag' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'ASSERT_FORMAT', target: 'code' });
            expect(data.error.message).toContain('urgent-repair');
        });

        it.each(['refund', 'long-tail-1'])('accepts the tag code "%s"', async code => {
            expect((await POST(`${ADMIN}/Tags`, { code, title: 'Tag' })).status).toBe(201);
        });

        it('rejects a template code that is not a slug', async () => {
            const { status, data } = await POST(`${ADMIN}/ResponseTemplates`, { code: 'Not A Slug', title: 'T', text: 'x' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_FORMAT');
        });

        it.each(['bad model!', '-gpt', 'gpt 4'])('rejects the model name "%s" in the settings', async aiModelName => {
            const { status, data } = await PATCH(`${ADMIN}/Settings`, { aiModelName }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'ASSERT_FORMAT', target: 'aiModelName' });
        });

        it.each(['gpt-4.1-mini', 'amazon--nova-lite'])('accepts the model name "%s" in the settings', async aiModelName => {
            const { status, data } = await PATCH(`${ADMIN}/Settings`, { aiModelName });

            expect(status).toBe(200);
            expect(data.aiModelName).toBe(aiModelName);
        });

        it('rejects a tag that does not exist (@assert.target)', async () => {
            const response = await save({ customerMessageID: 9803, tags: [{ tag_code: 'does-not-exist' }] });

            expect(response.status).toBe(400);
            expect(errors(response)).toEqual([expect.objectContaining({ code: 'ASSERT_TARGET', target: expect.stringMatching(/tag_code$/) })]);
        });

        it('requires the customerMessageID (@mandatory)', async () => {
            const response = await save({ customerName: 'No ID' });

            expect(response.status).toBe(400);
            expect(errors(response)).toEqual([expect.objectContaining({ code: 'ASSERT_MANDATORY', target: 'in/customerMessageID' })]);
        });
    });

    describe('checks when a message is saved', () => {
        it('rejects a customerMessageID that exists already', async () => {
            const response = await save({ customerMessageID: 3166 });

            expect(response.status).toBe(409);
            expect(errors(response)).toEqual([{
                code: 'MESSAGE_ID_NOT_UNIQUE',
                message: 'A customer message with the ID 3166 already exists.',
                target: 'in/customerMessageID',
                '@Common.numericSeverity': 4
            }]);
        });

        it.each([
            ['de', 'Eine Kundennachricht mit der ID 3166 existiert bereits.'],
            ['pt', 'Já existe uma mensagem de cliente com o ID 3166.']
        ])('translates the error for the language %s', async (language, message) => {
            const { data: created } = await POST(URL, { customerMessageID: 3166 });

            const response = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, inLanguage(language));

            expect(response.data.error.message).toBe(message);
        });

        it('does not report a clash of a message with itself', async () => {
            await POST(`${URL}(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)/${EDIT}`, { PreserveChanges: true });
            await PATCH(draft(FREEZER_COMPRESSOR), { customerName: 'Camille Durand' });

            const { status } = await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(200);
        });

        it('rejects the same tag twice on a message', async () => {
            const response = await save({ customerMessageID: 9804, tags: [{ tag_code: 'warranty' }, { tag_code: 'noise' }, { tag_code: 'warranty' }] });

            expect(response.status).toBe(400);
            expect(errors(response)).toEqual([expect.objectContaining({
                code: 'TAG_DUPLICATE',
                message: 'The tag "warranty" is assigned more than once.'
            })]);
        });

        it('reports all problems of a message at once', async () => {
            const response = await save({ customerMessageID: 3166, tags: [{ tag_code: 'noise' }, { tag_code: 'noise' }] });

            expect(response.status).toBe(400);
            expect(errors(response).map(error => error.code).sort()).toEqual(['MESSAGE_ID_NOT_UNIQUE', 'TAG_DUPLICATE']);
        });
    });

    describe('checks when a file is uploaded', () => {
        async function upload(content, contentType) {
            const { data: created } = await POST(URL, { customerMessageID: 9805 });
            const { data: attachment } = await POST(`${draft(created.ID)}/attachments`, { fileName: 'file' });
            return PUT(`${draft(created.ID)}/attachments(ID=${attachment.ID},IsActiveEntity=false)/content`, content, {
                ...ANY_STATUS,
                headers: { 'Content-Type': contentType }
            });
        }

        it.each(['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/plain', 'text/plain; charset=utf-8'])(
            'accepts the type %s', async contentType => {
                expect((await upload(Buffer.from('content'), contentType)).status).toBe(204);
            }
        );

        it.each(['text/html', 'image/svg+xml', 'application/octet-stream', 'application/x-msdownload'])(
            'rejects the type %s', async contentType => {
                const { status, data } = await upload(Buffer.from('content'), contentType);

                expect(status).toBe(415);
                expect(data.error.code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
                expect(data.error.message).toContain(`"${contentType}"`);
            }
        );

        it('accepts a file of 5 MB and rejects a larger one', async () => {
            expect((await upload(Buffer.alloc(5 * 1024 * 1024), 'image/png')).status).toBe(204);

            const { status, data } = await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png');
            expect(status).toBe(413);
            expect(data.error).toMatchObject({ code: 'ATTACHMENT_TOO_LARGE', message: 'The file is too large. The maximum size is 5 MB.' });
        });

        it('translates the error', async () => {
            const { data: created } = await POST(URL, { customerMessageID: 9806 });
            const { data: attachment } = await POST(`${draft(created.ID)}/attachments`, { fileName: 'file' });

            const response = await PUT(`${draft(created.ID)}/attachments(ID=${attachment.ID},IsActiveEntity=false)/content`, Buffer.from('x'), {
                ...inLanguage('de'),
                headers: { 'Content-Type': 'text/html', 'Accept-Language': 'de' }
            });

            expect(response.data.error.message).toMatch(/^Dateien vom Typ "text\/html" sind nicht erlaubt\./);
        });
    });

    describe('messages of the operations', () => {
        const action = (ID, name, data, config = ANY_STATUS) => POST(`${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.${name}`, data, config);

        it('confirms markAsResolved with an info message', async () => {
            const response = await action(FREEZER_COMPRESSOR, 'markAsResolved', {});

            expect(response.status).toBe(200);
            expect(messagesOf(response)).toEqual([expect.objectContaining({
                code: 'MESSAGE_RESOLVED',
                message: 'Customer message 3166 was marked as resolved.',
                numericSeverity: 2
            })]);
        });

        it('translates the info message', async () => {
            const response = await action(FREEZER_COMPRESSOR, 'markAsResolved', {}, inLanguage('de'));

            expect(messagesOf(response)[0].message).toBe('Kundennachricht 3166 wurde als gelöst markiert.');
        });

        it('warns when a reply is added to a resolved message, but adds it', async () => {
            const response = await action(POSITIVE_FEEDBACK, 'addReply', { author: 'Agent', text: 'One more thing' });

            expect(response.status).toBe(200);
            expect(response.data.text).toBe('One more thing');
            expect(messagesOf(response)).toEqual([expect.objectContaining({
                code: 'REPLY_TO_RESOLVED_MESSAGE',
                message: 'Customer message 2302 is already resolved. The reply was added anyway.',
                numericSeverity: 3
            })]);
        });

        it('does not warn when a reply is added to an open message', async () => {
            const response = await action(FREEZER_COMPRESSOR, 'addReply', { author: 'Agent', text: 'On it' });

            expect(response.status).toBe(200);
            expect(messagesOf(response)).toEqual([]);
        });

        it('translates the error for a message that is already resolved', async () => {
            const response = await action(POSITIVE_FEEDBACK, 'markAsResolved', {}, inLanguage('pt'));

            expect(response.status).toBe(409);
            expect(response.data.error.message).toBe('A mensagem de cliente 2302 já está resolvida.');
        });

        it('answers an unknown message with a translated 404', async () => {
            const response = await action('00000000-0000-4000-8000-000000000000', 'markAsResolved', {}, inLanguage('de'));

            expect(response.status).toBe(404);
            expect(response.data.error).toMatchObject({ code: 'MESSAGE_NOT_FOUND', message: 'Die Kundennachricht existiert nicht.' });
        });
    });
});
