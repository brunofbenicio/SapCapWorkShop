/**
 * Maps `items` through the async `worker` while keeping at most `limit`
 * worker calls in flight at the same time.
 *
 * Results keep the order of `items`. Like Promise.all, the returned promise
 * rejects with the first error, and no new work is started after a failure.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit maximum number of concurrent worker calls (at least 1)
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    const size = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, items.length));
    let next = 0;
    let failed = false;

    async function run() {
        while (!failed && next < items.length) {
            const index = next++;
            try {
                results[index] = await worker(items[index], index);
            } catch (error) {
                failed = true;
                throw error;
            }
        }
    }

    await Promise.all(Array.from({ length: size }, run));
    return results;
}

module.exports = mapLimit;
