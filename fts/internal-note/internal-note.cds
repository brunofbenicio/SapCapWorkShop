using { Benicio_1_04 as my } from '../../db/schema';

// Feature toggle "internal-note": tenants with the feature get a field for notes of the agents that
// the customer never sees. Activated per tenant (cds.requires.auth.tenants in the multitenancy
// profile in development, the feature vector of the tenant in production).
extend my.CustomerMessages with {
    internalNote : String(500);
};
