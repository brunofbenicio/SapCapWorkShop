const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { preprocessCustomerMessage } = require('./genai/orchestration');
const mapLimit = require('./util/map-limit');

const LOG = cds.log('GenAI');

const ENTITY = 'Benicio_1_04.CustomerMessages';

// Maximum number of AI calls running at the same time for one request.
// Can be changed with `cds.genai.concurrency`.
const DEFAULT_CONCURRENCY = 3;

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

// A message needs preprocessing if it has a text to work on and at least one AI field is empty.
const NEEDS_PREPROCESSING = `fullMessageCustomerLanguage is not null and fullMessageCustomerLanguage != '' and (${
	AI_FIELDS.map(field => `${field} is null or ${field} = ''`).join(' or ')
})`;

async function enrichCustomerMessage({ ID, titleCustomerLanguage, fullMessageCustomerLanguage }) {
	let result;
	try {
		// Preprocess the customer message using an external service
		result = await preprocessCustomerMessage(titleCustomerLanguage, fullMessageCustomerLanguage);
	} catch (error) {
		LOG.error(`Error from completion service for CustomerMessage ID ${ID}: ${error.message}`);
		return;  // Skip this message and proceed to the next
	}

	// Validate the response from the preprocessing service
	const data = Object.fromEntries(AI_FIELDS.map(field => [field, result?.[field]]));
	if (AI_FIELDS.some(field => !data[field])) {
		LOG.error(`Incomplete response from completion service for CustomerMessage ID ${ID}`);
		return;  // Skip this message and proceed to the next
	}

	try {
		// Update the customer message with preprocessed data
		await UPDATE(ENTITY).set(data).where({ ID });
		LOG.info(`CustomerMessage with ID ${ID} updated`);
	} catch (updateError) {
		LOG.error(`Error updating CustomerMessage ID ${ID}: ${updateError.message}`);
	}
}

module.exports = async function(request) {
	let customerMessages;
	try {
		// Fetch only the customer messages that still miss AI-derived fields. No row locks are taken.
		customerMessages = await SELECT
			.from(ENTITY)
			.columns('ID', 'titleCustomerLanguage', 'fullMessageCustomerLanguage')
			.where(NEEDS_PREPROCESSING);
	} catch (error) {
		LOG.error('Failed to retrieve customer messages', error.message);
		return request.reject(500, 'Failed to retrieve customer messages');
	}

	if (!customerMessages.length) return;

	// Process the customer messages with a bounded number of parallel AI calls
	const concurrency = cds.env.genai?.concurrency ?? DEFAULT_CONCURRENCY;
	await mapLimit(customerMessages, concurrency, enrichCustomerMessage);
}
