/**
 * Example of typed CAP code in plain JavaScript, with the types that @cap-js/cds-typer generates from
 * the CDS model.
 *
 * Generate the types with `npm run types` (`cds watch` does it at startup if they are missing). They
 * are written to @cds-models, which is not committed. The package.json entry `imports` maps
 * `#cds-models/*` to that folder, so the code can import the generated module of a namespace or
 * a service: `require('#cds-models/Benicio_1_04')`. The editor shows the elements of an entity
 * and the checker finds a wrong element name in a result or a wrong value of an enum:
 * `npm run typecheck` runs the TypeScript compiler over this file (jsconfig.json). The checks are for
 * the editor and the tests; the code still runs as plain JavaScript. The conditions of a query
 * (`where`) are not checked against the entity.
 *
 * The application does not load this file. It only shows the usage; test/srv/typed-example.test.js
 * runs it and checks its types.
 */
const cds = require('@sap/cds');
const { CustomerMessages } = require('#cds-models/Benicio_1_04');

const { SELECT } = cds.ql;

/** @typedef {import('#cds-models/Benicio_1_04').CustomerMessage} CustomerMessage */
/** @typedef {import('#cds-models/Benicio_1_04').MessageUrgency} MessageUrgency */

/**
 * Reads a message by its number. The generated class `CustomerMessages` is the entity: it names
 * the table for the query and gives the type of the result.
 *
 * @param {number} customerMessageID the number of the message
 * @returns {Promise<CustomerMessage | null>} the message, or null if there is none
 */
async function findMessage(customerMessageID) {
    const message = await SELECT.one.from(CustomerMessages).where({ customerMessageID });
    return message ?? null;
}

/**
 * Reads the open messages of an urgency, most recent first. The urgency is one of the values of the
 * enum `MessageUrgency`: 'High', 'Medium' or 'Low'.
 *
 * @param {MessageUrgency} urgency the urgency to look for
 * @returns {Promise<CustomerMessage[]>} the open messages
 */
async function openMessagesWithUrgency(urgency) {
    return SELECT.from(CustomerMessages)
        .where({ status: 'Open', messageUrgency: urgency })
        .orderBy('createdAt desc');
}

/**
 * Describes a message in one line, for a log or a notification. Only the elements that the text uses
 * are required, so a partial row from a `$select` fits as well.
 *
 * @param {Pick<CustomerMessage, 'customerMessageID' | 'customerName' | 'productName' | 'messageUrgency'>} message
 * @returns {string} for example `#2101 Lukas Brandt (Refrigerator), urgency High`
 */
function describeMessage({ customerMessageID, customerName, productName, messageUrgency }) {
    const urgency = messageUrgency ?? 'not classified';
    return `#${customerMessageID} ${customerName} (${productName}), urgency ${urgency}`;
}

module.exports = { findMessage, openMessagesWithUrgency, describeMessage };
