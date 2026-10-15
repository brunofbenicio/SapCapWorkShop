const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');
const { auditLog, deliver, forget, recorded } = require('../helpers/audit');
const { tasks, skipBackoff } = require('../helpers/enrichment');
const { useCustomerIdAsDataSubject } = require('../../srv/code/audit');

const { SELECT } = cds.ql;
const test = startServer();
const { GET, POST, PATCH, DELETE } = test;

const SERVICE = '/service/benicio_1_04';
const URL = `${SERVICE}/CustomerMessages`;
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ENTITY = 'benicio_1_04Srv.CustomerMessages';
const ANY_STATUS = { validateStatus: () => true };

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;

// Sample data: message 3166 belongs to customer C-10021 (Camille Dubois) and has two replies and an attachment.
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';
const SECRET = 'Le code de la porte est 4711';

const modified = async () => recorded('PersonalDataModified');
const reads = async () => recorded('SensitiveDataRead');
const names = attributes => attributes.map(attribute => attribute.name).sort();
const attribute = (event, name) => event.data.attributes.find(each => each.name === name);

/** Creates and saves a message of customer C-90001; the user becomes the creator of the message. */
async function createMessage(user = 'admin') {
    const config = as(user);
    const { data } = await POST(URL, {
        customerMessageID: 9100,
        customerId: 'C-90001',
        customerName: 'Erika Mustermann',
        titleCustomerLanguage: 'Geschirrspüler pumpt nicht ab',
        fullMessageCustomerLanguage: SECRET,
        originatingCountry: 'Germany'
    }, config);
    await POST(`${draft(data.ID)}/${ACTIVATE}`, {}, config);
    return data.ID;
}

/** Edits a saved message: opens a draft, applies the changes and saves it. */
async function change(ID, changes, user = 'admin') {
    const config = as(user);
    await POST(`${active(ID)}/${EDIT}`, { PreserveChanges: true }, config);
    if (changes) await PATCH(draft(ID), changes, config);
    return POST(`${draft(ID)}/${ACTIVATE}`, {}, { ...config, ...ANY_STATUS });
}

describe('audit logging', () => {
    beforeAll(() => {
        // The sample messages are not enriched, and AI Core is not available in tests.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(async () => {
        await test.data.reset();
        await forget();
    });

    describe('personal data annotations', () => {
        it('make the customer the data subject of the messages', () => {
            const messages = cds.model.definitions['Benicio_1_04.CustomerMessages'];

            expect(messages['@PersonalData.EntitySemantics']).toBe('DataSubject');
            expect(messages['@PersonalData.DataSubjectRole']).toBe('Customer');
            expect(messages.elements.customerId['@PersonalData.FieldSemantics']).toBe('DataSubjectID');
        });

        it('mark names as personal and free texts as sensitive', () => {
            const { elements } = cds.model.definitions['Benicio_1_04.CustomerMessages'];

            expect(elements.customerName['@PersonalData.IsPotentiallyPersonal']).toBe(true);
            expect(elements.titleCustomerLanguage['@PersonalData.IsPotentiallyPersonal']).toBe(true);
            expect(elements.fullMessageCustomerLanguage['@PersonalData.IsPotentiallySensitive']).toBe(true);
            expect(elements.fullMessageEnglish['@PersonalData.IsPotentiallySensitive']).toBe(true);
            expect(elements.productName['@PersonalData.IsPotentiallyPersonal']).toBeUndefined();
        });

        it('cover replies and attachments, which belong to a message', () => {
            const replies = cds.model.definitions['Benicio_1_04.CustomerMessageReplies'];
            const attachments = cds.model.definitions['Benicio_1_04.CustomerMessageAttachments'];

            expect(replies['@PersonalData.EntitySemantics']).toBe('Other');
            expect(replies.elements.author['@PersonalData.IsPotentiallyPersonal']).toBe(true);
            expect(replies.elements.text['@PersonalData.IsPotentiallySensitive']).toBe(true);
            expect(attachments.elements.fileName['@PersonalData.IsPotentiallyPersonal']).toBe(true);
            expect(attachments.elements.content['@PersonalData.IsPotentiallyPersonal']).toBeUndefined(); // never copied into the log
        });

        it('are inherited by the projections of the service', () => {
            expect(cds.model.definitions[ENTITY]['@PersonalData.EntitySemantics']).toBe('DataSubject');
            expect(cds.model.definitions[ENTITY].elements.customerName['@PersonalData.IsPotentiallyPersonal']).toBe(true);
        });
    });

    describe('PersonalDataModified', () => {
        it('is logged once when a message is saved, with the new values of personal attributes', async () => {
            const ID = await createMessage();

            const events = await modified();

            expect(events).toHaveLength(1);
            const [{ data }] = events;
            expect(data.data_subject).toEqual({ id: { customerId: 'C-90001' }, role: 'Customer', type: ENTITY });
            expect(data.object).toEqual({ type: ENTITY, id: { ID } });
            expect(data.attributes).toEqual(expect.arrayContaining([
                { name: 'customerName', new: 'Erika Mustermann' },
                { name: 'titleCustomerLanguage', new: 'Geschirrspüler pumpt nicht ab' }
            ]));
        });

        it('masks the value of sensitive attributes', async () => {
            await createMessage();

            const [{ data }] = await modified();

            expect(attribute({ data }, 'fullMessageCustomerLanguage')).toEqual({ name: 'fullMessageCustomerLanguage', new: '***' });
            expect(JSON.stringify(await recorded())).not.toContain(SECRET);
        });

        it('records who did it and when', async () => {
            await createMessage();

            const [{ data }] = await modified();

            expect(data).toMatchObject({ user: 'admin', uuid: expect.stringMatching(/^[0-9a-f-]{36}$/) });
            expect(Date.now() - Date.parse(data.time)).toBeLessThan(60 * 1000);
        });

        it('is not logged while the message is only a draft', async () => {
            const { data } = await POST(URL, { customerMessageID: 9101, customerId: 'C-90002', customerName: 'Draft Only' });
            await PATCH(draft(data.ID), { customerName: 'Still Draft' });
            await DELETE(draft(data.ID));

            expect(await modified()).toEqual([]);
        });

        it('shows the old and the new value of a changed attribute', async () => {
            const ID = await createMessage('agent');
            await forget();

            const { status } = await change(ID, { customerName: 'Erika Musterfrau' }, 'agent');
            const events = await modified();

            expect(status).toBe(200);
            expect(events).toHaveLength(1);
            expect(events[0].data.attributes).toEqual([{ name: 'customerName', old: 'Erika Mustermann', new: 'Erika Musterfrau' }]);
            expect(events[0].data.user).toBe('agent');
        });

        it('names the customer even if the update does not touch the customerId', async () => {
            const ID = await createMessage();
            await forget();

            await change(ID, { customerName: 'Erika Musterfrau' });
            const [{ data }] = await modified();

            expect(data.data_subject.id).toEqual({ customerId: 'C-90001' });
        });

        it('does not log attributes that did not change', async () => {
            const ID = await createMessage();
            await forget();

            await change(ID, { productName: 'Dishwasher' }); // not personal

            expect(await modified()).toEqual([]);
        });

        it('masks old and new value of a changed sensitive attribute', async () => {
            const ID = await createMessage();
            await forget();

            await change(ID, { fullMessageCustomerLanguage: 'Neuer geheimer Text' });
            const [{ data }] = await modified();

            expect(attribute({ data }, 'fullMessageCustomerLanguage')).toEqual({ name: 'fullMessageCustomerLanguage', old: '***', new: '***' });
            expect(JSON.stringify(await recorded())).not.toContain('Neuer geheimer Text');
        });

        it('is logged when the message is deleted, with the old values', async () => {
            const ID = await createMessage();
            await forget();

            const { status } = await DELETE(active(ID));
            const events = await modified();

            expect(status).toBe(204);
            expect(events).toHaveLength(1);
            expect(events[0].data.data_subject.id).toEqual({ customerId: 'C-90001' });
            expect(events[0].data.attributes).toEqual(expect.arrayContaining([
                { name: 'customerName', old: 'Erika Mustermann' },
                { name: 'fullMessageCustomerLanguage', old: '***' }
            ]));
            expect(attribute(events[0], 'customerName').new).toBeUndefined();
        });

        it('is logged for a reply, for the customer of the message', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            await POST(`${draft(FREEZER_COMPRESSOR)}/replies`, { author: 'Support Team', text: 'Une visite est prévue.' });
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});
            const events = await modified();

            const reply = events.find(event => event.data.object.type === 'benicio_1_04Srv.CustomerMessageReplies');
            expect(reply.data.data_subject).toEqual({ id: { customerId: 'C-10021' }, role: 'Customer', type: ENTITY });
            expect(reply.data.attributes).toEqual([
                { name: 'author', new: 'Support Team' },
                { name: 'text', new: '***' }
            ]);
        });

        it('is logged for the file name of an attachment, not for its content', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            await POST(`${draft(FREEZER_COMPRESSOR)}/attachments`, { fileName: 'door-seal.png', mediaType: 'image/png' });
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            const attachment = (await modified()).find(event => event.data.object.type === 'benicio_1_04Srv.CustomerMessageAttachments');

            expect(attachment.data.attributes).toEqual([{ name: 'fileName', new: 'door-seal.png' }]);
            expect(attachment.data.data_subject.id).toEqual({ customerId: 'C-10021' });
        });

        it('is not logged for data without personal data', async () => {
            await POST('/service/admin/Tags', { code: 'audit-demo', title: 'Audit demo' });
            await PATCH("/service/admin/Tags('audit-demo')", { title: 'Renamed' });

            expect(await recorded()).toEqual([]);
        });
    });

    describe('SensitiveDataRead', () => {
        it('is logged for each message read, with the names of the sensitive attributes', async () => {
            const { data } = await GET(`${URL}?$top=3&$orderby=customerMessageID`);
            const events = await reads();

            expect(data.value).toHaveLength(3);
            expect(events.filter(event => event.data.object.type === ENTITY)).toHaveLength(3);
            for (const { data: audit } of events) {
                expect(names(audit.attributes)).toEqual(['fullMessageCustomerLanguage', 'fullMessageEnglish']);
                expect(audit.attributes.every(each => Object.keys(each).length === 1)).toBe(true); // no values
                expect(audit.data_subject).toMatchObject({ role: 'Customer', type: ENTITY });
                expect(audit.user).toBe('admin');
            }
        });

        it('never contains the text that was read', async () => {
            await GET(`${active(FREEZER_COMPRESSOR)}`);

            expect(JSON.stringify(await recorded())).not.toContain('compresseur de mon congélateur');
        });

        it('names the customer, also when the request does not select the customerId', async () => {
            await GET(`${active(FREEZER_COMPRESSOR)}?$select=customerName,fullMessageCustomerLanguage`);

            const [{ data }] = await reads();

            expect(data.data_subject.id).toEqual({ customerId: 'C-10021' });
            expect(data.object.id).toEqual({ ID: FREEZER_COMPRESSOR });
        });

        it('is not logged when no sensitive attribute is read', async () => {
            await GET(`${URL}?$select=customerMessageID,customerName,productName&$top=3`);

            expect(await reads()).toEqual([]);
        });

        it('is logged for the replies that are read, for the customer of the message', async () => {
            await GET(`${active(FREEZER_COMPRESSOR)}/replies`);

            const events = await reads();

            expect(events).toHaveLength(2);
            for (const { data } of events) {
                expect(data.object.type).toBe('benicio_1_04Srv.CustomerMessageReplies');
                expect(data.data_subject.id).toEqual({ customerId: 'C-10021' });
                expect(names(data.attributes)).toEqual(['text']);
            }
        });

        it('is logged when the data is read through GraphQL', async () => {
            await POST('/graphql', { query: '{ benicio_1_04Srv { CustomerMessages(filter: { customerMessageID: { eq: 3166 } }) { nodes { fullMessageCustomerLanguage } } } }' });

            const [{ data }] = await reads();

            expect(data.object.id).toEqual({ ID: FREEZER_COMPRESSOR });
            expect(data.data_subject.id).toEqual({ customerId: 'C-10021' });
        });

        it('is not logged for the views of the work queue, which show no sensitive attribute of a message', async () => {
            await GET('/service/operations/CustomerMessages?$top=3');

            expect(await reads()).toEqual([]);
        });

        it('is logged for the replies of the work queue', async () => {
            await GET('/service/operations/CustomerMessageReplies?$top=1');

            const [{ data }] = await reads();

            expect(data.object.type).toBe('OperationsService.CustomerMessageReplies');
            expect(data.data_subject.id).toEqual({ customerId: 'C-10021' });
        });
    });

    describe('delivery', () => {
        /** Lets the audit log service reject (or hold) the events of one type until the returned function is called. */
        function interceptAuditLog(event, behaviour) {
            const service = cds.unqueued(auditLogService);
            const handle = service.handle;
            const spy = jest.spyOn(service, 'handle').mockImplementation(function (req) {
                return req.event === event && behaviour.active ? behaviour.run(req) : handle.call(this, req);
            });
            return spy;
        }

        let auditLogService;

        beforeAll(async () => {
            auditLogService = await auditLog();
            jest.spyOn(cds.log('persistent-queue'), 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            jest.restoreAllMocks();
            jest.spyOn(cds.log('persistent-queue'), 'error').mockImplementation(() => {});
        });

        // The audit log is outboxed: the event is written to the task queue (cds.outbox.Messages) in the
        // transaction of the request, so it is not lost when the audit log service is down for a while.
        it('is retried when the audit log cannot be reached, and the request is not affected', async () => {
            const behaviour = { active: true, run: () => Promise.reject(new Error('Audit log service unavailable')) };
            interceptAuditLog('PersonalDataModified', behaviour);

            const ID = await createMessage(); // succeeds although the audit log is down
            await deliver();
            const [waiting] = (await tasks()).filter(task => JSON.parse(task.msg).event === 'PersonalDataModified');

            expect(await modified()).toEqual([]);
            expect(waiting).toMatchObject({ attempts: 1, target: 'queue' });
            expect(JSON.parse(waiting.msg)).toMatchObject({ service: 'audit-log', data: { data_subject: { role: 'Customer' } } });
            expect(waiting.lastError).toContain('Audit log service unavailable');
            expect(await cds.db.run(SELECT.from('Benicio_1_04.CustomerMessages').where({ ID }))).toHaveLength(1);

            behaviour.active = false; // the audit log service is back
            await skipBackoff();
            await deliver();

            const events = await modified();
            expect(events).toHaveLength(1);
            expect(events[0].data.object.id).toEqual({ ID });
            expect(await tasks()).toEqual([]);
        });
    });

    describe('data subject of an event', () => {
        const event = (subject, object = { type: ENTITY, id: { ID: FREEZER_COMPRESSOR } }) => ({
            data: { data_subject: { id: subject, role: 'Customer', type: ENTITY }, object }
        });

        it('is the customer when the plugin has not found the ID', async () => {
            const req = event({});

            await useCustomerIdAsDataSubject(req);

            expect(req.data.data_subject.id).toEqual({ customerId: 'C-10021' });
        });

        it('is the customer when the plugin has used the key of the message', async () => {
            const req = event({ ID: FREEZER_COMPRESSOR }, { type: 'benicio_1_04Srv.CustomerMessageReplies', id: { ID: 'r1' } });

            await useCustomerIdAsDataSubject(req);

            expect(req.data.data_subject.id).toEqual({ customerId: 'C-10021' });
        });

        it('is left alone when it is the customer already', async () => {
            const req = event({ customerId: 'C-1' });

            await useCustomerIdAsDataSubject(req);

            expect(req.data.data_subject.id).toEqual({ customerId: 'C-1' });
        });

        it('is left alone when the message is gone, has no customer, or the event is about something else', async () => {
            const gone = event({ ID: '00000000-0000-4000-8000-000000000000' });
            const unknown = event({}, { type: 'benicio_1_04Srv.CustomerMessageReplies', id: { ID: 'r1' } });

            await useCustomerIdAsDataSubject(gone);
            await useCustomerIdAsDataSubject(unknown);
            await useCustomerIdAsDataSubject({ data: {} });

            expect(gone.data.data_subject.id).toEqual({ ID: '00000000-0000-4000-8000-000000000000' });
            expect(unknown.data.data_subject.id).toEqual({});
        });

        it('is left alone, and the problem is logged, when the database cannot be read', async () => {
            const warn = jest.spyOn(cds.log('audit-log'), 'warn').mockImplementation(() => {});
            jest.spyOn(cds.db, 'run').mockRejectedValueOnce(new Error('database unavailable'));
            const req = event({});

            await useCustomerIdAsDataSubject(req);

            expect(req.data.data_subject.id).toEqual({});
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('database unavailable'));
        });

        it('is registered once at the audit log service', async () => {
            const audit = cds.unqueued(await auditLog());
            const count = () => audit.handlers.before.filter(handler => handler.handler === useCustomerIdAsDataSubject).length;

            await require('../../srv/code/audit').register();

            expect(count()).toBe(1);
        });
    });

    it('does not change the messages: the data is the same with and without audit logging', async () => {
        const ID = await createMessage();

        const message = await cds.db.run(SELECT.one.from('Benicio_1_04.CustomerMessages').where({ ID }));

        expect(message).toMatchObject({ customerId: 'C-90001', customerName: 'Erika Mustermann', fullMessageCustomerLanguage: SECRET });
    });
});
