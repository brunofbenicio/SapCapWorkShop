const mapLimit = require('../../srv/code/util/map-limit');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('mapLimit', () => {
    it('returns the results in the order of the items', async () => {
        const result = await mapLimit([30, 1, 10], 3, async ms => {
            await sleep(ms);
            return ms * 2;
        });

        expect(result).toEqual([60, 2, 20]);
    });

    it('never runs more workers than the limit', async () => {
        let running = 0;
        let maxRunning = 0;

        await mapLimit([...Array(10).keys()], 3, async () => {
            maxRunning = Math.max(maxRunning, ++running);
            await sleep(5);
            running--;
        });

        expect(maxRunning).toBe(3);
    });

    it('passes the index to the worker', async () => {
        const indexes = [];
        await mapLimit(['a', 'b', 'c'], 2, async (item, index) => indexes.push([item, index]));

        expect(indexes.sort()).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    });

    it('handles an empty list', async () => {
        const worker = jest.fn();

        await expect(mapLimit([], 3, worker)).resolves.toEqual([]);
        expect(worker).not.toHaveBeenCalled();
    });

    it.each([0, -1, NaN, undefined])('falls back to one worker for the invalid limit %p', async limit => {
        let running = 0;
        let maxRunning = 0;

        await mapLimit([1, 2, 3], limit, async () => {
            maxRunning = Math.max(maxRunning, ++running);
            await sleep(1);
            running--;
        });

        expect(maxRunning).toBe(1);
    });

    it('rejects with the first error and starts no further work', async () => {
        const worker = jest.fn(async item => {
            if (item === 2) throw new Error('boom');
            await sleep(5);
        });

        await expect(mapLimit([1, 2, 3, 4, 5, 6], 1, worker)).rejects.toThrow('boom');
        expect(worker).toHaveBeenCalledTimes(2);
    });
});
