const cds = require('@sap/cds');

const DEFAULT_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE';
const DEFAULT_MAX_AGE = 600;

// The request ids are exposed to browser clients so that they can be quoted in a support request.
const EXPOSED_HEADERS = ['X-Request-ID', 'X-Correlation-ID'];

/**
 * CORS middleware, configured with `cds.cors` (package.json or the environment):
 *
 *   origins      list of the allowed origins, "*" allows every origin. Default: none, so the
 *                browser only accepts same-origin calls. Environment: CDS_CORS_ORIGINS='["https://ui.example.com"]'
 *   methods      allowed methods of a preflight request, default GET,HEAD,PUT,PATCH,POST,DELETE
 *   headers      allowed request headers of a preflight request, default: the requested ones
 *   credentials  true lets the browser send credentials (cookies, authorization) to the listed
 *                origins; it is never granted to "*"
 *   maxage       seconds the browser may cache a preflight answer, default 600
 *
 * The configuration is read for every request. It replaces the built-in CORS middleware of CAP
 * (`cds.server.cors`, which allows every origin outside production).
 *
 * @param {() => object} [getConfig] source of the configuration
 * @returns {import('express').Handler}
 */
function cors(getConfig = () => cds.env.cors) {
	return function cors_middleware(req, res, next) {
		const { origin } = req.headers;
		if (!origin) return next();

		const config = getConfig() ?? {};
		const origins = [].concat(config.origins ?? []);
		const any = origins.includes('*');
		res.vary('Origin');
		if (!any && !origins.includes(origin)) return next(); // no CORS headers: the browser refuses the answer

		res.set('Access-Control-Allow-Origin', origin);
		res.set('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));
		if (config.credentials && !any) res.set('Access-Control-Allow-Credentials', 'true');

		const preflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'];
		if (!preflight) return next();

		const headers = [].concat(config.headers ?? req.headers['access-control-request-headers'] ?? []).join(', ');
		res.set('Access-Control-Allow-Methods', [].concat(config.methods ?? DEFAULT_METHODS).join(','));
		if (headers) res.set('Access-Control-Allow-Headers', headers);
		res.set('Access-Control-Max-Age', String(config.maxage ?? DEFAULT_MAX_AGE));
		res.vary('Access-Control-Request-Headers');
		res.status(204).end();
	};
}

module.exports = { cors };
