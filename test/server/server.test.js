const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');

const test = startServer();
const { GET } = test;

const MAIN = '/service/benicio_1_04';
const ANY_STATUS = { validateStatus: () => true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('custom server (srv/server.js)', () => {
    let accessLog;
    let serverLog;

    beforeEach(() => {
        accessLog = { info: jest.spyOn(cds.log('access'), 'info').mockImplementation(() => {}), warn: jest.spyOn(cds.log('access'), 'warn').mockImplementation(() => {}), debug: jest.spyOn(cds.log('access'), 'debug').mockImplementation(() => {}) };
        serverLog = { info: jest.spyOn(cds.log('server'), 'info').mockImplementation(() => {}), error: jest.spyOn(cds.log('server'), 'error').mockImplementation(() => {}) };
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete cds.env.cors;
    });

    describe('request id', () => {
        it('returns the same id as X-Request-ID and X-Correlation-ID', async () => {
            const { headers } = await GET(`${MAIN}/$metadata`);

            expect(headers['x-request-id']).toMatch(UUID);
            expect(headers['x-correlation-id']).toBe(headers['x-request-id']);
        });

        it('takes over the id of the caller', async () => {
            const { headers } = await GET(`${MAIN}/$metadata`, { headers: { 'X-Request-ID': 'client-42' } });

            expect(headers['x-request-id']).toBe('client-42');
            expect(headers['x-correlation-id']).toBe('client-42');
        });

        it('hands the id to CAP as cds.context.id', async () => {
            let seen;
            const service = await cds.connect.to('AdminService');
            service.before('READ', 'Tags', () => { seen = cds.context.id; });

            await GET('/service/admin/Tags?$top=1', { headers: { 'X-Request-ID': 'in-the-handler' } });

            expect(seen).toBe('in-the-handler');
        });

        it('is also returned for requests that are refused', async () => {
            const unauthorized = await GET(`${MAIN}/CustomerMessages`, { auth: undefined, ...ANY_STATUS });
            const forbidden = await GET(`${MAIN}/CustomerMessages`, { ...as('stranger'), ...ANY_STATUS });
            const unknown = await GET('/does-not-exist', ANY_STATUS);

            expect([unauthorized.status, forbidden.status, unknown.status]).toEqual([401, 403, 404]);
            for (const { headers } of [unauthorized, forbidden, unknown]) expect(headers['x-request-id']).toMatch(UUID);
        });
    });

    describe('access log', () => {
        it('logs the request with its status and id', async () => {
            const { headers } = await GET(`${MAIN}/$metadata`, { headers: { 'X-Request-ID': 'log-1' } });

            expect(headers['x-request-id']).toBe('log-1');
            expect(accessLog.info).toHaveBeenCalledWith(expect.stringMatching(/^GET \/service\/benicio_1_04\/\$metadata 200 \d+ms \[log-1\]$/));
        });

        it('logs refused requests with their status', async () => {
            await GET(`${MAIN}/CustomerMessages`, { auth: undefined, ...ANY_STATUS });
            await GET(`${MAIN}/CustomerMessages`, { ...as('stranger'), ...ANY_STATUS });

            const lines = accessLog.info.mock.calls.map(([line]) => line);
            expect(lines).toEqual([
                expect.stringMatching(/^GET \/service\/benicio_1_04\/CustomerMessages 401 /),
                expect.stringMatching(/^GET \/service\/benicio_1_04\/CustomerMessages 403 /)
            ]);
        });

        it('does not log the query', async () => {
            await GET(`${MAIN}/CustomerMessages?$search=Camille&$top=1`);

            expect(accessLog.info.mock.calls[0][0]).toMatch(/^GET \/service\/benicio_1_04\/CustomerMessages 200 /);
            expect(accessLog.info.mock.calls[0][0]).not.toMatch(/Camille|search/);
        });
    });

    describe('health', () => {
        it('answers UP without authentication', async () => {
            const { status, data } = await GET('/health', { auth: undefined });

            expect(status).toBe(200);
            expect(data).toEqual({ status: 'UP' });
        });

        it('has a request id and does not fill the log at info level', async () => {
            const { headers } = await GET('/health', { auth: undefined });

            expect(headers['x-request-id']).toMatch(UUID);
            expect(accessLog.info).not.toHaveBeenCalled();
            expect(accessLog.debug).toHaveBeenCalledWith(expect.stringMatching(/^GET \/health 200 /));
        });

        it('checks the database: DOWN without details when it does not answer', async () => {
            const run = cds.db.run.bind(cds.db);
            jest.spyOn(cds.db, 'run').mockImplementation(query => {
                if (query?.SELECT?.from?.ref?.[0] === 'Benicio_1_04.Settings') return Promise.reject(new Error('database unavailable'));
                return run(query);
            });

            const { status, data } = await GET('/health', { auth: undefined, ...ANY_STATUS });

            expect(status).toBe(503);
            expect(data).toEqual({ status: 'DOWN' });
            expect(serverLog.error).toHaveBeenCalledWith('Health check failed:', 'database unavailable');
        });
    });

    describe('CORS', () => {
        const ORIGIN = 'https://ui.example.com';

        it('is configured for development in package.json and off otherwise', () => {
            const { cors } = require('../../package.json').cds;

            expect(cors.origins).toEqual([]);
            expect(cors['[development]'].origins).toEqual(['*']);
            expect(require('../../package.json').cds.server.cors).toBe(false); // the built-in CORS of CAP is replaced
        });

        it('allows no origin in the test profile', async () => {
            const { headers } = await GET(`${MAIN}/$metadata`, { headers: { Origin: ORIGIN } });

            expect(headers['access-control-allow-origin']).toBeUndefined();
        });

        it('allows the origins of cds.cors.origins', async () => {
            cds.env.cors = { origins: [ORIGIN] };

            const allowed = await GET(`${MAIN}/$metadata`, { headers: { Origin: ORIGIN } });
            const other = await GET(`${MAIN}/$metadata`, { headers: { Origin: 'https://evil.example.org' } });

            expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
            expect(allowed.headers['access-control-expose-headers']).toMatch(/X-Request-ID/);
            expect(other.headers['access-control-allow-origin']).toBeUndefined();
        });

        it('answers the preflight request of the UI before the authentication', async () => {
            cds.env.cors = { origins: [ORIGIN] };

            const { status, headers } = await test.axios.request({
                method: 'OPTIONS',
                url: `${MAIN}/CustomerMessages`,
                auth: undefined,
                headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
                ...ANY_STATUS
            });

            expect(status).toBe(204);
            expect(headers['access-control-allow-origin']).toBe(ORIGIN);
            expect(headers['access-control-allow-headers']).toBe('content-type');
        });

        it('does not give a foreign origin access to the data of an authenticated user', async () => {
            cds.env.cors = { origins: [ORIGIN] };

            const { status, headers } = await GET(`${MAIN}/CustomerMessages?$top=1`, { headers: { Origin: 'https://evil.example.org' } });

            expect(status).toBe(200); // the request is served; without the header the browser does not hand the answer over
            expect(headers['access-control-allow-origin']).toBeUndefined();
        });
    });

    describe('lifecycle events', () => {
        it('logs the served services', async () => {
            await cds.emit('served', cds.services);

            const line = serverLog.info.mock.calls.map(([text]) => text).find(text => text.startsWith('Ready:'));
            for (const name of ['benicio_1_04Srv', 'OperationsService', 'AdminService', 'AnalyticsService']) expect(line).toContain(name);
            expect(line).not.toMatch(/EnrichmentService/); // not served over HTTP
        });

        it('shuts down gracefully: logs, and the health check answers DOWN', async () => {
            await Promise.all(cds.listeners('shutdown').map(listener => listener(null)));

            const { status, data } = await GET('/health', { auth: undefined, ...ANY_STATUS });

            expect(serverLog.info).toHaveBeenCalledWith(expect.stringMatching(/^Shutting down; \d+ request\(s\) in progress$/));
            expect(status).toBe(503);
            expect(data).toEqual({ status: 'DOWN' });
        });
    });
});
