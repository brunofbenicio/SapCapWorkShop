/**
 * Examples of programmatic database access with the CAP query language.
 *
 * CQL (the language) is written in two ways in JavaScript: with the fluent API of `cds.ql`
 * (`SELECT.from(...).where(...)`) or with tagged templates (``SELECT.from `X` .where `a = ${b}` ``).
 * Both build a CQN object, the JSON form of the query that the database service turns into SQL.
 * Every example below shows the equivalent CQL in its comment. The tests in
 * test/srv/query-examples.test.js run each example against the sample data.
 *
 * How the examples are written:
 * - The functions that read and write return the query. A query is "thenable": `await query` runs it
 *   on the database (`cds.db`); `tx.run(query)` runs it in a given transaction.
 * - The functions that open a transaction are `async` and return the result.
 * - Values are always passed as arguments (`where({ status })`, `` `x = ${value}` ``), never
 *   concatenated into a string, so the database receives them as bound parameters.
 *
 * These queries go straight to the database. They do not run the service layer: no authorization
 * (@restrict), no validation (@mandatory, @assert.*), no draft handling, no events. A request
 * through a service does all that, see `readThroughService`.
 */
const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE, UPSERT, DELETE } = cds.ql;

const NAMESPACE = 'Benicio_1_04';

/** The entities of the data model, looked up when needed because the model is loaded at startup. */
const entities = () => cds.entities(NAMESPACE);

// ---------------------------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------------------------

/**
 * Columns, filter, sorting and paging.
 *
 * CQL: SELECT customerMessageID, customerName FROM Benicio_1_04.CustomerMessages
 *      WHERE status = 'Open' ORDER BY customerMessageID LIMIT 3
 *
 * @param {number} [limit] maximum number of rows
 */
function openMessages(limit = 3) {
    const { CustomerMessages } = entities();
    return SELECT.from(CustomerMessages)
        .columns('customerMessageID', 'customerName')
        .where({ status: 'Open' })
        .orderBy('customerMessageID')
        .limit(limit);
}

/**
 * One row, selected by a business key. `SELECT.one` returns the row itself, or `undefined` if there
 * is none, instead of an array.
 *
 * CQL: SELECT from Benicio_1_04.CustomerMessages WHERE customerMessageID = 2101
 *
 * @param {number} customerMessageID the number of the message
 */
function messageByNumber(customerMessageID) {
    const { CustomerMessages } = entities();
    return SELECT.one.from(CustomerMessages).where({ customerMessageID });
}

/**
 * Operators in the object syntax of `where`: a plain value means "equals", an object holds the
 * operators. Conditions in one object are combined with AND. A condition on a calculated element
 * (`priorityScore`) works like one on a stored column.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages
 *      WHERE productName IN ('Freezer', 'Oven') AND customerMessageID BETWEEN 2000 AND 4000
 *      AND customerName LIKE 'L%' ORDER BY customerMessageID
 *
 * @param {object} filter the conditions, all optional
 * @param {string[]} [filter.products] product names
 * @param {number} [filter.from] lowest message number
 * @param {number} [filter.to] highest message number
 * @param {string} [filter.namePrefix] start of the customer name
 */
function messagesMatching({ products, from, to, namePrefix } = {}) {
    const { CustomerMessages } = entities();
    const where = {};
    if (products) where.productName = { in: products };
    if (from !== undefined && to !== undefined) where.customerMessageID = { between: from, and: to };
    if (namePrefix) where.customerName = { like: `${namePrefix}%` };
    return SELECT.from(CustomerMessages).columns('customerMessageID').where(where).orderBy('customerMessageID');
}

/**
 * The same kind of query with tagged templates. Every `${...}` becomes a bound parameter, and
 * the expression itself stays readable CQL. Use `.where` with a template for conditions that the
 * object syntax cannot express, for example a function call.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages
 *      WHERE lower(customerName) LIKE ? ORDER BY customerMessageID
 *
 * @param {string} term part of a customer name, in any case
 */
function messagesByCustomerName(term) {
    const { CustomerMessages } = entities();
    return SELECT.from(CustomerMessages)
        .columns('customerMessageID')
        .where`lower(customerName) like ${`%${term.toLowerCase()}%`}`
        .orderBy('customerMessageID');
}

/**
 * Expand: a message with its replies in one result. The callback form of `columns` is a short way
 * to write the nested columns; `m.replies(...)` is the expand of the composition.
 *
 * CQL: SELECT from Benicio_1_04.CustomerMessages { customerMessageID, replies { author, text } }
 *      WHERE ID = <id>
 *
 * @param {string} ID the key of the message
 */
function messageWithReplies(ID) {
    const { CustomerMessages } = entities();
    return SELECT.one.from(CustomerMessages, ID, message => {
        message.customerMessageID;
        message.replies(reply => {
            reply.author, reply.text;
        });
    });
}

/**
 * The expand as plain CQN. This is what the callback and the CQL above are turned into: a column
 * with `expand` holds the nested columns. Nested columns are `{ ref }` objects. Use this form when
 * the columns are computed at runtime.
 *
 * @param {string} ID the key of the message
 */
function messageWithTagsAsCqn(ID) {
    const { CustomerMessages } = entities();
    return SELECT.one.from(CustomerMessages, ID).columns(
        'customerMessageID',
        { ref: ['tags'], expand: [{ ref: ['tag_code'] }, { ref: ['tag'], expand: [{ ref: ['title'] }] }] }
    );
}

/**
 * Path expressions follow associations. `category.name` reads the name of the category of each
 * message from the code list (a join that the database service adds), in the language of the
 * current user because of `localized`.
 *
 * CQL: SELECT from localized.Benicio_1_04.CustomerMessages
 *      { customerMessageID, category.name as categoryName } ORDER BY customerMessageID
 */
function messagesWithCategoryName() {
    const { CustomerMessages } = entities();
    return SELECT.localized.from(CustomerMessages)
        .columns('customerMessageID', 'category.name as categoryName')
        .orderBy('customerMessageID');
}

/**
 * A filter inside a path: `exists tags[tag.code = ?]` is true for the messages that have a link to
 * the tag. It is the right form for "has a tag"; a plain `tags.tag_code = ?` joins the links and
 * returns a message once per matching link.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages
 *      WHERE EXISTS tags[tag.code = 'warranty'] ORDER BY customerMessageID
 *
 * @param {string} code the code of the tag
 */
function messagesTaggedWith(code) {
    const { CustomerMessages } = entities();
    return SELECT.from(CustomerMessages)
        .columns('customerMessageID')
        .where`exists tags[tag.code = ${code}]`
        .orderBy('customerMessageID');
}

/**
 * `not exists` with an association: the messages nobody has replied to yet.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages
 *      WHERE NOT EXISTS replies ORDER BY customerMessageID
 */
function messagesWithoutReplies() {
    const { CustomerMessages } = entities();
    return SELECT.from(CustomerMessages)
        .columns('customerMessageID')
        .where`not exists replies`
        .orderBy('customerMessageID');
}

/**
 * Sub-select in a condition: the messages that have a reply of the given author.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages
 *      WHERE ID IN (SELECT message_ID FROM Benicio_1_04.CustomerMessageReplies WHERE author = ?)
 *
 * @param {string} author name of the author of the reply
 */
function messagesRepliedBy(author) {
    const { CustomerMessages, CustomerMessageReplies } = entities();
    const repliedMessages = SELECT.from(CustomerMessageReplies).columns('message_ID').where({ author });
    return SELECT.from(CustomerMessages)
        .columns('customerMessageID')
        .where({ ID: { in: repliedMessages } })
        .orderBy('customerMessageID');
}

/**
 * Correlated sub-select: the inner query refers to the outer one through its alias (`m`). Aliases
 * are given with `as` in the name of the entity.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages as m
 *      WHERE NOT EXISTS (SELECT from Benicio_1_04.CustomerMessageReplies as r
 *                        WHERE r.message_ID = m.ID AND r.author = ?)
 *
 * @param {string} author name of the author of the reply
 */
function messagesNotRepliedBy(author) {
    const { CustomerMessages, CustomerMessageReplies } = entities();
    const reply = SELECT.from(`${CustomerMessageReplies.name} as r`).where('r.message_ID = m.ID and r.author =', author);
    return SELECT.from(`${CustomerMessages.name} as m`)
        .columns('m.customerMessageID')
        .where('not exists', reply)
        .orderBy('m.customerMessageID');
}

/**
 * Explicit join. Use it for a relation without association; with an association a path expression
 * (`replies.author`) is shorter. The inner join returns one row per reply.
 *
 * CQL: SELECT m.customerMessageID, r.author FROM Benicio_1_04.CustomerMessages as m
 *      JOIN Benicio_1_04.CustomerMessageReplies as r ON r.message_ID = m.ID
 *      ORDER BY m.customerMessageID, r.sentAt
 */
function repliesWithMessageNumber() {
    const { CustomerMessages, CustomerMessageReplies } = entities();
    return SELECT.from(`${CustomerMessages.name} as m`)
        .join(`${CustomerMessageReplies.name} as r`)
        .on('r.message_ID = m.ID')
        .columns('m.customerMessageID', 'r.author')
        .orderBy('m.customerMessageID', 'r.sentAt');
}

/**
 * Aggregation: grouping, aggregate functions and `having`, which filters the groups. A column with
 * a function needs an alias (`as total`) to be readable in the result.
 *
 * CQL: SELECT productName, count(*) as total, max(priorityScore) as highestPriority
 *      FROM Benicio_1_04.CustomerMessages GROUP BY productName
 *      HAVING count(*) >= 2 ORDER BY total desc, productName
 *
 * @param {number} [minimum] smallest number of messages of a product that is listed
 */
function messagesPerProduct(minimum = 2) {
    const { CustomerMessages } = entities();
    return SELECT.from(CustomerMessages)
        .columns('productName', 'count(*) as total', 'max(priorityScore) as highestPriority')
        .groupBy('productName')
        .having('count(*) >=', minimum)
        .orderBy('total desc', 'productName');
}

/**
 * Query as plain CQN: the object that all of the above end up as. `cds.db.run` accepts it like
 * any other query, so a query can be stored as JSON or received from a client.
 *
 * CQL: SELECT customerMessageID FROM Benicio_1_04.CustomerMessages WHERE status = 'Resolved'
 *
 * @returns {object} the CQN
 */
function resolvedMessagesAsCqn() {
    return {
        SELECT: {
            from: { ref: [`${NAMESPACE}.CustomerMessages`] },
            columns: [{ ref: ['customerMessageID'] }],
            where: [{ ref: ['status'] }, '=', { val: 'Resolved' }],
            orderBy: [{ ref: ['customerMessageID'] }]
        }
    };
}

/**
 * CQL text turned into CQN with `cds.parse.cql`. Only use it with text that you wrote: a value
 * from outside must never be put into the text.
 *
 * @returns {object} the CQN of the query
 */
function resolvedMessagesFromCql() {
    return cds.parse.cql(
        `SELECT customerMessageID FROM ${NAMESPACE}.CustomerMessages WHERE status = 'Resolved' ORDER BY customerMessageID`
    );
}

// ---------------------------------------------------------------------------------------------
// INSERT, UPDATE, UPSERT, DELETE
// ---------------------------------------------------------------------------------------------

/**
 * INSERT of entries (objects). A deep insert writes the parts of a composition (here the replies)
 * with the message. The database service fills `createdAt`/`createdBy` (aspect `managed`).
 *
 * CQL: INSERT INTO Benicio_1_04.CustomerMessages { ID, customerMessageID, ..., replies } VALUES (...)
 *
 * @param {object|object[]} entries one or more messages
 */
function insertMessages(entries) {
    const { CustomerMessages } = entities();
    return INSERT.into(CustomerMessages).entries(entries);
}

/**
 * INSERT of rows (arrays) for a list of columns. This is the compact form for many rows of a
 * link entity.
 *
 * CQL: INSERT INTO Benicio_1_04.CustomerMessageTags (ID, message_ID, tag_code) VALUES (?, ?, ?), ...
 *
 * @param {string} messageID the key of the message
 * @param {string[]} codes the codes of the tags to put on the message
 */
function insertTagLinks(messageID, codes) {
    const { CustomerMessageTags } = entities();
    return INSERT.into(CustomerMessageTags)
        .columns('ID', 'message_ID', 'tag_code')
        .rows(codes.map(code => [cds.utils.uuid(), messageID, code]));
}

/**
 * UPDATE of one row by key, setting fields to values. It resolves to the number of changed rows,
 * so 0 means that the key does not exist.
 *
 * CQL: UPDATE Benicio_1_04.CustomerMessages SET status = 'Resolved', resolvedAt = ?, resolvedBy = ?
 *      WHERE ID = <id>
 *
 * @param {string} ID the key of the message
 * @param {string} resolvedBy who resolved the message
 */
function resolveMessage(ID, resolvedBy) {
    const { CustomerMessages } = entities();
    return UPDATE(CustomerMessages, ID).with({
        status: 'Resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy
    });
}

/**
 * UPDATE with an expression: the new value is computed from the old one in the database, so no
 * read is needed and a parallel change is not lost. With `set` and an object, values are written
 * as they are; with a template the expression is evaluated by the database.
 *
 * CQL: UPDATE Benicio_1_04.CustomerMessages SET summaryEnglish = coalesce(summaryEnglish, '') || ?
 *      WHERE ID = <id>
 *
 * @param {string} ID the key of the message
 * @param {string} text text to append to the English summary
 */
function appendToSummary(ID, text) {
    const { CustomerMessages } = entities();
    return UPDATE(CustomerMessages).set`summaryEnglish = coalesce(summaryEnglish, '') || ${text}`.where({ ID });
}

/**
 * UPDATE of many rows with a filter instead of a key.
 *
 * CQL: UPDATE Benicio_1_04.CustomerMessages SET productName = ? WHERE productName = ?
 *
 * @param {string} from the old product name
 * @param {string} to the new product name
 */
function renameProduct(from, to) {
    const { CustomerMessages } = entities();
    return UPDATE(CustomerMessages).set({ productName: to }).where({ productName: from });
}

/**
 * UPSERT: updates the row of an existing key and inserts the others. The sequence of the statements
 * does not matter, so it is safe to run the same data again (idempotent).
 *
 * CQL: UPSERT INTO Benicio_1_04.Tags { code, title } VALUES (...)
 *
 * @param {{code: string, title: string}[]} tags the tags to create or update
 */
function upsertTags(tags) {
    const { Tags } = entities();
    return UPSERT.into(Tags).entries(tags);
}

/**
 * DELETE with a filter. It resolves to the number of deleted rows.
 *
 * CQL: DELETE FROM Benicio_1_04.CustomerMessageReplies WHERE message_ID = <id> AND author = ?
 *
 * @param {string} messageID the key of the message
 * @param {string} author name of the author whose replies are deleted
 */
function deleteRepliesOf(messageID, author) {
    const { CustomerMessageReplies } = entities();
    return DELETE.from(CustomerMessageReplies).where({ message_ID: messageID, author });
}

/**
 * DELETE by key. The database service deletes the parts of the message (replies, attachments and
 * tag links, they are compositions) with it.
 *
 * CQL: DELETE FROM Benicio_1_04.CustomerMessages WHERE ID = <id>
 *
 * @param {string} ID the key of the message
 */
function deleteMessage(ID) {
    const { CustomerMessages } = entities();
    return DELETE.from(CustomerMessages, ID);
}

// ---------------------------------------------------------------------------------------------
// Transactions and locking
// ---------------------------------------------------------------------------------------------

/**
 * Transaction with a callback. `cds.tx(fn)` commits when the function resolves and rolls back when
 * it throws, so the reply is stored only if the message could be resolved.
 *
 * Only use `tx.run(...)` inside the callback: a query that is run another way is not part of the
 * transaction. Do not start requests to the same application while the transaction is open, the
 * in-memory SQLite database of the tests has one connection and waits for it.
 *
 * @param {string} ID the key of the message
 * @param {{author: string, text: string}} reply the reply to store
 * @returns {Promise<void>} rejects, and stores nothing, if the message does not exist
 */
async function replyAndResolve(ID, { author, text }) {
    const { CustomerMessageReplies } = entities();
    await cds.tx(async tx => {
        await tx.run(INSERT.into(CustomerMessageReplies).entries({ message_ID: ID, author, text }));
        const changed = await tx.run(resolveMessage(ID, author));
        if (!changed) throw new Error(`Message ${ID} does not exist`);
    });
}

/**
 * Transaction with explicit commit and rollback, for a flow where the decision is made at the
 * end. This one writes the tags and, in a dry run, rolls back to show what would change.
 *
 * @param {{code: string, title: string}[]} tags the tags to create or update
 * @param {boolean} [dryRun] roll back instead of commit
 * @returns {Promise<number>} the number of tags after the upsert, as seen in the transaction
 */
async function upsertTagsTransaction(tags, dryRun = false) {
    const { Tags } = entities();
    const tx = cds.tx();
    try {
        await tx.run(upsertTags(tags));
        const [{ total }] = await tx.run(SELECT.from(Tags).columns('count(*) as total'));
        if (dryRun) await tx.rollback();
        else await tx.commit();
        return total;
    } catch (error) {
        await tx.rollback(error);
        throw error;
    }
}

/**
 * Pessimistic locking. `forUpdate()` locks the selected rows until the end of the transaction, so a
 * parallel transaction that reads them with a lock waits. `wait: 0` fails at once instead of waiting
 * (NOWAIT), `forShareLock()` allows other readers but blocks writers.
 *
 * The lock exists on SAP HANA only. SQLite has no row locks: it accepts the clause and ignores it,
 * so the tests can only check the CQN and the result, not the locking.
 *
 * CQL: SELECT from Benicio_1_04.CustomerMessages WHERE ID = <id> FOR UPDATE [WAIT 0 | FOR SHARE LOCK]
 *
 * @param {string} ID the key of the message
 * @param {'exclusive'|'nowait'|'shared'} [mode] the kind of lock
 */
function lockMessage(ID, mode = 'exclusive') {
    const { CustomerMessages } = entities();
    const query = SELECT.one.from(CustomerMessages, ID).columns('ID', 'status');
    if (mode === 'shared') return query.forShareLock();
    return query.forUpdate(mode === 'nowait' ? { wait: 0 } : undefined);
}

/**
 * Read, decide and write under a lock. Without the lock two agents could read "Open" at the same
 * time and both resolve the message. With it the second one waits for the first one and then sees
 * "Resolved".
 *
 * @param {string} ID the key of the message
 * @param {string} resolvedBy who resolves the message
 * @returns {Promise<boolean>} true if this call resolved the message, false if it was resolved
 *   before or does not exist
 */
async function resolveOnce(ID, resolvedBy) {
    return cds.tx(async tx => {
        const message = await tx.run(lockMessage(ID));
        if (message?.status !== 'Open') return false;
        await tx.run(resolveMessage(ID, resolvedBy));
        return true;
    });
}

// ---------------------------------------------------------------------------------------------
// Through a service
// ---------------------------------------------------------------------------------------------

/**
 * The same query through a service. The service checks the @restrict annotations for the user, so
 * a user without the role Viewer is rejected with a 403 error, and a draft-enabled or projected
 * entity behaves like it does for an OData request. `service.tx({ user }, fn)` runs the function
 * as that user. Without a user, the current request's user is used.
 *
 * @param {cds.User} user the user to run as
 * @returns {Promise<object[]>} the first messages of the work queue
 */
function readThroughService(user) {
    const operations = cds.services.OperationsService;
    return operations.tx({ user }, tx => tx.run(
        SELECT.from('OperationsService.CustomerMessages').columns('customerMessageID').orderBy('customerMessageID').limit(3)
    ));
}

module.exports = {
    openMessages,
    messageByNumber,
    messagesMatching,
    messagesByCustomerName,
    messageWithReplies,
    messageWithTagsAsCqn,
    messagesWithCategoryName,
    messagesTaggedWith,
    messagesWithoutReplies,
    messagesRepliedBy,
    messagesNotRepliedBy,
    repliesWithMessageNumber,
    messagesPerProduct,
    resolvedMessagesAsCqn,
    resolvedMessagesFromCql,
    insertMessages,
    insertTagLinks,
    resolveMessage,
    appendToSummary,
    renameProduct,
    upsertTags,
    deleteRepliesOf,
    deleteMessage,
    replyAndResolve,
    upsertTagsTransaction,
    lockMessage,
    resolveOnce,
    readThroughService
};
