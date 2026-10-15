const cds = require('@sap/cds');

const { SELECT, UPDATE } = cds.ql;
const test = cds.test(__dirname + '/../..');
const { GET, POST, PATCH } = test;

const SERVICE = '/service/operations';
const MAIN_SERVICE = '/service/benicio_1_04';
const ANY_STATUS = { validateStatus: () => true };
const ENTITY = 'Benicio_1_04.CustomerMessages';

// Sample data: 11 messages, two of them (2202 and 2302) are resolved.
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // 3166, open
const POSITIVE_FEEDBACK = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e06'; // 2302, resolved
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const message = ID => `${SERVICE}/CustomerMessages(ID=${ID})`;
const markAsResolved = (ID, data = {}) => POST(`${message(ID)}/OperationsService.markAsResolved`, data, ANY_STATUS);
const suggestedPriority = ID => GET(`${message(ID)}/OperationsService.suggestedPriority()`, ANY_STATUS);
const statistics = () => GET(`${SERVICE}/statistics()`);
const classify = (customerMessageID, fields) => cds.db.run(UPDATE(ENTITY).set(fields).where({ customerMessageID }));
const readRow = ID => cds.db.run(SELECT.one.from(ENTITY).where({ ID }));

describe('OperationsService', () => {
    beforeEach(() => test.data.reset());

    describe('service document', () => {
        it('declares the action and the functions', async () => {
            const { data } = await GET(`${SERVICE}/$metadata`);

            expect(data).toContain('<Action Name="markAsResolved" IsBound="true"');
            expect(data).toContain('<Function Name="suggestedPriority" IsBound="true"');
            expect(data).toContain('<FunctionImport Name="statistics"');
        });

        it('exposes the messages read-only', async () => {
            const { data } = await GET(`${SERVICE}/CustomerMessages?$count=true&$top=1&$select=status`);
            const created = await POST(`${SERVICE}/CustomerMessages`, { customerMessageID: 1 }, ANY_STATUS);

            expect(data['@odata.count']).toBe(11);
            expect(created.status).toBe(405);
            expect(created.data.error.code).toBe('ENTITY_IS_READ_ONLY');
        });
    });

    describe('markAsResolved', () => {
        it('resolves an open message and returns it', async () => {
            const { status, data } = await markAsResolved(FREEZER_COMPRESSOR, { resolution: 'Compressor replaced' });

            expect(status).toBe(200);
            expect(data).toMatchObject({
                ID: FREEZER_COMPRESSOR,
                status: 'Resolved',
                resolvedBy: 'privileged',
                resolution: 'Compressor replaced'
            });
            expect(Date.parse(data.resolvedAt)).toBeGreaterThan(Date.parse('2025-01-01'));
        });

        it('stores the result in the database', async () => {
            await markAsResolved(FREEZER_COMPRESSOR, { resolution: 'Compressor replaced' });

            expect(await readRow(FREEZER_COMPRESSOR)).toMatchObject({
                status: 'Resolved',
                resolvedBy: 'privileged',
                resolution: 'Compressor replaced'
            });
        });

        it('does not need a resolution text', async () => {
            const { status, data } = await markAsResolved(FREEZER_COMPRESSOR);

            expect(status).toBe(200);
            expect(data.status).toBe('Resolved');
            expect(data.resolution).toBeNull();
        });

        it('rejects a message that is already resolved and keeps it unchanged', async () => {
            const before = await readRow(POSITIVE_FEEDBACK);

            const { status, data } = await markAsResolved(POSITIVE_FEEDBACK, { resolution: 'Again' });

            expect(status).toBe(409);
            expect(data.error.message).toBe('The customer message is already resolved');
            expect(await readRow(POSITIVE_FEEDBACK)).toMatchObject({
                resolvedAt: before.resolvedAt,
                resolution: before.resolution
            });
        });

        it('cannot resolve a message twice', async () => {
            expect((await markAsResolved(FREEZER_COMPRESSOR)).status).toBe(200);
            expect((await markAsResolved(FREEZER_COMPRESSOR)).status).toBe(409);
        });

        it('answers 404 for an unknown message', async () => {
            const { status } = await markAsResolved(UNKNOWN);

            expect(status).toBe(404);
        });

        it('rejects a resolution text that is too long', async () => {
            const { status } = await markAsResolved(FREEZER_COMPRESSOR, { resolution: 'x'.repeat(1001) });

            expect(status).toBe(400);
            expect((await readRow(FREEZER_COMPRESSOR)).status).toBe('Open');
        });

        it('is the only way to change the status: the main service ignores it', async () => {
            const { data: created } = await POST(`${MAIN_SERVICE}/CustomerMessages`, { customerMessageID: 9800, status: 'Resolved' });
            const draft = `${MAIN_SERVICE}/CustomerMessages(ID=${created.ID},IsActiveEntity=false)`;
            await PATCH(draft, { status: 'Resolved', resolution: 'Hacked' });
            await POST(`${draft}/benicio_1_04Srv.draftActivate`, {});

            expect(await readRow(created.ID)).toMatchObject({ status: 'Open', resolution: null });
        });
    });

    describe('suggestedPriority', () => {
        it.each([
            ['High', 'Negative', 5, 'Critical'],
            ['High', 'Neutral', 4, 'High'],
            ['Medium', 'Negative', 4, 'High'],
            ['Medium', 'Neutral', 3, 'Medium'],
            ['Low', 'Negative', 3, 'Medium'],
            ['Low', 'Positive', 1, 'Low'],
            [null, null, 0, 'Low']
        ])('suggests for urgency %s and sentiment %s the score %i and level %s', async (messageUrgency, messageSentiment, score, level) => {
            await classify(3166, { messageUrgency, messageSentiment });

            const { status, data } = await suggestedPriority(FREEZER_COMPRESSOR);

            expect(status).toBe(200);
            expect(data).toMatchObject({ score, level });
        });

        it('answers 404 for an unknown message', async () => {
            expect((await suggestedPriority(UNKNOWN)).status).toBe(404);
        });
    });

    describe('statistics', () => {
        it('counts the sample data per status and shows unclassified messages', async () => {
            const { status, data } = await statistics();

            expect(status).toBe(200);
            expect(data).toMatchObject({
                total: 11,
                open: 9,
                resolved: 2,
                byCategory: [{ value: 'Unclassified', count: 11 }],
                byUrgency: [{ value: 'Unclassified', count: 11 }]
            });
        });

        it('counts the messages per category and urgency, largest group first', async () => {
            await classify(3166, { messageCategory: 'Technical', messageUrgency: 'High' });
            await classify(3923, { messageCategory: 'Technical', messageUrgency: 'Low' });
            await classify(5896, { messageCategory: 'Technical', messageUrgency: 'High' });
            await classify(2101, { messageCategory: 'Delivery', messageUrgency: 'Medium' });

            const { data } = await statistics();

            expect(data.byCategory).toEqual([
                { value: 'Unclassified', count: 7 },
                { value: 'Technical', count: 3 },
                { value: 'Delivery', count: 1 }
            ]);
            expect(data.byUrgency).toEqual([
                { value: 'Unclassified', count: 7 },
                { value: 'High', count: 2 },
                { value: 'Low', count: 1 },
                { value: 'Medium', count: 1 }
            ]);
            expect(data.total).toBe(11);
        });

        it('follows markAsResolved', async () => {
            await markAsResolved(FREEZER_COMPRESSOR);

            const { data } = await statistics();

            expect(data).toMatchObject({ total: 11, open: 8, resolved: 3 });
        });
    });
});
