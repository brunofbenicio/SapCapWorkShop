const cds = require('@sap/cds');

const { SELECT } = cds.ql;
const test = cds.test(__dirname + '/../..');
const { GET, POST } = test;

const SERVICE = '/service/operations';
const ANY_STATUS = { validateStatus: () => true };
const EVENTS = LOG => LOG.info.mock.calls.map(([text]) => text);

const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // 3166, open
const POSITIVE_FEEDBACK = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e06'; // 2302, resolved
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const action = (ID, name, data = {}) => POST(`${SERVICE}/CustomerMessages(ID=${ID})/OperationsService.${name}`, data, ANY_STATUS);

describe('events of the OperationsService', () => {
    const resolved = jest.fn();
    const replied = jest.fn();
    const eventLog = cds.log('events');

    beforeAll(async () => {
        const messaging = await cds.connect.to('messaging');
        messaging.on('OperationsService.MessageResolved', resolved);
        messaging.on('OperationsService.ReplyAdded', replied);
    });

    beforeEach(async () => {
        resolved.mockClear();
        replied.mockClear();
        jest.spyOn(eventLog, 'info').mockImplementation(() => {});
        await test.data.reset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('model and configuration', () => {
        it('declares both events in the service', () => {
            const { definitions } = cds.model;

            expect(definitions['OperationsService.MessageResolved'].kind).toBe('event');
            expect(Object.keys(definitions['OperationsService.MessageResolved'].elements)).toEqual(
                ['messageID', 'customerMessageID', 'resolvedBy', 'resolvedAt', 'resolution']
            );
            expect(definitions['OperationsService.ReplyAdded'].kind).toBe('event');
        });

        it('uses in-process messaging in tests', () => {
            expect(cds.env.requires.messaging.kind).toBe('local-messaging');
        });

        it('uses file-based messaging in development and in-process messaging in production', () => {
            const { messaging } = require('../../package.json').cds.requires;

            expect(messaging['[development]']).toMatchObject({ kind: 'file-based-messaging' });
            expect(messaging['[production]']).toMatchObject({ kind: 'local-messaging' });
        });
    });

    describe('MessageResolved', () => {
        it('is emitted when a message is resolved', async () => {
            const { status } = await action(FREEZER_COMPRESSOR, 'markAsResolved', { resolution: 'Compressor replaced' });

            expect(status).toBe(200);
            expect(resolved).toHaveBeenCalledTimes(1);
            const { event, data } = resolved.mock.calls[0][0];
            expect(event).toBe('OperationsService.MessageResolved');
            expect(data).toMatchObject({
                messageID: FREEZER_COMPRESSOR,
                customerMessageID: 3166,
                resolvedBy: 'privileged',
                resolution: 'Compressor replaced'
            });
            expect(Date.parse(data.resolvedAt)).toBeGreaterThan(Date.parse('2025-01-01'));
        });

        it('carries the same time as the stored message', async () => {
            await action(FREEZER_COMPRESSOR, 'markAsResolved');

            const { data } = resolved.mock.calls[0][0];
            const row = await cds.db.run(SELECT.one.from('Benicio_1_04.CustomerMessages').where({ ID: FREEZER_COMPRESSOR }));
            expect(data.resolvedAt).toBe(row.resolvedAt);
        });

        it('is not emitted when the message is already resolved', async () => {
            const { status } = await action(POSITIVE_FEEDBACK, 'markAsResolved');

            expect(status).toBe(409);
            expect(resolved).not.toHaveBeenCalled();
        });

        it('is not emitted for an unknown message', async () => {
            const { status } = await action(UNKNOWN, 'markAsResolved');

            expect(status).toBe(404);
            expect(resolved).not.toHaveBeenCalled();
        });

        it('is handled by the subscriber', async () => {
            await action(FREEZER_COMPRESSOR, 'markAsResolved');

            expect(EVENTS(eventLog)).toEqual([`CustomerMessage 3166 (${FREEZER_COMPRESSOR}) was resolved by privileged`]);
        });
    });

    describe('addReply and ReplyAdded', () => {
        it('stores the reply and returns it', async () => {
            const { status, data } = await action(FREEZER_COMPRESSOR, 'addReply', { author: 'Agent One', text: 'We are on it.' });

            expect(status).toBe(200);
            expect(data).toMatchObject({ message_ID: FREEZER_COMPRESSOR, author: 'Agent One', text: 'We are on it.' });
            expect(Date.parse(data.sentAt)).toBeGreaterThan(Date.parse('2025-01-01'));
        });

        it('makes the reply visible in the main service', async () => {
            const { data: reply } = await action(FREEZER_COMPRESSOR, 'addReply', { author: 'Agent One', text: 'We are on it.' });

            const { data } = await GET(
                `/service/benicio_1_04/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)/replies?$select=ID,author&$orderby=sentAt`
            );

            expect(data.value).toHaveLength(3); // two sample replies and the new one
            expect(data.value.map(each => each.ID)).toContain(reply.ID);
        });

        it('emits ReplyAdded with the data of the reply', async () => {
            const { data: reply } = await action(FREEZER_COMPRESSOR, 'addReply', { author: 'Agent One', text: 'We are on it.' });

            expect(replied).toHaveBeenCalledTimes(1);
            expect(replied.mock.calls[0][0].data).toEqual({
                messageID: FREEZER_COMPRESSOR,
                customerMessageID: 3166,
                replyID: reply.ID,
                author: 'Agent One',
                sentAt: reply.sentAt
            });
            expect(resolved).not.toHaveBeenCalled();
        });

        it('is handled by the subscriber', async () => {
            const { data: reply } = await action(FREEZER_COMPRESSOR, 'addReply', { author: 'Agent One', text: 'We are on it.' });

            expect(EVENTS(eventLog)).toEqual([
                `Agent One replied to CustomerMessage 3166 (${FREEZER_COMPRESSOR}), reply ${reply.ID}`
            ]);
        });

        it.each([
            ['author', { text: 'No author' }],
            ['text', { author: 'Agent One' }]
        ])('requires the parameter %s and emits nothing without it', async (parameter, data) => {
            const response = await action(FREEZER_COMPRESSOR, 'addReply', data);

            expect(response.status).toBe(400);
            expect(response.data.error).toMatchObject({ code: 'ASSERT_MANDATORY', target: parameter });
            expect(replied).not.toHaveBeenCalled();
        });

        it('answers 404 and emits nothing for an unknown message', async () => {
            const { status } = await action(UNKNOWN, 'addReply', { author: 'Agent One', text: 'Hello' });

            expect(status).toBe(404);
            expect(replied).not.toHaveBeenCalled();
        });
    });
});
