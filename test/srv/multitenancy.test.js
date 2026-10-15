const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const { startProcess, ROOT } = require('../helpers/process');

const BIN = name => path.join(ROOT, 'node_modules/.bin', name);
const PROVISIONING = '/-/cds/saas-provisioning/tenant';
const EXTENSIBILITY = '/-/cds/extensibility';
const MESSAGES = '/service/benicio_1_04/CustomerMessages';
const ANY_STATUS = { validateStatus: () => true };

// The mocked users of the multitenancy profile (package.json): yves is the provisioning user
// (role internal-user) that CAP provides; the others belong to a tenant.
const PROVISIONER = { username: 'yves', password: '' };
const user = (username, password) => ({ username, password });
const T1_AGENT = user('t1-agent', 'agent');
const T2_AGENT = user('t2-agent', 'agent');
const T1_DEVELOPER = user('t1-developer', 'developer');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Repeats a request until the response satisfies the condition (a new model reaches the tenant within the check interval). */
async function eventually(send, condition = response => response.status === 200, timeout = 10000) {
    const end = Date.now() + timeout;
    let response = await send();
    while (!condition(response) && Date.now() < end) {
        await sleep(100);
        response = await send();
    }
    return response;
}

/** Runs a command of the CAP command line in the project, with the profile selected in the environment. */
const cds = (args, { cwd = ROOT, profile } = {}) =>
    execFileSync(BIN('cds'), args, { cwd, env: { ...process.env, NODE_ENV: 'development', ...(profile && { CDS_ENV: profile }) }, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 }).toString();

/** The configuration of CAP in the project for a profile, as JSON. */
const config = (expression, profile) => JSON.parse(execFileSync(process.execPath, ['-e', `console.log(JSON.stringify(${expression}))`], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', ...(profile ? { CDS_ENV: profile } : { CDS_ENV: '' }) }
}).toString());

describe('multitenancy profile (@sap/cds-mtxs)', () => {
    describe('configuration', () => {
        const EXPRESSION = "(() => { const { requires } = require('@sap/cds').env; return { multitenancy: !!requires.multitenancy, extensibility: !!requires.extensibility, toggles: !!requires.toggles }; })()";

        it('is off by default', () => {
            expect(config(EXPRESSION)).toEqual({ multitenancy: false, extensibility: false, toggles: false });
        });

        it('switches multitenancy, extensibility and feature toggles on', () => {
            expect(config(EXPRESSION, 'multitenancy')).toEqual({ multitenancy: true, extensibility: true, toggles: true });
        });

        it('allows extensions only for the fields of the customer messages, prefixed with x_', () => {
            const service = config("require('@sap/cds').env.requires['cds.xt.ExtensibilityService']", 'multitenancy');

            expect(service['element-prefix']).toEqual(['x_']);
            expect(service['extension-allowlist']).toEqual([{ for: ['Benicio_1_04.CustomerMessages'], kind: 'entity', 'new-fields': 3 }]);
        });

        it('has mocked users of the tenants t1 and t2, with the roles of the application', () => {
            const { users, tenants } = config("require('@sap/cds').env.requires.auth", 'multitenancy');

            expect(users['t1-agent']).toMatchObject({ tenant: 't1', roles: ['Viewer', 'Agent'] });
            expect(users['t2-agent']).toMatchObject({ tenant: 't2', roles: ['Viewer', 'Agent'] });
            expect(users['t1-developer']).toMatchObject({ tenant: 't1', roles: ['Viewer', 'cds.ExtensionDeveloper'] });
            expect(tenants).toEqual({ t1: { features: [] }, t2: { features: ['internal-note'] } });
        });

        it('keeps @sap/cds-mtxs a normal dependency, because the production installation needs it', () => {
            const { dependencies } = require('../../package.json');

            expect(dependencies['@sap/cds-mtxs']).toBeDefined();
        });
    });

    describe('compile and build (offline)', () => {
        let project;

        beforeAll(() => {
            // The build writes into the folder gen of the project: build a copy of it.
            project = fs.mkdtempSync(path.join(os.tmpdir(), 'mtx-'));
            for (const entry of ['db', 'srv', 'app', 'fts', 'package.json']) fs.cpSync(path.join(ROOT, entry), path.join(project, entry), { recursive: true });
            fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir');
        });

        afterAll(() => {
            fs.rmSync(project, { recursive: true, force: true });
        });

        it('compiles the model with the profile to the same tables as without it', () => {
            const tables = sql => sql.match(/^CREATE TABLE \S+/gm).sort();

            expect(tables(cds(['compile', 'srv', '--profile', 'multitenancy', '--to', 'sql']))).toEqual(tables(cds(['compile', 'srv', '--to', 'sql'])));
        });

        it('compiles the feature together with the model: it adds the field internalNote', () => {
            const base = cds(['compile', 'db', 'srv', '--to', 'sql']);
            const withFeature = cds(['compile', 'db', 'srv', 'fts/internal-note', '--to', 'sql']);

            expect(base).not.toContain('internalNote');
            expect(withFeature).toMatch(/internalNote NVARCHAR\(500\)/);
        });

        it('builds without the profile as before: no model resources for tenants', () => {
            cds(['build', '--production'], { cwd: project });

            expect(fs.existsSync(path.join(project, 'gen/srv/package.json'))).toBe(true);
            expect(fs.existsSync(path.join(project, 'gen/srv/resources.tgz'))).toBe(false);
            expect(fs.existsSync(path.join(project, 'gen/srv/fts'))).toBe(false);
        });

        it('builds with the profile: the base model of the tenants and the features are part of the service', () => {
            fs.rmSync(path.join(project, 'gen'), { recursive: true, force: true });

            cds(['build', '--production', '--profile', 'multitenancy'], { cwd: project });

            expect(fs.statSync(path.join(project, 'gen/srv/resources.tgz')).size).toBeGreaterThan(1000);
            expect(fs.existsSync(path.join(project, 'gen/srv/fts/internal-note/csn.json'))).toBe(true);
            expect(JSON.parse(fs.readFileSync(path.join(project, 'gen/srv/package.json'), 'utf8')).dependencies['@sap/cds-mtxs']).toBeDefined();
            expect(fs.readdirSync(path.join(project, 'gen/db/src/gen')).length).toBeGreaterThan(10); // the HANA artifacts for the container of a tenant
        });
    });

    // The application runs in its own process with the profile, like `CDS_ENV=multitenancy cds-serve` does
    // in development: every tenant has its own database, which the provisioning service creates.
    describe('running locally with SQLite', () => {
        let app;
        const request = (config, url, auth, method = 'GET', data) => axios.request({ baseURL: app.url, url, method, data, auth, ...ANY_STATUS, ...config });
        const get = (url, auth) => request({}, url, auth);
        const count = async auth => (await get(`${MESSAGES}?$count=true&$top=0`, auth)).data['@odata.count'];

        beforeAll(async () => {
            // The enrichment needs an AI Core, which is not available here.
            app = await startProcess({ CDS_ENV: 'multitenancy', CDS_GENAI_ENABLED: 'false', NO_TELEMETRY: 'true' });
            for (const tenant of ['t1', 't2']) {
                const { status } = await request({}, `${PROVISIONING}/${tenant}`, PROVISIONER, 'PUT', { subscribedTenantId: tenant, eventType: 'CREATE' });
                expect(status).toBe(200);
            }
        }, 90000);

        afterAll(() => app?.stop());

        describe('provisioning', () => {
            it('lists the subscribed tenants', async () => {
                const { status, data } = await get(PROVISIONING, PROVISIONER);

                expect(status).toBe(200);
                expect(data.map(tenant => tenant.subscribedTenantId).sort()).toEqual(['t1', 't2']);
            });

            it('is for the platform only: users of the application are refused', async () => {
                const anonymous = await get(PROVISIONING);
                const agent = await request({}, `${PROVISIONING}/t5`, T1_AGENT, 'PUT', { subscribedTenantId: 't5' });

                expect(anonymous.status).toBe(401);
                expect(agent.status).toBe(403);
            });

            it('does not harm the public health check', async () => {
                const { data } = await get('/health');

                expect(data).toEqual({ status: 'UP' });
            });
        });

        describe('tenant isolation', () => {
            it('gives every tenant its own data, initially the same sample messages', async () => {
                expect(await count(T1_AGENT)).toBe(11);
                expect(await count(T2_AGENT)).toBe(11);
            });

            it('keeps what one tenant creates away from the other', async () => {
                const created = await request({}, MESSAGES, T1_AGENT, 'POST', { customerMessageID: 9001, customerId: 'C-90001' });
                const { status } = await request({}, `${MESSAGES}(ID=${created.data.ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, T1_AGENT, 'POST', {});

                expect(status).toBe(201);
                expect(await count(T1_AGENT)).toBe(12);
                expect(await count(T2_AGENT)).toBe(11);
            });

            it('keeps the roles of the application per user', async () => {
                const { status } = await request({}, MESSAGES, T1_DEVELOPER, 'POST', { customerMessageID: 9002 });
                const read = await get(`${MESSAGES}?$top=1`, T1_DEVELOPER);

                expect(status).toBe(403); // a viewer, even with the role of the extension developer, may not create
                expect(read.status).toBe(200);
            });

            it('serves the other services per tenant as well', async () => {
                const created = await request({}, '/service/admin/Tags', T1_AGENT, 'POST', { code: 'tenant-one', title: 'Only in t1' });

                const t1 = await get("/service/admin/Tags('tenant-one')?$select=title", T1_AGENT);
                const t2 = await get("/service/admin/Tags('tenant-one')?$select=title", T2_AGENT);

                expect(created.status).toBe(201);
                expect(t1.data.title).toBe('Only in t1');
                expect(t2.status).toBe(404);
            });

            it('keeps the change history per tenant', async () => {
                await request({}, "/service/admin/Tags('tenant-one')", T1_AGENT, 'PATCH', { title: 'Renamed in t1' });
                const history = tenant => get("/service/admin/Tags('tenant-one')/changes?$filter=modification eq 'update'&$select=valueChangedTo", tenant);

                expect((await history(T1_AGENT)).data.value.map(change => change.valueChangedTo)).toEqual(['Renamed in t1']);
                expect((await history(T2_AGENT)).status).toBe(404); // the tag does not exist in t2
            });
        });

        describe('extensibility', () => {
            const set = (auth, tag, extension) => request({}, `${EXTENSIBILITY}/set`, auth, 'POST', { tag, extension: [extension] });

            it('is for extension developers only', async () => {
                const { status } = await set(T1_AGENT, 'by-agent', 'extend Benicio_1_04.CustomerMessages with { x_a : String(10); }');

                expect(status).toBe(403);
            });

            it.each([
                ['a field without the prefix x_', 'extend Benicio_1_04.CustomerMessages with { note : String(10); }', /must start with x_/],
                ['an entity that is not on the allowlist', 'extend Benicio_1_04.Tags with { x_a : String(10); }', /must not be extended/],
                ['more fields than allowed', 'extend Benicio_1_04.CustomerMessages with { x_a : String(1); x_b : String(1); x_c : String(1); x_d : String(1); }', /exceeds extension limit of 3/]
            ])('refuses %s', async (_, extension, message) => {
                const { status, data } = await set(T1_DEVELOPER, 'refused', extension);

                expect(status).toBe(422);
                expect(data.error.message).toMatch(message);
            });

            it('extends the model of one tenant only', async () => {
                const { status } = await set(T1_DEVELOPER, 'internal-ref', 'extend Benicio_1_04.CustomerMessages with { x_internalRef : String(40); }');
                const t1 = await eventually(() => get(`${MESSAGES}?$top=1&$select=customerMessageID,x_internalRef`, T1_AGENT));
                const t2 = await get(`${MESSAGES}?$top=1&$select=customerMessageID,x_internalRef`, T2_AGENT);

                expect(status).toBe(204);
                expect(t1.status).toBe(200);
                expect(t1.data.value[0]).toHaveProperty('x_internalRef', null);
                expect(t2.status).toBe(400);
                expect(t2.data.error.message).toMatch(/x_internalRef/);
            });

            it('stores the values of the extension field', async () => {
                await eventually(() => get(`${MESSAGES}?$top=1&$select=x_internalRef`, T1_AGENT));
                const created = await request({}, MESSAGES, T1_AGENT, 'POST', { customerMessageID: 9003, x_internalRef: 'REF-4711' });
                await request({}, `${MESSAGES}(ID=${created.data.ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, T1_AGENT, 'POST', {});

                const { data } = await get(`${MESSAGES}(ID=${created.data.ID},IsActiveEntity=true)?$select=x_internalRef`, T1_AGENT);

                expect(data.x_internalRef).toBe('REF-4711');
            });
        });

        describe('feature toggles', () => {
            it('gives the tenant with the feature the field internalNote', async () => {
                const t2 = await get(`${MESSAGES}?$top=1&$select=customerMessageID,internalNote`, T2_AGENT);
                const t1 = await get(`${MESSAGES}?$top=1&$select=customerMessageID,internalNote`, T1_AGENT);

                expect(t2.status).toBe(200);
                expect(t2.data.value[0]).toHaveProperty('internalNote', null);
                expect(t1.status).toBe(400);
                expect(t1.data.error.message).toMatch(/internalNote/);
            });

            it('offers the field in the metadata of that tenant only', async () => {
                const t2 = await get('/service/benicio_1_04/$metadata', T2_AGENT);
                const t1 = await get('/service/benicio_1_04/$metadata', T1_AGENT);

                expect(t2.data).toContain('Name="internalNote"');
                expect(t1.data).not.toContain('Name="internalNote"');
            });

            it('stores the value of the feature field', async () => {
                const created = await request({}, MESSAGES, T2_AGENT, 'POST', { customerMessageID: 9004, internalNote: 'Call back on Monday' });
                await request({}, `${MESSAGES}(ID=${created.data.ID},IsActiveEntity=false)/benicio_1_04Srv.draftActivate`, T2_AGENT, 'POST', {});

                const { data } = await get(`${MESSAGES}(ID=${created.data.ID},IsActiveEntity=true)?$select=internalNote`, T2_AGENT);

                expect(data.internalNote).toBe('Call back on Monday');
            });
        });

        describe('unsubscribing', () => {
            it('removes the tenant and its data, the other tenant is not affected', async () => {
                const { status } = await request({}, `${PROVISIONING}/t2`, PROVISIONER, 'DELETE');
                const gone = await get(`${MESSAGES}?$top=1`, T2_AGENT);

                expect(status).toBe(204);
                expect(gone.status).toBeGreaterThanOrEqual(400);
                expect(await count(T1_AGENT)).toBe(13);
            });

            it('gives a new subscription a fresh database', async () => {
                await request({}, `${PROVISIONING}/t2`, PROVISIONER, 'PUT', { subscribedTenantId: 't2', eventType: 'CREATE' });

                expect(await count(T2_AGENT)).toBe(11);
                expect((await get(`${MESSAGES}?$top=1&$select=internalNote`, T2_AGENT)).status).toBe(200); // the feature is still on
            });
        });
    });
});
