const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');
const { enableEnrichment, settle } = require('../helpers/enrichment');

// The AI call is mocked: no AI Core binding is needed.
jest.mock('../../srv/code/genai/orchestration', () => ({
    preprocessCustomerMessage: jest.fn()
}));

const { preprocessCustomerMessage } = require('../../srv/code/genai/orchestration');
const { SELECT, DELETE: DELETE_FROM } = cds.ql;
const test = startServer();
const { GET, POST, PATCH, DELETE } = test;

const MAIN = '/service/benicio_1_04';
const OPERATIONS = '/service/operations';
const ADMIN = '/service/admin';
const URL = `${MAIN}/CustomerMessages`;
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ANY_STATUS = { validateStatus: () => true };

// Sample data: message 3166 is open and not yet classified.
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';
const AI_RESULT = {
    fullMessageEnglish: 'The compressor is broken.',
    titleEnglish: 'Defective compressor',
    summaryCustomerLanguage: 'Le compresseur est en panne.',
    summaryEnglish: 'The compressor is broken.',
    messageCategory: 'Technical',
    messageUrgency: 'High',
    messageSentiment: 'Negative'
};

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;
const history = (service, path, query = '') => GET(`${service}/${path}/changes?$orderby=createdAt,attribute${query}`);

/** The rows of sap.changelog.Changes of an entity, oldest first. */
const changes = (entityKey, columns = ['attribute', 'valueChangedFrom', 'valueChangedTo', 'modification', 'createdBy', 'objectID']) =>
    cds.db.run(SELECT.from('sap.changelog.Changes').columns(columns).where({ entityKey }).orderBy('createdAt', 'attribute'));

/** Creates and saves a message of the user. */
async function createMessage(user, data) {
    const config = as(user);
    const { data: created } = await POST(URL, { customerMessageID: 9100, customerId: 'C-90001', customerName: 'Erika Mustermann', ...data }, config);
    await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, config);
    return created.ID;
}

/** Edits a message in a draft and saves it. */
async function change(ID, user, changes_) {
    const config = as(user);
    await POST(`${active(ID)}/${EDIT}`, { PreserveChanges: true }, config);
    await PATCH(draft(ID), changes_, config);
    return POST(`${draft(ID)}/${ACTIVATE}`, {}, config);
}

describe('change history', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'info').mockImplementation(() => {});
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(async () => {
        await test.data.reset();
        // Loading the sample data fired the triggers: it is in the history as created by "anonymous".
        // The tests start with an empty history.
        await cds.db.run(DELETE_FROM.from('sap.changelog.Changes'));
        preprocessCustomerMessage.mockReset();
    });

    describe('model', () => {
        const trackedElements = entity => Object.values(cds.model.definitions[entity].elements).filter(element => element['@changelog']).map(element => element.name).sort();

        it('tracks the classification and the status of a message', () => {
            expect(trackedElements('Benicio_1_04.CustomerMessages')).toEqual(['messageCategory', 'messageSentiment', 'messageUrgency', 'status']);
            expect(cds.model.definitions['Benicio_1_04.CustomerMessages']['@changelog']).toEqual([{ '=': 'customerMessageID' }]);
        });

        it('tracks the reference data and the settings', () => {
            expect(trackedElements('Benicio_1_04.Tags')).toEqual(['title']);
            expect(trackedElements('Benicio_1_04.ResponseTemplates')).toEqual(['messageCategory', 'text', 'title', 'validFrom', 'validTo']);
            expect(trackedElements('Benicio_1_04.Settings')).toEqual(['aiModelName', 'autoEnrichment']);
        });

        it('does not track personal data: the history would circumvent the audit log', () => {
            for (const definition of Object.values(cds.model.definitions)) {
                if (definition.kind !== 'entity' || !definition.name.startsWith('Benicio_1_04.')) continue;
                for (const element of Object.values(definition.elements)) {
                    const personal = element['@PersonalData.IsPotentiallyPersonal'] || element['@PersonalData.IsPotentiallySensitive'];
                    expect({ element: `${definition.name}.${element.name}`, tracked: !!(personal && element['@changelog']) })
                        .toEqual({ element: `${definition.name}.${element.name}`, tracked: false });
                }
            }
        });

        it('offers the history in the OperationsService and the AdminService, not in the app service', async () => {
            const { definitions } = cds.model;

            expect(definitions['OperationsService.CustomerMessages'].elements.changes).toBeDefined();
            expect(definitions['AdminService.Tags'].elements.changes).toBeDefined();
            expect(definitions['AdminService.ResponseTemplates'].elements.changes).toBeDefined();
            expect(definitions['AdminService.Settings'].elements.changes).toBeDefined();
            expect(definitions['benicio_1_04Srv.CustomerMessages'].elements.changes).toBeUndefined();
            expect(definitions['benicio_1_04Srv.ChangeView']).toBeUndefined();
            expect((await GET(`${MAIN}/$metadata`)).data).not.toContain('ChangeView');
        });
    });

    describe('recorded changes', () => {
        it('records the sample data as created by "anonymous", before any user acts', async () => {
            await test.data.reset();

            const rows = await changes(FREEZER_COMPRESSOR);

            expect(rows).toEqual([expect.objectContaining({ attribute: 'status', valueChangedTo: 'Open', modification: 'create', createdBy: 'anonymous' })]);
        });

        it('records who resolved a message', async () => {
            await POST(`${OPERATIONS}/CustomerMessages(ID=${FREEZER_COMPRESSOR})/OperationsService.markAsResolved`, { resolution: 'Compressor replaced' }, as('agent'));

            expect(await changes(FREEZER_COMPRESSOR)).toEqual([
                { attribute: 'status', valueChangedFrom: 'Open', valueChangedTo: 'Resolved', modification: 'update', createdBy: 'agent', objectID: '3166' }
            ]);
        });

        it('records a change made in a draft when it is saved', async () => {
            const ID = await createMessage('agent', { messageUrgency: 'High' });

            await change(ID, 'agent', { messageUrgency: 'Low' });

            expect((await changes(ID)).map(({ attribute, valueChangedFrom, valueChangedTo, modification }) => [attribute, valueChangedFrom, valueChangedTo, modification])).toEqual([
                ['messageUrgency', null, 'High', 'create'],
                ['status', null, 'Open', 'create'],
                ['messageUrgency', 'High', 'Low', 'update']
            ]);
        });

        it('records no change while the message is only a draft', async () => {
            const { data } = await POST(URL, { customerMessageID: 9101, customerId: 'C-90002', messageUrgency: 'High' });
            await PATCH(draft(data.ID), { messageUrgency: 'Low' });

            expect(await changes(data.ID)).toEqual([]);
        });

        it('identifies the object by its customerMessageID', async () => {
            const ID = await createMessage('agent', { messageUrgency: 'High' });

            const rows = await changes(ID);

            expect(rows.length).toBeGreaterThan(0);
            expect(new Set(rows.map(row => row.objectID))).toEqual(new Set(['9100']));
        });

        it('does not record attributes that are not annotated, nor personal data', async () => {
            const ID = await createMessage('agent', { messageUrgency: 'High', productName: 'Dishwasher' });

            await change(ID, 'agent', { customerName: 'Erika Musterfrau', productName: 'Dishwasher Pro', fullMessageCustomerLanguage: 'Neuer Text' });

            const attributes = (await changes(ID)).map(row => row.attribute);
            expect(attributes).not.toContain('customerName');
            expect(attributes).not.toContain('productName');
            expect(attributes).not.toContain('fullMessageCustomerLanguage');
            expect(JSON.stringify(await cds.db.run(SELECT.from('sap.changelog.Changes')))).not.toMatch(/Erika|Neuer Text/);
        });

        it('records the classification that the AI writes, as changes of the application itself', async () => {
            enableEnrichment();
            preprocessCustomerMessage.mockResolvedValue(AI_RESULT);

            await GET(`${URL}?$filter=customerMessageID eq 3166&$select=customerMessageID`);
            await settle();

            const rows = await changes(FREEZER_COMPRESSOR);
            expect(rows.map(row => [row.attribute, row.valueChangedFrom, row.valueChangedTo])).toEqual([
                ['messageCategory', null, 'Technical'],
                ['messageSentiment', null, 'Negative'],
                ['messageUrgency', null, 'High']
            ]);
            expect(new Set(rows.map(row => row.createdBy))).toEqual(new Set(['privileged'])); // not the user whose read started the task
        });

        it('keeps the changes of a deleted message as delete entries', async () => {
            const ID = await createMessage('agent', { messageUrgency: 'High' });

            const { status } = await DELETE(active(ID), as('agent'));

            expect(status).toBe(204);
            expect((await changes(ID)).map(row => [row.attribute, row.valueChangedFrom, row.valueChangedTo, row.modification])).toEqual([
                ['messageUrgency', 'High', null, 'delete'],
                ['status', 'Open', null, 'delete']
            ]);
        });

        it('records the changes of tags, templates and settings with their code', async () => {
            await PATCH(`${ADMIN}/Tags('warranty')`, { title: 'Warranty claim' }, as('agent'));
            await PATCH(`${ADMIN}/ResponseTemplates(code='technician-visit',validFrom=2024-01-01T00:00:00Z)`, { text: 'A technician will visit you within 24 hours.' }, as('agent'));
            await PATCH(`${ADMIN}/Settings`, { autoEnrichment: false, aiModelName: 'gpt-4.1-mini' }, as('admin'));

            expect(await changes('warranty')).toEqual([
                { attribute: 'title', valueChangedFrom: 'Warranty', valueChangedTo: 'Warranty claim', modification: 'update', createdBy: 'agent', objectID: 'warranty' }
            ]);
            expect((await changes('technician-visit')).map(row => row.attribute)).toEqual(['text']);
            expect((await changes('1')).map(row => [row.attribute, row.valueChangedFrom, row.valueChangedTo, row.createdBy])).toEqual([
                ['aiModelName', null, 'gpt-4.1-mini', 'admin'],
                ['autoEnrichment', 'true', 'false', 'admin']
            ]);
        });
    });

    describe('reading the history', () => {
        beforeEach(async () => {
            await POST(`${OPERATIONS}/CustomerMessages(ID=${FREEZER_COMPRESSOR})/OperationsService.markAsResolved`, { resolution: 'Done' }, as('agent'));
            await PATCH(`${ADMIN}/Tags('warranty')`, { title: 'Warranty claim' }, as('agent'));
        });

        it('lists the changes of a message with readable labels', async () => {
            const { status, data } = await history(OPERATIONS, `CustomerMessages(ID=${FREEZER_COMPRESSOR})`);

            expect(status).toBe(200);
            expect(data.value).toHaveLength(1);
            expect(data.value[0]).toMatchObject({
                attribute: 'status',
                attributeLabel: expect.any(String),
                valueChangedFrom: 'Open',
                valueChangedTo: 'Resolved',
                modification: 'update',
                modificationLabel: expect.any(String),
                objectID: '3166',
                createdBy: 'agent',
                entity: 'Benicio_1_04.CustomerMessages',
                entityKey: FREEZER_COMPRESSOR
            });
            expect(Date.now() - Date.parse(data.value[0].createdAt)).toBeLessThan(60 * 1000);
        });

        it('lists only the changes of that message', async () => {
            const other = '5d0a8c1e-6f43-4b7a-9a2e-1c7e3b9f4a01';
            await POST(`${OPERATIONS}/CustomerMessages(ID=${other})/OperationsService.markAsResolved`, {}, as('agent'));

            const { data } = await history(OPERATIONS, `CustomerMessages(ID=${FREEZER_COMPRESSOR})`);

            expect(data.value.map(row => row.entityKey)).toEqual([FREEZER_COMPRESSOR]);
        });

        it('can be filtered and expanded with the messages', async () => {
            const filtered = await history(OPERATIONS, `CustomerMessages(ID=${FREEZER_COMPRESSOR})`, "&$filter=attribute eq 'messageUrgency'");
            const expanded = await GET(`${OPERATIONS}/CustomerMessages?$filter=customerMessageID eq 3166&$select=customerMessageID&$expand=changes($select=attribute,valueChangedTo)`);

            expect(filtered.data.value).toEqual([]);
            expect(expanded.data.value[0].changes).toMatchObject([{ attribute: 'status', valueChangedTo: 'Resolved' }]);
        });

        it('lists the changes of a tag in the AdminService', async () => {
            const { data } = await history(ADMIN, "Tags('warranty')");

            expect(data.value).toHaveLength(1);
            expect(data.value[0]).toMatchObject({ attribute: 'title', valueChangedFrom: 'Warranty', valueChangedTo: 'Warranty claim', objectID: 'warranty' });
        });

        it('lists the changes of the settings in the AdminService', async () => {
            await PATCH(`${ADMIN}/Settings`, { autoEnrichment: false }, as('admin'));

            const { data } = await GET(`${ADMIN}/Settings/changes`);

            expect(data.value.map(row => [row.attribute, row.valueChangedFrom, row.valueChangedTo])).toEqual([['autoEnrichment', 'true', 'false']]);
        });

        it('is available in GraphQL for the tags', async () => {
            const { data } = await POST('/graphql', { query: "{ AdminService { Tags(filter: { code: { eq: \"warranty\" } }) { nodes { changes { nodes { attribute valueChangedTo } } } } } }" });

            expect(data.data.AdminService.Tags.nodes[0].changes.nodes).toEqual([{ attribute: 'title', valueChangedTo: 'Warranty claim' }]);
        });

        it('is not offered by the app service', async () => {
            const { status } = await GET(`${active(FREEZER_COMPRESSOR)}/changes`, ANY_STATUS);

            expect(status).toBe(404);
        });
    });

    describe('authorization', () => {
        it.each([
            ['anonymous', { auth: undefined }, 401],
            ['stranger', as('stranger'), 403],
            ['viewer', as('viewer'), 200],
            ['agent', as('agent'), 200],
            ['admin', as('admin'), 200]
        ])('history of a message, %s: %i', async (_, config, status) => {
            const response = await GET(`${OPERATIONS}/CustomerMessages(ID=${FREEZER_COMPRESSOR})/changes`, { ...config, ...ANY_STATUS });

            expect(response.status).toBe(status);
        });

        it.each([
            ['stranger', as('stranger'), 403],
            ['viewer', as('viewer'), 200]
        ])('history of a tag, %s: %i', async (_, config, status) => {
            const response = await GET(`${ADMIN}/Tags('warranty')/changes`, { ...config, ...ANY_STATUS });

            expect(response.status).toBe(status);
        });

        it('does not expose the history as an entity set, and nobody may write it', async () => {
            const read = await GET(`${OPERATIONS}/ChangeView`, ANY_STATUS);
            const write = await POST(`${OPERATIONS}/ChangeView`, { attribute: 'forged' }, ANY_STATUS);

            expect([read.status, write.status]).toEqual([405, 405]);
        });

        it('hides the history of a message from a role-less user also in an expand', async () => {
            const { status } = await GET(`${OPERATIONS}/CustomerMessages?$expand=changes`, { ...as('stranger'), ...ANY_STATUS });

            expect(status).toBe(403);
        });
    });
});
