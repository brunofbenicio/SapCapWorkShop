// Custom server of the application: cds-serve (npm start), cds watch and the tests load this file
// instead of the default server and add the following behavior to the standard bootstrap of CAP.
const cds = require('@sap/cds');
const { requestId } = require('./code/server/request-id');
const { accessLog } = require('./code/server/access-log');
const { cors } = require('./code/server/cors');
const { createLifecycle } = require('./code/server/lifecycle');
const audit = require('./code/audit');

const LOG = cds.log('server');

// Milliseconds the shutdown waits for the requests in progress, cds.server.drain_timeout in package.json.
const DEFAULT_DRAIN_TIMEOUT = 10000;

// A cheap query on the database tells whether the application can work.
const lifecycle = createLifecycle({
	check: async () => {
		if (cds.db) await cds.db.run(cds.ql.SELECT.one.from('Benicio_1_04.Settings').columns('ID'));
	}
});

// The middlewares are added before the ones of CAP (authentication, protocol adapters), so
// they also see the requests that CAP rejects.
cds.on('bootstrap', app => {
	app.use(requestId());
	app.use(lifecycle.track());
	app.use(accessLog());
	app.use(cors());
	// The health check is public and comes before the authentication; it replaces the simple
	// one of CAP, which only answers UP.
	app.get('/health', lifecycle.health());
});

cds.on('served', async services => {
	await audit.register();
	const names = Object.values(services).filter(service => service.endpoints?.length).map(service => service.name);
	LOG.info(`Ready: ${names.length} services are served (${names.join(', ')})`);
});

// Called for SIGTERM and SIGINT (for example when Cloud Foundry stops an instance) and after an
// uncaught error. The server is closed after the requests in progress are done.
cds.on('shutdown', reason => lifecycle.shutdown(cds.env.server?.drain_timeout ?? DEFAULT_DRAIN_TIMEOUT, reason));

module.exports = cds.server;
