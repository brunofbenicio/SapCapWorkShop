const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/server');
const { HTTP_DIR, httpFiles, parseHttpFile, toAxiosConfig } = require('./helpers/http-file');

const test = startServer();

describe('request files in http/', () => {
    beforeAll(() => {
        // The sample messages are not enriched, and AI Core is not available in tests.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('parser', () => {
        const SAMPLE = `# comment
@host = http://localhost:4004

### First
# expect: 201
POST {{host}}/a HTTP/1.1
Authorization: Basic agent agent
Content-Type: application/json

{
  "x": 1
}

### Second
// another comment
GET {{host}}/b?$top=1
`;

        it('reads variables, requests, expectations, headers and bodies', () => {
            const { variables, requests } = parseHttpFile(SAMPLE);

            expect(variables).toEqual({ host: 'http://localhost:4004' });
            expect(requests).toHaveLength(2);
            expect(requests[0]).toMatchObject({
                title: 'First',
                expect: 201,
                method: 'POST',
                url: '{{host}}/a',
                headers: { Authorization: 'Basic agent agent', 'Content-Type': 'application/json' }
            });
            expect(JSON.parse(requests[0].body)).toEqual({ x: 1 });
            expect(requests[1]).toMatchObject({ title: 'Second', method: 'GET', url: '{{host}}/b?$top=1' });
            expect(requests[1].expect).toBeUndefined();
            expect(requests[1].body).toBeUndefined();
        });

        it('turns a request into an axios config with basic authentication', () => {
            const { variables, requests } = parseHttpFile(SAMPLE);
            const config = toAxiosConfig(requests[0], variables);

            expect(config).toMatchObject({ method: 'POST', url: '/a', auth: { username: 'agent', password: 'agent' }, data: { x: 1 } });
            expect(config.headers.Authorization).toBeUndefined();
        });

        it('sends a request without Authorization header anonymously', () => {
            const { variables, requests } = parseHttpFile(SAMPLE);

            expect(toAxiosConfig(requests[1], variables).auth).toBeUndefined();
        });

        it('rejects an undefined variable', () => {
            const { requests } = parseHttpFile('### X\nGET {{unknown}}/a\n');

            expect(() => toAxiosConfig(requests[0], {})).toThrow('{{unknown}} is not defined');
        });
    });

    describe('examples', () => {
        it('exist', () => {
            expect(httpFiles().length).toBeGreaterThan(0);
        });

        // Every file starts on fresh sample data, its requests run top down like in the editor.
        describe.each(httpFiles())('%s', file => {
            const { variables, requests } = parseHttpFile(fs.readFileSync(path.join(HTTP_DIR, file), 'utf8'));

            beforeAll(() => test.data.reset());

            it('has a title and an expected status for every request', () => {
                expect(requests.length).toBeGreaterThan(0);
                for (const request of requests) {
                    expect(request.expect).toBeGreaterThanOrEqual(200);
                    expect(request.method).toBeDefined();
                }
            });

            it('gets the documented status for every request', async () => {
                const failures = [];
                for (const request of requests) {
                    const response = await test.axios.request(toAxiosConfig(request, variables));
                    if (response.status !== request.expect) {
                        failures.push(`${request.method} ${request.url} expected ${request.expect}, got ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`);
                    }
                }
                expect(failures).toEqual([]);
            });
        });
    });
});
