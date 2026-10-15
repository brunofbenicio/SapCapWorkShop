// Deliberately wrong code. It is not part of jsconfig.json; test/srv/typed-example.test.js type-checks
// it and expects exactly the errors on the lines marked ERROR, to show that the generated types
// find mistakes.
const { findMessage, openMessagesWithUrgency, describeMessage } = require('../../srv/code/typed-example');

async function wrong() {
    const message = await findMessage(2101);
    const typo = message?.customerNmae; // ERROR: no such element
    const text = describeMessage({ customerMessageID: 'abc', customerName: 'x', productName: 'y' }); // ERROR: the number is a string
    const rows = await openMessagesWithUrgency('Urgent'); // ERROR: not a value of MessageUrgency
    return [typo, text, rows];
}

module.exports = { wrong };
