const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');
const page = fs.readFileSync(path.join(ROOT, 'docs/features.md'), 'utf8');

const SKIPPED = new Set(['node_modules', 'gen', 'coverage', '.git', '@cds-models', 'docs/openapi', 'docs/asyncapi']);

/** All files below a folder of the project, as paths relative to the project. */
function filesIn(folder, matches) {
    const found = [];
    const walk = relative => {
        for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
            const child = path.posix.join(relative, entry.name);
            if (SKIPPED.has(child) || SKIPPED.has(entry.name)) continue;
            if (entry.isDirectory()) walk(child);
            else if (matches(child)) found.push(child);
        }
    };
    walk(folder);
    return found;
}

// What the page names in backticks
const code = [...page.matchAll(/`([^`\n]+)`/g)].map(match => match[1]);
const REPO_PATH = /^(?:app|db|srv|test|http|docs|scripts|fts)\/[\w@./-]+$|^[\w.-]+\.(?:json|yaml|mjs|md)$|^(?:Dockerfile|\.dockerignore)$/;
const paths = [...new Set(code.filter(entry => REPO_PATH.test(entry)))];
const named = new Set(paths);

describe('docs/features.md', () => {
    it('names only files and folders that exist', () => {
        expect(paths.length).toBeGreaterThan(80);
        for (const entry of paths) expect([entry, fs.existsSync(path.join(ROOT, entry))]).toEqual([entry, true]);
    });

    it('names only npm scripts and commands that exist', () => {
        const scripts = code.flatMap(entry => {
            const run = /^npm run ([\w:-]+)$/.exec(entry);
            return run ? [run[1]] : [];
        });

        expect(scripts.length).toBeGreaterThan(5);
        for (const script of scripts) expect([script, script in pkg.scripts]).toEqual([script, true]);
        for (const builtin of ['npm test', 'npm start']) expect(code).toContain(builtin);
        expect(pkg.scripts.test).toBeDefined();
        expect(pkg.scripts.start).toBeDefined();
    });

    it('names every test file', () => {
        const tests = filesIn('test', file => file.endsWith('.test.js'));

        expect(tests.length).toBeGreaterThan(30);
        expect(tests.filter(file => !named.has(file))).toEqual([]);
    });

    it('names every test helper', () => {
        const helpers = [...filesIn('test/helpers', () => true), 'test/setup.js', 'test/server/helpers.js', 'test/app/metadata.js'];

        expect(helpers.filter(file => !named.has(file))).toEqual([]);
    });

    it('names every file of the model and of the services', () => {
        const modelFiles = [
            ...filesIn('db', file => /\.(cds|csv)$/.test(file) || file.endsWith('undeploy.json')),
            ...filesIn('srv', file => /\.(cds|js|xml|csv|properties)$/.test(file)),
            ...filesIn('fts', file => file.endsWith('.cds'))
        ];

        expect(modelFiles.length).toBeGreaterThan(40);
        expect(modelFiles.filter(file => !named.has(file))).toEqual([]);
    });

    it('names every request file and every sample data file', () => {
        const files = [...filesIn('http', file => file.endsWith('.http')), ...filesIn('test/data', file => file.endsWith('.csv'))];

        expect(files.filter(file => !named.has(file))).toEqual([]);
    });

    it('names every file of the UI annotations and the UI texts', () => {
        const files = filesIn('app', file => file.endsWith('.cds') || file.endsWith('.properties') || /^app\/[^/]+\.html$/.test(file));

        expect(files.filter(file => !named.has(file))).toEqual([]);
    });

    it('names the deployment files and the scripts', () => {
        const files = ['mta.yaml', 'Dockerfile', '.dockerignore', 'xs-security.json', 'jsconfig.json', 'eslint.config.mjs', ...filesIn('scripts', () => true)];

        expect(files.filter(file => !named.has(file))).toEqual([]);
    });
});
