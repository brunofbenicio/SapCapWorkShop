const cds = require('@sap/cds');
const { benicio_1_04Srv } = require('../service');

const MAX_ATTACHMENT_MB = 5;
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/plain'];

/**
 * benicio_1_04Srv with additional input validation. It extends the class that SAP Build Code
 * generates in srv/service.js (which must not be edited) and is plugged in via srv/service-handlers.cds.
 * The messages are keys of srv/_i18n/messages*.properties.
 */
module.exports = class CustomerMessagesService extends benicio_1_04Srv {
	async init() {
		this.before('SAVE', 'CustomerMessages', req => this.checkMessage(req));
		this.before(['NEW', 'UPDATE'], 'CustomerMessageAttachments.drafts', req => this.checkUpload(req));
		return super.init();
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
