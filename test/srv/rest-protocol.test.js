const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');

const { SELECT } = cds.ql;
const test = startServer();
const { GET, POST } = test;

const REST = '/rest/service/operations';
const ODATA = '/service/operations';
const ANY_STATUS = { validateStatus: () => true };

// Sample data: 3166 is open and has a score of 0 until the AI classifies it, 2302 is resolved.
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // 3166
const POSITIVE_FEEDBACK = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e06'; // 2302
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const send = (user, method, url, data) => {
    const config = { ...(user === 'anonymous' ? { auth: undefined } : as(user)), ...ANY_STATUS };
    return method === 'GET' ? GET(url, config) : POST(url, data, config);
};

describe('REST protocol of the OperationsService', () => {
    beforeEach(() => test.data.reset());

    describe('endpoints', () => {
        it('serves the service with two protocols', () => {
            const service = cds.services.OperationsService;

            expect(service.endpoints.map(({ kind, path }) => ({ kind, path }))).toEqual([
                { kind: 'odata-v4', path: ODATA },
                { kind: 'rest', path: REST }
            ]);
        });

        it('lists the entities at the root', async () => {
            const { status, data } = await GET(REST);

            expect(status).toBe(200);
            expect(data.entities.map(entity => entity.name).sort()).toEqual(['ChangeView', 'CustomerMessageReplies', 'CustomerMessages']); // ChangeView: the change history
        });

        it('keeps the OData endpoint', async () => {
            const { data } = await GET(`${ODATA}/CustomerMessages?$top=1&$select=customerMessageID`);

            expect(data['@odata.context']).toBe('$metadata#CustomerMessages');
            expect(data.value).toHaveLength(1);
        });

        it('serves the other services with OData only', async () => {
            const { status } = await GET('/rest/service/benicio_1_04/CustomerMessages', ANY_STATUS);

            expect(status).toBe(404);
        });
    });

    describe('read', () => {
        it('returns a plain JSON array', async () => {
            const { status, data, headers } = await GET(`${REST}/CustomerMessages?$orderby=customerMessageID&$select=customerMessageID`);

            expect(status).toBe(200);
            expect(headers['content-type']).toMatch(/application\/json/);
            expect(Array.isArray(data)).toBe(true);
            expect(data).toHaveLength(11);
            expect(data[0]).toEqual({ customerMessageID: 1124 });
        });

        it('supports the OData query options', async () => {
            const { data } = await GET(`${REST}/CustomerMessages?$filter=status eq 'Resolved'&$orderby=customerMessageID desc&$select=customerMessageID,status`);

            expect(data).toEqual([
                { customerMessageID: 2302, status: 'Resolved' },
                { customerMessageID: 2202, status: 'Resolved' }
            ]);
        });

        it('applies the page limit', async () => {
            const { data } = await GET(`${REST}/CustomerMessages?$top=2&$select=customerMessageID`);

            expect(data).toHaveLength(2);
        });

        it('returns the same messages as the OData endpoint', async () => {
            const rest = await GET(`${REST}/CustomerMessages?$orderby=ID&$select=ID`);
            const odata = await GET(`${ODATA}/CustomerMessages?$orderby=ID&$select=ID`);

            expect(rest.data.map(row => row.ID)).toEqual(odata.data.value.map(row => row.ID));
        });

        it('reads an entity by its key', async () => {
            const { status, data } = await GET(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}`);

            expect(status).toBe(200);
            expect(data).toMatchObject({ ID: FREEZER_COMPRESSOR, customerMessageID: 3166, status: 'Open' });
        });

        it('answers 404 for an unknown key', async () => {
            const { status, data } = await GET(`${REST}/CustomerMessages/${UNKNOWN}`, ANY_STATUS);

            expect(status).toBe(404);
            expect(data.error.code).toBe('404');
        });

        it('reads the replies', async () => {
            const { data } = await GET(`${REST}/CustomerMessageReplies?$filter=message_ID eq ${FREEZER_COMPRESSOR}&$select=author`);

            expect(data).toHaveLength(2);
            expect(data[0]).toEqual({ author: 'Support Team' });
        });
    });

    describe('functions', () => {
        it('calls the bound function', async () => {
            const { status, data } = await GET(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/suggestedPriority`);

            expect(status).toBe(200);
            expect(data).toEqual({ score: 0, level: 'Low' });
        });

        it('calls the unbound function', async () => {
            const { data } = await GET(`${REST}/statistics`);

            expect(data).toMatchObject({ total: 11, open: 9, resolved: 2 });
        });

        it('answers 404 for a function of an unknown message', async () => {
            const { status } = await GET(`${REST}/CustomerMessages/${UNKNOWN}/suggestedPriority`, ANY_STATUS);

            expect(status).toBe(404);
        });
    });

    describe('actions', () => {
        it('resolves a message and returns it', async () => {
            const { status, data } = await POST(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/markAsResolved`, { resolution: 'Compressor replaced' });
            const stored = await cds.db.run(SELECT.one.from('Benicio_1_04.CustomerMessages').where({ ID: FREEZER_COMPRESSOR }));

            expect(status).toBe(200);
            expect(data).toMatchObject({ ID: FREEZER_COMPRESSOR, status: 'Resolved', resolvedBy: 'admin', resolution: 'Compressor replaced' });
            expect(stored.status).toBe('Resolved');
        });

        it('answers 409 when the message is already resolved', async () => {
            const { status, data } = await POST(`${REST}/CustomerMessages/${POSITIVE_FEEDBACK}/markAsResolved`, {}, ANY_STATUS);

            expect(status).toBe(409);
            expect(data.error).toMatchObject({ code: 'MESSAGE_ALREADY_RESOLVED', message: 'Customer message 2302 is already resolved.' });
        });

        it('adds a reply', async () => {
            const { status, data } = await POST(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/addReply`, { author: 'Support Team', text: 'We are on it.' });
            const stored = await cds.db.run(SELECT.from('Benicio_1_04.CustomerMessageReplies').where({ message_ID: FREEZER_COMPRESSOR }));

            expect(status).toBe(200);
            expect(data).toMatchObject({ message_ID: FREEZER_COMPRESSOR, author: 'Support Team', text: 'We are on it.' });
            expect(stored.map(reply => reply.ID)).toContain(data.ID);
        });

        it('answers 400 when a mandatory parameter is missing', async () => {
            const { status, data } = await POST(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/addReply`, { author: 'Support Team' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'ASSERT_MANDATORY', target: 'text' });
        });

        it('emits the same events as the OData endpoint', async () => {
            const messaging = await cds.connect.to('messaging');
            const received = [];
            messaging.on('OperationsService.MessageResolved', event => received.push(event.data.customerMessageID));

            await POST(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/markAsResolved`, {});

            expect(received).toEqual([3166]);
        });

        it('reads the change history of a message by navigation only', async () => {
            await POST(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/markAsResolved`, {});

            const history = await GET(`${REST}/CustomerMessages/${FREEZER_COMPRESSOR}/changes?$filter=attribute eq 'status' and modification eq 'update'`, ANY_STATUS);
            const direct = await GET(`${REST}/ChangeView`, ANY_STATUS);

            expect(history.status).toBe(200);
            expect(history.data).toMatchObject([{ attribute: 'status', valueChangedFrom: 'Open', valueChangedTo: 'Resolved', createdBy: 'admin' }]);
            expect(direct.status).toBe(405);
        });

        it('keeps the entities read-only', async () => {
            const { status, data } = await POST(`${REST}/CustomerMessages`, { customerMessageID: 9002 }, ANY_STATUS);

            expect(status).toBe(405);
            expect(data.error.code).toBe('ENTITY_IS_READ_ONLY');
        });
    });

    describe('authorization', () => {
        const messageUrl = `${REST}/CustomerMessages/${FREEZER_COMPRESSOR}`;

        it.each([
            ['anonymous', 401],
            ['stranger', 403],
            ['viewer', 200],
            ['agent', 200],
            ['admin', 200]
        ])('GET /CustomerMessages as %s: %i', async (user, status) => {
            expect((await send(user, 'GET', `${REST}/CustomerMessages?$top=1`)).status).toBe(status);
        });

        it.each([
            ['anonymous', 401],
            ['stranger', 403],
            ['viewer', 403],
            ['agent', 200],
            ['admin', 200]
        ])('POST addReply as %s: %i', async (user, status) => {
            expect((await send(user, 'POST', `${messageUrl}/addReply`, { author: 'A', text: 'B' })).status).toBe(status);
        });

        it.each([
            ['viewer', 403],
            ['agent', 200]
        ])('POST markAsResolved as %s: %i', async (user, status) => {
            expect((await send(user, 'POST', `${messageUrl}/markAsResolved`, {})).status).toBe(status);
        });

        it.each([
            ['stranger', 403],
            ['viewer', 200]
        ])('GET statistics as %s: %i', async (user, status) => {
            expect((await send(user, 'GET', `${REST}/statistics`)).status).toBe(status);
        });
    });
});
