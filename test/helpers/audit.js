const cds = require('@sap/cds');

/** The recording audit log service of the test profile (see audit-log-recorder.js). */
const auditLog = () => cds.connect.to('audit-log');

/**
 * Waits until the audit events of the finished requests have been delivered. The audit log is
 * outboxed: the events are written to the task queue in the transaction of the request and
 * delivered by the queue afterwards.
 */
const deliver = async () => cds.queued(await auditLog()).flush();

/** Forgets the events recorded so far, including the ones of earlier requests that are still on their way. */
const forget = async () => {
    await deliver();
    (await auditLog()).recorded.length = 0;
};

/**
 * The recorded events, oldest first.
 * @param {string} [event] only the events of this type, for example PersonalDataModified
 * @returns {Promise<Array<{ event: string, data: object }>>}
 */
const recorded = async event => {
    await deliver();
    const { recorded: events } = await auditLog();
    return event ? events.filter(each => each.event === event) : [...events];
};

module.exports = { auditLog, deliver, forget, recorded };
