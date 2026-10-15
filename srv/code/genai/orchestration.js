const cds = require('@sap/cds');
const { OrchestrationClient } = require('@sap-ai-sdk/orchestration');

const LOG = cds.log('GenAI');

// Defaults used when nothing is configured. A low temperature keeps the
// classification of category, urgency and sentiment as stable as possible.
const DEFAULT_MODEL_NAME = 'gpt-4o';
const DEFAULT_MODEL_PARAMS = { temperature: 0, max_tokens: 1500 };

/**
 * Parses the optional GENAI_MODEL_PARAMS environment variable (a JSON object).
 * Invalid values are ignored with a warning instead of breaking the request.
 */
function parseModelParamsFromEnv() {
    const raw = process.env.GENAI_MODEL_PARAMS;
    if (!raw) return {};
    let params;
    try {
        params = JSON.parse(raw);
    } catch {
        params = undefined;
    }
    if (params && typeof params === 'object' && !Array.isArray(params)) return params;
    LOG.warn('Ignoring GENAI_MODEL_PARAMS: expected a JSON object');
    return {};
}

/**
 * Resolves the LLM configuration for the orchestration service.
 *
 * Precedence for the model name (highest first):
 *   1. `options.modelName`, for example from the application settings
 *   2. environment variable GENAI_MODEL_NAME
 *   3. cds.env: `cds.genai.model`
 *   4. built-in default
 * The model parameters come from GENAI_MODEL_PARAMS (JSON), `cds.genai.modelParams`
 * and the built-in defaults, in this order.
 *
 * @param {{ modelName?: string }} [options]
 * @returns {{ model_name: string, model_params: object }}
 */
function getLlmConfig({ modelName } = {}) {
    const settings = cds.env.genai || {};
    return {
        model_name: modelName || process.env.GENAI_MODEL_NAME || settings.model || DEFAULT_MODEL_NAME,
        model_params: {
            ...DEFAULT_MODEL_PARAMS,
            ...settings.modelParams,
            ...parseModelParamsFromEnv()
        }
    };
}

/**
 * Creates an orchestration client for a single prompt template.
 * The template may contain `{{?name}}` placeholders that are filled via `inputParams`.
 */
function createOrchestrationClient(prompt, options) {
    return new OrchestrationClient({
        llm: getLlmConfig(options),
        templating: { template: [{ role: 'user', content: prompt }] }
    });
}

/**
 * Extracts the JSON object from the model output. Some models wrap the JSON
 * in a markdown code fence even when asked not to, so strip it first.
 */
function parseModelJson(content) {
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('The model returned an empty response');
    }
    const text = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    return JSON.parse(text);
}

// Preprocess customer message by categorizing, translating, and summarizing.
// Takes title and full message in customer's language and optionally the model name to use.
// Returns structured JSON with translated title and message, summaries, categories, urgency, and sentiment.

async function preprocessCustomerMessage(titleCustomerLanguage, fullMessageCustomerLanguage, options = {}) {
    const prompt = `
    Categorize the fullMessageCustomerLanguage into one of (Technical, Delivery, Service).
    Classify urgency of the fullMessageCustomerLanguage into one of (High, Medium, Low).
    Classify sentiment of the fullMessageCustomerLanguage into one of (Negative, Positive, Neutral).
    Translate fullMessageCustomerLanguage to English and put it in fullMessageEnglish.
    Summarize fullMessageCustomerLanguage into 20 words max and keep the original language and put it in summaryCustomerLanguage.
    Translate the summaryCustomerLanguage to English and put it in summaryEnglish.
    Translate the titleCustomerLanguage to English and put it in titleEnglish.
    Here is the titleCustomerLanguage and fullMessageCustomerLanguage:
    titleCustomerLanguage: {{?titleCustomerLanguage}}
    fullMessageCustomerLanguage: {{?fullMessageCustomerLanguage}}
    Return only a valid JSON object (no markdown, no comments) in the following template:
    {
        "fullMessageEnglish": "Text",
        "titleEnglish": "Text",
        "summaryCustomerLanguage": "Text",
        "summaryEnglish": "Text",
        "messageCategory": "Text",
        "messageUrgency": "Text",
        "messageSentiment": "Text"
    }`;

    try {
        const orchestrationClient = createOrchestrationClient(prompt, options);
        const response = await orchestrationClient.chatCompletion({
            inputParams: {
                titleCustomerLanguage: String(titleCustomerLanguage ?? ''),
                fullMessageCustomerLanguage: String(fullMessageCustomerLanguage ?? '')
            }
        });
        return parseModelJson(response.getContent());
    } catch (error) {
        LOG.error('Error in preprocessing:', error);
        throw new Error('Preprocessing service failed.', { cause: error });
    }
}

module.exports = {
    preprocessCustomerMessage,
    getLlmConfig,
}
