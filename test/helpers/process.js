const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CDS_SERVE = path.join(ROOT, 'node_modules/.bin/cds-serve');

/**
 * Starts the application in its own process, like `npm start` does, and waits until it listens.
 * The environment of the tests (NODE_ENV=test, NO_TELEMETRY) is not passed on, so the process runs
 * in the development profile unless the environment says otherwise.
 *
 * @param {Record<string, string>} [env] additional environment variables, for example CDS_ENV=multitenancy
 * @returns {Promise<{ url: string, output: () => string, stop: () => Promise<void> }>}
 */
function startProcess(env = {}) {
    const inherited = { ...process.env };
    delete inherited.NODE_ENV;
    delete inherited.NO_TELEMETRY;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CDS_SERVE, '--port', '0'], { cwd: ROOT, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const stop = () => new Promise(done => {
            if (child.exitCode !== null || child.signalCode !== null) return done();
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

module.exports = { startProcess, ROOT };
