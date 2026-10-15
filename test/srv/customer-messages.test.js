const cds = require('@sap/cds');

const test = cds.test(__dirname + '/../..');
const { GET, POST, PATCH, DELETE } = test;

const SERVICE = '/service/benicio_1_04';
const URL = `${SERVICE}/CustomerMessages`;
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';

// Responses with an error status are inspected instead of thrown.
const ANY_STATUS = { validateStatus: () => true };

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;

// IDs of the sample messages in test/data
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // customerMessageID 3166

async function createDraft(data) {
    const { status, data: created } = await POST(URL, data);
    expect(status).toBe(201);
    return created;
}

describe('CustomerMessages service', () => {
    beforeAll(() => {
        // The AI enrichment is not available in tests; its failures are expected.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('read', () => {
        it('exposes the entity in the service metadata', async () => {
            const { status, data } = await GET(`${SERVICE}/$metadata`);

            expect(status).toBe(200);
            expect(data).toContain('<EntitySet Name="CustomerMessages"');
        });

        it('lists the active messages with a count', async () => {
            const { status, data } = await GET(`${URL}?$count=true`);

            expect(status).toBe(200);
            expect(data['@odata.count']).toBeGreaterThanOrEqual(8);
            expect(data.value).toHaveLength(data['@odata.count']);
            data.value.forEach(message => expect(message.IsActiveEntity).toBe(true));
        });

        it('supports $filter and $select', async () => {
            const { data } = await GET(`${URL}?$filter=sourceLanguage eq 'German'&$select=customerMessageID,customerName`);

            expect(data.value.length).toBeGreaterThan(0);
            for (const message of data.value) {
                expect(Object.keys(message).sort()).toEqual(['ID', 'IsActiveEntity', 'customerMessageID', 'customerName']);
            }
        });

        it('supports $orderby, $top and $skip', async () => {
            const { data: all } = await GET(`${URL}?$orderby=customerMessageID&$select=customerMessageID`);
            const { data: page } = await GET(`${URL}?$orderby=customerMessageID&$select=customerMessageID&$top=2&$skip=1`);

            const ids = all.value.map(message => message.customerMessageID);
            expect(ids).toEqual([...ids].sort((a, b) => a - b));
            expect(page.value.map(message => message.customerMessageID)).toEqual(ids.slice(1, 3));
        });

        it('reads a single message by key', async () => {
            const { status, data } = await GET(active(FREEZER_COMPRESSOR));

            expect(status).toBe(200);
            expect(data).toMatchObject({
                ID: FREEZER_COMPRESSOR,
                customerMessageID: 3166,
                productName: 'Freezer',
                sourceLanguage: 'French'
            });
        });

        it('answers 404 for an unknown message', async () => {
            const { status } = await GET(active('00000000-0000-4000-8000-000000000000'), ANY_STATUS);

            expect(status).toBe(404);
        });
    });

    describe('draft flow', () => {
        it('creates, edits and activates a message', async () => {
            const created = await createDraft({ customerMessageID: 9001, customerName: 'Test Customer' });
            expect(created).toMatchObject({ IsActiveEntity: false, HasActiveEntity: false });

            const { status: patchStatus } = await PATCH(draft(created.ID), {
                titleCustomerLanguage: 'Titre de test',
                fullMessageCustomerLanguage: 'Ceci est un message de test.'
            });
            expect(patchStatus).toBe(200);

            const { status: activateStatus, data } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {});
            expect(activateStatus).toBe(201);
            expect(data).toMatchObject({ ID: created.ID, IsActiveEntity: true, customerMessageID: 9001 });

            const { data: stored } = await GET(active(created.ID));
            expect(stored).toMatchObject({
                customerName: 'Test Customer',
                titleCustomerLanguage: 'Titre de test'
            });
        });

        it('keeps a new message out of the active list until it is activated', async () => {
            const created = await createDraft({ customerMessageID: 9002 });
            const filter = `$filter=customerMessageID eq 9002&$select=customerMessageID`;

            const { data: before } = await GET(`${URL}?${filter}`);
            expect(before.value).toHaveLength(0);
            const { status } = await GET(draft(created.ID));
            expect(status).toBe(200);

            await POST(`${draft(created.ID)}/${ACTIVATE}`, {});

            const { data: after } = await GET(`${URL}?${filter}`);
            expect(after.value).toHaveLength(1);
        });

        it('edits an existing message through a draft', async () => {
            const { status: editStatus, data: edited } = await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            expect(editStatus).toBe(201);
            expect(edited).toMatchObject({ IsActiveEntity: false, HasActiveEntity: true });

            await PATCH(draft(FREEZER_COMPRESSOR), { customerName: 'Camille Durand' });
            const { data: untouched } = await GET(active(FREEZER_COMPRESSOR));
            expect(untouched.customerName).toBe('Camille Dubois');

            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});
            const { data: updated } = await GET(active(FREEZER_COMPRESSOR));
            expect(updated.customerName).toBe('Camille Durand');
        });

        it('discards a draft without changing the stored data', async () => {
            const created = await createDraft({ customerMessageID: 9003 });

            const { status } = await DELETE(draft(created.ID));

            expect(status).toBe(204);
            expect((await GET(draft(created.ID), ANY_STATUS)).status).toBe(404);
            expect((await GET(active(created.ID), ANY_STATUS)).status).toBe(404);
        });

        it('deletes an active message', async () => {
            const { status } = await DELETE(active(FREEZER_COMPRESSOR));

            expect(status).toBe(204);
            expect((await GET(active(FREEZER_COMPRESSOR), ANY_STATUS)).status).toBe(404);
        });
    });

    describe('validation', () => {
        it('saves a draft without customerMessageID but rejects its activation (@mandatory)', async () => {
            const created = await createDraft({ customerName: 'No ID yet' });

            const { status, data } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error).toMatchObject({ code: 'ASSERT_MANDATORY', target: 'in/customerMessageID' });
            expect((await GET(active(created.ID), ANY_STATUS)).status).toBe(404);
        });

        it('can be completed after a rejected activation', async () => {
            const created = await createDraft({ customerName: 'No ID yet' });
            await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            await PATCH(draft(created.ID), { customerMessageID: 9004 });
            const { status } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {});

            expect(status).toBe(201);
        });

        it('rejects a duplicate customerMessageID (@assert.unique)', async () => {
            const created = await createDraft({ customerMessageID: 3166 });

            const { status } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBeGreaterThanOrEqual(400);
            const { data } = await GET(`${URL}?$filter=customerMessageID eq 3166&$select=ID`);
            expect(data.value.map(message => message.ID)).toEqual([FREEZER_COMPRESSOR]);
        });

        it('rejects a customerMessageID that is not an integer', async () => {
            const created = await createDraft({ customerMessageID: 9005 });

            const { status } = await PATCH(draft(created.ID), { customerMessageID: 'abc' }, ANY_STATUS);

            expect(status).toBe(400);
        });
    });
});
