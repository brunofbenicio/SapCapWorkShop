const cds = require('@sap/cds');
const { startServer } = require('../helpers/server');
const examples = require('../../srv/code/query-examples');

const { SELECT, UPDATE } = cds.ql;
const test = startServer();

const NS = 'Benicio_1_04';
const MESSAGES = `${NS}.CustomerMessages`;
const REPLIES = `${NS}.CustomerMessageReplies`;
const LINKS = `${NS}.CustomerMessageTags`;
const TAGS = `${NS}.Tags`;

// Sample data (test/data): 11 messages, 3 of them with replies, 9 tag links, 6 tags
const FREEZER_COMPRESSOR = '08bb27b2-9357-4598-9ea3-6b9f8dcb6d99'; // number 3166, 2 replies, urgent-repair + warranty
const KITCHEN_FRIDGE = '5d0a8c1e-6f43-4b7a-9a2e-1c7e3b9f4a01'; // number 2101, 1 reply, delivery-delay
const DISHWASHER = '9c3f7b52-2d18-4e6c-8b0a-6a4d5e1f7c02'; // number 2102, no reply, no tag
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

const numbers = rows => rows.map(row => row.customerMessageID);
const count = async entity => (await SELECT.from(entity).columns('count(*) as total'))[0].total;
const message = ID => SELECT.one.from(MESSAGES, ID);
// The error of a promise that is expected to reject
const rejection = async promise => {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected the promise to reject');
};

describe('query examples', () => {
    beforeAll(() => {
        // Reading through a service tries to enrich the sample messages, and AI Core is not available in tests.
        jest.spyOn(cds.log('GenAI'), 'error').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => test.data.reset());

    describe('SELECT', () => {
        it('selects columns with a filter, sorting and a limit', async () => {
            const query = examples.openMessages(3);

            expect(await query).toEqual([
                { customerMessageID: 1124, customerName: 'Sophie Laurent' },
                { customerMessageID: 2101, customerName: 'Lukas Brandt' },
                { customerMessageID: 2102, customerName: 'Marie Keller' }
            ]);
            // The CQN holds the parts of the CQL: filter, sort order and paging
            expect(query.SELECT.where).toEqual([{ ref: ['status'] }, '=', { val: 'Open' }]);
            expect(query.SELECT.limit.rows).toEqual({ val: 3 });
        });

        it('selects one row, or nothing, by a business key', async () => {
            expect(await examples.messageByNumber(2101)).toMatchObject({ ID: KITCHEN_FRIDGE, customerName: 'Lukas Brandt' });
            expect(await examples.messageByNumber(999999)).toBeUndefined();
        });

        it('combines the operators in, between and like', async () => {
            expect(numbers(await examples.messagesMatching())).toHaveLength(11);
            expect(numbers(await examples.messagesMatching({ products: ['Freezer', 'Oven'] }))).toHaveLength(7);
            expect(numbers(await examples.messagesMatching({ products: ['Freezer', 'Oven'], from: 2000, to: 4000 })))
                .toEqual([2202, 2301, 3166, 3923]);
            expect(numbers(await examples.messagesMatching({ products: ['Freezer', 'Oven'], from: 2000, to: 4000, namePrefix: 'C' })))
                .toEqual([2301, 3166]);
        });

        it('binds the values of a template as parameters', async () => {
            expect(numbers(await examples.messagesByCustomerName('LU'))).toEqual([2101, 2302]);

            // A value that looks like SQL is only a value
            expect(await examples.messagesByCustomerName("x' or '1'='1")).toEqual([]);
        });

        it('expands the replies of a message', async () => {
            const withReplies = await examples.messageWithReplies(FREEZER_COMPRESSOR);
            const withoutReplies = await examples.messageWithReplies(DISHWASHER);

            expect(withReplies.customerMessageID).toBe(3166);
            expect(withReplies.replies.map(reply => reply.author)).toEqual(['Support Team', 'Support Team']);
            expect(Object.keys(withReplies.replies[0]).sort()).toEqual(['author', 'text']);
            expect(withoutReplies).toEqual({ customerMessageID: 2102, replies: [] });
        });

        it('expands through the link entity with plain CQN columns', async () => {
            const result = await examples.messageWithTagsAsCqn(FREEZER_COMPRESSOR);

            const tags = result.tags.map(link => [link.tag_code, link.tag.title]).sort();
            expect(tags).toEqual([['urgent-repair', 'Urgent repair'], ['warranty', 'Warranty']]);
        });

        it('reads a path expression in the language of the user', async () => {
            await UPDATE(MESSAGES).set({ messageCategory: 'Delivery' }).where({ customerMessageID: 2101 });
            const categoryOf2101 = rows => rows.find(row => row.customerMessageID === 2101).categoryName;

            expect(categoryOf2101(await examples.messagesWithCategoryName())).toBe('Delivery');
            expect(categoryOf2101(await cds.tx({ locale: 'de' }, tx => tx.run(examples.messagesWithCategoryName())))).toBe('Lieferung');
            // Messages without a category stay in the result
            expect(await examples.messagesWithCategoryName()).toHaveLength(11);
        });

        it('filters by a condition inside a path (exists)', async () => {
            expect(numbers(await examples.messagesTaggedWith('warranty'))).toEqual([2201, 3166]);
            expect(numbers(await examples.messagesTaggedWith('urgent-repair'))).toEqual([2301, 3166, 5896]);
            expect(await examples.messagesTaggedWith('unknown')).toEqual([]);
        });

        it('finds the messages without a reply (not exists)', async () => {
            expect(numbers(await examples.messagesWithoutReplies())).toEqual([1124, 2102, 2201, 2202, 2302, 3923, 5896, 7085]);
        });

        it('uses a sub-select in a condition', async () => {
            expect(numbers(await examples.messagesRepliedBy('Support Team'))).toEqual([2101, 2301, 3166]);
            expect(await examples.messagesRepliedBy('Nobody')).toEqual([]);
        });

        it('correlates a sub-select with the outer query through an alias', async () => {
            expect(numbers(await examples.messagesNotRepliedBy('Support Team'))).toEqual([1124, 2102, 2201, 2202, 2302, 3923, 5896, 7085]);
            expect(await examples.messagesNotRepliedBy('Nobody')).toHaveLength(11);
        });

        it('joins messages and replies', async () => {
            const rows = await examples.repliesWithMessageNumber();

            expect(rows).toEqual([
                { customerMessageID: 2101, author: 'Support Team' },
                { customerMessageID: 2301, author: 'Support Team' },
                { customerMessageID: 3166, author: 'Support Team' },
                { customerMessageID: 3166, author: 'Support Team' }
            ]);
        });

        it('groups, aggregates and filters the groups', async () => {
            await UPDATE(MESSAGES).set({ messageUrgency: 'High', messageSentiment: 'Negative' }).where({ customerMessageID: 3166 });

            expect(await examples.messagesPerProduct()).toEqual([
                { productName: 'Freezer', total: 6, highestPriority: 5 },
                { productName: 'Refrigerator', total: 2, highestPriority: 0 }
            ]);
            expect(await examples.messagesPerProduct(1)).toHaveLength(5);
            expect(await examples.messagesPerProduct(7)).toEqual([]);
        });

        it('runs the CQN of a query like any other query', async () => {
            const cqn = examples.resolvedMessagesAsCqn();
            const fluent = SELECT.from(MESSAGES).columns('customerMessageID').where({ status: 'Resolved' }).orderBy('customerMessageID');

            expect(numbers(await cds.db.run(cqn))).toEqual([2202, 2302]);
            // The fluent API builds the same CQN
            expect(cqn.SELECT.columns).toEqual(fluent.SELECT.columns);
            expect(cqn.SELECT.where).toEqual(fluent.SELECT.where);
            expect(cqn.SELECT.orderBy).toEqual(fluent.SELECT.orderBy);
        });

        it('parses CQL text into CQN', async () => {
            const cqn = examples.resolvedMessagesFromCql();

            expect(cqn.SELECT.from.ref).toEqual([MESSAGES]);
            expect(cqn.SELECT.where).toEqual([{ ref: ['status'] }, '=', { val: 'Resolved' }]);
            expect(numbers(await cds.db.run(cqn))).toEqual([2202, 2302]);
        });
    });

    describe('INSERT, UPDATE, UPSERT and DELETE', () => {
        it('inserts messages deeply, including the replies', async () => {
            const result = await examples.insertMessages({
                customerMessageID: 9001,
                customerName: 'Nora Example',
                productName: 'Oven',
                replies: [{ author: 'Support Team', text: 'We will call you.' }]
            });

            expect(result.affectedRows).toBeGreaterThan(0);
            const stored = await SELECT.one.from(MESSAGES).where({ customerMessageID: 9001 });
            expect(stored.ID).toMatch(/^[0-9a-f-]{36}$/); // generated
            expect(stored.createdAt).toBeTruthy(); // filled by the aspect managed
            expect(stored.status).toBe('Open'); // default value
            expect(await SELECT.from(REPLIES).where({ message_ID: stored.ID })).toHaveLength(1);
        });

        it('does not validate: the service layer is bypassed', async () => {
            // The service rejects a message without a number (@mandatory); the database accepts it.
            await examples.insertMessages({ customerName: 'No Number' });

            expect(await SELECT.one.from(MESSAGES).where({ customerName: 'No Number' })).toBeTruthy();
        });

        it('inserts rows for a list of columns', async () => {
            await examples.insertTagLinks(DISHWASHER, ['noise', 'warranty']);

            const links = await SELECT.from(LINKS).where({ message_ID: DISHWASHER });
            expect(links.map(link => link.tag_code).sort()).toEqual(['noise', 'warranty']);
        });

        it('rejects a tag that is already on the message (unique constraint)', async () => {
            const error = await rejection(examples.insertTagLinks(FREEZER_COMPRESSOR, ['warranty']));

            expect(error.message).toMatch(/UNIQUE constraint/);
        });

        it('updates a row by key and reports the number of changed rows', async () => {
            expect(await examples.resolveMessage(DISHWASHER, 'agent.one')).toBe(1);
            expect(await examples.resolveMessage(UNKNOWN, 'agent.one')).toBe(0);

            expect(await message(DISHWASHER)).toMatchObject({ status: 'Resolved', resolvedBy: 'agent.one' });
            expect((await message(DISHWASHER)).resolvedAt).toBeTruthy();
        });

        it('computes the new value in the database', async () => {
            await examples.appendToSummary(DISHWASHER, 'First. ');
            await examples.appendToSummary(DISHWASHER, 'Second.');

            expect((await message(DISHWASHER)).summaryEnglish).toBe('First. Second.');
        });

        it('updates many rows with a filter', async () => {
            expect(await examples.renameProduct('Freezer', 'Deep Freezer')).toBe(6);

            expect(await SELECT.from(MESSAGES).where({ productName: 'Freezer' })).toEqual([]);
            expect(await SELECT.from(MESSAGES).where({ productName: 'Deep Freezer' })).toHaveLength(6);
        });

        it('upserts: updates existing keys and inserts new ones, repeatable', async () => {
            const tags = [{ code: 'noise', title: 'Loud noise' }, { code: 'new-tag', title: 'New tag' }];

            await examples.upsertTags(tags);
            await examples.upsertTags(tags);

            const stored = await SELECT.from(TAGS).where({ code: { in: ['noise', 'new-tag'] } }).orderBy('code');
            expect(stored.map(tag => [tag.code, tag.title])).toEqual([['new-tag', 'New tag'], ['noise', 'Loud noise']]);
            expect(await count(TAGS)).toBe(7);
        });

        it('deletes rows with a filter and reports their number', async () => {
            expect(await examples.deleteRepliesOf(FREEZER_COMPRESSOR, 'Somebody Else')).toBe(0);
            expect(await examples.deleteRepliesOf(FREEZER_COMPRESSOR, 'Support Team')).toBe(2);

            expect(await count(REPLIES)).toBe(2);
        });

        it('deletes a message with its parts', async () => {
            expect(await examples.deleteMessage(FREEZER_COMPRESSOR)).toBe(1);

            expect(await message(FREEZER_COMPRESSOR)).toBeUndefined();
            expect(await SELECT.from(REPLIES).where({ message_ID: FREEZER_COMPRESSOR })).toEqual([]);
            expect(await SELECT.from(LINKS).where({ message_ID: FREEZER_COMPRESSOR })).toEqual([]);
        });
    });

    describe('transactions', () => {
        it('commits all statements of a callback together', async () => {
            await examples.replyAndResolve(DISHWASHER, { author: 'agent.one', text: 'Fixed on site.' });

            expect(await message(DISHWASHER)).toMatchObject({ status: 'Resolved', resolvedBy: 'agent.one' });
            expect(await SELECT.from(REPLIES).where({ message_ID: DISHWASHER })).toHaveLength(1);
        });

        it('rolls back all statements of a callback when one fails', async () => {
            const before = await count(REPLIES);

            const error = await rejection(examples.replyAndResolve(UNKNOWN, { author: 'agent.one', text: 'Lost.' }));

            expect(error.message).toContain('does not exist');

            // The reply was inserted before the failing check, and is gone again
            expect(await count(REPLIES)).toBe(before);
        });

        it('keeps the writes of a manual transaction on commit', async () => {
            const total = await examples.upsertTagsTransaction([{ code: 'one', title: 'One' }, { code: 'two', title: 'Two' }]);

            expect(total).toBe(8);
            expect(await count(TAGS)).toBe(8);
        });

        it('discards the writes of a manual transaction on rollback', async () => {
            const total = await examples.upsertTagsTransaction([{ code: 'one', title: 'One' }, { code: 'two', title: 'Two' }], true);

            expect(total).toBe(8); // seen inside the transaction
            expect(await count(TAGS)).toBe(6); // not stored
        });

        it('rolls back a manual transaction when a statement fails', async () => {
            // The second tag has no key
            const error = await rejection(examples.upsertTagsTransaction([{ code: 'one', title: 'One' }, { title: 'No code' }]));

            expect(error.message).toMatch(/NOT NULL|code/);

            expect(await SELECT.one.from(TAGS).where({ code: 'one' })).toBeUndefined();
        });
    });

    describe('row locking', () => {
        it('builds the lock clauses into the CQN', () => {
            expect(examples.lockMessage(DISHWASHER).SELECT.forUpdate).toEqual({});
            expect(examples.lockMessage(DISHWASHER, 'nowait').SELECT.forUpdate).toEqual({ wait: 0 });
            expect(examples.lockMessage(DISHWASHER, 'shared').SELECT.forShareLock).toBe(true);
            expect(examples.lockMessage(DISHWASHER, 'shared').SELECT.forUpdate).toBeUndefined();
        });

        it('runs the locking queries (SQLite ignores the lock)', async () => {
            for (const mode of ['exclusive', 'nowait', 'shared']) {
                const row = await cds.tx(tx => tx.run(examples.lockMessage(DISHWASHER, mode)));
                expect(row).toEqual({ ID: DISHWASHER, status: 'Open' });
            }
        });

        it('resolves a message once', async () => {
            expect(await examples.resolveOnce(DISHWASHER, 'agent.one')).toBe(true);
            expect(await examples.resolveOnce(DISHWASHER, 'agent.two')).toBe(false);
            expect(await examples.resolveOnce(UNKNOWN, 'agent.two')).toBe(false);

            expect((await message(DISHWASHER)).resolvedBy).toBe('agent.one');
        });

        it('lets only one of two parallel callers resolve the message', async () => {
            const results = await Promise.all([
                examples.resolveOnce(DISHWASHER, 'agent.one'),
                examples.resolveOnce(DISHWASHER, 'agent.two')
            ]);

            expect(results.filter(Boolean)).toHaveLength(1);
        });
    });

    describe('through a service', () => {
        const userWith = (...roles) => new cds.User({ id: 'alice.example', roles });

        it('reads the work queue for a user with the role Viewer', async () => {
            const rows = await examples.readThroughService(userWith('Viewer'));

            expect(numbers(rows)).toEqual([1124, 2101, 2102]);
        });

        it('rejects a user without the role, which the database does not', async () => {
            const error = await rejection(examples.readThroughService(userWith()));

            expect(error.code).toBe(403);

            expect(await count(MESSAGES)).toBe(11);
        });
    });
});
