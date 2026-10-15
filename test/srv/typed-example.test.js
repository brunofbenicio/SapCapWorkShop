const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');

const { UPDATE } = cds.ql;

const ROOT = path.resolve(__dirname, '../..');
const TSC = require.resolve('typescript/bin/tsc');
const WRONG_USAGE = path.join(ROOT, 'test/types/wrong-usage.js');
const MESSAGES = 'Benicio_1_04.CustomerMessages';

/** Runs a command in the project folder; resolves with the exit code and the output, also on failure. */
const run = (command, args) => new Promise(resolve => {
    execFile(command, args, { cwd: ROOT, timeout: 90000 }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code ?? 1 : 0, output: `${stdout}${stderr}` });
    });
});

const test = startServer();

describe('typed code with @cap-js/cds-typer', () => {
    let example;

    beforeAll(async () => {
        // The types are generated, not committed (@cds-models is ignored by git), so a clean checkout has none.
        const typer = await run('npm', ['run', 'types']);
        expect(typer.code).toBe(0);

        // The example imports the generated module, so it can only be loaded after the generation.
        example = require('../../srv/code/typed-example');
    }, 120000);

    beforeEach(() => test.data.reset());

    describe('generated types', () => {
        it('has no type errors in the example', async () => {
            const { code, output } = await run(process.execPath, [TSC, '-p', 'jsconfig.json']);

            expect(output).toBe('');
            expect(code).toBe(0);
        }, 120000);

        it('finds the mistakes in code that uses the types wrongly', async () => {
            const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-example-'));
            const config = path.join(folder, 'tsconfig.json');
            fs.writeFileSync(config, JSON.stringify({ extends: path.join(ROOT, 'jsconfig.json'), include: [WRONG_USAGE] }));
            const expected = fs.readFileSync(WRONG_USAGE, 'utf8').split('\n')
                .flatMap((line, index) => (line.includes('// ERROR') ? [index + 1] : []));

            const { code, output } = await run(process.execPath, [TSC, '-p', config]);
            fs.rmSync(folder, { recursive: true });

            const reported = [...output.matchAll(/wrong-usage\.js\((\d+),\d+\): error/g)].map(match => Number(match[1]));
            expect(code).not.toBe(0);
            expect(expected).toHaveLength(3);
            expect(reported).toEqual(expected);
            expect(output).toContain("Property 'customerNmae' does not exist on type 'CustomerMessage'");
            expect(output).toContain(`Argument of type '"Urgent"' is not assignable to parameter of type 'MessageUrgency'`);
        }, 120000);

        it('generates the enums of the model as constants', () => {
            const { MessageUrgency, MessageStatus } = require('#cds-models/Benicio_1_04');

            expect(MessageUrgency).toEqual({ High: 'High', Medium: 'Medium', Low: 'Low' });
            expect(MessageStatus).toEqual({ Open: 'Open', Resolved: 'Resolved' });
        });
    });

    describe('example', () => {
        it('finds a message by its number', async () => {
            expect(await example.findMessage(2101)).toMatchObject({ customerName: 'Lukas Brandt', productName: 'Refrigerator' });
            expect(await example.findMessage(999999)).toBeNull();
        });

        it('finds the open messages of an urgency, most recent first', async () => {
            expect(await example.openMessagesWithUrgency('High')).toEqual([]);
            await cds.db.run(UPDATE(MESSAGES).set({ messageUrgency: 'High' }).where({ customerMessageID: { in: [2101, 2102, 2202] } }));
            await cds.db.run(UPDATE(MESSAGES).set({ createdAt: '2025-01-02T00:00:00Z' }).where({ customerMessageID: 2101 }));
            await cds.db.run(UPDATE(MESSAGES).set({ createdAt: '2025-01-03T00:00:00Z' }).where({ customerMessageID: 2102 }));

            const messages = await example.openMessagesWithUrgency('High');

            // 2202 is resolved
            expect(messages.map(message => message.customerMessageID)).toEqual([2102, 2101]);
        });

        it('describes a message in one line', () => {
            const row = { customerMessageID: 2101, customerName: 'Lukas Brandt', productName: 'Refrigerator' };

            expect(example.describeMessage({ ...row, messageUrgency: 'High' })).toBe('#2101 Lukas Brandt (Refrigerator), urgency High');
            expect(example.describeMessage(row)).toBe('#2101 Lukas Brandt (Refrigerator), urgency not classified');
        });
    });
});
