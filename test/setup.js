// The telemetry plugin (@cap-js/telemetry) prints the traces of every request to the console in
// development. It is switched off for the tests; test/srv/telemetry.test.js starts the application
// in a separate process to test it. This must happen before the plugin is loaded.
process.env.NO_TELEMETRY = 'true';

// Safety net for all tests: they must never reach SAP AI Core. Any call to the
// orchestration service fails fast. Tests that need AI output replace this mock
// (for example by mocking srv/code/genai/orchestration).
jest.mock('@sap-ai-sdk/orchestration', () => ({
    OrchestrationClient: class {
        async chatCompletion() {
            throw new Error('SAP AI Core is not available in tests');
        }
    }
}));
