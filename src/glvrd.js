'use babel';

var XMLHttpRequest = require('xhr2');

function makeTimestamp() {
    return Math.ceil((new Date()).getTime() / 1000);
}

class Glavred {

    constructor(app) {
        this.app = app;
        this.session = null;
        this.sessionExpireTime = null;
        this.cache = {};
        this.max_text_length = 0;
        this.max_hints_count = 0;
    }

    /**
     * AJAX fetch implementation.
     * @param url
     * @param data
     * @param method
     * @returns {Promise}
     */
    fetch(url, data, method) {
        return new Promise((resolve, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.open(method || "GET", url);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = function () {
                if (this.status >= 200 && this.status < 300) {
                    let json = JSON.parse(xhr.response);
                    if (json.status == 'ok') {
                        resolve(json);
                    }
                    else {
                        reject(json);
                    }
                } else {
                    reject({
                        status: 'error',
                        code: 'network_error',
                        statusText: xhr.statusText
                    });
                }
            };
            xhr.onerror = function () {
                reject({
                    status: 'error',
                    code: 'network_error',
                    statusText: xhr.statusText
                });
            };
            let post_data;
            if (method == "POST") {
                post_data = Glavred.urlEncode(data);
            }
            xhr.send(post_data);
        });
    }

    /**
     * Prepare data for POST request.
     * @param data
     * @returns {string}
     */
    static urlEncode(data) {
        let body = [], field;
        for (field in data) {
            if (data.hasOwnProperty(field)) {
                body.push(field + '=' + encodeURI(data[field]));
            }
        }
        return body.join('&');
    }

    /**
     * Constructs API uri.
     * @param operation
     * @returns {string}
     */
    getApiURL(operation) {
        let base = 'https://api.glvrd.ru/v2/' + operation + '/';
        let params = [];

        if (this.app) {
            params.push('app=' + this.app);
        }
        if (this.hasValidSession()) {
            params.push('session=' + this.session);
        }

        return base + '?' + params.join('&');
    }

    /**
     *
     * @returns {boolean}
     */
    hasValidSession() {
        return Boolean(this.session && this.sessionExpireTime > makeTimestamp());
    }

    /**
     * Loads new session.
     * @returns {Promise}
     */
    getSession() {
        let timestamp = makeTimestamp();
        return this.fetch(this.getApiURL('session'), {}, "POST").then((response)=> {
            this.session = response.session;
            // TODO: replace 3600 with lifespan once API is updated.
            this.sessionExpireTime = timestamp + 3600;
            return Promise.resolve(response);
        });
    }

    /**
     * Ensures that current session is valid and requests new one if not.
     * @returns {Promise}
     */
    checkSession() {
        return new Promise((resolve, reject) => {
            if (!this.hasValidSession()) {
                this.getSession()
                    .then((response) => resolve(response))
                    .catch((response) => reject(response));
            }
            else {
                resolve({status: 'ok', session: this.session, cached: true});
            }
        });
    }

    /**
     * Checks Glavred service status.
     * @returns {Promise}
     */
    getStatus() {
        return this.fetch(this.getApiURL('status'), {}, "GET").then((response) => {
            this.handleStatusResponse(response);
            return Promise.resolve(response);
        });
    }

    /**
     * Updates current session.
     * @returns {Promise}
     */
    postStatus() {
        return this.checkSession().then(() => {
            let timestamp = makeTimestamp();
            return this.fetch(this.getApiURL('status'), {}, "POST").then((response) => {
                this.handleStatusResponse(response);
                // TODO: replace 3600 with lifespan once API is updated.
                this.sessionExpiration = timestamp + 3600;
                return Promise.resolve(response);
            });
        });
    }

    /**
     * Updates limits returned by service.
     */
    handleStatusResponse(response) {
        this.max_text_length = response.max_text_length;
        this.max_hints_count = response.max_hints_count;
    }

    /**
     * Check a text with Glavred.
     * @param text
     * @param doNotDecorate Used for testing.
     * @returns {Promise}
     */
    proofread(text, doNotDecorate) {
        // TODO: caching && max_text_length
        return this.checkSession().then((response) => {
            return this.fetch(this.getApiURL('proofread'), {text: text}, "POST").then((response)=> {
                response.text = text;
                if (doNotDecorate) {
                    return Promise.resolve(response)
                }
                else {
                    response.score = this.getScore(response);
                    return this.decorateHints(response);
                }
            });
        });
    }

    /**
     * Check a text with Glavred.
     * @param response
     * @returns {Promise}
     */
    decorateHints(response) {
        return new Promise((resolve, reject) => {
            let ids = [], needsUpdate = [];
            for (let i = 0; i < response.fragments.length; i++) {
                let fragment = response.fragments[i];
                let hint = this.getHint(fragment.hint_id);
                if (hint) {
                    fragment.hint = hint;
                }
                else {
                    ids.push(fragment.hint_id);
                    needsUpdate.push(fragment);
                }
            }

            if (!ids.length) {
                resolve(response);
            }
            else {
                this.getHints(ids).then((hints) => {
                    for (let i = 0; i < needsUpdate.length; i++) {
                        needsUpdate[i].hint = hints[needsUpdate[i].hint_id];
                    }
                    resolve(response);
                });
            }
        });
    }

    /**
     * Get a single hint from cache.
     * @param id
     * @returns {*}
     */
    getHint(id) {
        let cache = this.cache[this.session];
        if (cache) {
            return cache[id];
        }
    }

    /**
     * Save a hint to the cache.
     * @param id
     * @param hint
     * @returns {*}
     */
    cacheHint(id, hint) {
        this.cache[this.session] = this.cache[this.session] || {};
        this.cache[this.session]['hints'] = this.cache[this.session]['hints'] || {};
        this.cache[this.session]['hints'][id] = hint;
    }

    /**
     * Load hint descriptions from Glavred.
     * @param ids Array of hint ids.
     * @returns {Promise}
     */
    getHints(ids) {
        // TODO: max_hints_count
        return this.checkSession().then((response) => {
            return this.fetch(this.getApiURL('hints'), {ids: ids.join(',')}, "POST").then((response)=> {
                for (let hint_id in response.hints) {
                    this.cacheHint(hint_id, response.hints[hint_id]);
                }
                return Promise.resolve(response.hints)
            });
        });
    }

    /**
     * Calculate score for the given proofreading results.
     * @param proofreadResults Either one or array of results of proofreading responses.
     * @returns {number}
     */
    getScore(proofreadResults) {
        if (Object.prototype.toString.call(proofreadResults) !== '[object Array]') {
            proofreadResults = [proofreadResults];
        }

        let word_regexp = /[А-Яа-яA-Za-z0-9-]+([^А-Яа-яA-Za-z0-9-]+)?/g;
        let letters = 0, penalty = 0, fragments_count = 0;

        for (let i = 0; i < proofreadResults.length; i++) {
            var text = proofreadResults[i].text.trim();
            letters += text ? text.replace(word_regexp, ".").length : 0;
            var fragments = proofreadResults[i].fragments;
            fragments_count += fragments.length;
            for (var j = 0; j < fragments.length; j++) {
                var fragment = fragments[j];
                fragment.hint && fragment.hint.penalty && (penalty += fragment.hint.penalty)
            }
        }

        if (letters == 0) {
            return 0;
        }

        var score = Math.floor(100 * Math.pow(1 - fragments_count / letters, 3)) - penalty;
        score = Math.min(Math.max(score, 0), 100);
        score % 10 == 0 ? score /= 10 : score = parseFloat((score / 10).toFixed(1));
        return score;
    }
}

export default Glavred;