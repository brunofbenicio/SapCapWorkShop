const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.resolve(__dirname, '../..');

// The mocked users of the development profile, see cds.requires.auth in package.json.
// Any other name logs in as an authenticated user without roles.
const USERS = require('../../package.json').cds.requires.auth['[development]'].users;

/**
 * Request config (for GET, POST, ...) that logs in as a mocked user.
 *
 * @param {string} user viewer, agent, admin or any other name
 */
const as = user => ({ auth: { username: user, password: USERS[user]?.password ?? '' } });

/**
 * Starts the application like cds.test() does, with the required services mocked like `cds watch`
 * does (the S/4HANA service orders come from srv/external/data, no network is needed). All
 * requests are sent as the given user unless a request uses its own config, for example
 * `GET(url, as('viewer'))`.
 *
 * @param {string} [user] default user, an administrator unless stated otherwise
 */
function startServer(user = 'admin') {
    const test = cds.test(ROOT, '--with-mocks');
    test.defaults.auth = as(user).auth;
    return test;
}

module.exports = { startServer, as, USERS };
