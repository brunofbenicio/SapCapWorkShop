// Preprocess customer message by categorizing, translating, and summarizing.
// Takes title and full message in customer's language.
// Returns structured JSON with translated title and message, summaries, categories, urgency, and sentiment.

async function preprocessCustomerMassage(titleCustomerLanguage, fullMessageCustomerLanguage) {
    const prompt = `
    Categorize the fullMessageCustomerLanguage into one of (Technical, Delivery, Service). 
    Classify urgency of the fullMessageCustomerLanguage into one of (High, Medium, Low). 
    Classify sentiment of the fullMessageCustomerLanguage into one of (Negative, Positive, Neutral). 
    Translate fullMessageCustomerLanguage to English and put it in fullMessageEnglish.
    Summarize fullMessageCustomerLanguage into 20 words max and keep the original language and put it in summaryCustomerLanguage. 
    Translate the summaryCustomerLanguage to English and put it in summaryEnglish.
    Translate the titleCustomerLanguage to English and put it in titleEnglish. 
    Here is the titleCustomerLanguage and fullMessageCustomerLanguage:
    titleCustomerLanguage: {{?titleCustomerLanguage}}
    fullMessageCustomerLanguage: {{?fullMessageCustomerLanguage}}
    Return the result in the following JSON template:
    {
        fullMessageEnglish: Text,
        titleEnglish: Text, 
        summaryCustomerLanguage: Text, 
        summaryEnglish: Text, 
        messageCategory: Text, 
        messageUrgency: Text, 
        messageSentiment: Text
    }`;

    try {
        const orchestrationClient = await createOrchestrationClient(prompt);
        const response = await orchestrationClient.chatCompletion({
            inputParams: { titleCustomerLanguage, fullMessageCustomerLanguage }
        });
        return JSON.parse(response.getContent());
    } catch (error) {
        LOG.error('Error in preprocessing:', error);
        throw new Error('Preprocessing service failed.');
    }
}

module.exports = {
    preprocessCustomerMassage,
}
