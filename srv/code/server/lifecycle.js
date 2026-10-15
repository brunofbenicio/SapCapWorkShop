const cds = require('@sap/cds');

const LOG = cds.log('server');

const DEFAULT_CHECK_TIMEOUT = 2000;

/**
 * Keeps track of the requests in progress and of the state of the server, for the health
 * check and the graceful shutdown.
 *
 * @param {{ check?: () => Promise<unknown>, checkTimeout?: number }} [options]
 *   check: tests that the dependencies work (rejects if not); checkTimeout: milliseconds the check may take
 */
function createLifecycle({ check = async () => {}, checkTimeout = DEFAULT_CHECK_TIMEOUT } = {}) {
	let active = 0;
	let shuttingDown = false;
	let idle = [];

	const requestEnded = () => {
		active--;
		if (active === 0) {
			for (const resolve of idle) resolve(true);
			idle = [];
		}
	};

	return {
		/** Counts the requests in progress. @returns {import('express').Handler} */
		track() {
			return function track_requests(req, res, next) {
				active++;
				res.once('close', requestEnded);
				next();
			};
		},

		/**
		 * Health check for the platform: 200 {"status":"UP"} while the server works, 503 {"status":"DOWN"}
		 * if the check fails or the server is shutting down. Details go to the log, not to the caller.
		 * @returns {import('express').Handler}
		 */
		health() {
			return async function health(req, res) {
				if (shuttingDown) return res.status(503).json({ status: 'DOWN' });
				let timer;
				try {
					await Promise.race([
						check(),
						new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${checkTimeout} ms`)), checkTimeout); })
					]);
					res.json({ status: 'UP' });
				} catch (error) {
					LOG.error('Health check failed:', error.message);
					res.status(503).json({ status: 'DOWN' });
				} finally {
					clearTimeout(timer);
				}
			};
		},

		/** Number of requests in progress. */
		get active() { return active; },

		/** True after shutdown() was called. */
		get shuttingDown() { return shuttingDown; },

		/**
		 * Starts the shutdown: the health check answers 503 from now on, then waits until the requests in
		 * progress are finished, at most `timeout` milliseconds.
		 *
		 * @param {number} timeout maximum time to wait for the requests in progress
		 * @param {unknown} [reason] signal or error that caused the shutdown, for the log
		 * @returns {Promise<boolean>} true if all requests were finished, false if the time was up
		 */
		async shutdown(timeout, reason) {
			shuttingDown = true;
			const why = reason instanceof Error ? ` after an error: ${reason.message}` : '';
			LOG.info(`Shutting down${why}; ${active} request(s) in progress`);
			if (active === 0) return LOG.info('Shutdown: no request in progress'), true;

			let timer;
			const finished = await Promise.race([
				new Promise(resolve => idle.push(resolve)),
				new Promise(resolve => { timer = setTimeout(() => resolve(false), timeout); timer.unref(); })
			]);
			clearTimeout(timer);
			if (finished) LOG.info('Shutdown: all requests are finished');
			else LOG.warn(`Shutdown: ${active} request(s) still in progress after ${timeout} ms, they are cut off`);
			return finished;
		}
	};
}

module.exports = { createLifecycle };
