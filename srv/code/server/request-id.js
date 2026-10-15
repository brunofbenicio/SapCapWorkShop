const cds = require('@sap/cds');

// Ids that are taken over from the caller: short and free of characters that could forge a log line.
const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// Headers that may carry an id, in the order of precedence. X-Vcap-Request-Id is set by the
// Cloud Foundry router.
const ID_HEADERS = ['x-request-id', 'x-correlation-id', 'x-vcap-request-id'];

/**
 * Gives every request an id: the id sent by the caller (X-Request-ID, X-Correlation-ID or the
 * id of the Cloud Foundry router) if it is a plausible one, otherwise a new UUID.
 *
 * The id is
 *  - available as `req.id` for the following middlewares,
 *  - returned in the response header X-Request-ID,
 *  - handed to CAP as X-Correlation-ID, so that it becomes `cds.context.id` and CAP returns it
 *    as the response header X-Correlation-ID. Both headers carry the same id.
 *
 * @returns {import('express').Handler}
 */
function requestId() {
	return function request_id(req, res, next) {
		const incoming = ID_HEADERS.map(name => req.headers[name]).find(value => typeof value === 'string' && VALID_ID.test(value));
		const id = incoming ?? cds.utils.uuid();
		req.id = id;
		req.headers['x-correlation-id'] = id;
		res.set('X-Request-ID', id);
		next();
	};
}

module.exports = { requestId, VALID_ID };
