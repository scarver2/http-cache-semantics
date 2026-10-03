'use strict';
/*
 * Copyright (C) 2011 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const assert = require('assert');
const CachePolicy = require('..');

describe('okhttp tests', function() {
    it('response caching by response code', function() {
        // Test each documented HTTP/1.1 code, plus the first unused value in each range.
        // http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html

        assertCached(false, 100);
        assertCached(false, 101);
        assertCached(false, 102);
        assertCached(true, 200);
        assertCached(false, 201);
        assertCached(false, 202);
        assertCached(true, 203);
        assertCached(true, 204);
        assertCached(false, 205);
        assertCached(false, 206); //Electing to not cache partial responses
        assertCached(false, 207);
        assertCached(true, 300);
        assertCached(true, 301);
        assertCached(true, 302);
        // assertCached(false, 303);
        assertCached(false, 304);
        assertCached(false, 305);
        assertCached(false, 306);
        assertCached(true, 307);
        assertCached(true, 308);
        assertCached(false, 400);
        assertCached(false, 401);
        assertCached(false, 402);
        assertCached(false, 403);
        assertCached(true, 404);
        assertCached(true, 405);
        assertCached(false, 406);
        assertCached(false, 408);
        assertCached(false, 409);
        // the HTTP spec permits caching 410s, but the RI doesn't.
        assertCached(true, 410);
        assertCached(false, 411);
        assertCached(false, 412);
        assertCached(false, 413);
        assertCached(true, 414);
        assertCached(false, 415);
        assertCached(false, 416);
        assertCached(false, 417);
        assertCached(false, 418);
        assertCached(false, 429);

        assertCached(false, 500);
        assertCached(true, 501);
        assertCached(false, 502);
        assertCached(false, 503);
        assertCached(false, 504);
        assertCached(false, 505);
        assertCached(false, 506);
    });

    function assertCached(shouldPut, responseCode) {
        let expectedResponseCode = responseCode;

        const mockResponse = {
            headers: {
                'last-modified': formatDate(-1, 3600),
                expires: formatDate(1, 3600),
                'www-authenticate': 'challenge',
            },
            status: responseCode,
            body: 'ABCDE',
        };
        if (responseCode == 407) {
            mockResponse.headers['proxy-authenticate'] =
                'Basic realm="protected area"';
        } else if (responseCode == 401) {
            mockResponse.headers['www-authenticate'] =
                'Basic realm="protected area"';
        } else if (responseCode == 204 || responseCode == 205) {
            mockResponse.body = ''; // We forbid bodies for 204 and 205.
        }

        const request = { url: '/', headers: {} };

        const cache = new CachePolicy(request, mockResponse, { shared: false });

        assert.equal(shouldPut, cache.storable());
    }

    it('default expiration date fully cached for less than24 hours', function() {
        //      last modified: 105 seconds ago
        //             served:   5 seconds ago
        //   default lifetime: (105 - 5) / 10 = 10 seconds
        //            expires:  10 seconds from served date = 5 seconds from now
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-105, 1),
                    date: formatDate(-5, 1),
                },
                body: 'A',
            },
            { shared: false }
        );

        assert(cache.timeToLive() > 4000);
    });

    it('default expiration date fully cached for more than24 hours', function() {
        //      last modified: 105 days ago
        //             served:   5 days ago
        //   default lifetime: (105 - 5) / 10 = 10 days
        //            expires:  10 days from served date = 5 days from now
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-105, 3600 * 24),
                    date: formatDate(-5, 3600 * 24),
                },
                body: 'A',
            },
            { shared: false }
        );

        assert(cache.maxAge() >= 10 * 3600 * 24);
        assert(cache.timeToLive() + 1000 >= 5 * 3600 * 24);
    });

    it('max age in the past with date header but no last modified header', function() {
        // Chrome interprets max-age relative to the local clock. Both our cache
        // and Firefox both use the earlier of the local and server's clock.
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(-120, 1),
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
    });

    it('maxAge timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );
        const now = Date.now();
        cache.now = () => now

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 60000);
    });

    it('stale-if-error timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-if-error=200',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 260000);
    });

    it('stale-while-revalidate timetolive', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(120, 1),
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert.equal(cache.timeToLive(), 260000);
    });

    it('stale-while-revalidate does not satisfy when stale because it requires revalidation', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 120,
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
        assert(cache.useStaleWhileRevalidate());
        assert(!cache.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('stale-while-revalidate does not satisfy when stale and must-revalidate because it requires revalidation', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 120,
                    'cache-control': 'max-age=60, stale-while-revalidate=200, must-revalidate',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
        assert(!cache.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('stale-while-revalidate work with max-stale', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 100,
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
        assert(cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale',
            }
        }));
        assert(!cache.satisfiesWithoutRevalidation({
            headers: {
                'cache-control': 'max-stale=40',
            }
        }));
    });

    it('stale-while-revalidate not satisfies when stale and expired', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 260,
                    'cache-control': 'max-age=60, stale-while-revalidate=200',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
        assert(!cache.useStaleWhileRevalidate());
        assert(!cache.satisfiesWithoutRevalidation({ headers: {} }));
    });

    it('max age preferred over lower shared max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    date: formatDate(-2, 60),
                    'cache-control': 's-maxage=60, max-age=180',
                },
            },
            { shared: false }
        );

        assert.equal(cache.maxAge(), 180);
    });

    it('max age preferred over higher max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 360,
                    'cache-control': 's-maxage=60, max-age=180',
                },
            },
            { shared: false }
        );

        assert(cache.stale());
    });

    it('request method options is not cached', function() {
        testRequestMethodNotCached('OPTIONS');
    });

    it('request method put is not cached', function() {
        testRequestMethodNotCached('PUT');
    });

    it('request method delete is not cached', function() {
        testRequestMethodNotCached('DELETE');
    });

    it('request method trace is not cached', function() {
        testRequestMethodNotCached('TRACE');
    });

    function testRequestMethodNotCached(method) {
        // 1. seed the cache (potentially)
        // 2. expect a cache hit or miss
        const cache = new CachePolicy(
            { method, headers: {} },
            {
                headers: {
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(cache.stale());
    }

    it('etag and expiration date in the future', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    etag: 'v1',
                    'last-modified': formatDate(-2, 3600),
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(cache.timeToLive() > 0);
    });

    it('client side no store', function() {
        const cache = new CachePolicy(
            {
                headers: {
                    'cache-control': 'no-store',
                },
            },
            {
                headers: {
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.storable());
    });

    it('request max age', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'last-modified': formatDate(-2, 3600),
                    age: 60,
                    expires: formatDate(1, 3600),
                },
            },
            { shared: false }
        );

        assert(!cache.stale());
        assert(cache.age() >= 60);

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-age=90',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-age=30',
                },
            })
        );
    });

    it('request min fresh', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=60',
                },
            },
            { shared: false }
        );

        assert(!cache.stale());

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'min-fresh=120',
                },
            })
        );

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'min-fresh=10',
                },
            })
        );
    });

    it('request min fresh with stale-while-revalidate', function() {
        const cache = new CachePolicy(
            { headers: {} },
            { headers: {'cache-control': 'max-age=60, stale-while-revalidate=100000'} },
            { shared: false }
        );

        assert(!cache.satisfiesWithoutRevalidation({headers: {'cache-control': 'min-fresh=120'}}));
        assert(cache.satisfiesWithoutRevalidation({headers: {'cache-control': 'min-fresh=10'}}));
    });

    it('request max stale', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=120',
                    age: 4*60,
                },
            },
            { shared: false }
        );

        assert(cache.stale());

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=180',
                },
            })
        );

        assert(
            cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=10',
                },
            })
        );
    });

    it('request max stale not honored with must revalidate', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    'cache-control': 'max-age=120, must-revalidate',
                    age: 360,
                },
            },
            { shared: false }
        );

        assert(cache.stale());

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale=180',
                },
            })
        );

        assert(
            !cache.satisfiesWithoutRevalidation({
                headers: {
                    'cache-control': 'max-stale',
                },
            })
        );
    });

    it('request max stale is honored for an ordinarily expired response', function() {
        const cache = stalePolicy('max-age=120');

        assert(cache.satisfiesWithoutRevalidation(maxStaleRequest()));
    });

    it('request max stale preserves the ordinary expiration tolerance', function() {
        const cache = stalePolicy('max-age=120');

        assert(cache.satisfiesWithoutRevalidation(maxStaleRequest(1000)));
        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest(10)));
    });

    it('request max stale does not expose shared response cookies without an explicit opt-in', function() {
        const cache = stalePolicy('max-age=120', {
            responseHeaders: { 'set-cookie': 'session=private' },
        });

        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest(1000)));
    });

    for (const optIn of ['public', 'immutable']) {
        it(`request max stale preserves the ${optIn} shared-cookie opt-in`, function() {
            const cache = stalePolicy(`max-age=120, ${optIn}`, {
                responseHeaders: { 'set-cookie': 'session=public' },
            });

            assert(cache.satisfiesWithoutRevalidation(maxStaleRequest()));
        });
    }

    it('request max stale does not bypass proxy revalidation in a shared cache', function() {
        const cache = stalePolicy('max-age=120, proxy-revalidate');

        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest(1000)));
    });

    it('request max stale does not bypass response no-cache', function() {
        const cache = stalePolicy('max-age=120, no-cache');

        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest()));
    });

    it('request max stale does not bypass response no-cache in a nonshared cache', function() {
        const cache = stalePolicy('max-age=120, no-cache', { shared: false });

        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest(1000)));
    });

    it('request max stale does not reuse a private response in a shared cache', function() {
        const cache = stalePolicy('max-age=120, private');

        assert(!cache.satisfiesWithoutRevalidation(maxStaleRequest()));
    });

    for (const cacheControl of [
        'max-age=120',
        'max-age=120, private',
        'max-age=120, proxy-revalidate',
    ]) {
        it(`request max stale preserves nonshared behavior for ${cacheControl}`, function() {
            const cache = stalePolicy(cacheControl, {
                responseHeaders: { 'set-cookie': 'session=private' },
                shared: false,
            });

            assert(cache.satisfiesWithoutRevalidation(maxStaleRequest()));
        });
    }

    for (const testCase of [
        { name: 'shared cookies', headers: { 'set-cookie': 'session=private' }, reuse: false },
        { name: 'shared proxy-revalidate', directive: 'proxy-revalidate', reuse: false },
        { name: 'response no-cache', directive: 'no-cache', reuse: false },
        { name: 'nonshared no-cache', directive: 'no-cache', shared: false, reuse: false },
        { name: 'ordinary expiration', reuse: true },
        { name: 'public shared cookies', directive: 'public', headers: { 'set-cookie': 'session=public' }, reuse: true },
        { name: 'immutable shared cookies', directive: 'immutable', headers: { 'set-cookie': 'session=public' }, reuse: true },
        { name: 'nonshared cookies and proxy-revalidate', directive: 'proxy-revalidate', headers: { 'set-cookie': 'session=private' }, shared: false, reuse: true },
    ]) {
        it(`request max stale preserves ${testCase.name} through serialization`, function() {
            const original = stalePolicy(
                `max-age=120${testCase.directive ? ', ' + testCase.directive : ''}`,
                { responseHeaders: testCase.headers, shared: testCase.shared }
            );
            const restored = CachePolicy.fromObject(JSON.parse(JSON.stringify(original.toObject())));

            for (const cache of [original, restored]) {
                for (const request of [maxStaleRequest(), maxStaleRequest(1000)]) {
                    assert.strictEqual(cache.satisfiesWithoutRevalidation(request), testCase.reuse);

                    if (!testCase.reuse) {
                        const result = cache.evaluateRequest(request);
                        assert.strictEqual(result.response, undefined);
                        assert.strictEqual(result.revalidation.synchronous, true);
                    }
                }
            }
        });
    }

    function maxStaleRequest(seconds) {
        const value = seconds === undefined ? 'max-stale' : `max-stale=${seconds}`;
        return { headers: { 'cache-control': value } };
    }

    function stalePolicy(cacheControl, { responseHeaders = {}, shared = true } = {}) {
        return new CachePolicy(
            { headers: {} },
            {
                headers: {
                    age: 240,
                    'cache-control': cacheControl,
                    ...responseHeaders,
                },
            },
            { shared }
        );
    }

    it('get headers deletes cached100 level warnings', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                headers: {
                    warning: '199 test danger, 200 ok ok',
                },
            }
        );

        assert.equal('200 ok ok', cache.responseHeaders().warning);
    });

    it('do not cache partial response', function() {
        const cache = new CachePolicy(
            { headers: {} },
            {
                status: 206,
                headers: {
                    'content-range': 'bytes 100-100/200',
                    'cache-control': 'max-age=60',
                },
            }
        );
        assert(!cache.storable());
    });

    function formatDate(delta, unit) {
        return new Date(Date.now() + delta * unit * 1000).toUTCString();
    }
});
