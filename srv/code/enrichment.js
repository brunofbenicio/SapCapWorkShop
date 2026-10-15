const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { preprocessCustomerMessage } = require('./genai/orchestration');

const LOG = cds.log('GenAI');

const ENTITY = 'Benicio_1_04.CustomerMessages';
const SETTINGS = 'Benicio_1_04.Settings';

// Fields that are derived by the GenAI preprocessing.
const AI_FIELDS = [
	'fullMessageEnglish',
	'titleEnglish',
	'summaryCustomerLanguage',
	'summaryEnglish',
	'messageCategory',
	'messageUrgency',
	'messageSentiment'
];

// AI fields that must contain one of the values of the enum type in db/schema.cds.
const ENUM_FIELDS = ['messageCategory', 'messageUrgency', 'messageSentiment'];

// A message needs preprocessing if it has a text to work on and at least one AI field is empty.
const NEEDS_PREPROCESSING = `fullMessageCustomerLanguage is not null and fullMessageCustomerLanguage != '' and (${
	AI_FIELDS.map(field => `${field} is null or ${field} = ''`).join(' or ')
})`;

// Allowed values of an enum-typed field, taken from the model so there is a single source of truth.
function enumValues(field) {
	const { CustomerMessages } = cds.entities('Benicio_1_04');
	return Object.entries(CustomerMessages.elements[field].enum).map(([name, definition]) => definition.val ?? name);
}

// Maps the answer of the model to the allowed value, ignoring case and surrounding blanks.
function toEnumValue(field, value) {
	if (typeof value !== 'string') return undefined;
	const wanted = value.trim().toLowerCase();
	return enumValues(field).find(allowed => allowed.toLowerCase() === wanted);
}

/**
 * Reads the application settings (singleton). Without a settings row the defaults apply.
 *
 * @returns {Promise<{ autoEnrichment: boolean, modelName?: string }>}
 */
async function readSettings() {
	const row = await SELECT.one.from(SETTINGS).columns('autoEnrichment', 'aiModelName');
	return {
		autoEnrichment: row?.autoEnrichment !== false,
		modelName: row?.aiModelName || undefined
	};
}

/**
 * Reads the IDs of the messages that still miss AI fields.
 *
 * @returns {Promise<string[]>}
 */
async function findIncompleteMessages() {
	const rows = await SELECT.from(ENTITY).columns('ID').where(NEEDS_PREPROCESSING);
	return rows.map(({ ID }) => ID);
}

// An error that the task queue may retry. It is a plain Error on purpose: the queue stops the whole
// application for programming errors (TypeError and the like), and a failing network call from
// the AI SDK must never do that.
function retryable(message, cause) {
	return new Error(message, { cause });
}

/**
 * Enriches one customer message with the answer of the AI model. Fails if the AI service does not
 * deliver a usable answer, so that the task queue retries it later (see EnrichmentService).
 * A message that is already complete, or that no longer exists, is left alone.
 *
 * @param {string} ID the ID of the customer message
 */
async function enrichCustomerMessage(ID) {
	const { autoEnrichment, modelName } = await readSettings();
	if (!autoEnrichment) {
		LOG.debug('Automatic enrichment is switched off in the settings');
		return;
	}

	const message = await SELECT.one.from(ENTITY)
		.columns('ID', 'titleCustomerLanguage', 'fullMessageCustomerLanguage')
		.where({ ID })
		.and(NEEDS_PREPROCESSING);
	if (!message) return;

	let result;
	try {
		// Preprocess the customer message using an external service
		result = await preprocessCustomerMessage(message.titleCustomerLanguage, message.fullMessageCustomerLanguage, { modelName });
	} catch (error) {
		throw retryable(`Error from completion service for CustomerMessage ID ${ID}: ${error.message}`, error);
	}

	// Validate the response from the preprocessing service
	const data = Object.fromEntries(AI_FIELDS.map(field => [field, result?.[field]]));
	if (AI_FIELDS.some(field => !data[field])) {
		throw retryable(`Incomplete response from completion service for CustomerMessage ID ${ID}`);
	}

	for (const field of ENUM_FIELDS) {
		const value = toEnumValue(field, data[field]);
		if (!value) {
			throw retryable(`Invalid ${field} ${JSON.stringify(data[field])} from completion service for CustomerMessage ID ${ID}`);
		}
		data[field] = value;
	}

	// Update the customer message with preprocessed data
	await UPDATE(ENTITY).set(data).where({ ID });
	LOG.info(`CustomerMessage with ID ${ID} updated`);
}

module.exports = { ENTITY, NEEDS_PREPROCESSING, readSettings, findIncompleteMessages, enrichCustomerMessage };
