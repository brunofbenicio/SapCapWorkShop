const cds = require('@sap/cds');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, as } = require('../helpers/server');

const { INSERT, SELECT } = cds.ql;
const test = startServer();
const { GET, POST } = test;

const ROOT = path.resolve(__dirname, '../..');
const ANY_STATUS = { validateStatus: () => true };
const MESSAGES = 'Benicio_1_04.CustomerMessages';

/**
 * Sends a GraphQL request. GraphQL reports errors in the body (HTTP 200), not with the HTTP status.
 * @param {string} query GraphQL document
 * @param {{ user?: string, variables?: object, headers?: object }} [options] "anonymous" sends no credentials
 */
const graphql = async (query, { user = 'admin', variables, headers } = {}) => {
    const auth = user === 'anonymous' ? { auth: undefined } : as(user);
    const { status, data } = await POST('/graphql', { query, variables }, { ...auth, headers, ...ANY_STATUS });
    return { status, data: data.data, errors: data.errors, code: data.errors?.[0]?.extensions?.code };
};

const dbTag = code => cds.db.run(SELECT.one.from('Benicio_1_04.Tags').where({ code }));
const createTag = (code, user) => graphql(`mutation { AdminService { Tags { create(input: { code: "${code}", title: "Tag ${code}" }) { code title } } } }`, { user });

describe('GraphQL endpoint', () => {
    beforeAll(() => {
        // The sample messages are not enriched, and AI Core is not available in tests.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('schema', () => {
        it('contains the annotated services only', async () => {
            const { data } = await graphql('{ __schema { queryType { fields { name } } } }');

            expect(data.__schema.queryType.fields.map(field => field.name).sort()).toEqual(['AdminService', 'benicio_1_04Srv']);
        });

        it('contains the main entities and their associations', async () => {
            const { data } = await graphql('{ __type(name: "benicio_1_04Srv_CustomerMessages") { fields { name } } }');
            const fields = data.__type.fields.map(field => field.name);

            expect(fields).toEqual(expect.arrayContaining(['customerMessageID', 'priorityScore', 'replies', 'attachments', 'tags', 'category']));
        });

        it('serves GraphiQL to browsers in development', async () => {
            const { status, headers, data } = await GET('/graphql', { headers: { Accept: 'text/html' }, ...ANY_STATUS });

            expect(status).toBe(200);
            expect(headers['content-type']).toMatch(/text\/html/);
            expect(data).toMatch(/graphiql/i);
        });

        it('switches GraphiQL off in production', () => {
            const script = "const cds = require('@sap/cds'); require('@cap-js/graphql/cds-plugin'); console.log(cds.env.protocols.graphql.graphiql)";
            const output = profile => execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, CDS_ENV: profile } }).toString().trim();

            expect(output('production')).toBe('false');
            expect(output('development')).toBe('undefined'); // the adapter default (on) applies
        });
    });

    describe('query', () => {
        it('reads messages with filter, order, paging and total count', async () => {
            const { data, errors } = await graphql(`{
                benicio_1_04Srv {
                    CustomerMessages(filter: { originatingCountry: { eq: "France" } }, orderBy: [{ customerMessageID: asc }], top: 2, skip: 1) {
                        nodes { customerMessageID customerName productName }
                        totalCount
                    }
                }
            }`);

            expect(errors).toBeUndefined();
            expect(data.benicio_1_04Srv.CustomerMessages.totalCount).toBe(5);
            expect(data.benicio_1_04Srv.CustomerMessages.nodes.map(message => message.customerMessageID)).toEqual([3166, 3923]);
        });

        it('reads calculated elements and nested compositions and associations', async () => {
            const { data, errors } = await graphql(`{
                benicio_1_04Srv {
                    CustomerMessages(filter: { customerMessageID: { eq: 3166 } }) {
                        nodes {
                            priorityScore
                            displayTitle
                            replies { nodes { author } }
                            tags { nodes { tag { code title } } }
                        }
                    }
                }
            }`);
            const [message] = data.benicio_1_04Srv.CustomerMessages.nodes;

            expect(errors).toBeUndefined();
            expect(message.priorityScore).toBe(0);
            expect(message.displayTitle).toBe('Problème de compresseur défectueux');
            expect(message.replies.nodes).toHaveLength(2);
            expect(message.tags.nodes.map(link => link.tag.code).sort()).toEqual(['urgent-repair', 'warranty']);
        });

        it('takes variables', async () => {
            const { data } = await graphql(
                'query ($id: Int) { benicio_1_04Srv { CustomerMessages(filter: { customerMessageID: { eq: $id } }) { nodes { customerName } } } }',
                { user: 'viewer', variables: { id: 2101 } }
            );

            expect(data.benicio_1_04Srv.CustomerMessages.nodes).toEqual([{ customerName: 'Lukas Brandt' }]);
        });

        it('reads the reference data of the AdminService', async () => {
            const { data } = await graphql('{ AdminService { Tags(orderBy: [{ code: asc }], top: 2) { nodes { code title } } ResponseTemplates { totalCount } } }');

            expect(data.AdminService.Tags.nodes).toEqual([
                { code: 'delivery-damage', title: 'Delivery damage' },
                { code: 'delivery-delay', title: 'Delivery delay' }
            ]);
            expect(data.AdminService.ResponseTemplates.totalCount).toBeGreaterThan(0);
        });

        it('reads the translated texts of a code list', async () => {
            const { data } = await graphql('{ benicio_1_04Srv { MessageCategories(orderBy: [{ code: asc }]) { nodes { code name } } } }', { headers: { 'Accept-Language': 'de' } });

            expect(data.benicio_1_04Srv.MessageCategories.nodes).toEqual([
                { code: 'Delivery', name: 'Lieferung' },
                { code: 'Service', name: 'Service' },
                { code: 'Technical', name: 'Technik' }
            ]);
        });

        it('applies the page size of the service', async () => {
            const rows = Array.from({ length: 60 }, (_, n) => ({
                ID: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
                customerMessageID: 100000 + n,
                titleCustomerLanguage: 'Titre',
                fullMessageCustomerLanguage: 'Message',
                fullMessageEnglish: 'Message',
                titleEnglish: 'Title',
                summaryCustomerLanguage: 'Résumé',
                summaryEnglish: 'Summary',
                messageCategory: 'Service',
                messageUrgency: 'Low',
                messageSentiment: 'Neutral'
            }));
            await cds.db.run(INSERT.into(MESSAGES).entries(rows));

            const { data } = await graphql('{ benicio_1_04Srv { CustomerMessages { nodes { ID } totalCount } } }');

            expect(data.benicio_1_04Srv.CustomerMessages.nodes).toHaveLength(50);
            expect(data.benicio_1_04Srv.CustomerMessages.totalCount).toBe(71);
        });

        it('rejects a query that expands deeper than the service allows', async () => {
            const { errors, code } = await graphql('{ benicio_1_04Srv { CustomerMessages(top: 1) { nodes { tags { nodes { tag { messages { nodes { message { ID } } } } } } } } } }');

            expect(errors).toHaveLength(1);
            expect(code).toBe('EXPAND_MAX_LEVELS_EXCEEDED');
        });

        it('reports an invalid query as an error', async () => {
            const { errors } = await graphql('{ benicio_1_04Srv { CustomerMessages { nodes { doesNotExist } } } }');

            expect(errors[0].message).toMatch(/doesNotExist/);
        });
    });

    describe('mutation', () => {
        it('creates a tag and records who created it', async () => {
            const { data, errors } = await createTag('gql-demo', 'agent');

            expect(errors).toBeUndefined();
            expect(data.AdminService.Tags.create).toEqual([{ code: 'gql-demo', title: 'Tag gql-demo' }]);
            expect(await dbTag('gql-demo')).toMatchObject({ title: 'Tag gql-demo', createdBy: 'agent' });
        });

        it('updates a tag', async () => {
            await createTag('gql-demo', 'agent');

            const { data, errors } = await graphql('mutation { AdminService { Tags { update(filter: { code: { eq: "gql-demo" } }, input: { title: "Renamed" }) { code title } } } }', { user: 'agent' });

            expect(errors).toBeUndefined();
            expect(data.AdminService.Tags.update).toEqual([{ code: 'gql-demo', title: 'Renamed' }]);
            expect((await dbTag('gql-demo')).title).toBe('Renamed');
        });

        it('deletes a tag and returns the number of deleted tags', async () => {
            await createTag('gql-demo', 'agent');

            const { data } = await graphql('mutation { AdminService { Tags { delete(filter: { code: { eq: "gql-demo" } }) } } }', { user: 'agent' });

            expect(data.AdminService.Tags.delete).toBe(1);
            expect(await dbTag('gql-demo')).toBeUndefined();
        });

        it('validates the input like the other protocols', async () => {
            const { code, errors } = await createTag('Not A Slug', 'agent');

            expect(code).toBe('ASSERT_FORMAT');
            expect(errors[0].message).toMatch(/lowercase letters/);
            expect(await dbTag('Not A Slug')).toBeUndefined();
        });

        // The GraphQL adapter has no actions, so it cannot activate a draft, and a direct update would
        // bypass the drafts. Messages are created and changed with the OData service (http/messages.http).
        describe('of customer messages', () => {
            const MUTATIONS = {
                create: 'create(input: { customerMessageID: 9100, customerName: "New" }) { ID }',
                update: 'update(filter: { customerMessageID: { eq: 3166 } }, input: { customerName: "Changed" }) { ID }',
                delete: 'delete(filter: { customerMessageID: { eq: 3166 } })'
            };

            it.each(Object.keys(MUTATIONS))('is refused for %s, even for an administrator', async operation => {
                const { errors, code } = await graphql(`mutation { benicio_1_04Srv { CustomerMessages { ${MUTATIONS[operation]} } } }`);

                expect(code).toBe('GRAPHQL_READ_ONLY');
                expect(errors[0].message).toMatch(/can be read with GraphQL, but not changed/);
                expect(await cds.db.run(SELECT.from(MESSAGES).where({ customerMessageID: 9100 }))).toEqual([]);
                expect(await cds.db.run(SELECT.from('benicio_1_04Srv.CustomerMessages.drafts'))).toEqual([]);
                expect(await cds.db.run(SELECT.one.from(MESSAGES).where({ customerMessageID: 3166 }))).toMatchObject({ customerName: 'Camille Dubois' });
            });

            it('is refused in the language of the request', async () => {
                const { errors } = await graphql(`mutation { benicio_1_04Srv { CustomerMessages { ${MUTATIONS.create} } } }`, { headers: { 'Accept-Language': 'de' } });

                expect(errors[0].message).toMatch(/Kundennachrichten können mit GraphQL gelesen/);
            });

            it('is still possible with the OData service', async () => {
                const { status } = await POST('/service/benicio_1_04/CustomerMessages', { customerMessageID: 9100 });

                expect(status).toBe(201);
            });
        });
    });

    describe('authorization', () => {
        const READ = '{ benicio_1_04Srv { CustomerMessages(top: 1) { nodes { customerMessageID } } } }';

        it('answers a request without credentials with the error 401', async () => {
            const { status, data, code } = await graphql(READ, { user: 'anonymous' });

            expect(status).toBe(200); // GraphQL reports errors in the body
            expect(data.benicio_1_04Srv.CustomerMessages).toBeNull();
            expect(code).toBe('401');
        });

        it('answers a user without a role with the error 403', async () => {
            const { code } = await graphql(READ, { user: 'stranger' });

            expect(code).toBe('403');
        });

        it.each(['viewer', 'agent', 'admin'])('lets %s read', async user => {
            const { data, errors } = await graphql(READ, { user });

            expect(errors).toBeUndefined();
            expect(data.benicio_1_04Srv.CustomerMessages.nodes).toHaveLength(1);
        });

        it.each([
            ['viewer', '403'],
            ['agent', undefined],
            ['admin', undefined]
        ])('%s creates a tag: %s', async (user, code) => {
            const response = await createTag(`by-${user}`, user);

            expect(response.code).toBe(code);
            if (code) expect(await dbTag(`by-${user}`)).toBeUndefined();
            else expect(await dbTag(`by-${user}`)).toMatchObject({ createdBy: user });
        });

        // The instance restriction "createdBy = $user" is checked by CAP for the whole entity when the
        // GraphQL adapter updates or deletes with a filter: an agent is refused as soon as a tag of
        // another user exists, even if the filter selects only the agent's own tags. This fails
        // closed; agents change their tags with the OData service, administrators may use GraphQL.
        describe('of tags created by an administrator', () => {
            beforeEach(() => createTag('by-admin', 'admin'));

            const rename = (code, user) => graphql(`mutation { AdminService { Tags { update(filter: { code: { eq: "${code}" } }, input: { title: "Renamed" }) { code title } } } }`, { user });
            const remove = (code, user) => graphql(`mutation { AdminService { Tags { delete(filter: { code: { eq: "${code}" } }) } } }`, { user });

            it('are not updated by an agent', async () => {
                const { code } = await rename('by-admin', 'agent');

                expect(code).toBe('403');
                expect((await dbTag('by-admin')).title).toBe('Tag by-admin');
            });

            it('are not deleted by an agent', async () => {
                const { code } = await remove('by-admin', 'agent');

                expect(code).toBe('403');
                expect(await dbTag('by-admin')).toBeDefined();
            });

            it('are not changed by a viewer', async () => {
                expect((await rename('by-admin', 'viewer')).code).toBe('403');
                expect((await remove('by-admin', 'viewer')).code).toBe('403');
            });

            it('are changed and deleted by an administrator', async () => {
                const renamed = await rename('by-admin', 'admin');
                const deleted = await remove('by-admin', 'admin');

                expect(renamed.data.AdminService.Tags.update).toEqual([{ code: 'by-admin', title: 'Renamed' }]);
                expect(deleted.data.AdminService.Tags.delete).toBe(1);
                expect(await dbTag('by-admin')).toBeUndefined();
            });
        });

        it('does not serve the services that are not annotated', async () => {
            const { errors } = await graphql('{ OperationsService { CustomerMessages { nodes { ID } } } }');

            expect(errors[0].message).toMatch(/Cannot query field "OperationsService"/);
        });
    });
});
