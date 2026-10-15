/**
 * Internal service that enriches one customer message with the answer of the GenAI model.
 * It is not served over HTTP (@protocol: 'none'). The READ of the customer messages puts one
 * task per incomplete message into the persistent task queue (cds.queued); the queue calls
 * this service outside of the request and retries a failed task with an exponential back-off
 * (cds.requires.queue in package.json: maxAttempts, chunkSize). The tasks are stored in the
 * table cds.outbox.Messages, so they survive a restart.
 */
@protocol : 'none'
service EnrichmentService
{
    /**
     * Enriches the customer message. Fails, and is retried by the queue, when the AI service does
     * not deliver a usable answer. A message that is complete or deleted is ignored.
     */
    action enrichMessage(ID : UUID);
}
