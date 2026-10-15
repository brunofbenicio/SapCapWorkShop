const express = require('express');
const cds = require('@sap/cds');
const { createLifecycle } = require('../../srv/code/server/lifecycle');
const { listen } = require('./helpers');

const LOG = cds.log('server');

/** An app with the lifecycle middleware and a route that answers only when it is released. */
async function start(options) {
    const lifecycle = createLifecycle(options);
    const app = express();
    const hanging = [];
    app.use(lifecycle.track());
    app.get('/health', lifecycle.health());
    app.get('/work', (req, res) => hanging.push(() => res.json({ done: true })));
    const server = await listen(app);
    return { lifecycle, server, release: () => hanging.splice(0).forEach(answer => answer()) };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('createLifecycle', () => {
    let current;

    beforeEach(() => {
        jest.spyOn(LOG, 'info').mockImplementation(() => {});
        jest.spyOn(LOG, 'warn').mockImplementation(() => {});
        jest.spyOn(LOG, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
        current?.release();
        await current?.server.close();
        current = undefined;
        jest.restoreAllMocks();
    });

    describe('health', () => {
        it('answers UP while the check works', async () => {
            const check = jest.fn().mockResolvedValue();
            current = await start({ check });

            const { status, data } = await current.server.get('/health');

            expect(status).toBe(200);
            expect(data).toEqual({ status: 'UP' });
            expect(check).toHaveBeenCalledTimes(1);
        });

        it('answers DOWN without details when the check fails, and logs the reason', async () => {
            current = await start({ check: async () => { throw new Error('connection to db-host:30015 refused'); } });

            const { status, data } = await current.server.get('/health');

            expect(status).toBe(503);
            expect(data).toEqual({ status: 'DOWN' });
            expect(LOG.error).toHaveBeenCalledWith('Health check failed:', 'connection to db-host:30015 refused');
        });

        it('answers DOWN when the check takes too long', async () => {
            current = await start({ check: () => new Promise(() => {}), checkTimeout: 30 });

            const { status, data } = await current.server.get('/health');

            expect(status).toBe(503);
            expect(data).toEqual({ status: 'DOWN' });
            expect(LOG.error).toHaveBeenCalledWith('Health check failed:', 'timeout after 30 ms');
        });

        it('answers DOWN as soon as the shutdown has started, without running the check', async () => {
            const check = jest.fn().mockResolvedValue();
            current = await start({ check });
            await current.lifecycle.shutdown(10);

            const { status } = await current.server.get('/health');

            expect(status).toBe(503);
            expect(check).not.toHaveBeenCalled();
        });
    });

    describe('shutdown', () => {
        it('counts the requests in progress', async () => {
            current = await start();
            const pending = current.server.get('/work');
            await wait(30);

            expect(current.lifecycle.active).toBe(1);
            current.release();
            await pending;
            await wait(10);

            expect(current.lifecycle.active).toBe(0);
        });

        it('returns at once when no request is in progress', async () => {
            current = await start();

            await expect(current.lifecycle.shutdown(5000)).resolves.toBe(true);

            expect(current.lifecycle.shuttingDown).toBe(true);
            expect(LOG.info).toHaveBeenCalledWith('Shutting down; 0 request(s) in progress');
            expect(LOG.info).toHaveBeenCalledWith('Shutdown: no request in progress');
        });

        it('waits for the requests in progress', async () => {
            current = await start();
            const pending = current.server.get('/work');
            await wait(30);

            const shutdown = current.lifecycle.shutdown(5000);
            await wait(30);
            current.release();

            await expect(shutdown).resolves.toBe(true);
            expect((await pending).data).toEqual({ done: true });
            expect(LOG.info).toHaveBeenCalledWith('Shutting down; 1 request(s) in progress');
            expect(LOG.info).toHaveBeenCalledWith('Shutdown: all requests are finished');
        });

        it('gives up when a request takes longer than the timeout', async () => {
            current = await start();
            const pending = current.server.get('/work', { timeout: 500 }).catch(() => {});
            await wait(30);

            await expect(current.lifecycle.shutdown(50)).resolves.toBe(false);

            expect(LOG.warn).toHaveBeenCalledWith('Shutdown: 1 request(s) still in progress after 50 ms, they are cut off');
            current.release();
            await pending;
        });

        it('names the error that caused the shutdown', async () => {
            current = await start();

            await current.lifecycle.shutdown(10, new Error('Unhandled rejection'));

            expect(LOG.info).toHaveBeenCalledWith('Shutting down after an error: Unhandled rejection; 0 request(s) in progress');
        });
    });
});
