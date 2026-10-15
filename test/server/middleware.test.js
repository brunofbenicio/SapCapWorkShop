const express = require('express');
const { requestId } = require('../../srv/code/server/request-id');
const { accessLog } = require('../../srv/code/server/access-log');
const { cors } = require('../../srv/code/server/cors');
const { listen } = require('./helpers');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestId', () => {
    let server;

    beforeAll(async () => {
        const app = express();
        app.use(requestId());
        app.get('/id', (req, res) => res.json({ id: req.id, correlation: req.headers['x-correlation-id'] }));
        server = await listen(app);
    });

    afterAll(() => server.close());

    it('creates a UUID for a request without id', async () => {
        const { data, headers } = await server.get('/id');

        expect(data.id).toMatch(UUID);
        expect(headers['x-request-id']).toBe(data.id);
        expect(data.correlation).toBe(data.id);
    });

    it('creates a different id for every request', async () => {
        const first = await server.get('/id');
        const second = await server.get('/id');

        expect(first.data.id).not.toBe(second.data.id);
    });

    it.each([
        ['X-Request-ID', 'client-request-1'],
        ['X-Correlation-ID', 'client-correlation-2'],
        ['X-Vcap-Request-Id', 'router-3']
    ])('takes over %s', async (header, id) => {
        const { data, headers } = await server.get('/id', { headers: { [header]: id } });

        expect(data.id).toBe(id);
        expect(headers['x-request-id']).toBe(id);
        expect(data.correlation).toBe(id);
    });

    it('prefers X-Request-ID to X-Correlation-ID', async () => {
        const { data } = await server.get('/id', { headers: { 'X-Request-ID': 'first', 'X-Correlation-ID': 'second' } });

        expect(data.id).toBe('first');
    });

    it.each([
        ['blanks', 'not an id'],
        ['a script', '<script>'],
        ['a tab', 'abc\tdef'],
        ['more than 128 characters', 'a'.repeat(129)]
    ])('replaces an id with %s', async (_, id) => {
        const { data, headers } = await server.get('/id', { headers: { 'X-Request-ID': id } });

        expect(data.id).toMatch(UUID);
        expect(headers['x-request-id']).toBe(data.id);
    });
});

describe('accessLog', () => {
    let server;
    let log;

    beforeAll(async () => {
        const app = express();
        app.use(requestId());
        app.use(accessLog({ log: new Proxy({}, { get: (_, level) => (log[level] ??= jest.fn()) }) }));
        app.get('/ok', (req, res) => res.json({}));
        app.get('/health', (req, res) => res.json({ status: 'UP' }));
        app.get('/broken', (req, res) => res.status(500).json({}));
        app.get('/slow', (req, res) => setTimeout(() => res.json({}), 40));
        app.get('/hang', () => {});
        server = await listen(app);
    });

    afterAll(() => server.close());

    beforeEach(() => {
        log = {};
    });

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    it('logs method, path, status, duration and request id', async () => {
        await server.get('/ok', { headers: { 'X-Request-ID': 'abc-1' } });
        await wait(10);

        expect(log.info).toHaveBeenCalledTimes(1);
        expect(log.info.mock.calls[0][0]).toMatch(/^GET \/ok 200 \d+ms \[abc-1\]$/);
    });

    it('leaves the query out, because it may contain search terms', async () => {
        await server.get('/ok?$search=Camille%20Dubois&$filter=customerName%20eq%20%27x%27');
        await wait(10);

        expect(log.info.mock.calls[0][0]).toMatch(/^GET \/ok 200 /);
        expect(log.info.mock.calls[0][0]).not.toMatch(/Camille|search|filter/);
    });

    it('measures the duration', async () => {
        await server.get('/slow');
        await wait(10);
        const [, ms] = /(\d+)ms/.exec(log.info.mock.calls[0][0]);

        expect(Number(ms)).toBeGreaterThanOrEqual(35);
    });

    it('logs a 5xx status as a warning', async () => {
        await server.get('/broken');
        await wait(10);

        expect(log.info).toBeUndefined();
        expect(log.warn.mock.calls[0][0]).toMatch(/^GET \/broken 500 /);
    });

    it('logs the health check at debug level only', async () => {
        await server.get('/health');
        await wait(10);

        expect(log.info).toBeUndefined();
        expect(log.debug.mock.calls[0][0]).toMatch(/^GET \/health 200 /);
    });

    it('logs a request that the client gives up as aborted', async () => {
        await server.get('/hang', { timeout: 50 }).catch(() => {});
        await wait(50);

        expect(log.warn.mock.calls[0][0]).toMatch(/^GET \/hang aborted \d+ms \[/);
    });
});

describe('cors', () => {
    let server;
    let config;

    beforeAll(async () => {
        const app = express();
        app.use(cors(() => config));
        app.get('/data', (req, res) => res.json({}));
        server = await listen(app);
    });

    afterAll(() => server.close());

    const from = (origin, headers) => server.get('/data', { headers: { Origin: origin, ...headers } });
    const preflight = (origin, headers) => server.request({
        method: 'OPTIONS',
        url: '/data',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', ...headers }
    });

    it('adds no headers to a request without Origin', async () => {
        config = { origins: ['*'] };

        const { headers } = await server.get('/data');

        expect(headers['access-control-allow-origin']).toBeUndefined();
        expect(headers.vary).toBeUndefined();
    });

    it('allows no origin by default', async () => {
        config = undefined;

        const { status, headers } = await from('https://ui.example.com');

        expect(status).toBe(200);
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows a listed origin and tells the browser that the answer depends on it', async () => {
        config = { origins: ['https://ui.example.com', 'https://admin.example.com'] };

        const { headers } = await from('https://admin.example.com');

        expect(headers['access-control-allow-origin']).toBe('https://admin.example.com');
        expect(headers.vary).toMatch(/Origin/);
        expect(headers['access-control-expose-headers']).toBe('X-Request-ID, X-Correlation-ID');
    });

    it('refuses an origin that is not listed', async () => {
        config = { origins: ['https://ui.example.com'] };

        const { headers } = await from('https://evil.example.org');

        expect(headers['access-control-allow-origin']).toBeUndefined();
        expect(headers.vary).toMatch(/Origin/);
    });

    it('compares the whole origin, not a part of it', async () => {
        config = { origins: ['https://ui.example.com'] };

        for (const origin of ['https://ui.example.com.evil.org', 'http://ui.example.com', 'https://ui.example.com:8443']) {
            expect((await from(origin)).headers['access-control-allow-origin']).toBeUndefined();
        }
    });

    it('allows every origin with "*"', async () => {
        config = { origins: ['*'] };

        expect((await from('https://anything.example.net')).headers['access-control-allow-origin']).toBe('https://anything.example.net');
    });

    it('answers a preflight request of an allowed origin with 204 and the allowed methods and headers', async () => {
        config = { origins: ['https://ui.example.com'] };

        const { status, headers } = await preflight('https://ui.example.com', { 'Access-Control-Request-Headers': 'content-type, x-csrf-token' });

        expect(status).toBe(204);
        expect(headers['access-control-allow-origin']).toBe('https://ui.example.com');
        expect(headers['access-control-allow-methods']).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
        expect(headers['access-control-allow-headers']).toBe('content-type, x-csrf-token');
        expect(headers['access-control-max-age']).toBe('600');
    });

    it('uses the configured methods, headers and max age', async () => {
        config = { origins: ['https://ui.example.com'], methods: ['GET', 'POST'], headers: ['Content-Type'], maxage: 60 };

        const { headers } = await preflight('https://ui.example.com', { 'Access-Control-Request-Headers': 'x-other' });

        expect(headers['access-control-allow-methods']).toBe('GET,POST');
        expect(headers['access-control-allow-headers']).toBe('Content-Type');
        expect(headers['access-control-max-age']).toBe('60');
    });

    it('does not answer the preflight request of an origin that is not listed', async () => {
        config = { origins: ['https://ui.example.com'] };

        const { status, headers } = await preflight('https://evil.example.org');

        expect(status).not.toBe(204);
        expect(headers['access-control-allow-origin']).toBeUndefined();
        expect(headers['access-control-allow-methods']).toBeUndefined();
    });

    it('passes a plain OPTIONS request without preflight header on', async () => {
        config = { origins: ['https://ui.example.com'] };

        const { status } = await server.request({ method: 'OPTIONS', url: '/data', headers: { Origin: 'https://ui.example.com' } });

        expect(status).not.toBe(204);
    });

    it('allows credentials for a listed origin if configured', async () => {
        config = { origins: ['https://ui.example.com'], credentials: true };

        expect((await from('https://ui.example.com')).headers['access-control-allow-credentials']).toBe('true');
    });

    it('never allows credentials together with "*"', async () => {
        config = { origins: ['*'], credentials: true };

        const { headers } = await from('https://ui.example.com');

        expect(headers['access-control-allow-origin']).toBe('https://ui.example.com');
        expect(headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('does not allow credentials unless configured', async () => {
        config = { origins: ['https://ui.example.com'] };

        expect((await from('https://ui.example.com')).headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('takes a single origin as a string', async () => {
        config = { origins: 'https://ui.example.com' };

        expect((await from('https://ui.example.com')).headers['access-control-allow-origin']).toBe('https://ui.example.com');
    });
});
