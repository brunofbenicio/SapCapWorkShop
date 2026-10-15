const cds = require('@sap/cds');
const { benicio_1_04Srv } = require('../service');

const LOG = cds.log('service-orders');

// The remote service with the service orders of SAP S/4HANA, see cds.requires in package.json.
const SERVICE_ORDER_SERVICE = 'S4HCP_ServiceOrder_Odata';

const MAX_ATTACHMENT_MB = 5;
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/plain'];

/**
 * benicio_1_04Srv with additional input validation. It extends the class that SAP Build Code
 * generates in srv/service.js (which must not be edited) and is plugged in via srv/service-handlers.cds.
 * The messages are keys of srv/_i18n/messages*.properties.
 */
module.exports = class CustomerMessagesService extends benicio_1_04Srv {
	async init() {
		this.on('markAsResolved', 'CustomerMessages', req => this.resolveMessage(req));
		this.on('READ', 'A_ServiceOrder', req => this.readServiceOrders(req));
		this.before('*', req => this.checkGraphQLReadOnly(req));
		this.before('SAVE', 'CustomerMessages', req => this.checkMessage(req));
		this.before(['NEW', 'UPDATE'], 'CustomerMessageAttachments.drafts', req => this.checkUpload(req));
		return super.init();
	}

	// The action markAsResolved of the app is the action of the work queue: the OperationsService sets the
	// status and emits the event MessageResolved. It runs in the transaction of this request, as the same user.
	async resolveMessage(req) {
		const { ID } = req.params.at(-1);
		const operations = await cds.connect.to('OperationsService');
		await operations.tx(req).send({ event: 'markAsResolved', entity: 'OperationsService.CustomerMessages', params: [{ ID }], data: req.data });

		const message = await this.run(cds.ql.SELECT.one.from(req.subject));
		req.info({ message: 'MESSAGE_RESOLVED', args: [message.customerMessageID] });
		return message;
	}

	// The service orders are not stored here: reads are passed on to the S/4HANA service (a destination in
	// production, a local mock with the data of srv/external/data in development and tests).
	async readServiceOrders(req) {
		try {
			const remote = await cds.connect.to(SERVICE_ORDER_SERVICE);
			return await remote.run(req.query);
		} catch (error) {
			// A wrong request (4xx) is the caller's problem, everything else means the remote system is not available.
			const status = error.status ?? error.statusCode;
			if (status >= 400 && status < 500) throw error;
			LOG.error(`Reading the service orders failed: ${error.message}`);
			return req.reject(502, 'SERVICE_ORDERS_UNAVAILABLE');
		}
	}

	// Messages are created and changed in drafts, which the GraphQL adapter cannot activate (it has no
	// actions) and which a direct GraphQL update would bypass. So GraphQL may only read this service.
	checkGraphQLReadOnly(req) {
		if (req.event === 'READ' || !req.http?.req) return;
		if (req.http.req.baseUrl === (cds.env.protocols?.graphql?.path ?? '/graphql')) req.reject(405, 'GRAPHQL_READ_ONLY');
	}

	// Called when a draft is saved (activated), also for new messages
	async checkMessage(req) {
		const { SELECT } = cds.ql;
		const { ID, customerMessageID, tags = [] } = req.data;

		if (customerMessageID != null) {
			const clash = await SELECT.one.from('Benicio_1_04.CustomerMessages')
				.columns('ID')
				.where({ customerMessageID, ID: { '!=': ID } });
			if (clash) req.error({ status: 409, message: 'MESSAGE_ID_NOT_UNIQUE', target: 'in/customerMessageID', args: [customerMessageID] });
		}

		const seen = new Set();
		for (const { ID: linkID, tag_code } of tags) {
			if (seen.has(tag_code)) {
				req.error({ status: 400, message: 'TAG_DUPLICATE', target: `in/tags(ID=${linkID},IsActiveEntity=false)/tag_code`, args: [tag_code] });
			}
			seen.add(tag_code);
		}
	}

	// Called when the content of an attachment is uploaded. Only the declared size can be
	// checked here; a chunked upload without Content-Length is limited by the platform.
	checkUpload(req) {
		if (!req.data.content) return;
		const mediaType = String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
		if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
			return req.reject(415, 'ATTACHMENT_TYPE_NOT_ALLOWED', [mediaType, ALLOWED_MEDIA_TYPES.join(', ')]);
		}
		if (Number(req.headers['content-length']) > MAX_ATTACHMENT_MB * 1024 * 1024) {
			return req.reject(413, 'ATTACHMENT_TOO_LARGE', [MAX_ATTACHMENT_MB]);
		}
	}
};
