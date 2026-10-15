const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');

const workflow = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const { steps } = workflow.jobs.verify;
const commands = steps.filter(step => step.run).map(step => step.run);
const action = name => steps.find(step => step.uses?.startsWith(`${name}@`));

describe('GitHub Actions workflow (.github/workflows/ci.yml)', () => {
    it('runs for pull requests and for pushes to main', () => {
        expect(workflow.on.pull_request).toBeDefined();
        expect(workflow.on.push.branches).toEqual(['main']);
    });

    it('only reads the repository and needs no secret', () => {
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(JSON.stringify(workflow)).not.toMatch(/secrets\./);
    });

    it('installs from the lock file, then lints, tests and builds', () => {
        const order = ['npm ci', 'npm run lint', 'npm test', 'npm run build'].map(command => commands.indexOf(command));

        expect(order.every(index => index >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('runs only scripts that package.json defines', () => {
        for (const command of commands) {
            const script = /^npm run ([\w:-]+)$/.exec(command)?.[1];
            if (script) expect([script, script in pkg.scripts]).toEqual([script, true]);
        }
        expect(pkg.scripts.test).toBeDefined();
        expect(pkg.scripts.build).toBeDefined();
        expect(pkg.scripts.lint).toBeDefined();
    });

    it('compiles the model before the tests', () => {
        expect(commands.indexOf('npx cds compile srv --to sql > /dev/null')).toBeGreaterThan(-1);
        expect(commands.indexOf('npx cds compile srv --to sql > /dev/null')).toBeLessThan(commands.indexOf('npm test'));
    });

    it('caches npm with a Node.js version that the tests need', () => {
        const { with: options } = action('actions/setup-node');

        expect(options.cache).toBe('npm');
        expect(options['node-version']).toBeGreaterThanOrEqual(22); // cds-typer needs Node.js 22
        expect(fs.existsSync(path.join(ROOT, 'package-lock.json'))).toBe(true); // the key of the cache
    });

    it('uses released versions of the actions, not a branch', () => {
        const used = steps.filter(step => step.uses).map(step => step.uses);

        expect(used.length).toBeGreaterThan(1);
        for (const name of used) expect(name).toMatch(/^[\w-]+\/[\w-]+@v\d+$/);
    });

    it('stops a stuck run and the runs that a newer commit makes obsolete', () => {
        expect(workflow.jobs.verify['timeout-minutes']).toBeLessThanOrEqual(30);
        expect(workflow.concurrency['cancel-in-progress']).toBe(true);
    });
});
