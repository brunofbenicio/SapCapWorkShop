const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');
const { annotation, paths, targetOf } = require('./metadata');

const { INSERT } = cds.ql;
const test = startServer();
const { GET, POST } = test;

const SERVICE = '/service/benicio_1_04';
const ENTITY = 'benicio_1_04Srv.CustomerMessages';
const ANY_STATUS = { validateStatus: () => true };

describe('Fiori elements annotations of the customer messages', () => {
    let edmx;

    beforeAll(async () => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
        edmx = (await GET(`${SERVICE}/$metadata`)).data;
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    const on = (term, qualifier, target = ENTITY) => annotation(edmx, target, term, qualifier);

    describe('filter bar and list', () => {
        it('offers category, urgency, sentiment, status, country and product next to the ID', () => {
            expect(paths(on('UI.SelectionFields'))).toEqual([
                'customerMessageID', 'messageCategory', 'messageUrgency', 'messageSentiment', 'status', 'originatingCountry', 'productName'
            ]);
        });

        it('lists the important columns, without the long texts', () => {
            const columns = paths(on('UI.LineItem'));

            expect(columns).toEqual(expect.arrayContaining(['customerMessageID', 'displayTitle', 'customerName', 'messageCategory', 'messageUrgency', 'messageSentiment', 'priorityScore', 'status']));
            expect(columns).not.toEqual(expect.arrayContaining(['fullMessageCustomerLanguage']));
            expect(columns).not.toEqual(expect.arrayContaining(['suggestedResponseEnglish']));
        });

        it('colors urgency, sentiment, priority and status by their criticality', () => {
            const lineItem = on('UI.LineItem');

            for (const criticality of ['urgencyCriticality', 'sentimentCriticality', 'priorityCriticality', 'statusCriticality']) {
                expect(lineItem).toContain(`<PropertyValue Property="Criticality" Path="${criticality}"/>`);
            }
            expect(lineItem).toContain('CriticalityRepresentation" EnumMember="UI.CriticalityRepresentationType/WithIcon"');
        });

        it('has the action to resolve the selected message in the table toolbar', () => {
            const lineItem = on('UI.LineItem');

            expect(lineItem).toContain('<Record Type="UI.DataFieldForAction">');
            expect(lineItem).toContain('<PropertyValue Property="Action" String="benicio_1_04Srv.markAsResolved"/>');
        });

        it('shows the English title or the original one in the header of the page', () => {
            const info = on('UI.HeaderInfo');

            expect(paths(info)).toEqual(['displayTitle', 'customerName']);
            expect(info).toContain('Property="TypeName" String="Customer Message"');
        });
    });

    describe('object page header', () => {
        it.each([
            ['Urgency', 'messageUrgency', 'urgencyCriticality'],
            ['Sentiment', 'messageSentiment', 'sentimentCriticality'],
            ['Status', 'status', 'statusCriticality'],
            ['Priority', 'priorityScore', 'priorityCriticality']
        ])('has the data point %s with the criticality of the value', (qualifier, value, criticality) => {
            const point = on('UI.DataPoint', qualifier);

            expect(point).toContain(`<PropertyValue Property="Value" Path="${value}"/>`);
            expect(point).toContain(`<PropertyValue Property="Criticality" Path="${criticality}"/>`);
        });

        it('has a bullet chart of the priority with a range from 0 to 5', () => {
            const chart = on('UI.Chart', 'Priority');
            const point = on('UI.DataPoint', 'Priority');

            expect(chart).toContain('ChartType" EnumMember="UI.ChartType/Bullet"');
            expect(paths(chart)).toContain('priorityScore');
            expect(chart).toContain('<PropertyValue Property="DataPoint" AnnotationPath="@UI.DataPoint#Priority"/>');
            expect(point).toContain('<PropertyValue Property="MinimumValue" Decimal="0"/>');
            expect(point).toContain('<PropertyValue Property="MaximumValue" Decimal="5"/>');
        });

        it('shows the data points and the chart as header facets', () => {
            expect(paths(on('UI.HeaderFacets'))).toEqual([
                '@UI.DataPoint#Urgency', '@UI.DataPoint#Sentiment', '@UI.DataPoint#Status', '@UI.Chart#Priority'
            ]);
        });

        it('has the action to resolve the message in the header', () => {
            const identification = on('UI.Identification');

            expect(identification).toContain('<PropertyValue Property="Action" String="benicio_1_04Srv.markAsResolved"/>');
            expect(identification).toContain('Importance" EnumMember="UI.ImportanceType/High"');
            expect(identification).toContain('Property="Criticality" EnumMember="UI.CriticalityType/Positive"');
        });
    });

    describe('facets', () => {
        it('groups the data of the message and adds replies, tags and attachments', () => {
            expect(paths(on('UI.Facets'))).toEqual([
                '@UI.FieldGroup#Customer', '@UI.FieldGroup#Classification', '@UI.FieldGroup#Resolution',
                '@UI.FieldGroup#Message', '@UI.FieldGroup#Summary',
                'replies/@UI.LineItem', 'tags/@UI.LineItem', 'attachments/@UI.LineItem',
                '@UI.FieldGroup#ServiceOrder'
            ]);
        });

        it('defines every field group that a facet points to', () => {
            for (const target of paths(on('UI.Facets')).filter(path => path.startsWith('@UI.FieldGroup#'))) {
                expect(on('UI.FieldGroup', target.split('#')[1])).toBeDefined();
            }
        });

        it.each([
            ['CustomerMessageReplies', ['author', 'text', 'sentAt']],
            ['CustomerMessageTags', ['tag_code']],
            ['CustomerMessageAttachments', ['content', 'fileName', 'mediaType', 'createdAt', 'createdBy']]
        ])('lists the columns of %s', (entity, columns) => {
            expect(paths(annotation(edmx, `benicio_1_04Srv.${entity}`, 'UI.LineItem'))).toEqual(columns);
        });

        it('exposes the navigation properties that the facets use', () => {
            for (const navigation of ['replies', 'tags', 'attachments']) {
                expect(edmx).toMatch(new RegExp(`<NavigationProperty Name="${navigation}" Type="Collection\\(benicio_1_04Srv\\.`));
            }
        });
    });

    describe('value helps', () => {
        it('offers the message categories with their translated names', () => {
            const help = on('Common.ValueList', undefined, `${ENTITY}/messageCategory`);

            expect(help).toContain('<PropertyValue Property="CollectionPath" String="MessageCategories"/>');
            expect(paths(on('Common.Text', undefined, `${ENTITY}/messageCategory`))).toEqual(['category/name']);
            expect(on('Common.ValueListWithFixedValues', undefined, `${ENTITY}/messageCategory`)).toContain('Bool="true"');
            expect(edmx).toContain('<EntitySet Name="MessageCategories"');
        });

        it('offers the tags for the tag of a message', () => {
            const help = annotation(edmx, 'benicio_1_04Srv.CustomerMessageTags/tag_code', 'Common.ValueList');

            expect(help).toContain('<PropertyValue Property="CollectionPath" String="Tags"/>');
            expect(help).toContain('<PropertyValue Property="LocalDataProperty" PropertyPath="tag_code"/>');
            expect(edmx).toContain('<EntitySet Name="Tags"');
        });

        it('keeps the value help for the service order of SAP Build Code', () => {
            const help = annotation(edmx, `${ENTITY}/S4HCP_ServiceOrder_ServiceOrder`, 'Common.ValueList');

            expect(help).toContain('<PropertyValue Property="CollectionPath" String="A_ServiceOrder"/>');
        });
    });

    describe('side effects', () => {
        it('refreshes priority and colors when urgency or sentiment change', () => {
            const effects = on('Common.SideEffects', 'Classification');

            expect(paths(effects)).toEqual(['messageUrgency', 'messageSentiment']);
            for (const target of ['priorityScore', 'priorityCriticality', 'urgencyCriticality', 'sentimentCriticality']) {
                expect(effects).toContain(`<String>${target}</String>`);
            }
        });

        it('refreshes the title when one of the titles changes', () => {
            const effects = on('Common.SideEffects', 'Title');

            expect(paths(effects)).toEqual(['titleEnglish', 'titleCustomerLanguage']);
            expect(effects).toContain('<String>displayTitle</String>');
        });

        it('refreshes status and resolution after the action', () => {
            const effects = annotation(edmx, 'benicio_1_04Srv.markAsResolved(benicio_1_04Srv.CustomerMessages)', 'Common.SideEffects');

            for (const target of ['in/status', 'in/statusCriticality', 'in/resolvedAt', 'in/resolvedBy', 'in/resolution']) {
                expect(effects).toContain(`<String>${target}</String>`);
            }
        });
    });

    describe('action to resolve a message', () => {
        const ACTION = 'benicio_1_04Srv.markAsResolved(benicio_1_04Srv.CustomerMessages)';

        it('is offered for a saved, open message only', () => {
            const available = annotation(edmx, ACTION, 'Core.OperationAvailable');

            expect(paths(available)).toEqual(['in/IsActiveEntity', 'in/status']);
            expect(available).toContain('<String>Open</String>');
        });

        it('is bound to the message and returns it', () => {
            expect(edmx).toMatch(/<Action Name="markAsResolved" IsBound="true" EntitySetPath="in">/);
            expect(edmx).toMatch(/<ReturnType Type="benicio_1_04Srv\.CustomerMessages"\/>/);
        });

        it('asks for the resolution text', () => {
            expect(targetOf(edmx, 'benicio_1_04Srv.markAsResolved(benicio_1_04Srv.CustomerMessages)/resolution')).toContain('<Annotation Term="Common.Label" String="Resolution"/>');
        });
    });

    describe('criticality', () => {
        const ENTITY_NAME = 'Benicio_1_04.CustomerMessages';
        const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const read = (ID, columns) => GET(`${SERVICE}/CustomerMessages(ID=${ID},IsActiveEntity=true)?$select=${columns}`);

        it.each([
            ['High', 1], ['Medium', 2], ['Low', 3], [null, 0]
        ])('maps the urgency %s to %i', async (urgency, expected) => {
            await test.data.reset();
            await cds.db.run(INSERT.into(ENTITY_NAME).entries({ ID: UUID(1), customerMessageID: 7001, messageUrgency: urgency }));

            const { data } = await read(UUID(1), 'urgencyCriticality');

            expect(data.urgencyCriticality).toBe(expected);
        });

        it.each([
            ['Negative', 1], ['Neutral', 0], ['Positive', 3], [null, 0]
        ])('maps the sentiment %s to %i', async (sentiment, expected) => {
            await test.data.reset();
            await cds.db.run(INSERT.into(ENTITY_NAME).entries({ ID: UUID(2), customerMessageID: 7002, messageSentiment: sentiment }));

            const { data } = await read(UUID(2), 'sentimentCriticality');

            expect(data.sentimentCriticality).toBe(expected);
        });

        it.each([
            ['Open', 2], ['Resolved', 3]
        ])('maps the status %s to %i', async (status, expected) => {
            await test.data.reset();
            await cds.db.run(INSERT.into(ENTITY_NAME).entries({ ID: UUID(3), customerMessageID: 7003, status }));

            const { data } = await read(UUID(3), 'statusCriticality');

            expect(data.statusCriticality).toBe(expected);
        });

        it.each([
            ['High', 'Negative', 5, 1],
            ['High', 'Neutral', 4, 1],
            ['Medium', 'Negative', 4, 1],
            ['Medium', 'Neutral', 3, 2],
            ['Low', 'Negative', 3, 2],
            ['Low', 'Neutral', 2, 2],
            ['Low', 'Positive', 1, 3],
            [null, null, 0, 3]
        ])('maps the priority of %s and %s (score %i) to %i', async (urgency, sentiment, score, expected) => {
            await test.data.reset();
            await cds.db.run(INSERT.into(ENTITY_NAME).entries({ ID: UUID(4), customerMessageID: 7004, messageUrgency: urgency, messageSentiment: sentiment }));

            const { data } = await read(UUID(4), 'priorityScore,priorityCriticality');

            expect(data).toMatchObject({ priorityScore: score, priorityCriticality: expected });
        });

        it('is read only and not part of the writable data of a message', async () => {
            const { data } = await POST(`${SERVICE}/CustomerMessages`, { customerMessageID: 7005, urgencyCriticality: 3 });

            expect(data.urgencyCriticality).toBe(0); // calculated from the (empty) urgency, not taken from the request
        });
    });

    describe('markAsResolved in the app service', () => {
        const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // open
        const POSITIVE_FEEDBACK = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e06'; // resolved
        const resolve = (ID, user, data = {}) => POST(`${SERVICE}/CustomerMessages(ID=${ID},IsActiveEntity=true)/benicio_1_04Srv.markAsResolved`, data, { ...as(user), ...ANY_STATUS });

        beforeEach(() => test.data.reset());

        it('resolves the message and returns it with the new criticality', async () => {
            const { status, data } = await resolve(FREEZER_COMPRESSOR, 'agent', { resolution: 'Compressor replaced' });

            expect(status).toBe(200);
            expect(data).toMatchObject({ ID: FREEZER_COMPRESSOR, status: 'Resolved', resolvedBy: 'agent', resolution: 'Compressor replaced', statusCriticality: 3 });
        });

        it('reports the result as a message of the UI', async () => {
            const { headers } = await resolve(FREEZER_COMPRESSOR, 'agent');

            expect(JSON.parse(headers['sap-messages'])).toEqual([expect.objectContaining({ code: 'MESSAGE_RESOLVED', message: 'Customer message 3166 was marked as resolved.' })]);
        });

        it('emits the same event as the work queue', async () => {
            const messaging = await cds.connect.to('messaging');
            const received = [];
            messaging.on('OperationsService.MessageResolved', event => received.push(event.data));

            await resolve(FREEZER_COMPRESSOR, 'agent');

            expect(received).toEqual([expect.objectContaining({ customerMessageID: 3166, resolvedBy: 'agent' })]);
        });

        it('refuses a message that is resolved already', async () => {
            const { status, data } = await resolve(POSITIVE_FEEDBACK, 'agent');

            expect(status).toBe(409);
            expect(data.error.code).toBe('MESSAGE_ALREADY_RESOLVED');
        });

        it.each([
            ['anonymous', undefined, 401],
            ['stranger', 'stranger', 403],
            ['viewer', 'viewer', 403],
            ['agent', 'agent', 200],
            ['admin', 'admin', 200]
        ])('%s: %i', async (_, name, status) => {
            const response = name
                ? await resolve(FREEZER_COMPRESSOR, name)
                : await POST(`${SERVICE}/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)/benicio_1_04Srv.markAsResolved`, {}, { auth: undefined, ...ANY_STATUS });

            expect(response.status).toBe(status);
        });

        it('does not change the message when the user may not resolve it', async () => {
            await resolve(FREEZER_COMPRESSOR, 'viewer');

            const { data } = await GET(`${SERVICE}/CustomerMessages(ID=${FREEZER_COMPRESSOR},IsActiveEntity=true)?$select=status`);
            expect(data.status).toBe('Open');
        });

        it('records the change of the status in the change history', async () => {
            await cds.db.run(cds.ql.DELETE.from('sap.changelog.Changes'));

            await resolve(FREEZER_COMPRESSOR, 'agent');

            const { data } = await GET(`/service/operations/CustomerMessages(ID=${FREEZER_COMPRESSOR})/changes?$select=attribute,valueChangedTo,createdBy`);
            expect(data.value).toEqual([expect.objectContaining({ attribute: 'status', valueChangedTo: 'Resolved', createdBy: 'agent' })]);
        });
    });
});
