const cds = require('@sap/cds');
const xsSecurity = require('../../xs-security.json');

// Pseudo roles of CAP that do not need a scope in the XSUAA configuration.
const PSEUDO_ROLES = ['any', 'authenticated-user', 'identified-user', 'system-user', 'internal-user'];

const scopeNames = xsSecurity.scopes.map(scope => scope.name);
const templateNames = xsSecurity['role-templates'].map(template => `$XSAPPNAME.${template.name}`);

const unique = values => new Set(values).size === values.length;

// Collects the roles that are used in @requires and @restrict annotations of the model.
function rolesUsedInModel(model) {
    const roles = new Set();
    const collect = definition => {
        for (const role of [definition['@requires']].flat()) if (typeof role === 'string') roles.add(role);
        for (const restriction of [definition['@restrict']].flat()) {
            for (const role of [restriction?.to].flat()) if (typeof role === 'string') roles.add(role);
        }
    };
    for (const definition of Object.values(model.definitions)) {
        collect(definition);
        Object.values(definition.actions || {}).forEach(collect);
    }
    return [...roles].filter(role => !PSEUDO_ROLES.includes(role));
}

describe('xs-security.json', () => {
    it('declares the application name and a dedicated tenant mode', () => {
        expect(xsSecurity.xsappname).toBe('benicio_1_04');
        expect(xsSecurity['tenant-mode']).toBe('dedicated');
    });

    it('declares unique scopes that are prefixed with $XSAPPNAME', () => {
        expect(scopeNames.length).toBeGreaterThan(0);
        expect(unique(scopeNames)).toBe(true);
        scopeNames.forEach(name => expect(name).toMatch(/^\$XSAPPNAME\.[A-Za-z]+$/));
    });

    it('only references declared scopes in role templates', () => {
        expect(unique(templateNames)).toBe(true);
        for (const template of xsSecurity['role-templates']) {
            expect(template['scope-references'].length).toBeGreaterThan(0);
            template['scope-references'].forEach(scope => expect(scopeNames).toContain(scope));
        }
    });

    it('only references declared role templates in role collections', () => {
        const collections = xsSecurity['role-collections'];
        expect(collections.map(collection => collection.name)).toEqual(
            expect.arrayContaining(['CustomerMessages_Viewer', 'CustomerMessages_Admin'])
        );
        for (const collection of collections) {
            expect(collection['role-template-references'].length).toBeGreaterThan(0);
            collection['role-template-references'].forEach(ref => expect(templateNames).toContain(ref));
        }
    });

    it('provides a scope for every role that the CDS model requires', async () => {
        const model = await cds.load('*');

        for (const role of rolesUsedInModel(model)) {
            expect(scopeNames).toContain(`$XSAPPNAME.${role}`);
        }
    });
});
