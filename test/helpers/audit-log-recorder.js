const AuditLogService = require('@cap-js/audit-logging/srv/service');

/**
 * Audit log service of the test profile (cds.requires.audit-log in package.json). Instead of
 * writing the events to the console or to the SAP Audit Log service, it keeps them in `recorded`,
 * for the tests to look at. Use `recorded(event)` of test/helpers/audit.js.
 */
module.exports = class AuditLogRecorder extends AuditLogService {
    async init() {
        this.recorded = [];
        this.on('*', req => {
            this.recorded.push({ event: req.event, data: req.data });
        });
        await super.init();
    }
};
