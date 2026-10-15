const { startServer } = require('../helpers/server');

const test = startServer();
const { GET, POST } = test;

const URL = '/service/benicio_1_04/ResponseTemplates';
const ADMIN_URL = '/service/admin/ResponseTemplates'; // templates are maintained here
const ANY_STATUS = { validateStatus: () => true };

// Sample data in test/data:
//   warranty-claim          12 month text 2024-01-01 .. 2025-06-01, 24 month text from 2025-06-01
//   delivery-delay-apology  2024-01-01 .. open end
//   technician-visit        2024-01-01 .. open end
//   holiday-support-hours   2024-12-20 .. 2025-01-06 (expired)
const validAt = timestamp => GET(`${URL}?$orderby=code&sap-valid-at=${timestamp}`);
const codes = ({ data }) => data.value.map(template => template.code);
const warrantyMonths = ({ data }) => data.value.filter(template => template.code === 'warranty-claim')
    .map(template => template.text.match(/(\d+) month/)[1]);

describe('response templates (temporal data)', () => {
    beforeEach(() => test.data.reset());

    describe('as of now', () => {
        it('returns only the versions that are valid today', async () => {
            const response = await GET(`${URL}?$orderby=code`);

            expect(codes(response)).toEqual(['delivery-delay-apology', 'technician-visit', 'warranty-claim']);
            expect(warrantyMonths(response)).toEqual(['24']);
        });

        it('exposes the validity period of a version', async () => {
            const { data } = await GET(`${URL}?$filter=code eq 'warranty-claim'&$select=validFrom,validTo`);

            expect(data.value).toHaveLength(1);
            expect(data.value[0].validFrom).toBe('2025-06-01T00:00:00.000Z');
            expect(data.value[0].validTo).toMatch(/^9999-12-31/);
        });

        it('supports $filter on the other fields', async () => {
            const { data } = await GET(`${URL}?$filter=messageCategory eq 'Delivery'&$select=code`);

            expect(data.value.map(template => template.code)).toEqual(['delivery-delay-apology']);
        });
    });

    describe('time travel with sap-valid-at', () => {
        it('returns the text that applied in the past', async () => {
            const response = await validAt('2024-03-01T00:00:00Z');

            expect(warrantyMonths(response)).toEqual(['12']);
            expect(codes(response)).toEqual(['delivery-delay-apology', 'technician-visit', 'warranty-claim']);
        });

        it('accepts a plain date', async () => {
            expect(warrantyMonths(await validAt('2024-03-01'))).toEqual(['12']);
        });

        it('returns nothing before the first version', async () => {
            expect(codes(await validAt('2023-12-31T23:59:59Z'))).toEqual([]);
        });

        it('includes validFrom and excludes validTo of a period', async () => {
            expect(warrantyMonths(await validAt('2025-05-31T23:59:59Z'))).toEqual(['12']);
            expect(warrantyMonths(await validAt('2025-06-01T00:00:00Z'))).toEqual(['24']);
        });

        it('shows an expired template only within its period', async () => {
            expect(codes(await validAt('2024-12-19T23:59:59Z'))).not.toContain('holiday-support-hours');
            expect(codes(await validAt('2024-12-25T00:00:00Z'))).toContain('holiday-support-hours');
            expect(codes(await validAt('2025-01-06T00:00:00Z'))).not.toContain('holiday-support-hours');
        });
    });

    describe('periods with sap-valid-from and sap-valid-to', () => {
        it('returns every version that overlaps the period', async () => {
            const { data } = await GET(`${URL}?$filter=code eq 'warranty-claim'&$orderby=validFrom&sap-valid-from=2024-01-01T00:00:00Z&sap-valid-to=2026-01-01T00:00:00Z`);

            expect(data.value.map(template => template.text.match(/(\d+) month/)[1])).toEqual(['12', '24']);
        });

        it('returns only the old version for a period in the past', async () => {
            const response = await GET(`${URL}?$orderby=code&sap-valid-from=2024-02-01T00:00:00Z&sap-valid-to=2024-03-01T00:00:00Z`);

            expect(warrantyMonths(response)).toEqual(['12']);
        });
    });

    describe('maintenance', () => {
        it('makes a new template valid from now on without end by default', async () => {
            const created = await POST(ADMIN_URL, { code: 'refund-info', title: 'Refund information', text: 'Your refund is on its way.' });
            expect(created.status).toBe(201);

            const { data } = await GET(`${URL}?$filter=code eq 'refund-info'&$select=validFrom,validTo`);
            expect(data.value).toHaveLength(1);
            expect(Date.parse(data.value[0].validFrom)).toBeLessThanOrEqual(Date.now());
            expect(data.value[0].validTo).toMatch(/^9999-12-31/);

            expect(codes(await validAt('2025-01-01T00:00:00Z'))).not.toContain('refund-info');
        });

        it('can plan a template for a future period', async () => {
            await POST(ADMIN_URL, {
                code: 'summer-hours',
                title: 'Summer hours',
                text: 'Our support is open from 9 to 15 in summer.',
                validFrom: '2099-06-01T00:00:00Z',
                validTo: '2099-09-01T00:00:00Z'
            });

            expect(codes(await GET(`${URL}?$orderby=code`))).not.toContain('summer-hours');
            expect(codes(await validAt('2099-07-01T00:00:00Z'))).toContain('summer-hours');
            expect(codes(await validAt('2099-09-01T00:00:00Z'))).not.toContain('summer-hours');
        });

        it('requires a title and a text (@mandatory)', async () => {
            const { status, data } = await POST(ADMIN_URL, { code: 'incomplete' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('MULTIPLE_ERRORS');
            expect(data.error.details.map(detail => [detail.code, detail.target]).sort()).toEqual([
                ['ASSERT_MANDATORY', 'text'],
                ['ASSERT_MANDATORY', 'title']
            ]);
        });

        it('rejects a category that is not one of the message categories', async () => {
            const { status, data } = await POST(ADMIN_URL, { code: 'odd', title: 'Odd', text: 'x', messageCategory: 'Billing' }, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_ENUM');
        });
    });
});
