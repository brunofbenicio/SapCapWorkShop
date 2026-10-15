const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

const { SELECT } = cds.ql;
const test = startServer();
const { GET, POST, PATCH, DELETE } = test;

const SERVICE = '/service/benicio_1_04';
const URL = `${SERVICE}/CustomerMessages`;
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ANY_STATUS = { validateStatus: () => true };

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;

// Sample data: message 3166 has two replies, message 2101 has one.
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';
const LATE_DELIVERY = '5d0a8c1e-6f43-4b7a-9a2e-1c7e3b9f4a01';

const dbReplies = ID => cds.db.run(SELECT.from('Benicio_1_04.CustomerMessageReplies').where({ message_ID: ID }));
const texts = replies => replies.map(reply => reply.text).sort();

async function createMessageWithReplies(replies) {
    const { status, data } = await POST(URL, { customerMessageID: 9500, replies });
    expect(status).toBe(201);
    return data;
}

describe('replies of a customer message', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('read', () => {
        it('expands the replies of a message in the order they were sent', async () => {
            const { data } = await GET(`${active(FREEZER_COMPRESSOR)}?$select=customerMessageID&$expand=replies($select=author,sentAt;$orderby=sentAt)`);

            expect(data.replies).toHaveLength(2);
            expect(data.replies[0].author).toBe('Support Team');
            expect(data.replies[0].sentAt < data.replies[1].sentAt).toBe(true);
        });

        it('reads the replies as a navigation property', async () => {
            const { data } = await GET(`${active(LATE_DELIVERY)}/replies?$select=text`);

            expect(data.value).toHaveLength(1);
            expect(data.value[0].text).toContain('Kühlschrank');
        });
    });

    describe('deep insert', () => {
        it('creates a message together with its replies', async () => {
            const created = await createMessageWithReplies([
                { author: 'Agent One', text: 'We are looking into it.' },
                { author: 'Agent Two', text: 'A technician is on the way.' }
            ]);

            const { data: draftReplies } = await GET(`${draft(created.ID)}/replies`);
            expect(texts(draftReplies.value)).toEqual(['A technician is on the way.', 'We are looking into it.']);

            const { status } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {});
            expect(status).toBe(201);

            const stored = await dbReplies(created.ID);
            expect(texts(stored)).toEqual(['A technician is on the way.', 'We are looking into it.']);
            stored.forEach(reply => expect(reply.message_ID).toBe(created.ID));
        });

        it('sets sentAt and the managed fields when the reply is saved', async () => {
            const created = await createMessageWithReplies([
                { author: 'Agent One', text: 'Hello', sentAt: '2020-01-01T00:00:00Z' }
            ]);
            await POST(`${draft(created.ID)}/${ACTIVATE}`, {});

            const [reply] = await dbReplies(created.ID);

            expect(Date.parse(reply.sentAt)).toBeGreaterThan(Date.parse('2025-01-01'));
            expect(reply.createdBy).toBe('admin');
        });

        it('adds a reply to an existing message through its draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const { status } = await POST(`${draft(FREEZER_COMPRESSOR)}/replies`, { author: 'Agent', text: 'Your new compressor has been shipped.' });
            expect(status).toBe(201);

            expect(await dbReplies(FREEZER_COMPRESSOR)).toHaveLength(2); // not saved yet
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            const stored = await dbReplies(FREEZER_COMPRESSOR);
            expect(stored).toHaveLength(3);
            expect(texts(stored)).toContain('Your new compressor has been shipped.');
        });

        it('requires author and text (@mandatory) when the message is saved', async () => {
            const created = await createMessageWithReplies([{ author: 'Agent One' }]);

            const { status, data } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_MANDATORY');
            expect(data.error.target).toMatch(/^in\/replies\(.*\)\/text$/);
            expect(await dbReplies(created.ID)).toHaveLength(0);
        });
    });

    describe('delete', () => {
        it('removes a reply that is deleted in the draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const { data } = await GET(`${draft(FREEZER_COMPRESSOR)}/replies?$orderby=sentAt&$top=1&$select=ID`);

            const { status } = await DELETE(`${draft(FREEZER_COMPRESSOR)}/replies(ID=${data.value[0].ID},IsActiveEntity=false)`);
            expect(status).toBe(204);
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            expect(await dbReplies(FREEZER_COMPRESSOR)).toHaveLength(1);
        });

        it('deletes the replies together with the message (cascade)', async () => {
            expect(await dbReplies(FREEZER_COMPRESSOR)).toHaveLength(2);

            const { status } = await DELETE(active(FREEZER_COMPRESSOR));

            expect(status).toBe(204);
            expect(await dbReplies(FREEZER_COMPRESSOR)).toHaveLength(0);
            expect(await dbReplies(LATE_DELIVERY)).toHaveLength(1); // other messages are not affected
        });

        it('discards the replies together with a draft', async () => {
            const created = await createMessageWithReplies([{ author: 'Agent One', text: 'Draft only' }]);
            const draftReplies = cds.model.definitions['benicio_1_04Srv.CustomerMessageReplies'].drafts;
            expect(await cds.db.run(SELECT.from(draftReplies))).toHaveLength(1);

            const { status } = await DELETE(draft(created.ID));

            expect(status).toBe(204);
            expect(await cds.db.run(SELECT.from(draftReplies))).toHaveLength(0);
            expect(await dbReplies(created.ID)).toHaveLength(0);
        });
    });

    it('keeps the drafts of replies out of the active data until the message is saved', async () => {
        await POST(`${active(LATE_DELIVERY)}/${EDIT}`, { PreserveChanges: true });
        await POST(`${draft(LATE_DELIVERY)}/replies`, { author: 'Agent', text: 'Unsaved' });
        await PATCH(draft(LATE_DELIVERY), { customerName: 'Lukas Brandt (draft)' });

        const { data } = await GET(`${active(LATE_DELIVERY)}?$select=customerName&$expand=replies($select=text)`);

        expect(data.customerName).toBe('Lukas Brandt');
        expect(data.replies).toHaveLength(1);
    });
});
