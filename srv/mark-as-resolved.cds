using { benicio_1_04Srv } from './service.cds';

// The app of the agents can resolve a message, like the work queue (OperationsService.markAsResolved).
// The action is bound to the saved message (not to a draft); the handler passes it on to the
// OperationsService, which sets the status and emits the event MessageResolved.
extend benicio_1_04Srv.CustomerMessages with actions
{
    /** Closes the message. Fails with 409 if it is already resolved. */
    action markAsResolved(resolution : String(1000)) returns benicio_1_04Srv.CustomerMessages;
};
