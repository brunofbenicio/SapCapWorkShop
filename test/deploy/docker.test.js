const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ignore = require('ignore');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');

/**
 * The instructions of a Dockerfile by stage. Comments are dropped and a line that ends with a backslash
 * continues in the next one.
 *
 * @param {string} text the content of the Dockerfile
 * @returns {{ globalArgs: string[], stages: {name: string, image: string, instructions: {name: string, args: string}[]}[] }}
 */
function parseDockerfile(text) {
    const lines = [];
    let pending = '';
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!pending && (!line || line.startsWith('#'))) continue;
        pending += `${pending ? ' ' : ''}${line.replace(/\\$/, '').trim()}`;
        if (!line.endsWith('\\')) {
            lines.push(pending);
            pending = '';
        }
    }
    const globalArgs = [];
    const stages = [];
    for (const line of lines) {
        const [, name, args] = /^(\S+)\s*(.*)$/.exec(line);
        const instruction = name.toUpperCase();
        if (instruction === 'FROM') {
            const [, image, stage] = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args);
            stages.push({ name: stage, image, instructions: [] });
        } else if (!stages.length) {
            globalArgs.push(args);
        } else {
            stages.at(-1).instructions.push({ name: instruction, args });
        }
    }
    return { globalArgs, stages };
}

const dockerfile = parseDockerfile(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'));
const stage = name => dockerfile.stages.find(candidate => candidate.name === name);
const all = (name, instruction) => stage(name).instructions.filter(candidate => candidate.name === instruction).map(candidate => candidate.args);
const dockerignore = ignore().add(fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8'));

describe('Dockerfile', () => {
    const build = stage('build');

    it('has a build stage and a runtime stage', () => {
        expect(dockerfile.stages.map(candidate => candidate.name)).toEqual(['build', 'runtime']);
    });

    it('uses a current Node.js base image with a version, not latest', () => {
        const [, version] = dockerfile.globalArgs.find(arg => arg.startsWith('NODE_VERSION=')).split('=');

        expect(Number(version)).toBeGreaterThanOrEqual(Number(pkg.engines.node.replace(/\D/g, '')));
        for (const { image } of dockerfile.stages) expect(image).toMatch(/^node:\$\{NODE_VERSION\}-alpine$/);
    });

    it('installs with the lock file and builds with the script of package.json', () => {
        expect(all('build', 'RUN')).toEqual(expect.arrayContaining(['npm ci', 'npm run build']));
        expect(pkg.scripts.build).toBe('cds build --production');
        expect(all('build', 'COPY')[0]).toBe('package.json package-lock.json ./'); // before the sources, for the layer cache
        expect(all('build', 'RUN').indexOf('npm ci')).toBeLessThan(all('build', 'RUN').indexOf('npm run build'));
    });

    it('installs only the production dependencies of the build output', () => {
        expect(all('build', 'RUN')).toContain('cd gen/srv && npm ci --omit=dev');
        expect(build.instructions.find(({ args }) => args.includes('--omit=dev'))).toBeDefined();
        // The runtime stage installs nothing: it only takes over the result
        expect(all('runtime', 'RUN')).toEqual([]);
    });

    it('runs in the production profile as a user that is not root', () => {
        expect(all('runtime', 'ENV')).toContain('NODE_ENV=production');
        const users = all('runtime', 'USER');

        expect(users.at(-1)).toBe('node');
        expect(['root', '0']).not.toContain(users.at(-1));
        expect(all('runtime', 'COPY')).toEqual(['--from=build --chown=node:node /app/gen/srv ./']);
    });

    it('starts the server of npm start directly, so that it receives SIGTERM', () => {
        expect(all('runtime', 'CMD')).toEqual(['["node_modules/.bin/cds-serve"]']);
        expect(all('runtime', 'ENTRYPOINT')).toEqual([]);
    });

    it('checks the health endpoint of the server on the port of the server', () => {
        const [healthcheck] = all('runtime', 'HEALTHCHECK');

        expect(healthcheck).toContain('/health');
        expect(healthcheck).toContain('${PORT:-4004}'); // cds listens on PORT, default 4004
        expect(all('runtime', 'EXPOSE')).toEqual(['4004']);
        expect(fs.readFileSync(path.join(ROOT, 'srv/server.js'), 'utf8')).toContain("app.get('/health'");
    });

    it('does not bake configuration or secrets into the image', () => {
        const instructions = dockerfile.stages.flatMap(candidate => candidate.instructions);
        const text = instructions.map(({ name, args }) => `${name} ${args}`).join('\n');

        expect(instructions.map(({ name }) => name)).not.toContain('ADD');
        expect(text).not.toMatch(/(PASSWORD|SECRET|TOKEN|CREDENTIALS|VCAP_SERVICES)/i);
        expect(text).not.toMatch(/\.env|xs-security|default-env/);
    });
});

describe('.dockerignore', () => {
    it('keeps the sources of the build in the context', () => {
        for (const file of ['package.json', 'package-lock.json', 'db/schema.cds', 'srv/service.cds', 'srv/server.js', 'app/customer-messages-ui.cds', 'srv/_i18n/messages.properties']) {
            expect(dockerignore.ignores(file)).toBe(false);
        }
    });

    it('keeps secrets, installed packages, build output and tests out of the context', () => {
        for (const file of [
            '.git/HEAD', '.env', '.env.local', 'default-env.json', 'default-services.json', '.cdsrc-private.json', 'connection.properties',
            'node_modules/@sap/cds/package.json', 'app/benicio_1_04.myapplication/node_modules/x/index.js', 'gen/srv/package.json',
            '@cds-models/index.js', 'mta_archives/x.mtar', 'db.sqlite', 'srv/local.db', 'npm-debug.log', '.cds-msg-box', '.cds-msg-box-copy',
            'test/srv/tags.test.js', 'docs/features.md', 'http/messages.http', 'README.md'
        ]) {
            expect([file, dockerignore.ignores(file)]).toEqual([file, true]);
        }
    });

    it('does not send more than the sources of the images to the build', () => {
        const sent = [];
        const walk = folder => {
            for (const entry of fs.readdirSync(path.join(ROOT, folder), { withFileTypes: true })) {
                const relative = path.posix.join(folder, entry.name);
                if (relative === 'node_modules' || relative === '.git') continue; // never part of the context
                if (entry.isDirectory()) walk(relative);
                else if (!dockerignore.ignores(relative)) sent.push(relative);
            }
        };
        walk('');

        const topLevel = new Set(sent.map(file => file.split('/')[0]));
        expect([...topLevel].sort()).toEqual(expect.arrayContaining(['Dockerfile', 'app', 'db', 'package-lock.json', 'package.json', 'srv']));
        expect([...topLevel].filter(entry => !['Dockerfile', '.dockerignore', 'app', 'db', 'fts', 'package-lock.json', 'package.json', 'srv'].includes(entry))).toEqual([]);
    });
});

describe('build stage (without Docker)', () => {
    let project;

    beforeAll(() => {
        // Do what the stage does: the files that its COPY instructions take, minus what .dockerignore removes,
        // then npm run build. The packages are the ones of the project, as after npm ci.
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-'));
        const copy = (relative, target) => {
            const source = path.join(ROOT, relative);
            if (fs.statSync(source).isDirectory()) {
                for (const entry of fs.readdirSync(source)) {
                    const child = path.posix.join(relative, entry);
                    const isFolder = fs.statSync(path.join(ROOT, child)).isDirectory();
                    if (!dockerignore.ignores(isFolder ? `${child}/` : child)) copy(child, path.join(target, entry));
                }
            } else {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.copyFileSync(source, target);
            }
        };
        for (const args of all('build', 'COPY')) {
            const sources = args.split(' ');
            const destination = sources.pop();
            for (const source of sources) copy(source, path.join(project, destination === './' ? source : destination.replace(/^\.\//, '')));
        }
        fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(project, 'node_modules'), 'dir');
        execFileSync(process.execPath, [path.join(ROOT, 'node_modules/.bin/cds'), 'build', '--production'], { cwd: project, stdio: 'pipe' });
    }, 120000);

    afterAll(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    it('builds from the files of the context alone', () => {
        const generated = JSON.parse(fs.readFileSync(path.join(project, 'gen/srv/package.json'), 'utf8'));

        expect(generated.scripts.start).toBe('cds-serve');
        expect(fs.existsSync(path.join(project, 'gen/srv/package-lock.json'))).toBe(true); // needed by npm ci in gen/srv
        expect(fs.existsSync(path.join(project, 'gen/srv/srv/csn.json'))).toBe(true);
    });

    it('does not need the files that the context leaves out', () => {
        for (const file of ['xs-security.json', 'mta.yaml', 'test', 'http', 'docs']) {
            expect(fs.existsSync(path.join(project, file))).toBe(false);
        }
    });
});
