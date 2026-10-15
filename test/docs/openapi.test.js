const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compileOpenApi, writeOpenApi } = require('../../scripts/openapi');

const ROOT = path.resolve(__dirname, '../..');

describe('OpenAPI documents (npm run openapi)', () => {
    let documents;

    beforeAll(async () => {
        documents = await compileOpenApi(ROOT);
    });

    const paths = name => Object.keys(documents.get(name).paths);
    const operations = (name, urlPath) => Object.keys(documents.get(name).paths[urlPath]).filter(key => key !== 'parameters');

    it('has a document for every service that the application serves, and none for the external one', () => {
        expect([...documents.keys()].sort()).toEqual(['AdminService', 'AnalyticsService', 'OperationsService', 'benicio_1_04Srv']);
    });

    it.each([
        ['benicio_1_04Srv', '/service/benicio_1_04', 'Customer Messages'],
        ['OperationsService', '/service/operations', 'Customer Messages Operations'],
        ['AdminService', '/service/admin', 'Customer Messages Administration'],
        ['AnalyticsService', '/service/analytics', 'Customer Messages Analytics']
    ])('describes %s at %s', (name, url, title) => {
        const document = documents.get(name);

        expect(document.openapi).toMatch(/^3\./);
        expect(document.servers).toEqual([{ url }]);
        expect(document.info.title).toBe(title);
        expect(document.info.description).not.toMatch(/Use the .* annotation/);
    });

    it('lists the entities of the main service with the keys of the draft entities', () => {
        const names = paths('benicio_1_04Srv');

        expect(names).toEqual(expect.arrayContaining([
            '/CustomerMessages',
            "/CustomerMessages(ID={ID},IsActiveEntity='{IsActiveEntity}')",
            "/CustomerMessages(ID={ID},IsActiveEntity='{IsActiveEntity}')/replies",
            "/CustomerMessages(ID={ID},IsActiveEntity='{IsActiveEntity}')/benicio_1_04Srv.draftActivate",
            '/CustomerMessageAttachments',
            '/Tags',
            '/ResponseTemplates',
            '/Settings',
            '/MessageCategories',
            '/A_ServiceOrder',
            '/$batch'
        ]));
        expect(names.every(name => !name.startsWith('/sap'))).toBe(true);
    });

    it('lists the actions and functions of the operations service', () => {
        expect(paths('OperationsService')).toEqual(expect.arrayContaining([
            '/CustomerMessages',
            '/CustomerMessages({ID})/OperationsService.markAsResolved',
            '/CustomerMessages({ID})/OperationsService.addReply',
            '/CustomerMessages({ID})/OperationsService.suggestedPriority',
            '/statistics'
        ]));
        expect(operations('OperationsService', '/CustomerMessages({ID})/OperationsService.markAsResolved')).toEqual(['post']);
        expect(operations('OperationsService', '/statistics')).toEqual(['get']);
    });

    it('describes the parameters of an action', () => {
        const action = documents.get('OperationsService').paths['/CustomerMessages({ID})/OperationsService.addReply'].post;
        const parameters = action.requestBody.content['application/json'].schema;

        expect(Object.keys(parameters.properties).sort()).toEqual(['author', 'text']);
    });

    it('offers the read-only views for reading only', () => {
        expect(paths('AnalyticsService')).toEqual(expect.arrayContaining(['/MessageAnalytics', '/MessageAnalytics({ID})']));
        expect(operations('AnalyticsService', '/MessageAnalytics')).toEqual(['get']);
        expect(operations('OperationsService', '/CustomerMessages')).toEqual(['get']);
    });

    it('lets the administration service maintain the reference data', () => {
        expect(paths('AdminService')).toEqual(expect.arrayContaining(['/Tags', "/Tags('{code}')", '/ResponseTemplates', '/Settings']));
        expect(operations('AdminService', '/Tags')).toEqual(['get', 'post']);
        expect(operations('AdminService', "/Tags('{code}')")).toEqual(['get', 'patch', 'delete']);
        expect(operations('AdminService', '/Settings')).toEqual(['get', 'patch']);
    });

    it('uses the English texts of the model instead of i18n keys', () => {
        for (const [name, document] of documents) {
            expect({ name, keys: JSON.stringify(document).match(/\{i18n>[^}]*\}/g) }).toEqual({ name, keys: null });
        }
        expect(JSON.stringify(documents.get('OperationsService'))).toContain('"Customer Messages"');
    });

    describe('output', () => {
        let directory;

        beforeEach(() => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-'));
        });

        afterEach(() => {
            fs.rmSync(directory, { recursive: true, force: true });
        });

        it('writes one file per service', async () => {
            const files = await writeOpenApi(directory);

            expect(files.map(file => path.basename(file)).sort()).toEqual([
                'AdminService.openapi3.json',
                'AnalyticsService.openapi3.json',
                'OperationsService.openapi3.json',
                'benicio_1_04Srv.openapi3.json'
            ]);
            const written = JSON.parse(fs.readFileSync(path.join(directory, 'AdminService.openapi3.json'), 'utf8'));
            expect(written.paths['/Tags']).toBeDefined();
        });

        it('is started by npm run openapi', () => {
            const { scripts } = require('../../package.json');
            const output = execFileSync(process.execPath, [path.join(ROOT, 'scripts/openapi.js'), directory], { cwd: ROOT }).toString();

            expect(scripts.openapi).toBe('node scripts/openapi.js');
            expect(output).toContain('AdminService.openapi3.json');
            expect(fs.readdirSync(directory)).toHaveLength(4);
        });
    });
});
