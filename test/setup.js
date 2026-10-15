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
