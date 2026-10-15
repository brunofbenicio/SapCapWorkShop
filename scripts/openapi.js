#!/usr/bin/env node
// Writes an OpenAPI 3 document for every service that the application serves to docs/openapi/.
//
//   npm run openapi [-- <output directory>]
//
// The documents are compiled from the CDS model with @cap-js/openapi; the same compiler feeds the
// OData documents only. The REST protocol of the OperationsService is not documented here: the
// compiler describes it with the key notation of OData (/CustomerMessages({ID})), which is not
// the path of the REST adapter (/CustomerMessages/<ID>); see http/operations-rest.http. External
// services (the imported S/4HANA API) and internal ones (@protocol: 'none', the EnrichmentService)
// have no API of this application and are skipped.
const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');
const { compile } = require('@cap-js/openapi');

const DEFAULT_OUTPUT_DIRECTORY = path.resolve(__dirname, '../docs/openapi');
const LANGUAGE = 'en';

// The titles in the model are keys like "{i18n>CustomerMessages}". They are replaced by the English
// texts of db/i18n before the compilation, so the documents read "Customer Messages".
function localize(value) {
	if (typeof value === 'string') {
		const key = /^\{i18n>(.+)\}$/.exec(value)?.[1];
		return key === undefined ? value : (cds.i18n.labels.at(key, LANGUAGE) ?? value);
	}
	if (Array.isArray(value)) return value.map(localize);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, localize(entry)]));
	return value;
}

/**
 * Compiles the OpenAPI documents of all services of the project.
 *
 * @param {string} [root] project root
 * @returns {Promise<Map<string, object>>} the documents by file name without extension: the name of
 *   the service, for example "AdminService"
 */
async function compileOpenApi(root = cds.root) {
	const model = await cds.load('*', { root });
	cds.model = cds.linked(model); // the texts of the model are found through the model
	const csn = localize(model);
	const external = new Set(Object.entries(csn.definitions)
		.filter(([, definition]) => definition.kind === 'service' && definition['@cds.external'])
		.map(([name]) => name));
	for (const [name, definition] of Object.entries(csn.definitions)) {
		if (definition.kind === 'service' && definition['@protocol'] === 'none') {
			for (const other of Object.keys(csn.definitions)) if (other === name || other.startsWith(`${name}.`)) delete csn.definitions[other];
		}
	}

	const documents = new Map();
	for (const [document, { file }] of compile(csn, { service: 'all', 'openapi:diagram': false })) {
		// A service served with several protocols yields one document per protocol: <service>.<protocol>.
		const [service, protocol] = file.split('.');
		if (external.has(service) || protocol === 'rest') continue;
		documents.set(service, document);
	}
	return documents;
}

/**
 * Writes the documents of all services as <name>.openapi3.json.
 *
 * @param {string} [directory] output directory, created if needed
 * @returns {Promise<string[]>} the written files
 */
async function writeOpenApi(directory = DEFAULT_OUTPUT_DIRECTORY) {
	const documents = await compileOpenApi();
	fs.mkdirSync(directory, { recursive: true });
	return [...documents].map(([name, document]) => {
		const file = path.join(directory, `${name}.openapi3.json`);
		fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
		return file;
	});
}

module.exports = { compileOpenApi, writeOpenApi };

if (require.main === module) {
	writeOpenApi(process.argv[2] && path.resolve(process.argv[2])).then(
		files => files.forEach(file => process.stdout.write(`written ${path.relative(process.cwd(), file)}\n`)),
		error => {
			process.stderr.write(`${error.stack ?? error}\n`);
			process.exitCode = 1;
		}
	);
}
