const cds = require('@sap/cds');
const { startServer, as } = require('../helpers/server');

const { UPDATE } = cds.ql;
const test = startServer();
const { GET, POST } = test;

const SERVICE = '/service/analytics';
const ANY_STATUS = { validateStatus: () => true };
const ENTITY = 'Benicio_1_04.CustomerMessages';

// Classification as the AI would deliver it (the sample data is not classified), with the
// resulting priorityScore: urgency High 3, Medium 2, Low 1 plus sentiment Negative 2, Neutral 1.
// Message 7085 stays unclassified (score 0); 2202 and 2302 are resolved in the sample data.
const CLASSIFICATION = [
    [3166, 'France', 'Technical', 'High', 'Negative'], // 5
    [3923, 'France', 'Technical', 'Low', 'Neutral'], // 2
    [1124, 'France', 'Delivery', 'Medium', 'Positive'], // 2
    [5896, 'France', 'Technical', 'High', 'Negative'], // 5
    [2101, 'Germany', 'Delivery', 'High', 'Negative'], // 5
    [2102, 'Germany', 'Service', 'Low', 'Positive'], // 1
    [2201, 'Brazil', 'Technical', 'Medium', 'Neutral'], // 3
    [2202, 'Portugal', 'Delivery', 'Low', 'Negative'], // 3
    [2301, 'Spain', 'Technical', 'High', 'Neutral'], // 4
    [2302, 'Mexico', 'Service', 'Low', 'Positive'] // 1
];

const analytics = query => GET(`${SERVICE}/MessageAnalytics?${query}`);

/** Index the rows of an aggregation by the value of one property. */
const by = (rows, key) => Object.fromEntries(rows.map(row => [row[key], row]));

describe('AnalyticsService', () => {
    beforeEach(async () => {
        await test.data.reset();
        await Promise.all(CLASSIFICATION.map(([customerMessageID, , messageCategory, messageUrgency, messageSentiment]) =>
            cds.db.run(UPDATE(ENTITY).set({ messageCategory, messageUrgency, messageSentiment }).where({ customerMessageID }))));
    });

    describe('metadata', () => {
        it('advertises the supported transformations, groupable and aggregatable properties', async () => {
            const { data } = await GET(`${SERVICE}/$metadata`);

            expect(data).toContain('Term="Aggregation.ApplySupported"');
            expect(data).toContain('<String>groupby</String>');
            expect(data).toContain('<String>aggregate</String>');
            for (const property of ['messageCategory', 'messageUrgency', 'originatingCountry']) {
                expect(data).toContain(`<PropertyPath>${property}</PropertyPath>`);
            }
            expect(data).toContain('PropertyPath="priorityScore"');
            expect(data).toContain('<String>average</String>');
        });
    });

    describe('$apply=groupby', () => {
        it('counts the messages per category', async () => {
            const { data } = await analytics('$apply=groupby((messageCategory),aggregate($count as messages))');
            const rows = by(data.value, 'messageCategory');

            expect(data.value).toHaveLength(4);
            expect(rows.Technical.messages).toBe(5);
            expect(rows.Delivery.messages).toBe(3);
            expect(rows.Service.messages).toBe(2);
            expect(rows.null.messages).toBe(1); // not classified yet
        });

        it('counts the messages per urgency', async () => {
            const { data } = await analytics('$apply=groupby((messageUrgency),aggregate($count as messages))');
            const rows = by(data.value, 'messageUrgency');

            expect(rows.High.messages).toBe(4);
            expect(rows.Medium.messages).toBe(2);
            expect(rows.Low.messages).toBe(4);
        });

        it('counts the messages per country, sorted by the count', async () => {
            const { data } = await analytics('$apply=groupby((originatingCountry),aggregate($count as messages))&$orderby=messages desc,originatingCountry');

            expect(data.value[0]).toMatchObject({ originatingCountry: 'France', messages: 5 });
            expect(data.value[1]).toMatchObject({ originatingCountry: 'Germany', messages: 2 });
            expect(data.value.map(row => row.originatingCountry)).toEqual(['France', 'Germany', 'Brazil', 'Mexico', 'Portugal', 'Spain']);
        });

        it('groups by several properties', async () => {
            const { data } = await analytics('$apply=groupby((messageCategory,messageUrgency),aggregate($count as messages))');
            const technicalHigh = data.value.find(row => row.messageCategory === 'Technical' && row.messageUrgency === 'High');

            expect(technicalHigh.messages).toBe(3);
            expect(data.value.reduce((sum, row) => sum + row.messages, 0)).toBe(11);
        });

        it('returns the distinct values and their number without an aggregate', async () => {
            const { data } = await analytics('$apply=groupby((originatingCountry))&$count=true');

            expect(data['@odata.count']).toBe(6);
            expect(data.value).toHaveLength(6);
        });
    });

    describe('$apply=aggregate', () => {
        it('averages the priority score per country', async () => {
            const { data } = await analytics('$apply=groupby((originatingCountry),aggregate(priorityScore with average as averageScore))');
            const rows = by(data.value, 'originatingCountry');

            expect(rows.France.averageScore).toBeCloseTo(2.8); // (5 + 2 + 2 + 5 + 0) / 5
            expect(rows.Germany.averageScore).toBeCloseTo(3); // (5 + 1) / 2
            expect(rows.Spain.averageScore).toBeCloseTo(4);
        });

        it('averages the priority score per category', async () => {
            const { data } = await analytics('$apply=groupby((messageCategory),aggregate(priorityScore with average as averageScore))&$orderby=averageScore desc');

            expect(data.value.map(row => row.messageCategory)).toEqual(['Technical', 'Delivery', 'Service', null]);
            expect(data.value[0].averageScore).toBeCloseTo(3.8); // (5 + 2 + 5 + 3 + 4) / 5
            expect(data.value[1].averageScore).toBeCloseTo(10 / 3);
            expect(data.value[2].averageScore).toBeCloseTo(1);
        });

        it('returns count, minimum, maximum, sum and average of all messages in one row', async () => {
            const { data } = await analytics('$apply=aggregate($count as messages,priorityScore with min as lowest,priorityScore with max as highest,priorityScore with sum as total,priorityScore with average as average)');

            expect(data.value).toHaveLength(1);
            expect(data.value[0]).toMatchObject({ messages: 11, lowest: 0, highest: 5, total: 31 });
            expect(data.value[0].average).toBeCloseTo(31 / 11);
        });

        it('sums the count measure of the view', async () => {
            const { data } = await analytics('$apply=aggregate(messageCount with sum as messages)');

            expect(data.value[0].messages).toBe(11);
        });
    });

    describe('$apply=filter', () => {
        it('aggregates only the filtered messages', async () => {
            const { data } = await analytics("$apply=filter(status eq 'Open')/groupby((messageCategory),aggregate(messageCount with sum as open))");
            const rows = by(data.value, 'messageCategory');

            expect(rows.Technical.open).toBe(5);
            expect(rows.Delivery.open).toBe(2); // 2202 is resolved
            expect(rows.Service.open).toBe(1); // 2302 is resolved
        });

        it('counts the resolved messages per status', async () => {
            const { data } = await analytics('$apply=groupby((status),aggregate($count as messages))');
            const rows = by(data.value, 'status');

            expect(rows.Open.messages).toBe(9);
            expect(rows.Resolved.messages).toBe(2);
        });
    });

    describe('access', () => {
        it('is read-only', async () => {
            const created = await POST(`${SERVICE}/MessageAnalytics`, { customerMessageID: 1 }, ANY_STATUS);

            expect(created.status).toBe(405);
        });

        it.each([
            ['viewer', 200],
            ['agent', 200],
            ['admin', 200],
            ['stranger', 403]
        ])('%s: %i', async (user, status) => {
            const response = await GET(`${SERVICE}/MessageAnalytics?$top=1`, { ...as(user), ...ANY_STATUS });

            expect(response.status).toBe(status);
        });

        it('rejects requests without credentials', async () => {
            const response = await GET(`${SERVICE}/MessageAnalytics`, { auth: undefined, ...ANY_STATUS });

            expect(response.status).toBe(401);
        });
    });
});
