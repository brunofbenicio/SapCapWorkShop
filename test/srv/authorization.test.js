const cds = require('@sap/cds');
const { startServer, as, USERS: MOCKED_USERS } = require('../helpers/server');

const test = startServer();

const MAIN = '/service/benicio_1_04';
const ADMIN = '/service/admin';
const OPERATIONS = '/service/operations';

// Sample data (created by "agent"): message 3166 is open, 2302 is resolved; tag "noise" and template "technician-visit".
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';

// The users of the application. "anonymous" sends no credentials, "stranger" logs in
// without any role; the others are the mocked users from package.json.
const USERS = ['anonymous', 'stranger', 'viewer', 'agent', 'admin'];

/** Sends a request as the given user and returns the response, whatever its status. */
function send(user, method, url, data) {
    const config = { ...(user === 'anonymous' ? { auth: undefined } : as(user)), validateStatus: () => true };
    return ['GET', 'DELETE'].includes(method) ? test[method](url, config) : test[method](url, data, config);
}

/** Creates and saves a message as the given user; the user becomes the creator of the message. */
async function createMessage(user, customerMessageID) {
    const { data } = await send(user, 'POST', `${MAIN}/CustomerMessages`, { customerMessageID });
    await send(user, 'POST', `${MAIN}/CustomerMessages(ID=${data.ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, {});
    return data.ID;
}

/**
 * Checks the status of one request for every user.
 * @param {string} name description of the request
 * @param {() => Promise<[string, string, object?]> | [string, string, object?]} request method, url and body
 * @param {object} expected status per user, for example { viewer: 200, agent: 200 }
 */
function matrix(name, request, expected) {
    describe(name, () => {
        it.each(USERS.map(user => [user, expected[user]]))('%s: %i', async (user, status) => {
            const [method, url, body] = await request();
            const response = await send(user, method, url, body);
            expect(response.status).toBe(status);
        });
    });
}

describe('authorization', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('users', () => {
        it('has the mocked users viewer, agent and admin with the roles of xs-security.json', () => {
            expect(MOCKED_USERS.viewer.roles).toEqual(['Viewer']);
            expect(MOCKED_USERS.agent.roles).toEqual(['Viewer', 'Agent']);
            expect(MOCKED_USERS.admin.roles).toEqual(['Viewer', 'Agent', 'Admin']);

            const xsRoles = require('../../xs-security.json')['role-templates']
                .map(template => [template.name, template['scope-references'].map(scope => scope.replace('$XSAPPNAME.', ''))]);
            for (const [name, scopes] of xsRoles) {
                expect(MOCKED_USERS[name.toLowerCase()].roles).toEqual(scopes);
            }
        });
    });

    describe('benicio_1_04Srv (the app of the agents)', () => {
        matrix('read messages', () => ['GET', `${MAIN}/CustomerMessages`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('read the metadata', () => ['GET', `${MAIN}/$metadata`], { anonymous: 401, stranger: 200, viewer: 200, agent: 200, admin: 200 });
        matrix('read replies, attachments and tags of a message', () => ['GET', `${MAIN}/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)/tags`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('create a message (draft)', () => ['POST', `${MAIN}/CustomerMessages`, { customerMessageID: 9900 }], { anonymous: 401, stranger: 403, viewer: 403, agent: 201, admin: 201 });
        matrix('read the code list of categories', () => ['GET', `${MAIN}/MessageCategories`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('write a tag in this service (read-only here)', () => ['POST', `${MAIN}/Tags`, { code: 'refund', title: 'Refund' }], { anonymous: 401, stranger: 405, viewer: 405, agent: 405, admin: 405 });

        describe('edit a message that was created by the agent', () => {
            matrix('start a draft', () => ['POST', `${MAIN}/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)/benicio_1_04Srv.draftEdit`, { PreserveChanges: true }],
                { anonymous: 401, stranger: 403, viewer: 403, agent: 201, admin: 201 });
            matrix('delete', () => ['DELETE', `${MAIN}/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)`],
                { anonymous: 401, stranger: 403, viewer: 403, agent: 204, admin: 204 });
        });

        describe('edit a message that was created by an administrator (instance-based)', () => {
            let ID;
            beforeEach(async () => { ID = await createMessage('admin', 9901); });

            matrix('start a draft', () => ['POST', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=true)/benicio_1_04Srv.draftEdit`, { PreserveChanges: true }],
                { anonymous: 401, stranger: 403, viewer: 403, agent: 403, admin: 201 });
            matrix('delete', () => ['DELETE', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=true)`],
                { anonymous: 401, stranger: 403, viewer: 403, agent: 403, admin: 204 });
        });

        it('lets an agent change and delete a message that the agent created', async () => {
            const ID = await createMessage('agent', 9902);

            const edit = await send('agent', 'POST', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=true)/benicio_1_04Srv.draftEdit`, { PreserveChanges: true });
            const patch = await send('agent', 'PATCH', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=false)`, { customerName: 'Own message' });
            const activate = await send('agent', 'POST', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, {});
            const remove = await send('agent', 'DELETE', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=true)`);

            expect([edit.status, patch.status, activate.status, remove.status]).toEqual([201, 200, 200, 204]);
        });

        it('does not let an agent save a draft of a message of someone else', async () => {
            const ID = await createMessage('admin', 9903);
            await send('admin', 'POST', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=true)/benicio_1_04Srv.draftEdit`, { PreserveChanges: true });

            const patch = await send('agent', 'PATCH', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=false)`, { customerName: 'Hijacked' });
            const activate = await send('agent', 'POST', `${MAIN}/CustomerMessages(ID=${ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, {});

            expect(patch.status).toBeGreaterThanOrEqual(403);
            expect(activate.status).toBeGreaterThanOrEqual(403);
        });
    });

    describe('AdminService (reference data and settings)', () => {
        matrix('read tags', () => ['GET', `${ADMIN}/Tags`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('read response templates', () => ['GET', `${ADMIN}/ResponseTemplates`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('read the settings', () => ['GET', `${ADMIN}/Settings`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('create a tag', () => ['POST', `${ADMIN}/Tags`, { code: 'refund', title: 'Refund' }], { anonymous: 401, stranger: 403, viewer: 403, agent: 201, admin: 201 });
        matrix('create a response template', () => ['POST', `${ADMIN}/ResponseTemplates`, { code: 'refund', title: 'Refund', text: 'x' }], { anonymous: 401, stranger: 403, viewer: 403, agent: 201, admin: 201 });
        matrix('change the settings', () => ['PATCH', `${ADMIN}/Settings`, { autoEnrichment: false }], { anonymous: 401, stranger: 403, viewer: 403, agent: 403, admin: 200 });

        describe('change a tag that was created by an agent (sample data)', () => {
            matrix('rename', () => ['PATCH', `${ADMIN}/Tags('noise')`, { title: 'Loud' }], { anonymous: 401, stranger: 403, viewer: 403, agent: 200, admin: 200 });
            matrix('delete', () => ['DELETE', `${ADMIN}/Tags('noise')`], { anonymous: 401, stranger: 403, viewer: 403, agent: 204, admin: 204 });
        });

        describe('change a tag that was created by an administrator (instance-based)', () => {
            beforeEach(async () => { await send('admin', 'POST', `${ADMIN}/Tags`, { code: 'internal', title: 'Internal' }); });

            matrix('rename', () => ['PATCH', `${ADMIN}/Tags('internal')`, { title: 'Internal use' }], { anonymous: 401, stranger: 403, viewer: 403, agent: 403, admin: 200 });
            matrix('delete', () => ['DELETE', `${ADMIN}/Tags('internal')`], { anonymous: 401, stranger: 403, viewer: 403, agent: 403, admin: 204 });
        });

        it('lets an agent change and delete a tag that the agent created', async () => {
            await send('agent', 'POST', `${ADMIN}/Tags`, { code: 'mine', title: 'Mine' });

            const rename = await send('agent', 'PATCH', `${ADMIN}/Tags('mine')`, { title: 'Still mine' });
            const remove = await send('agent', 'DELETE', `${ADMIN}/Tags('mine')`);

            expect([rename.status, remove.status]).toEqual([200, 204]);
        });

        it('records the logged-in user as the creator', async () => {
            const { data } = await send('agent', 'POST', `${ADMIN}/Tags`, { code: 'mine', title: 'Mine' });

            expect(data.createdBy).toBe('agent');
        });

        it('lets nobody delete the settings', async () => {
            for (const user of ['agent', 'admin']) {
                expect((await send(user, 'DELETE', `${ADMIN}/Settings`)).status).toBe(403);
            }
        });
    });

    describe('OperationsService (work queue)', () => {
        const ID = FREEZER_COMPRESSOR;
        matrix('read the queue', () => ['GET', `${OPERATIONS}/CustomerMessages`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('read the statistics', () => ['GET', `${OPERATIONS}/statistics()`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('read the suggested priority', () => ['GET', `${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.suggestedPriority()`], { anonymous: 401, stranger: 403, viewer: 200, agent: 200, admin: 200 });
        matrix('mark a message as resolved', () => ['POST', `${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.markAsResolved`, {}], { anonymous: 401, stranger: 403, viewer: 403, agent: 200, admin: 200 });
        matrix('add a reply', () => ['POST', `${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.addReply`, { author: 'Agent', text: 'Hello' }], { anonymous: 401, stranger: 403, viewer: 403, agent: 200, admin: 200 });

        it('lets an agent resolve a message that was created by someone else', async () => {
            const created = await createMessage('admin', 9904);

            const { status } = await send('agent', 'POST', `${OPERATIONS}/CustomerMessages(ID=${created})/OperationsService.markAsResolved`, {});

            expect(status).toBe(200);
        });

        it('keeps a message unchanged when a viewer tries to resolve it', async () => {
            await send('viewer', 'POST', `${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.markAsResolved`, {});

            const { data } = await send('viewer', 'GET', `${OPERATIONS}/CustomerMessages(ID=${ID})?$select=status`);
            expect(data.status).toBe('Open');
        });

        it('records the logged-in user as the resolver', async () => {
            const { data } = await send('agent', 'POST', `${OPERATIONS}/CustomerMessages(ID=${ID})/OperationsService.markAsResolved`, {});

            expect(data.resolvedBy).toBe('agent');
        });
    });

    describe('credentials', () => {
        it('rejects a wrong password', async () => {
            const response = await test.GET(`${MAIN}/CustomerMessages`, {
                auth: { username: 'admin', password: 'wrong' },
                validateStatus: () => true
            });

            expect(response.status).toBe(401);
        });
    });
});
