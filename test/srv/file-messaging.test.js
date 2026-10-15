const fs = require('fs');
const os = require('os');
const path = require('path');

// Use the file-based messaging of the development profile, but with a temporary
// message box and a short polling interval. This must be set before cds loads its configuration.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-msg-box-'));
const messageBox = path.join(directory, 'messages');
process.env.CDS_REQUIRES_MESSAGING_KIND = 'file-based-messaging';
process.env.CDS_REQUIRES_MESSAGING_FILE = messageBox;
process.env.CDS_REQUIRES_MESSAGING_INTERVAL = '50';

const cds = require('@sap/cds');

const test = cds.test(__dirname + '/../..');
const { POST } = test;

const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // 3166, open

// Waits until the condition is true; the subscribers run asynchronously after the message box was polled.
async function eventually(condition, timeout = 10000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeout) throw new Error('Timeout: the event was not delivered');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

describe('file-based messaging (development profile)', () => {
    const eventLog = cds.log('events');

    beforeAll(() => {
        jest.spyOn(eventLog, 'info').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('is the configured messaging kind', () => {
        expect(cds.env.requires.messaging).toMatchObject({ kind: 'file-based-messaging', file: messageBox });
    });

    it('delivers an event through the message box to the subscriber', async () => {
        const { status } = await POST(
            `/service/operations/CustomerMessages(ID=${FREEZER_COMPRESSOR})/OperationsService.markAsResolved`,
            { resolution: 'Compressor replaced' }
        );
        expect(status).toBe(200);

        await eventually(() => eventLog.info.mock.calls.length > 0);

        expect(eventLog.info).toHaveBeenCalledWith(`CustomerMessage 3166 (${FREEZER_COMPRESSOR}) was resolved by privileged`);
        expect(fs.existsSync(messageBox)).toBe(true);
    });
});
