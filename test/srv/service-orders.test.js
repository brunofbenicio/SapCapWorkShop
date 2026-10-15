const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');

const test = startServer();
const { GET } = test;

const ORDERS = '/service/benicio_1_04/A_ServiceOrder';
const ANY_STATUS = { validateStatus: () => true };
const REMOTE = 'S4HCP_ServiceOrder_Odata';

// Mock data of the S/4HANA service: srv/external/data/S4HCP_ServiceOrder_Odata-A_ServiceOrder.csv (8 orders).
const FREEZER_ORDERS = ['4000001', '4000002', '4000003', '4000004'];

const orderIds = data => data.value.map(order => order.ServiceOrder);

describe('service orders of SAP S/4HANA', () => {
    let remote;

    beforeAll(async () => {
        remote = await cds.connect.to(REMOTE);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('configuration', () => {
        const required = require('../../package.json').cds.requires[REMOTE];

        it('uses a destination in production', () => {
            expect(required.kind).toBe('odata-v2');
            expect(required['[production]'].credentials.destination).toBe('S4HCP-ServiceOrder-Odata');
        });

        it('has no credentials in development and test, the service is a local mock', () => {
            expect(required.credentials).toBeUndefined();
            expect(cds.env.requires[REMOTE].credentials).toBeUndefined();
            expect(remote.mocked).toBe(true);
        });
    });

    describe('read', () => {
        it('reads the orders from the mock data', async () => {
            const { status, data } = await GET(`${ORDERS}?$count=true&$orderby=ServiceOrder`);

            expect(status).toBe(200);
            expect(data['@odata.count']).toBe(8);
            expect(orderIds(data)).toEqual(['4000001', '4000002', '4000003', '4000004', '4000005', '4000006', '4000007', '4000008']);
        });

        it('exposes the number and the description only', async () => {
            const { data } = await GET(`${ORDERS}?$top=1&$orderby=ServiceOrder`);

            expect(data.value).toEqual([{ ServiceOrder: '4000001', ServiceOrderDescription: 'Replace freezer compressor' }]);
        });

        it('reads one order by its number', async () => {
            const { data } = await GET(`${ORDERS}('4000005')`);

            expect(data).toMatchObject({ ServiceOrder: '4000005', ServiceOrderDescription: 'Redeliver damaged dishwasher' });
        });

        it('answers 404 for an unknown order', async () => {
            const { status } = await GET(`${ORDERS}('9999999')`, ANY_STATUS);

            expect(status).toBe(404);
        });

        it('filters, sorts and pages', async () => {
            const { data } = await GET(`${ORDERS}?$filter=contains(ServiceOrderDescription,'freezer')&$orderby=ServiceOrder desc&$skip=1&$top=2&$select=ServiceOrder`);

            expect(orderIds(data)).toEqual(['4000003', '4000002']);
        });

        it('searches', async () => {
            const { data } = await GET(`${ORDERS}?$search=freezer`);

            expect(orderIds(data).sort()).toEqual(FREEZER_ORDERS);
        });
    });

    describe('delegation', () => {
        it('passes the query to the remote service', async () => {
            const run = jest.spyOn(remote, 'run');

            await GET(`${ORDERS}?$filter=ServiceOrder eq '4000002'`);

            const [query] = run.mock.calls[0];
            expect(query.SELECT.from.ref[0]).toBe('benicio_1_04Srv.A_ServiceOrder');
            expect(query.SELECT.where).toBeDefined();
        });

        it('returns what the remote service returns', async () => {
            jest.spyOn(remote, 'run').mockResolvedValue([{ ServiceOrder: '1', ServiceOrderDescription: 'From the remote system' }]);

            const { data } = await GET(ORDERS);

            expect(data.value).toEqual([{ ServiceOrder: '1', ServiceOrderDescription: 'From the remote system' }]);
        });

        it('reports an unavailable remote system as 502', async () => {
            jest.spyOn(remote, 'run').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));
            const log = jest.spyOn(cds.log('service-orders'), 'error').mockImplementation(() => {});

            const { status, data } = await GET(ORDERS, ANY_STATUS);

            expect(status).toBe(502);
            expect(data.error.code).toBe('SERVICE_ORDERS_UNAVAILABLE');
            expect(data.error.message).toMatch(/SAP S\/4HANA system is not available/);
            expect(JSON.stringify(data)).not.toContain('ECONNREFUSED');
            expect(log).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
        });

        it('reports a missing destination as 502', async () => {
            const connect = cds.connect.to;
            jest.spyOn(cds.connect, 'to').mockImplementation((name, ...args) =>
                name === REMOTE ? Promise.reject(new Error('No destination "S4HCP-ServiceOrder-Odata"')) : connect.call(cds.connect, name, ...args));
            jest.spyOn(cds.log('service-orders'), 'error').mockImplementation(() => {});

            const { status, data } = await GET(ORDERS, ANY_STATUS);

            expect(status).toBe(502);
            expect(data.error.code).toBe('SERVICE_ORDERS_UNAVAILABLE');
        });

        it('translates the error', async () => {
            jest.spyOn(remote, 'run').mockRejectedValue(new Error('timeout'));
            jest.spyOn(cds.log('service-orders'), 'error').mockImplementation(() => {});

            const { data } = await GET(ORDERS, { ...ANY_STATUS, headers: { 'Accept-Language': 'de' } });

            expect(data.error.message).toMatch(/SAP-S\/4HANA-System nicht verfügbar/);
        });

        it('passes on an error of the request itself', async () => {
            jest.spyOn(remote, 'run').mockRejectedValue(Object.assign(new Error('Invalid filter'), { status: 400 }));

            const { status, data } = await GET(ORDERS, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.message).toBe('Invalid filter');
        });
    });

    describe('authorization', () => {
        it.each([
            ['anonymous', undefined, 401],
            ['stranger', as('stranger'), 403],
            ['viewer', as('viewer'), 200],
            ['agent', as('agent'), 200],
            ['admin', as('admin'), 200]
        ])('%s: %i', async (_, config, status) => {
            const response = await GET(`${ORDERS}?$top=1`, { ...(config ?? { auth: undefined }), ...ANY_STATUS });

            expect(response.status).toBe(status);
        });

        it('does not grant anybody to create orders', async () => {
            const { status } = await test.POST(ORDERS, { ServiceOrder: '1' }, ANY_STATUS);

            expect(status).toBe(403);
        });
    });
});
