const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

const { SELECT } = cds.ql;
const test = startServer();
const { GET, POST, PATCH, DELETE } = test;

const SERVICE = '/service/benicio_1_04';
const URL = `${SERVICE}/CustomerMessages`;
const ADMIN = '/service/admin'; // tags are maintained here
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ANY_STATUS = { validateStatus: () => true };

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;

// Sample data
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // urgent-repair, warranty
const NOISY_COMPRESSOR = 'f5fb0645-98c1-48d1-b27d-d126cfa00b11'; // noise, urgent-repair

const query = path => GET(encodeURI(`${SERVICE}/${path}`));
const messageIDs = ({ data }) => data.value.map(message => message.customerMessageID);
const tagCodes = ID => cds.db.run(SELECT.from('Benicio_1_04.CustomerMessageTags').where({ message_ID: ID }))
    .then(rows => rows.map(row => row.tag_code).sort());

describe('tags of a customer message (many-to-many)', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('expand', () => {
        it('expands the tags of a message through the link entity', async () => {
            const { data } = await query(
                `CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)?$select=customerMessageID&$expand=tags($select=tag_code;$expand=tag($select=title))`
            );

            const tags = data.tags.map(link => [link.tag_code, link.tag.title]).sort();
            expect(tags).toEqual([['urgent-repair', 'Urgent repair'], ['warranty', 'Warranty']]);
        });

        it('expands the messages of a tag from the other side', async () => {
            const { data } = await query(`Tags('urgent-repair')?$expand=messages($expand=message($select=customerMessageID))`);

            const ids = data.messages.map(link => link.message.customerMessageID).sort();
            expect(ids).toEqual([2301, 3166, 5896]);
        });
    });

    describe('filter', () => {
        it('finds the messages that have a tag', async () => {
            const response = await query(`CustomerMessages?$filter=tags/any(t:t/tag_code eq 'warranty')&$select=customerMessageID&$orderby=customerMessageID`);

            expect(messageIDs(response)).toEqual([2201, 3166]);
        });

        it('finds the messages by the title of a tag', async () => {
            const response = await query(`CustomerMessages?$filter=tags/any(t:t/tag/title eq 'Delivery delay')&$select=customerMessageID`);

            expect(messageIDs(response)).toEqual([2101]);
        });

        it('finds the messages that have all of several tags', async () => {
            const response = await query(
                `CustomerMessages?$filter=tags/any(a:a/tag_code eq 'noise') and tags/any(b:b/tag_code eq 'urgent-repair')&$select=customerMessageID`
            );

            expect(messageIDs(response)).toEqual([5896]);
        });

        it('finds the messages that have any of several tags', async () => {
            const response = await query(
                `CustomerMessages?$filter=tags/any(t:t/tag_code eq 'noise' or t/tag_code eq 'positive-feedback')&$select=customerMessageID&$orderby=customerMessageID`
            );

            expect(messageIDs(response)).toEqual([2302, 5896]);
        });

        it('finds the messages without any tag', async () => {
            const { data } = await query(`CustomerMessages?$filter=not tags/any()&$select=customerMessageID&$count=true`);

            expect(data['@odata.count']).toBe(4);
            expect(data.value.map(message => message.customerMessageID)).not.toContain(3166);
        });
    });

    describe('assign tags', () => {
        it('adds a tag to a message through its draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const { status } = await POST(`${draft(FREEZER_COMPRESSOR)}/tags`, { tag_code: 'noise' });
            expect(status).toBe(201);
            expect(await tagCodes(FREEZER_COMPRESSOR)).toEqual(['urgent-repair', 'warranty']); // not saved yet

            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            expect(await tagCodes(FREEZER_COMPRESSOR)).toEqual(['noise', 'urgent-repair', 'warranty']);
        });

        it('removes a tag from a message through its draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const { data } = await GET(`${draft(FREEZER_COMPRESSOR)}/tags?$filter=tag_code eq 'warranty'&$select=ID`);
            await DELETE(`${draft(FREEZER_COMPRESSOR)}/tags(ID=${data.value[0].ID},IsActiveEntity=false)`);

            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            expect(await tagCodes(FREEZER_COMPRESSOR)).toEqual(['urgent-repair']);
        });

        it('creates a message together with its tags (deep insert)', async () => {
            const { status, data: created } = await POST(URL, {
                customerMessageID: 9700,
                tags: [{ tag_code: 'warranty' }, { tag_code: 'noise' }]
            });
            expect(status).toBe(201);

            await POST(`${draft(created.ID)}/${ACTIVATE}`, {});

            expect(await tagCodes(created.ID)).toEqual(['noise', 'warranty']);
            const response = await query(`CustomerMessages?$filter=tags/any(t:t/tag_code eq 'noise')&$select=customerMessageID&$orderby=customerMessageID`);
            expect(messageIDs(response)).toEqual([5896, 9700]);
        });

        it('rejects the same tag twice on one message (@assert.unique)', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            await POST(`${draft(FREEZER_COMPRESSOR)}/tags`, { tag_code: 'warranty' });

            const { status, data } = await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'TAG_DUPLICATE', message: 'The tag "warranty" is assigned more than once.' });
            expect(await tagCodes(FREEZER_COMPRESSOR)).toEqual(['urgent-repair', 'warranty']);
        });

        it('requires a tag on the link (@mandatory)', async () => {
            const { data: created } = await POST(URL, { customerMessageID: 9701, tags: [{}] });

            const { status, data } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_MANDATORY');
        });

        it('keeps the tag when the message is deleted, and deletes only the links', async () => {
            const { status } = await DELETE(active(FREEZER_COMPRESSOR));

            expect(status).toBe(204);
            expect(await tagCodes(FREEZER_COMPRESSOR)).toEqual([]);
            const { data } = await query(`Tags('warranty')`);
            expect(data.title).toBe('Warranty');
            expect(await tagCodes('b7e41d96-3a5c-4f08-a1d3-8e2c9f6b3d03')).toEqual(['warranty']);
        });
    });

    describe('tags', () => {
        it('creates, renames and deletes a tag', async () => {
            const created = await POST(`${ADMIN}/Tags`, { code: 'refund', title: 'Refund' });
            expect(created.status).toBe(201);

            const renamed = await PATCH(`${ADMIN}/Tags('refund')`, { title: 'Refund requested' });
            expect(renamed.data.title).toBe('Refund requested');

            const deleted = await DELETE(`${ADMIN}/Tags('refund')`);
            expect(deleted.status).toBe(204);
            expect((await GET(`${ADMIN}/Tags('refund')`, ANY_STATUS)).status).toBe(404);
        });

        it('requires a title (@mandatory)', async () => {
            const { status, data } = await POST(`${ADMIN}/Tags`, { code: 'untitled' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'ASSERT_MANDATORY', target: 'title' });
        });

        it('can be assigned to many messages', async () => {
            const { data } = await query(`Tags('urgent-repair')?$expand=messages`);

            expect(data.messages).toHaveLength(3);
            expect(await tagCodes(NOISY_COMPRESSOR)).toContain('urgent-repair');
        });
    });
});
