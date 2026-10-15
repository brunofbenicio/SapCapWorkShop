// Reads the request files in http/*.http (VS Code REST Client and IntelliJ HTTP Client syntax)
// and runs their requests against the application under test, so the examples cannot go stale.
//
// Supported subset of the syntax:
//   @name = value            file variable, used as {{name}}
//   ### title                starts a request
//   # expect: 200            expected status of the request (not part of the HTTP client syntax)
//   METHOD url [HTTP/1.1]    request line
//   Name: value              header lines, followed by an empty line and the body
//   # text or // text        comment
//   Authorization: Basic <user> <password> is sent as HTTP basic authentication.
const fs = require('fs');
const path = require('path');

const HTTP_DIR = path.resolve(__dirname, '../../http');
const REQUEST_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/;
const COMMENT = /^\s*(#|\/\/)/;

/** The names of the request files in http/. */
const httpFiles = () => fs.readdirSync(HTTP_DIR).filter(name => name.endsWith('.http')).sort();

/**
 * Parses the content of a request file.
 *
 * @param {string} text content of the file
 * @returns {{ variables: object, requests: Array<{ title: string, expect?: number, method: string, url: string, headers: object, body?: string }> }}
 */
function parseHttpFile(text) {
    const variables = {};
    const requests = [];
    let current;

    const startRequest = title => {
        current = { title, headers: {}, bodyLines: [], state: 'before' };
        requests.push(current);
    };

    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('###')) {
            startRequest(line.slice(3).trim());
            continue;
        }
        const variable = /^@(\w+)\s*=\s*(.*)$/.exec(line);
        if (variable && (!current || current.state === 'before')) {
            variables[variable[1]] = variable[2].trim();
            continue;
        }
        if (!current) continue;

        if (current.state === 'before' || current.state === 'headers') {
            const expect = /^\s*#\s*expect:\s*(\d{3})\s*$/.exec(line);
            if (expect) current.expect = Number(expect[1]);
            if (COMMENT.test(line) || (!line.trim() && current.state === 'before')) continue;
        }
        if (current.state === 'before') {
            const request = REQUEST_LINE.exec(line);
            if (!request) throw new Error(`Request "${current.title}": expected a request line, got "${line}"`);
            [, current.method, current.url] = request;
            current.state = 'headers';
        } else if (current.state === 'headers') {
            if (!line.trim()) current.state = 'body';
            else {
                const colon = line.indexOf(':');
                current.headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
            }
        } else {
            current.bodyLines.push(line);
        }
    }

    return {
        variables,
        requests: requests.map(({ title, expect, method, url, headers, bodyLines }) => {
            const body = bodyLines.join('\n').trim();
            return { title, expect, method, url, headers, ...(body && { body }) };
        })
    };
}

const substitute = (text, variables) => text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in variables)) throw new Error(`Variable ${match} is not defined`);
    return variables[name];
});

/**
 * Turns a parsed request into an axios request config for the application under test.
 * The host of the file is replaced by the base URL of the test server.
 *
 * @param {object} request an entry of parseHttpFile().requests
 * @param {object} variables the file variables
 */
function toAxiosConfig(request, variables) {
    const host = variables.host ?? '';
    const url = substitute(request.url, variables);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, substitute(value, variables)]));

    // Without an Authorization header the request is anonymous: auth must be undefined, otherwise
    // the default user of the test would be added.
    let auth;
    if (headers.Authorization) {
        const basic = /^Basic\s+([^\s:]+)[\s:]+(\S+)$/.exec(headers.Authorization);
        if (!basic) throw new Error(`Request "${request.title}": only "Authorization: Basic <user> <password>" is supported`);
        auth = { username: basic[1], password: basic[2] };
        delete headers.Authorization;
    }

    const contentType = headers['Content-Type'] ?? headers['content-type'];
    const data = request.body === undefined ? undefined
        : /json/.test(contentType ?? '') ? JSON.parse(substitute(request.body, variables)) : substitute(request.body, variables);

    return { method: request.method, url: url.replace(host, ''), headers, auth, data, validateStatus: () => true };
}

module.exports = { HTTP_DIR, httpFiles, parseHttpFile, toAxiosConfig };
