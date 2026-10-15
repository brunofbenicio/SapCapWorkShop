const fs = require('fs');
const path = require('path');
const { startServer } = require('../helpers/server');
const { annotation, paths, targetOf } = require('./metadata');

const test = startServer();
const { GET } = test;

const ROOT = path.resolve(__dirname, '../..');
const SERVICE = '/service/benicio_1_04';
const ENTITY = 'benicio_1_04Srv.CustomerMessages';
const LANGUAGES = ['', '_de', '_pt'];

/** Reads a .properties file into an object (key=value, # comments). */
function properties(file) {
    const entries = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)
        .filter(line => line.trim() && !line.trim().startsWith('#'))
        .map(line => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        });
    return Object.fromEntries(entries);
}

const bundle = (folder, language) => properties(`${folder}/i18n${language}.properties`);
const usedKeys = fs.readFileSync(path.join(ROOT, 'app/customer-messages-ui.cds'), 'utf8').match(/\{i18n>[^}]+\}/g).map(key => key.slice(6, -1));

describe('texts of the Fiori elements UI', () => {
    describe('resource bundles', () => {
        it('use only keys that a bundle of the model or of the UI defines', () => {
            const known = new Set([...Object.keys(bundle('app/_i18n', '')), ...Object.keys(bundle('db/i18n', ''))]);

            expect([...new Set(usedKeys)].filter(key => !known.has(key))).toEqual([]);
        });

        it('have the same keys in English, German and Portuguese', () => {
            const english = Object.keys(bundle('app/_i18n', '')).sort();

            for (const language of LANGUAGES) {
                expect(Object.keys(bundle('app/_i18n', language)).sort()).toEqual(english);
            }
        });

        it('have a text for every key', () => {
            for (const language of LANGUAGES) {
                const empty = Object.entries(bundle('app/_i18n', language)).filter(([, text]) => !text).map(([key]) => key);
                expect(empty).toEqual([]);
            }
        });

        it('translate: German and Portuguese differ from English, except for words that are the same', () => {
            const english = bundle('app/_i18n', '');
            const same = { _de: ['Tag', 'ReplyText'], _pt: [] };

            for (const language of ['_de', '_pt']) {
                const translated = bundle('app/_i18n', language);
                const untranslated = Object.keys(english).filter(key => translated[key] === english[key] && !same[language].includes(key));
                expect(untranslated).toEqual([]);
            }
        });

        it('contain no key that the UI does not use, and no key of the model bundle', () => {
            const model = Object.keys(bundle('db/i18n', ''));

            for (const key of Object.keys(bundle('app/_i18n', ''))) {
                expect({ key, used: usedKeys.includes(key) }).toEqual({ key, used: true });
                expect({ key, inModel: model.includes(key) }).toEqual({ key, inModel: false });
            }
        });

        it('keep the placeholders and the end of the sentence of the English text', () => {
            for (const language of LANGUAGES) {
                for (const text of Object.values(bundle('app/_i18n', language))) expect(text).not.toMatch(/[{}]|\s$/);
            }
        });
    });

    describe('$metadata', () => {
        const metadata = (language, query = '') => GET(`${SERVICE}/$metadata${query}`, { headers: { 'Accept-Language': language } }).then(response => response.data);
        const label = (edmx, term, qualifier, target = ENTITY) => annotation(edmx, target, term, qualifier);

        it.each(['en', 'de', 'pt', 'fr', 'ja'])('has no unresolved key in %s', async language => {
            expect(await metadata(language)).not.toContain('{i18n>');
        });

        it('is English by default and for a language without translation', async () => {
            for (const edmx of [await GET(`${SERVICE}/$metadata`).then(r => r.data), await metadata('en'), await metadata('fr')]) {
                expect(label(edmx, 'UI.HeaderInfo')).toContain('Property="TypeName" String="Customer Message"');
                expect(label(edmx, 'UI.LineItem')).toContain('String="Mark as resolved"');
                expect(targetOf(edmx, `${ENTITY}/messageUrgency`)).toContain('String="Urgency"');
            }
        });

        it('is German for Accept-Language de', async () => {
            const edmx = await metadata('de');

            expect(label(edmx, 'UI.HeaderInfo')).toContain('Property="TypeName" String="Kundennachricht"');
            expect(label(edmx, 'UI.HeaderInfo')).toContain('Property="TypeNamePlural" String="Kundennachrichten"');
            expect(label(edmx, 'UI.LineItem')).toContain('String="Als gelöst markieren"');
            expect(label(edmx, 'UI.Identification')).toContain('String="Als gelöst markieren"');
            expect(targetOf(edmx, `${ENTITY}/messageUrgency`)).toContain('String="Dringlichkeit"');
            expect(targetOf(edmx, `${ENTITY}/customerName`)).toContain('String="Kundenname"');
        });

        it('is Portuguese for Accept-Language pt', async () => {
            const edmx = await metadata('pt');

            expect(label(edmx, 'UI.HeaderInfo')).toContain('Property="TypeName" String="Mensagem de cliente"');
            expect(label(edmx, 'UI.Identification')).toContain('String="Marcar como resolvida"');
            expect(targetOf(edmx, `${ENTITY}/messageSentiment`)).toContain('String="Sentimento"');
        });

        it('follows the URL parameter sap-locale', async () => {
            const edmx = await GET(`${SERVICE}/$metadata?sap-locale=de`).then(response => response.data);

            expect(label(edmx, 'UI.Identification')).toContain('String="Als gelöst markieren"');
        });

        it('translates the data points, the chart and the facets', async () => {
            const edmx = await metadata('de');

            expect(label(edmx, 'UI.DataPoint', 'Urgency')).toContain('Property="Title" String="Dringlichkeit"');
            expect(label(edmx, 'UI.DataPoint', 'Sentiment')).toContain('Property="Title" String="Stimmung"');
            expect(label(edmx, 'UI.DataPoint', 'Priority')).toContain('Property="Title" String="Prioritätswert"'); // from db/i18n
            expect(label(edmx, 'UI.Chart', 'Priority')).toContain('Property="Title" String="Priorität"');
            const facets = label(edmx, 'UI.Facets');
            for (const text of ['Allgemeine Informationen', 'Kunde und Produkt', 'Klassifizierung', 'Nachricht', 'Antworten', 'Anhänge', 'Serviceauftrag']) {
                expect(facets).toContain(`String="${text}"`);
            }
        });

        it('translates the columns of replies, tags and attachments', async () => {
            const edmx = await metadata('pt');

            expect(targetOf(edmx, 'benicio_1_04Srv.CustomerMessageReplies/author')).toContain('String="Autor"');
            expect(targetOf(edmx, 'benicio_1_04Srv.CustomerMessageReplies/sentAt')).toContain('String="Enviado em"');
            expect(targetOf(edmx, 'benicio_1_04Srv.CustomerMessageAttachments/fileName')).toContain('String="Nome do ficheiro"');
            expect(label(await metadata('pt'), 'UI.LineItem', undefined, 'benicio_1_04Srv.CustomerMessageTags')).toContain('String="Etiqueta"');
        });

        it('translates the parameter of the action and the value help of the service order', async () => {
            const edmx = await metadata('de');

            expect(targetOf(edmx, 'benicio_1_04Srv.markAsResolved(benicio_1_04Srv.CustomerMessages)/resolution')).toContain('String="Lösung"'); // from db/i18n
            expect(label(edmx, 'Common.ValueList', undefined, `${ENTITY}/S4HCP_ServiceOrder_ServiceOrder`) ?? targetOf(edmx, `${ENTITY}/S4HCP_ServiceOrder`)).toContain('String="Serviceauftrag"');
        });

        it('keeps the labels in the paths of the annotations intact', async () => {
            const edmx = await metadata('de');

            expect(paths(label(edmx, 'UI.SelectionFields'))).toContain('messageCategory');
            expect(label(edmx, 'UI.LineItem')).toContain('Path="urgencyCriticality"');
        });
    });
});
