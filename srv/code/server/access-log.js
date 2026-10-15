const cds = require('@sap/cds');

/**
 * Logs one line per request when its response is complete:
 * method, path (without the query, which may contain search terms), status, duration and request id.
 * Requests that end with a 5xx status are logged as warnings, requests that are aborted by the
 * client as well, and the health check at debug level, so the probes of the platform do not fill the log.
 *
 * @param {{ log?: object, quiet?: string[] }} [options] logger and the paths that are logged at debug level only
 * @returns {import('express').Handler}
 */
function accessLog({ log = cds.log('access'), quiet = ['/health'] } = {}) {
	return function access_log(req, res, next) {
		const start = process.hrtime.bigint();
		const path = req.originalUrl.split('?')[0];
		const describe = state => `${req.method} ${path} ${state} ${Math.round(Number(process.hrtime.bigint() - start) / 1e6)}ms [${req.id}]`;

		res.on('finish', () => {
			if (quiet.includes(path)) log.debug(describe(res.statusCode));
			else if (res.statusCode >= 500) log.warn(describe(res.statusCode));
			else log.info(describe(res.statusCode));
		});
		res.on('close', () => {
			if (!res.writableFinished) log.warn(describe('aborted'));
		});
		next();
	};
}

module.exports = { accessLog };
