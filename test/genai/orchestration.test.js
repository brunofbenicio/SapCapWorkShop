const path = require('path');
const cds = require('@sap/cds');

// The SAP AI SDK is mocked: no network access or AI Core binding is needed.
const mockChatCompletion = jest.fn();
const mockConstructor = jest.fn();

jest.mock('@sap-ai-sdk/orchestration', () => ({
    OrchestrationClient: class {
        constructor(config) {
            mockConstructor(config);
        }
        chatCompletion(...args) {
            return mockChatCompletion(...args);
        }
    }
}));

const { preprocessCustomerMessage, getLlmConfig } = require('../../srv/code/genai/orchestration');

const LOG = cds.log('GenAI');

const MODEL_RESULT = {
    fullMessageEnglish: 'The freezer compressor is broken.',
    titleEnglish: 'Defective compressor',
    summaryCustomerLanguage: 'Le compresseur est en panne.',
    summaryEnglish: 'The compressor is broken.',
    messageCategory: 'Technical',
    messageUrgency: 'High',
    messageSentiment: 'Negative'
};

function respondWith(content) {
    mockChatCompletion.mockResolvedValue({ getContent: () => content });
}

describe('GenAI orchestration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.GENAI_MODEL_NAME;
        delete process.env.GENAI_MODEL_PARAMS;
        delete cds.env.genai;
        jest.spyOn(LOG, 'error').mockImplementation(() => {});
        jest.spyOn(LOG, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('preprocessCustomerMessage', () => {
        it('sends the prompt template and input params and returns the parsed JSON', async () => {
            respondWith(JSON.stringify(MODEL_RESULT));

            const result = await preprocessCustomerMessage('Compresseur défectueux', 'Le compresseur ne marche plus.');

            expect(result).toEqual(MODEL_RESULT);
            expect(mockChatCompletion).toHaveBeenCalledWith({
                inputParams: {
                    titleCustomerLanguage: 'Compresseur défectueux',
                    fullMessageCustomerLanguage: 'Le compresseur ne marche plus.'
                }
            });

            const [config] = mockConstructor.mock.calls[0];
            expect(config.llm).toEqual({ model_name: 'gpt-4o', model_params: { temperature: 0, max_tokens: 1500 } });
            expect(config.templating.template).toHaveLength(1);
            expect(config.templating.template[0].role).toBe('user');
            expect(config.templating.template[0].content).toContain('{{?titleCustomerLanguage}}');
            expect(config.templating.template[0].content).toContain('{{?fullMessageCustomerLanguage}}');
        });

        it('accepts JSON wrapped in a markdown code fence', async () => {
            respondWith('```json\n' + JSON.stringify(MODEL_RESULT) + '\n```');

            await expect(preprocessCustomerMessage('t', 'm')).resolves.toEqual(MODEL_RESULT);
        });

        it('replaces missing inputs by empty strings', async () => {
            respondWith(JSON.stringify(MODEL_RESULT));

            await preprocessCustomerMessage(undefined, null);

            expect(mockChatCompletion).toHaveBeenCalledWith({
                inputParams: { titleCustomerLanguage: '', fullMessageCustomerLanguage: '' }
            });
        });

        it('fails with a stable error when the model does not return JSON', async () => {
            respondWith('Sorry, I cannot help with that.');

            await expect(preprocessCustomerMessage('t', 'm')).rejects.toThrow('Preprocessing service failed.');
            expect(LOG.error).toHaveBeenCalled();
        });

        it('fails with a stable error when the model returns nothing', async () => {
            respondWith(undefined);

            await expect(preprocessCustomerMessage('t', 'm')).rejects.toThrow('Preprocessing service failed.');
        });

        it('fails with a stable error and keeps the cause when the SDK call fails', async () => {
            const failure = new Error('connect ECONNREFUSED');
            mockChatCompletion.mockRejectedValue(failure);

            const error = await preprocessCustomerMessage('t', 'm').catch(e => e);

            expect(error.message).toBe('Preprocessing service failed.');
            expect(error.cause).toBe(failure);
            expect(LOG.error).toHaveBeenCalled();
        });
    });

    describe('prompt', () => {
        // The prompt must offer exactly the values that db/schema.cds allows.
        it.each([
            ['messageCategory', 'MessageCategory'],
            ['messageUrgency', 'MessageUrgency'],
            ['messageSentiment', 'MessageSentiment']
        ])('lists the values of the enum type of %s', async (_, type) => {
            respondWith(JSON.stringify(MODEL_RESULT));
            const model = await cds.load(path.join(__dirname, '../../db/schema.cds'));
            const values = Object.keys(model.definitions[`Benicio_1_04.${type}`].enum);

            await preprocessCustomerMessage('t', 'm');

            const [config] = mockConstructor.mock.calls[0];
            expect(config.templating.template[0].content).toContain(`(${values.join(', ')})`);
        });
    });

    describe('getLlmConfig', () => {
        it('uses sensible defaults', () => {
            expect(getLlmConfig()).toEqual({
                model_name: 'gpt-4o',
                model_params: { temperature: 0, max_tokens: 1500 }
            });
        });

        it('reads the model and params from cds.env', () => {
            cds.env.genai = { model: 'gpt-4.1-mini', modelParams: { max_tokens: 800 } };

            expect(getLlmConfig()).toEqual({
                model_name: 'gpt-4.1-mini',
                model_params: { temperature: 0, max_tokens: 800 }
            });
        });

        it('lets environment variables override cds.env', () => {
            cds.env.genai = { model: 'gpt-4.1-mini', modelParams: { max_tokens: 800 } };
            process.env.GENAI_MODEL_NAME = 'gemini-2.0-flash';
            process.env.GENAI_MODEL_PARAMS = '{"temperature":0.2}';

            expect(getLlmConfig()).toEqual({
                model_name: 'gemini-2.0-flash',
                model_params: { temperature: 0.2, max_tokens: 800 }
            });
        });

        it('ignores GENAI_MODEL_PARAMS that is not a JSON object', () => {
            process.env.GENAI_MODEL_PARAMS = 'not json';
            expect(getLlmConfig().model_params).toEqual({ temperature: 0, max_tokens: 1500 });

            process.env.GENAI_MODEL_PARAMS = '[1,2]';
            expect(getLlmConfig().model_params).toEqual({ temperature: 0, max_tokens: 1500 });

            expect(LOG.warn).toHaveBeenCalledTimes(2);
        });
    });
});
