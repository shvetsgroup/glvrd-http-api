(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(['module', 'exports', 'xhr2'], factory);
    } else if (typeof exports !== "undefined") {
        factory(module, exports, require('xhr2'));
    } else {
        var mod = {
            exports: {}
        };
        factory(mod, mod.exports, global.XMLHttpRequest);
        global.Glavred = mod.exports;
    }
})(this, function (module, exports, XMLHttpRequest) {
    'use strict';
    'use babel';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    function makeTimestamp() {
        return Math.ceil(new Date().getTime() / 1000);
    }

    var Glavred = function () {
        function Glavred(app) {
            _classCallCheck(this, Glavred);

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


        _createClass(Glavred, [{
            key: 'fetch',
            value: function fetch(url, data, method) {
                return new Promise(function (resolve, reject) {
                    var xhr = new XMLHttpRequest();
                    xhr.open(method || "GET", url);
                    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                    xhr.onload = function () {
                        if (this.status >= 200 && this.status < 300) {
                            var json = JSON.parse(xhr.response);
                            if (json.status == 'ok') {
                                resolve(json);
                            } else {
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
                    var post_data = void 0;
                    if (method == "POST") {
                        post_data = Glavred.urlEncode(data);
                    }
                    xhr.send(post_data);
                });
            }
        }, {
            key: 'getApiURL',
            value: function getApiURL(operation) {
                var base = 'https://api.glvrd.ru/v2/' + operation + '/';
                var params = [];

                if (this.app) {
                    params.push('app=' + this.app);
                }
                if (this.hasValidSession()) {
                    params.push('session=' + this.session);
                }

                return base + '?' + params.join('&');
            }
        }, {
            key: 'hasValidSession',
            value: function hasValidSession() {
                return Boolean(this.session && this.sessionExpireTime > makeTimestamp());
            }
        }, {
            key: 'getSession',
            value: function getSession() {
                var _this = this;

                var timestamp = makeTimestamp();
                return this.fetch(this.getApiURL('session'), {}, "POST").then(function (response) {
                    _this.session = response.session;
                    // TODO: replace 3600 with lifespan once API is updated.
                    _this.sessionExpireTime = timestamp + 3600;
                    return Promise.resolve(response);
                });
            }
        }, {
            key: 'checkSession',
            value: function checkSession() {
                var _this2 = this;

                return new Promise(function (resolve, reject) {
                    if (!_this2.hasValidSession()) {
                        _this2.getSession().then(function (response) {
                            return resolve(response);
                        }).catch(function (response) {
                            return reject(response);
                        });
                    } else {
                        resolve({ status: 'ok', session: _this2.session, cached: true });
                    }
                });
            }
        }, {
            key: 'getStatus',
            value: function getStatus() {
                var _this3 = this;

                return this.fetch(this.getApiURL('status'), {}, "GET").then(function (response) {
                    _this3.handleStatusResponse(response);
                    return Promise.resolve(response);
                });
            }
        }, {
            key: 'postStatus',
            value: function postStatus() {
                var _this4 = this;

                return this.checkSession().then(function () {
                    var timestamp = makeTimestamp();
                    return _this4.fetch(_this4.getApiURL('status'), {}, "POST").then(function (response) {
                        _this4.handleStatusResponse(response);
                        // TODO: replace 3600 with lifespan once API is updated.
                        _this4.sessionExpiration = timestamp + 3600;
                        return Promise.resolve(response);
                    });
                });
            }
        }, {
            key: 'handleStatusResponse',
            value: function handleStatusResponse(response) {
                this.max_text_length = response.max_text_length;
                this.max_hints_count = response.max_hints_count;
            }
        }, {
            key: 'proofread',
            value: function proofread(text, doNotDecorate) {
                var _this5 = this;

                // TODO: caching && max_text_length
                return this.checkSession().then(function (response) {
                    return _this5.fetch(_this5.getApiURL('proofread'), { text: text }, "POST").then(function (response) {
                        response.text = text;
                        if (doNotDecorate) {
                            return Promise.resolve(response);
                        } else {
                            response.score = _this5.getScore(response);
                            return _this5.decorateHints(response);
                        }
                    });
                });
            }
        }, {
            key: 'decorateHints',
            value: function decorateHints(response) {
                var _this6 = this;

                return new Promise(function (resolve, reject) {
                    var ids = [],
                        needsUpdate = [];
                    for (var i = 0; i < response.fragments.length; i++) {
                        var fragment = response.fragments[i];
                        var hint = _this6.getHint(fragment.hint_id);
                        if (hint) {
                            fragment.hint = hint;
                        } else {
                            ids.push(fragment.hint_id);
                            needsUpdate.push(fragment);
                        }
                    }

                    if (!ids.length) {
                        resolve(response);
                    } else {
                        _this6.getHints(ids).then(function (hints) {
                            for (var _i = 0; _i < needsUpdate.length; _i++) {
                                needsUpdate[_i].hint = hints[needsUpdate[_i].hint_id];
                            }
                            resolve(response);
                        });
                    }
                });
            }
        }, {
            key: 'getHint',
            value: function getHint(id) {
                var cache = this.cache[this.session];
                if (cache) {
                    return cache[id];
                }
            }
        }, {
            key: 'cacheHint',
            value: function cacheHint(id, hint) {
                this.cache[this.session] = this.cache[this.session] || {};
                this.cache[this.session]['hints'] = this.cache[this.session]['hints'] || {};
                this.cache[this.session]['hints'][id] = hint;
            }
        }, {
            key: 'getHints',
            value: function getHints(ids) {
                var _this7 = this;

                // TODO: max_hints_count
                return this.checkSession().then(function (response) {
                    return _this7.fetch(_this7.getApiURL('hints'), { ids: ids.join(',') }, "POST").then(function (response) {
                        for (var hint_id in response.hints) {
                            _this7.cacheHint(hint_id, response.hints[hint_id]);
                        }
                        return Promise.resolve(response.hints);
                    });
                });
            }
        }, {
            key: 'getScore',
            value: function getScore(proofreadResults) {
                if (Object.prototype.toString.call(proofreadResults) !== '[object Array]') {
                    proofreadResults = [proofreadResults];
                }

                var word_regexp = /[А-Яа-яA-Za-z0-9-]+([^А-Яа-яA-Za-z0-9-]+)?/g;
                var letters = 0,
                    penalty = 0,
                    fragments_count = 0;

                for (var i = 0; i < proofreadResults.length; i++) {
                    var text = proofreadResults[i].text.trim();
                    letters += text ? text.replace(word_regexp, ".").length : 0;
                    var fragments = proofreadResults[i].fragments;
                    fragments_count += fragments.length;
                    for (var j = 0; j < fragments.length; j++) {
                        var fragment = fragments[j];
                        fragment.hint && fragment.hint.penalty && (penalty += fragment.hint.penalty);
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
        }], [{
            key: 'urlEncode',
            value: function urlEncode(data) {
                var body = [],
                    field = void 0;
                for (field in data) {
                    if (data.hasOwnProperty(field)) {
                        body.push(field + '=' + encodeURI(data[field]));
                    }
                }
                return body.join('&');
            }
        }]);

        return Glavred;
    }();

    exports.default = Glavred;
    module.exports = exports['default'];
});