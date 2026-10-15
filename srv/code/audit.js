const cds = require('@sap/cds');

const LOG = cds.log('audit-log');

const MESSAGES = 'Benicio_1_04.CustomerMessages';

const $registered = Symbol('useCustomerIdAsDataSubject registered');

/**
 * Makes the customer the data subject of an audit event, identified by the customerId.
 *
 * The audit log plugin identifies the data subject by the keys of the entity: it leaves the ID out
 * when the customerId was not read or not changed (a read with $select, an update of the name), and
 * for replies and attachments it takes the key of the message. Auditors ask for the customer, so the
 * ID of the message is replaced by the customerId of the message. For events about a deleted message
 * this is not possible: the message is gone when the event is delivered; the event keeps its ID.
 *
 * Registered as a before handler of the audit log service, so it works for every kind of it.
 *
 * @param {import('@sap/cds').Request} req audit event, req.data.data_subject is the data subject
 */
async function useCustomerIdAsDataSubject(req) {
	const subject = req.data?.data_subject;
	if (!subject?.id || subject.id.customerId) return;

	// The message is the data subject itself, or the object that the event is about.
	const messageID = subject.id.ID ?? (req.data.object?.type === subject.type ? req.data.object.id?.ID : undefined);
	if (!messageID) return;

	try {
		const message = await cds.db.run(cds.ql.SELECT.one.from(MESSAGES).columns('customerId').where({ ID: messageID }));
		if (message?.customerId) subject.id = { customerId: message.customerId };
	} catch (error) {
		LOG.warn(`The customer of message ${messageID} could not be determined: ${error.message}`);
	}
}

/**
 * Hooks into the audit log service. A service that cannot be connected, for example in production
 * without a binding of the SAP Audit Log service, is left alone: the plugin reports that when it logs.
 */
async function register() {
	try {
		const audit = cds.unqueued(await cds.connect.to('audit-log'));
		if (audit[$registered]) return;
		audit[$registered] = true;
		audit.before('*', useCustomerIdAsDataSubject);
	} catch (error) {
		LOG.warn(`The audit log service is not available: ${error.message}`);
	}
}

module.exports = { register, useCustomerIdAsDataSubject };
