const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

const { INSERT, SELECT } = cds.ql;
const test = startServer();
const { GET } = test;

const MAIN = '/service/benicio_1_04';
const ADMIN = '/service/admin';
const OPERATIONS = '/service/operations';
const ANALYTICS = '/service/analytics';
const ANY_STATUS = { validateStatus: () => true };

const ids = rows => rows.map(row => row.customerMessageID);
const search = (service, term) => GET(`${service}/CustomerMessages?$search=${encodeURIComponent(term)}`);

describe('query options', () => {
    beforeAll(() => {
        // The sample messages are not enriched, and AI Core is not available in tests.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('page size (@cds.query.limit)', () => {
        const TOTAL = 1111; // the 11 sample messages and 1100 more

        beforeAll(async () => {
            await test.data.reset();
            // Complete messages, so the enrichment ignores them.
            const messages = Array.from({ length: TOTAL - 11 }, (_, n) => ({
                ID: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
                customerMessageID: 100000 + n,
                titleCustomerLanguage: `Title ${n}`,
                fullMessageCustomerLanguage: `Message ${n}`,
                fullMessageEnglish: `Message ${n}`,
                titleEnglish: `Title ${n}`,
                summaryCustomerLanguage: `Summary ${n}`,
                summaryEnglish: `Summary ${n}`,
                messageCategory: 'Service',
                messageUrgency: 'Low',
                messageSentiment: 'Neutral'
            }));
            const tags = Array.from({ length: 150 }, (_, n) => ({ code: `tag-${String(n).padStart(3, '0')}`, title: `Tag ${n}` }));
            await cds.db.run(INSERT.into('Benicio_1_04.CustomerMessages').entries(messages));
            await cds.db.run(INSERT.into('Benicio_1_04.Tags').entries(tags));
        });

        it('returns the default page and a link to the next page', async () => {
            const { data } = await GET(`${OPERATIONS}/CustomerMessages?$count=true&$orderby=customerMessageID`);

            expect(data.value).toHaveLength(50);
            expect(data['@odata.count']).toBe(TOTAL);
            expect(data['@odata.nextLink']).toBeDefined();
        });

        it('returns the following page through the next link', async () => {
            const first = await GET(`${OPERATIONS}/CustomerMessages?$orderby=customerMessageID&$select=customerMessageID`);
            const second = await GET(`${OPERATIONS}/${first.data['@odata.nextLink']}`);

            expect(second.data.value).toHaveLength(50);
            expect(ids(second.data.value)[0]).toBeGreaterThan(ids(first.data.value).at(-1));
        });

        it('cuts a bigger $top to the maximum', async () => {
            const { data } = await GET(`${OPERATIONS}/CustomerMessages?$top=5000&$select=customerMessageID`);

            expect(data.value).toHaveLength(200);
        });

        it('keeps a smaller $top', async () => {
            const { data } = await GET(`${OPERATIONS}/CustomerMessages?$top=5&$select=customerMessageID`);

            expect(data.value).toHaveLength(5);
        });

        it('applies to the app service as well', async () => {
            const { data } = await GET(`${MAIN}/CustomerMessages?$select=customerMessageID`);
            const more = await GET(`${MAIN}/CustomerMessages?$top=5000&$select=customerMessageID`);

            expect(data.value).toHaveLength(50);
            expect(more.data.value).toHaveLength(200);
        });

        it('uses bigger pages for the reference data of the AdminService', async () => {
            const { data } = await GET(`${ADMIN}/Tags`);
            const more = await GET(`${ADMIN}/Tags?$top=5000`);

            expect(data.value).toHaveLength(100);
            expect(more.data.value).toHaveLength(156); // 6 sample tags and 150 more, below the maximum of 500
        });

        it('limits the groups of the analytics view', async () => {
            const query = '$apply=groupby((customerMessageID),aggregate($count as messages))';
            const { data } = await GET(`${ANALYTICS}/MessageAnalytics?${query}`);
            const more = await GET(`${ANALYTICS}/MessageAnalytics?${query}&$top=5000`);

            expect(data.value).toHaveLength(200);
            expect(more.data.value).toHaveLength(1000);
        });

        it('does not limit reads from the service code', async () => {
            const service = await cds.connect.to('OperationsService');
            const rows = await service.tx({ user: cds.User.privileged }, tx => tx.run(SELECT.from(service.entities.CustomerMessages).columns('ID')));

            expect(rows).toHaveLength(TOTAL);
        });
    });

    describe('search (@cds.search)', () => {
        beforeAll(() => test.data.reset());

        it('finds a customer by name', async () => {
            const { data } = await search(MAIN, 'Camille');

            expect(ids(data.value)).toEqual([3166]);
        });

        it('finds messages by product name, case insensitive', async () => {
            const { data } = await search(OPERATIONS, 'freezer');

            expect(ids(data.value).sort()).toEqual([1124, 2202, 3166, 3923, 5896, 7085]);
        });

        it('finds a message by the original text', async () => {
            const { data } = await search(MAIN, 'compresseur');

            expect(ids(data.value).sort()).toEqual([3166, 5896]);
        });

        it('finds a message by customer ID and product ID', async () => {
            const customer = await search(MAIN, 'C-10021');
            const product = await search(MAIN, 'FRZ-150');

            expect(ids(customer.data.value)).toEqual([3166]);
            expect(ids(product.data.value).sort()).toEqual([1124, 2202, 7085]);
        });

        it('finds messages by the title of their tags', async () => {
            const { data } = await search(MAIN, 'warranty');

            expect(ids(data.value).sort()).toEqual([2201, 3166]);
        });

        it('lists a message once although several of its tags match', async () => {
            // Message 3166 has the tags "Urgent repair" and "Warranty", and both contain an "r".
            const { data } = await GET(`${MAIN}/CustomerMessages?$search=r&$count=true&$select=customerMessageID`);

            expect(new Set(ids(data.value)).size).toBe(data.value.length);
            expect(data['@odata.count']).toBe(data.value.length);
        });

        it('does not look at elements that are not annotated', async () => {
            // "French" is the sourceLanguage of five messages, "agent" their creator and "Open" their status.
            for (const term of ['French', 'agent', 'Open']) {
                const { data } = await search(MAIN, term);
                expect(data.value).toEqual([]);
            }
        });

        it('searches the tags of the AdminService by code and title', async () => {
            const byCode = await GET(`${ADMIN}/Tags?$search=delivery-delay`);
            const byTitle = await GET(`${ADMIN}/Tags?$search=${encodeURIComponent('"Delivery damage"')}`);

            expect(byCode.data.value.map(tag => tag.code)).toEqual(['delivery-delay']);
            expect(byTitle.data.value.map(tag => tag.code)).toEqual(['delivery-damage']);
        });

        it('searches the text of the response templates', async () => {
            const { data } = await GET(`${ADMIN}/ResponseTemplates?$search=technician`);

            expect(data.value.map(template => template.code)).toEqual(['technician-visit']);
        });
    });

    describe('capabilities', () => {
        const metadata = async service => (await GET(`${service}/$metadata`)).data;

        it('marks the analytics view as not searchable', async () => {
            const data = await metadata(ANALYTICS);

            expect(data).toMatch(/Target="AnalyticsService.EntityContainer\/MessageAnalytics">[\s\S]*?Term="Capabilities.SearchRestrictions"[\s\S]*?Property="Searchable" Bool="false"/);
        });

        it('lists the long texts as not sortable and not filterable', async () => {
            const data = await metadata(MAIN);

            for (const term of ['SortRestrictions', 'FilterRestrictions']) {
                const restriction = data.match(new RegExp(`Term="Capabilities.${term}">[\\s\\S]*?</Annotation>`))[0];
                expect(restriction).toContain('<PropertyPath>fullMessageCustomerLanguage</PropertyPath>');
                expect(restriction).toContain('<PropertyPath>suggestedResponseEnglish</PropertyPath>');
                expect(restriction).not.toContain('<PropertyPath>customerName</PropertyPath>');
            }
        });

        it('allows an expand of three levels', async () => {
            const { status } = await GET(`${MAIN}/CustomerMessages?$expand=tags($expand=tag($expand=messages))&$top=1`, ANY_STATUS);

            expect(status).toBe(200);
        });

        it('rejects a deeper expand', async () => {
            const { status, data } = await GET(`${MAIN}/CustomerMessages?$expand=tags($expand=tag($expand=messages($expand=message)))&$top=1`, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('EXPAND_MAX_LEVELS_EXCEEDED');
        });
    });
});
