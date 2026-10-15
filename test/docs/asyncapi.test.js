const cds = require('@sap/cds');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compile } = require('@cap-js/asyncapi');
const { startServer } = require('../helpers/server');

const ROOT = path.resolve(__dirname, '../..');
const CDS = path.join(ROOT, 'node_modules/.bin/cds');

const test = startServer();
const { POST } = test;

const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks an event payload against the JSON schema of the AsyncAPI document (the part that CAP generates). */
function validate(schema, data) {
    const problems = [];
    for (const [name, value] of Object.entries(data)) {
        const property = schema.properties[name];
        if (!property) {
            problems.push(`${name} is not in the schema`);
        } else if (value === null) {
            continue;
        } else if (property.type === 'integer' && !Number.isInteger(value)) {
            problems.push(`${name} is not an integer`);
        } else if (property.type === 'string' && typeof value !== 'string') {
            problems.push(`${name} is not a string`);
        } else if (property.format === 'uuid' && !UUID.test(value)) {
            problems.push(`${name} is not a UUID`);
        } else if (property.format === 'date-time' && Number.isNaN(Date.parse(value))) {
            problems.push(`${name} is not a date-time`);
        } else if (property.maxLength && String(value).length > property.maxLength) {
            problems.push(`${name} is longer than ${property.maxLength}`);
        }
    }
    return problems;
}

describe('AsyncAPI document (npm run asyncapi)', () => {
    let document;

    beforeAll(async () => {
        document = compile(await cds.load('*', { root: ROOT }), { service: 'OperationsService' });
    });

    beforeEach(() => test.data.reset());

    it('is an AsyncAPI 2 document of the application', () => {
        expect(document.asyncapi).toBe('2.0.0');
        expect(document['x-sap-application-namespace']).toBe('customer.customermessages');
        expect(document.info).toMatchObject({ title: 'Customer Messages Events', version: '1.0.0' });
        expect(document.defaultContentType).toBe('application/json');
    });

    it('has a channel for each event of the OperationsService', () => {
        expect(Object.keys(document.channels).sort()).toEqual(['OperationsService.MessageResolved', 'OperationsService.ReplyAdded']);
        for (const [name, channel] of Object.entries(document.channels)) {
            expect(channel.subscribe.message.$ref).toBe(`#/components/messages/${name}`);
        }
    });

    it('describes the payload of MessageResolved', () => {
        const { properties } = document.components.schemas['OperationsService.MessageResolved'];

        expect(Object.keys(properties).sort()).toEqual(['customerMessageID', 'messageID', 'resolution', 'resolvedAt', 'resolvedBy']);
        expect(properties.messageID).toMatchObject({ type: 'string', format: 'uuid' });
        expect(properties.customerMessageID.type).toBe('integer');
        expect(properties.resolvedAt).toMatchObject({ type: 'string', format: 'date-time' });
        expect(properties.resolution.maxLength).toBe(1000);
    });

    it('describes the payload of ReplyAdded', () => {
        const { properties } = document.components.schemas['OperationsService.ReplyAdded'];

        expect(Object.keys(properties).sort()).toEqual(['author', 'customerMessageID', 'messageID', 'replyID', 'sentAt']);
        expect(properties.replyID).toMatchObject({ type: 'string', format: 'uuid' });
        expect(properties.author.maxLength).toBe(100);
    });

    it('sends the events as CloudEvents named like the channel', () => {
        for (const name of Object.keys(document.channels)) {
            const message = document.components.messages[name];

            expect(message.headers.properties.type.const).toBe(name);
            expect(message.traits).toEqual([{ $ref: '#/components/messageTraits/CloudEventsContext.v1' }]);
        }
    });

    describe('events that the service emits', () => {
        let messaging;
        const received = {};

        beforeAll(async () => {
            messaging = await cds.connect.to('messaging');
            for (const name of Object.keys(document.channels)) messaging.on(name, event => { received[name] = event.data; });
        });

        beforeEach(() => {
            for (const name of Object.keys(received)) delete received[name];
        });

        it('match the schema of MessageResolved', async () => {
            await POST(`/service/operations/CustomerMessages(ID=${FREEZER_COMPRESSOR})/OperationsService.markAsResolved`, { resolution: 'Compressor replaced' });
            const data = received['OperationsService.MessageResolved'];

            expect(data).toMatchObject({ messageID: FREEZER_COMPRESSOR, customerMessageID: 3166, resolution: 'Compressor replaced' });
            expect(validate(document.components.schemas['OperationsService.MessageResolved'], data)).toEqual([]);
        });

        it('match the schema of ReplyAdded', async () => {
            await POST(`/service/operations/CustomerMessages(ID=${FREEZER_COMPRESSOR})/OperationsService.addReply`, { author: 'Support Team', text: 'We are on it.' });
            const data = received['OperationsService.ReplyAdded'];

            expect(data).toMatchObject({ messageID: FREEZER_COMPRESSOR, customerMessageID: 3166, author: 'Support Team' });
            expect(validate(document.components.schemas['OperationsService.ReplyAdded'], data)).toEqual([]);
        });

        it('are found by the validation when a property is not in the schema', () => {
            expect(validate(document.components.schemas['OperationsService.ReplyAdded'], { text: 'secret', customerMessageID: 'x' })).toEqual([
                'text is not in the schema',
                'customerMessageID is not an integer'
            ]);
        });
    });

    describe('output', () => {
        let directory;

        beforeEach(() => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asyncapi-'));
        });

        afterEach(() => {
            fs.rmSync(directory, { recursive: true, force: true });
        });

        it('is written by npm run asyncapi, one file for each service with events', () => {
            const { scripts } = require('../../package.json');
            const [, ...args] = scripts.asyncapi.split(' ').map(arg => (arg === 'docs/asyncapi' ? directory : arg));
            execFileSync(CDS, args, { cwd: ROOT, stdio: 'pipe' });

            expect(scripts.asyncapi).toMatch(/^cds compile srv --service all --to asyncapi -o docs\/asyncapi$/);
            expect(fs.readdirSync(directory)).toEqual(['OperationsService.json']);
            expect(JSON.parse(fs.readFileSync(path.join(directory, 'OperationsService.json'), 'utf8'))).toEqual(document);
        });
    });
});
