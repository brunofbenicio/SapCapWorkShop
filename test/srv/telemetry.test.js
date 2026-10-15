const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { startServer } = require('../helpers/server');

const ROOT = path.resolve(__dirname, '../..');
const CDS_SERVE = path.join(ROOT, 'node_modules/.bin/cds-serve');

const test = startServer();

/**
 * Starts the application in its own process, like `npm start` does in development, and waits until it
 * listens. The environment of the tests (NODE_ENV=test, NO_TELEMETRY) is not passed on.
 *
 * @param {Record<string, string>} [env] additional environment variables
 */
function startProcess(env = {}) {
    const inherited = { ...process.env };
    delete inherited.NODE_ENV;
    delete inherited.NO_TELEMETRY;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CDS_SERVE, '--port', '0'], { cwd: ROOT, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const stop = () => new Promise(done => {
            if (child.exitCode !== null) return done();
            child.once('exit', done);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        });
        const timer = setTimeout(() => {
            stop();
            reject(new Error(`The application did not start in time:\n${output}`));
        }, 60000);
        const endedWhileStarting = code => {
            clearTimeout(timer);
            reject(new Error(`The application ended with code ${code} while starting:\n${output}`));
        };
        child.once('exit', endedWhileStarting);
        const collect = chunk => {
            output += chunk;
            const listening = /server listening on \{ url: '([^']+)'/.exec(output);
            if (listening) {
                clearTimeout(timer);
                child.off('exit', endedWhileStarting);
                resolve({ url: listening[1], output: () => output, stop });
            }
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
    });
}

const request = (app, url) => axios.get(`${app.url}${url}`, { auth: { username: 'viewer', password: 'viewer' }, validateStatus: () => true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('telemetry (@cap-js/telemetry)', () => {
    const running = [];

    afterAll(() => Promise.all(running.map(app => app.stop())));

    const start = async env => {
        const app = await startProcess(env);
        running.push(app);
        return app;
    };

    describe('in the tests', () => {
        it('is switched off and the application serves requests', async () => {
            const { status } = await test.GET('/service/benicio_1_04/$metadata');
            const health = await test.GET('/health', { auth: undefined });

            expect(process.env.NO_TELEMETRY).toBe('true');
            expect(status).toBe(200);
            expect(health.data).toEqual({ status: 'UP' });
        });
    });

    describe('in development', () => {
        it('boots with the plugin, serves requests and prints the traces to the console', async () => {
            const app = await start();

            const metadata = await request(app, '/service/benicio_1_04/$metadata');
            const messages = await request(app, '/service/benicio_1_04/CustomerMessages?$top=1&$select=customerMessageID');
            await sleep(500);

            expect(app.output()).toContain('[cds] - server listening');
            expect(metadata.status).toBe(200);
            expect(messages.status).toBe(200);
            expect(app.output()).toMatch(/\[telemetry\] - /);
            expect(app.output()).toContain('CustomerMessages');
        });

        it('does not trace the health check', async () => {
            const app = await start();
            const before = app.output().length;

            const health = await axios.get(`${app.url}/health`);
            await sleep(500);

            expect(health.data).toEqual({ status: 'UP' });
            expect(app.output().slice(before)).not.toMatch(/\[telemetry\]/);
        });

        it('can be switched off with NO_TELEMETRY', async () => {
            const app = await start({ NO_TELEMETRY: 'true' });

            const response = await request(app, '/service/benicio_1_04/CustomerMessages?$top=1&$select=customerMessageID');
            await sleep(500);

            expect(response.status).toBe(200);
            expect(app.output()).not.toMatch(/\[telemetry\]/);
        });
    });

    describe('configuration', () => {
        const { cds, devDependencies, dependencies } = require('../../package.json');

        it('selects the console exporter in development', () => {
            expect(cds.requires.telemetry).toEqual({ '[development]': { kind: 'telemetry-to-console' } });
        });

        it('is a development dependency: the production installation does not contain it', () => {
            expect(devDependencies['@cap-js/telemetry']).toBeDefined();
            expect(dependencies['@cap-js/telemetry']).toBeUndefined();
        });
    });
});
