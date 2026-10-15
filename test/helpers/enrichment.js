const cds = require('@sap/cds');

const { SELECT } = cds.ql;

const TASKS = 'cds.outbox.Messages';

/**
 * Switches the GenAI enrichment on for the tests of a file. The test profile switches it off
 * (cds.genai.enabled in package.json), so that reads of the sample messages neither call the AI
 * nor fill the task queue.
 */
function enableEnrichment() {
    cds.env.genai = { ...cds.env.genai, enabled: true };
}

/** The queue of the EnrichmentService. */
const queue = async () => cds.queued(await cds.connect.to('EnrichmentService'));

/** Waits until the queue has processed all tasks that are due; a task that failed waits for its back-off. */
const settle = async () => (await queue()).flush();

/** All entries of the queue table, oldest first. It is shared by all queued services, for example the audit log. */
const tasks = () => cds.db.run(SELECT.from(TASKS).orderBy('timestamp', 'ID'));

/**
 * Only the enrichment tasks (`enrich-<ID>`). The audit log events of a read (SensitiveDataRead) stay in
 * the table until they are delivered, so a test that counts enrichment tasks must not use tasks().
 */
const enrichmentTasks = () => cds.db.run(SELECT.from(TASKS).where({ task: { like: 'enrich-%' } }).orderBy('timestamp', 'ID'));

/** Lets the back-off of the failed tasks pass: the next settle() retries them. */
const skipBackoff = () => cds.db.run(cds.ql.UPDATE(TASKS).set({ lastAttemptTimestamp: '2000-01-01T00:00:00.000Z' }));

module.exports = { enableEnrichment, settle, tasks, enrichmentTasks, skipBackoff, TASKS };
