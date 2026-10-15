const cds = require('@sap/cds');

const { SELECT } = cds.ql;
const test = cds.test(__dirname + '/../..');
const { GET, POST, PUT, DELETE } = test;

const URL = '/service/benicio_1_04/CustomerMessages';
const ACTIVATE = 'benicio_1_04Srv.draftActivate';
const EDIT = 'benicio_1_04Srv.draftEdit';
const ANY_STATUS = { validateStatus: () => true };

const active = ID => `${URL}(ID=${ID},IsActiveEntity=true)`;
const draft = ID => `${URL}(ID=${ID},IsActiveEntity=false)`;
const attachment = (message, ID, isActive) => `${(isActive ? active : draft)(message)}/attachments(ID=${ID},IsActiveEntity=${isActive})`;

// Sample data: message 3166 has one attachment (a 70 byte PNG image).
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99';
const SAMPLE_ATTACHMENT = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d01';
const PNG_SIGNATURE = '89504e470d0a1a0a';

// Binary data that is not valid text, to prove that nothing is re-encoded
const BINARY = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x41, 0x42]);

const download = (url) => GET(url, { responseType: 'arraybuffer', validateStatus: () => true });
const storedAttachments = ID => cds.db.run(SELECT.from('Benicio_1_04.CustomerMessageAttachments').where({ message_ID: ID }));

async function addAttachmentToDraft(message, fileName, content, contentType) {
    const { status, data } = await POST(`${draft(message)}/attachments`, { fileName });
    expect(status).toBe(201);
    const upload = await PUT(`${attachment(message, data.ID, false)}/content`, content, { headers: { 'Content-Type': contentType } });
    expect(upload.status).toBe(204);
    return data.ID;
}

describe('attachments of a customer message', () => {
    beforeAll(() => {
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('download', () => {
        it('lists the metadata of an attachment without its content', async () => {
            const { data } = await GET(`${active(FREEZER_COMPRESSOR)}/attachments`);

            expect(data.value).toHaveLength(1);
            expect(data.value[0]).toMatchObject({
                ID: SAMPLE_ATTACHMENT,
                fileName: 'compressor-label.png',
                mediaType: 'image/png',
                'content@odata.mediaContentType': 'image/png'
            });
            expect(data.value[0]).not.toHaveProperty('content');
        });

        it('streams the content with its media type and as a download', async () => {
            const response = await download(`${attachment(FREEZER_COMPRESSOR, SAMPLE_ATTACHMENT, true)}/content`);

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('image/png');
            expect(response.headers['content-disposition']).toBe('attachment; filename="compressor-label.png"');
            const bytes = Buffer.from(response.data);
            expect(bytes).toHaveLength(70);
            expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
        });

        it('answers 404 for an unknown attachment', async () => {
            const response = await download(`${attachment(FREEZER_COMPRESSOR, '00000000-0000-4000-8000-000000000000', true)}/content`);

            expect(response.status).toBe(404);
        });
    });

    describe('upload', () => {
        it('stores binary content unchanged and serves it again', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const ID = await addAttachmentToDraft(FREEZER_COMPRESSOR, 'dump.jpg', BINARY, 'image/jpeg');
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            const response = await download(`${attachment(FREEZER_COMPRESSOR, ID, true)}/content`);

            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('image/jpeg');
            expect(response.headers['content-disposition']).toBe('attachment; filename="dump.jpg"');
            expect(Buffer.from(response.data).equals(BINARY)).toBe(true);
            expect(await storedAttachments(FREEZER_COMPRESSOR)).toHaveLength(2);
        });

        it('takes the media type from the Content-Type of the upload', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const ID = await addAttachmentToDraft(FREEZER_COMPRESSOR, 'note.txt', Buffer.from('Compressor is loud'), 'text/plain');
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            const { data } = await GET(attachment(FREEZER_COMPRESSOR, ID, true));
            const response = await download(`${attachment(FREEZER_COMPRESSOR, ID, true)}/content`);

            expect(data.mediaType).toBe('text/plain');
            expect(response.headers['content-type']).toMatch(/^text\/plain/);
            expect(Buffer.from(response.data).toString()).toBe('Compressor is loud');
        });

        it('uploads an attachment together with a new message', async () => {
            const { data: created } = await POST(URL, { customerMessageID: 9600 });
            const ID = await addAttachmentToDraft(created.ID, 'photo.png', Buffer.from(PNG_SIGNATURE, 'hex'), 'image/png');

            const { status } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {});
            const response = await download(`${attachment(created.ID, ID, true)}/content`);

            expect(status).toBe(201);
            expect(Buffer.from(response.data).toString('hex')).toBe(PNG_SIGNATURE);
        });

        it('replaces the content of an attachment through a draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            const { status } = await PUT(`${attachment(FREEZER_COMPRESSOR, SAMPLE_ATTACHMENT, false)}/content`, BINARY, {
                headers: { 'Content-Type': 'image/jpeg' }
            });
            expect(status).toBe(204);
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            const response = await download(`${attachment(FREEZER_COMPRESSOR, SAMPLE_ATTACHMENT, true)}/content`);

            expect(Buffer.from(response.data).equals(BINARY)).toBe(true);
        });

        it('requires a file name (@mandatory) when the message is saved', async () => {
            const { data: created } = await POST(URL, { customerMessageID: 9601, attachments: [{ mediaType: 'text/plain' }] });

            const { status, data } = await POST(`${draft(created.ID)}/${ACTIVATE}`, {}, ANY_STATUS);

            expect(status).toBe(400);
            expect(data.error.code).toBe('ASSERT_MANDATORY');
            expect(data.error.target).toMatch(/^in\/attachments\(.*\)\/fileName$/);
        });

        it('keeps an uploaded file in the draft until the message is saved', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });
            await addAttachmentToDraft(FREEZER_COMPRESSOR, 'later.txt', Buffer.from('later'), 'text/plain');

            const { data } = await GET(`${active(FREEZER_COMPRESSOR)}/attachments?$select=fileName`);

            expect(data.value.map(file => file.fileName)).toEqual(['compressor-label.png']);
        });
    });

    describe('delete', () => {
        it('deletes the attachments together with the message (cascade)', async () => {
            expect(await storedAttachments(FREEZER_COMPRESSOR)).toHaveLength(1);

            const { status } = await DELETE(active(FREEZER_COMPRESSOR));

            expect(status).toBe(204);
            expect(await storedAttachments(FREEZER_COMPRESSOR)).toHaveLength(0);
        });

        it('removes an attachment that is deleted in the draft', async () => {
            await POST(`${active(FREEZER_COMPRESSOR)}/${EDIT}`, { PreserveChanges: true });

            const { status } = await DELETE(attachment(FREEZER_COMPRESSOR, SAMPLE_ATTACHMENT, false));
            await POST(`${draft(FREEZER_COMPRESSOR)}/${ACTIVATE}`, {});

            expect(status).toBe(204);
            expect(await storedAttachments(FREEZER_COMPRESSOR)).toHaveLength(0);
        });
    });
});
