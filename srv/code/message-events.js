const cds = require('@sap/cds');

const LOG = cds.log('events');

// Subscribers of the events that OperationsService emits. They are the place
// where downstream reactions, for example notifications, can be added.

function onMessageResolved({ data }) {
	LOG.info(`CustomerMessage ${data.customerMessageID} (${data.messageID}) was resolved by ${data.resolvedBy}`);
}

function onReplyAdded({ data }) {
	LOG.info(`${data.author} replied to CustomerMessage ${data.customerMessageID} (${data.messageID}), reply ${data.replyID}`);
}

/**
 * Registers the subscribers at the messaging service.
 *
 * @param {import('@sap/cds').Service} messaging the messaging service
 * @param {string} serviceName name of the service that emits the events
 */
function subscribe(messaging, serviceName) {
	messaging.on(`${serviceName}.MessageResolved`, onMessageResolved);
	messaging.on(`${serviceName}.ReplyAdded`, onReplyAdded);
}

module.exports = { subscribe, onMessageResolved, onReplyAdded };
