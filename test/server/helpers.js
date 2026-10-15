const axios = require('axios');

/** Starts an express app on a free port. @returns {Promise<{ url: string, get: Function, request: Function, close: Function }>} */
async function listen(app) {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const request = config => axios.request({ baseURL: url, validateStatus: () => true, ...config });
    return {
        url,
        request,
        get: (path, config) => request({ url: path, ...config }),
        close: () => new Promise(resolve => {
            server.closeAllConnections?.();
            server.close(resolve);
        })
    };
}

module.exports = { listen };
