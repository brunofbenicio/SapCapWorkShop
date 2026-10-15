const cds = require('@sap/cds');
const { enrichCustomerMessage } = require('./code/enrichment');

module.exports = class EnrichmentService extends cds.ApplicationService {
	async init() {
		this.on('enrichMessage', req => enrichCustomerMessage(req.data.ID));
		return super.init();
	}
};
