const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');
const xsSecurity = require('../../xs-security.json');

const mta = YAML.parse(fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8'));
const module_ = name => mta.modules.find(candidate => candidate.name === name);
const byService = service => mta.resources.filter(candidate => candidate.parameters.service === service);

describe('mta.yaml (Cloud Foundry deployment descriptor)', () => {
    describe('structure', () => {
        it('is the application of package.json', () => {
            expect(mta.ID).toBe(pkg.name);
            expect(mta.version).toBe(pkg.version);
            expect(mta['_schema-version']).toMatch(/^3\.\d+\.\d+$/);
        });

        it('names every module and resource once', () => {
            const names = [...mta.modules, ...mta.resources].map(entry => entry.name);

            expect(new Set(names).size).toBe(names.length);
            for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
        });

        it('only requires what exists: a resource, or a name that another module provides', () => {
            const provided = mta.modules.flatMap(entry => (entry.provides ?? []).map(provides => provides.name));
            const known = new Set([...mta.resources.map(entry => entry.name), ...provided]);

            for (const entry of mta.modules) {
                for (const required of entry.requires ?? []) expect(known).toContain(required.name);
            }
        });

        it('uses every resource', () => {
            const required = new Set(mta.modules.flatMap(entry => (entry.requires ?? []).map(requires => requires.name)));

            for (const entry of mta.resources) expect(required).toContain(entry.name);
        });

        it('builds the artifacts of the modules before anything else', () => {
            const commands = mta['build-parameters']['before-all'].flatMap(step => step.commands);

            expect(commands).toEqual(['npm ci', 'npx cds build --production']);
        });
    });

    describe('services for the production profile', () => {
        it('has the HDI container of SAP HANA that the production profile uses', () => {
            expect(pkg.cds.requires['[production]'].db).toBe('hana');
            const [hana] = byService('hana');
            expect(hana).toMatchObject({ type: 'com.sap.xs.hdi-container', parameters: { 'service-plan': 'hdi-shared' } });
            expect(module_('Benicio_1_04-srv').requires).toContainEqual({ name: hana.name });
            expect(module_('Benicio_1_04-db-deployer').requires).toContainEqual({ name: hana.name });
        });

        it('has the XSUAA instance, created from xs-security.json', () => {
            expect(pkg.cds.requires['[production]'].auth).toBe('xsuaa');
            const [xsuaa] = byService('xsuaa');
            expect(xsuaa.parameters).toMatchObject({ 'service-plan': 'application', path: './xs-security.json' });
            expect(fs.existsSync(path.join(ROOT, xsuaa.parameters.path))).toBe(true);
            expect(xsuaa.parameters.config['tenant-mode']).toBe(xsSecurity['tenant-mode']);
            // The name must be unique per space, the roles of the CDS model come from the scopes of the file
            expect(xsuaa.parameters.config.xsappname).toContain('${space}');
        });

        it('has the destination service for the S/4HANA destination of the production profile', () => {
            const { destination } = pkg.cds.requires.S4HCP_ServiceOrder_Odata['[production]'].credentials;

            expect(destination).toBe('S4HCP-ServiceOrder-Odata');
            expect(byService('destination')).toHaveLength(1);
        });

        it('has the application logs and the audit log', () => {
            expect(pkg.cds.requires['application-logging']).toBe(true);
            expect(pkg.dependencies['@cap-js/audit-logging']).toBeDefined();
            expect(byService('application-logs')).toHaveLength(1);
            expect(byService('auditlog')).toHaveLength(1);
        });
    });

    describe('modules', () => {
        let project;

        beforeAll(() => {
            // The build writes into the folder gen of the project: build a copy of it.
            project = fs.mkdtempSync(path.join(os.tmpdir(), 'mta-'));
            for (const entry of ['db', 'srv', 'app', 'fts', 'package.json', 'package-lock.json', 'xs-security.json']) {
                fs.cpSync(path.join(ROOT, entry), path.join(project, entry), { recursive: true });
            }
            fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir');
            execFileSync(process.execPath, [path.join(ROOT, 'node_modules/.bin/cds'), 'build', '--production'], { cwd: project, stdio: 'pipe' });
        }, 120000);

        afterAll(() => {
            fs.rmSync(project, { recursive: true, force: true });
        });

        const built = (...segments) => path.join(project, ...segments);
        const srv = module_('Benicio_1_04-srv');
        const deployer = module_('Benicio_1_04-db-deployer');

        it('serves the CAP application from the folder that "cds build --production" writes', () => {
            expect(srv).toMatchObject({ type: 'nodejs', path: 'gen/srv' });
            const generated = JSON.parse(fs.readFileSync(built(srv.path, 'package.json'), 'utf8'));

            expect(generated.scripts.start).toBe('cds-serve'); // the Node.js buildpack runs npm start
            expect(generated.dependencies['@cap-js/hana']).toBeDefined(); // the production profile uses SAP HANA
            expect(fs.existsSync(built(srv.path, 'package-lock.json'))).toBe(true); // required by the builder npm-ci
            expect(srv['build-parameters'].builder).toBe('npm-ci');
        });

        it('deploys the tables from the folder that "cds build --production" writes', () => {
            expect(deployer).toMatchObject({ type: 'hdb', path: 'gen/db' });
            const tables = fs.readdirSync(built(deployer.path, 'src/gen')).filter(file => file.endsWith('.hdbtable'));

            expect(tables).toContain('Benicio_1_04.CustomerMessages.hdbtable');
            expect(fs.existsSync(built(deployer.path, 'package.json'))).toBe(true); // @sap/hdi-deploy
        });

        it('lets the platform check the public health endpoint of the server', () => {
            expect(srv.parameters).toMatchObject({ 'health-check-type': 'http', 'health-check-http-endpoint': '/health' });
            expect(fs.readFileSync(path.join(ROOT, 'srv/server.js'), 'utf8')).toContain("app.get('/health'");
        });
    });
});
