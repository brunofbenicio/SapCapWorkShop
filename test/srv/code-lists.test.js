const cds = require('@sap/cds');

const { SELECT, UPDATE } = cds.ql;
const test = cds.test(__dirname + '/../..');
const { GET, POST } = test;

const SERVICE = '/service/benicio_1_04';
const CATEGORIES = `${SERVICE}/MessageCategories?$orderby=code`;
const ANY_STATUS = { validateStatus: () => true };

const inLanguage = language => ({ headers: { 'Accept-Language': language } });
const names = ({ data }) => data.value.map(category => category.name);

describe('message categories code list', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('data', () => {
        const run = query => cds.db.run(query);

        it('has a code for every value of the MessageCategory enum', async () => {
            const enumValues = Object.keys(cds.model.definitions['Benicio_1_04.MessageCategory'].enum);

            const { MessageCategories } = cds.entities('Benicio_1_04');

            const rows = await run(SELECT.from(MessageCategories).columns('code'));

            expect(rows.map(row => row.code).sort()).toEqual([...enumValues].sort());
        });

        it.each(['de', 'pt'])('has a translated name and description in %s for every code', async locale => {
            const { MessageCategories } = cds.entities('Benicio_1_04');

            const rows = await run(SELECT.from(MessageCategories.texts).where({ locale }));

            expect(rows).toHaveLength(3);
            for (const row of rows) {
                expect(row.name).toBeTruthy();
                expect(row.descr).toBeTruthy();
            }
        });
    });

    describe('localization of the texts', () => {
        it('returns English texts by default', async () => {
            expect(names(await GET(CATEGORIES))).toEqual(['Delivery', 'Service', 'Technical']);
        });

        it.each([
            ['en', ['Delivery', 'Service', 'Technical']],
            ['de', ['Lieferung', 'Service', 'Technik']],
            ['pt', ['Entrega', 'Serviço', 'Técnico']]
        ])('returns the texts for Accept-Language %s', async (language, expected) => {
            expect(names(await GET(CATEGORIES, inLanguage(language)))).toEqual(expected);
        });

        it('uses the language of a regional locale such as de-DE or pt-BR', async () => {
            expect(names(await GET(CATEGORIES, inLanguage('de-DE')))[0]).toBe('Lieferung');
            expect(names(await GET(CATEGORIES, inLanguage('pt-BR')))[0]).toBe('Entrega');
        });

        it('uses the first language of an Accept-Language list', async () => {
            expect(names(await GET(CATEGORIES, inLanguage('de,en;q=0.5')))[0]).toBe('Lieferung');
        });

        it.each(['fr', 'ja'])('falls back to English for the unsupported language %s', async language => {
            expect(names(await GET(CATEGORIES, inLanguage(language)))).toEqual(['Delivery', 'Service', 'Technical']);
        });

        it('lets the sap-locale URL parameter win over Accept-Language', async () => {
            const response = await GET(`${CATEGORIES}&sap-locale=pt`, inLanguage('de'));

            expect(names(response)).toEqual(['Entrega', 'Serviço', 'Técnico']);
        });

        it('returns the localized description as well', async () => {
            const { data } = await GET(`${SERVICE}/MessageCategories('Delivery')`, inLanguage('de'));

            expect(data).toMatchObject({ name: 'Lieferung', descr: 'Verspätete, beschädigte oder fehlende Lieferungen' });
        });
    });

    describe('association from a customer message', () => {
        beforeEach(async () => {
            await test.data.reset();
            await cds.db.run(
                UPDATE('Benicio_1_04.CustomerMessages')
                    .set({ messageCategory: 'Delivery' })
                    .where({ customerMessageID: 2101 })
            );
        });

        it.each([
            ['en', 'Delivery'],
            ['de', 'Lieferung'],
            ['pt', 'Entrega']
        ])('expands the category name in %s', async (language, expected) => {
            const { data } = await GET(
                `${SERVICE}/CustomerMessages?$filter=customerMessageID eq 2101&$select=messageCategory&$expand=category($select=code,name)`,
                inLanguage(language)
            );

            expect(data.value).toHaveLength(1);
            expect(data.value[0]).toMatchObject({ messageCategory: 'Delivery', category: { code: 'Delivery', name: expected } });
        });

        it('has no category while the AI result is missing', async () => {
            const { data } = await GET(
                `${SERVICE}/CustomerMessages?$filter=customerMessageID eq 3166&$expand=category($select=code)`
            );

            expect(data.value[0].category).toBeNull();
        });
    });

    describe('labels of the service metadata', () => {
        it.each([
            ['en', 'Message Categories', 'Category'],
            ['de', 'Nachrichtenkategorien', 'Kategorie'],
            ['pt', 'Categorias de mensagens', 'Categoria']
        ])('are translated for %s', async (language, entityLabel, associationLabel) => {
            const { data } = await GET(`${SERVICE}/$metadata`, inLanguage(language));

            expect(data).toContain(`<Annotation Term="Common.Label" String="${entityLabel}"/>`);
            expect(data).toContain(`<Annotation Term="Common.Label" String="${associationLabel}"/>`);
        });
    });

    it('is read-only', async () => {
        const { status, data } = await POST(`${SERVICE}/MessageCategories`, { code: 'Service', name: 'Other' }, ANY_STATUS);

        expect(status).toBe(405);
        expect(data.error.code).toBe('ENTITY_IS_READ_ONLY');
    });
});
