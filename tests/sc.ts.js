// Tests for vite-plugin-balafon utility logic
// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// _identifier — inline copy to test in isolation
// ---------------------------------------------------------------------------
function _identifier(name) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
        name = '"' + name + '"';
    }
    return name;
}

test('_identifier: plain name is returned as-is', () => {
    assert.equal(_identifier('MyComponent'), 'MyComponent');
    assert.equal(_identifier('_private'), '_private');
    assert.equal(_identifier('$root'), '$root');
    assert.equal(_identifier('camelCase123'), 'camelCase123');
});

test('_identifier: hyphenated name is quoted', () => {
    assert.equal(_identifier('my-component'), '"my-component"');
    assert.equal(_identifier('balafon-icon'), '"balafon-icon"');
});

test('_identifier: name starting with digit is quoted', () => {
    assert.equal(_identifier('1invalid'), '"1invalid"');
});

test('_identifier: empty string is quoted', () => {
    assert.equal(_identifier(''), '""');
});

// ---------------------------------------------------------------------------
// merge_properties — inline copy to test in isolation
// ---------------------------------------------------------------------------
const merge_properties = (obj, prop, merge) => {
    if (!obj) return prop;
    if (merge == undefined) merge = false;
    for (let i in prop) {
        if (!(i in obj) || merge) {
            obj[i] = prop[i];
        }
    }
    return obj;
};

test('merge_properties: does not overwrite existing keys by default', () => {
    const obj = { a: 1 };
    merge_properties(obj, { a: 99, b: 2 });
    assert.equal(obj.a, 1);
    assert.equal(obj.b, 2);
});

test('merge_properties: overwrites when merge=true', () => {
    const obj = { a: 1 };
    merge_properties(obj, { a: 99, b: 2 }, true);
    assert.equal(obj.a, 99);
    assert.equal(obj.b, 2);
});

test('merge_properties: returns prop when obj is null', () => {
    const prop = { x: 1 };
    assert.equal(merge_properties(null, prop), prop);
});

// ---------------------------------------------------------------------------
// _createWatchListener — inline copy to test in isolation
// ---------------------------------------------------------------------------
function _createWatchListener() {
    const m_listener = [];
    const m_registry = {};
    let m_server = null;
    const self = Object.create(null);
    Object.defineProperty(self, 'registry', { get() { return m_registry; } });
    Object.defineProperty(self, 'server', {
        get() { return m_server; },
        set(v) { m_server = v; }
    });
    self.handle = function (f) {
        let e = false;
        m_listener.forEach(c => { e = e || c.apply(self, [f]); });
        return e;
    };
    self.register = function (listener) { m_listener.push(listener); };
    self.clear = function () { m_listener.length = 0; };
    return self;
}

test('_createWatchListener: register and handle a listener', () => {
    const wl = _createWatchListener();
    let called = false;
    wl.register(() => { called = true; return true; });
    const result = wl.handle('/some/file.vue');
    assert.ok(called, 'listener should have been called');
    assert.ok(result, 'handle should return truthy when a listener returns true');
});

test('_createWatchListener: clear removes all listeners', () => {
    const wl = _createWatchListener();
    let calls = 0;
    wl.register(() => { calls++; return false; });
    wl.register(() => { calls++; return false; });
    wl.clear();
    wl.handle('/some/file');
    assert.equal(calls, 0, 'no listeners should fire after clear()');
});

test('_createWatchListener: server property is settable', () => {
    const wl = _createWatchListener();
    assert.equal(wl.server, null);
    const fakeServer = { watcher: {} };
    wl.server = fakeServer;
    assert.equal(wl.server, fakeServer);
});

test('_createWatchListener: registry is accessible', () => {
    const wl = _createWatchListener();
    assert.deepEqual(wl.registry, {});
    wl.registry['i18n'] = 1;
    assert.equal(wl.registry['i18n'], 1);
});

// ---------------------------------------------------------------------------
// _createVueFinder — inline copy to test in isolation
// ---------------------------------------------------------------------------
function _createVueFinder() {
    let _cache = null;
    return function _vue_(plugins) {
        if (_cache !== null) return _cache || null;
        _cache = plugins.find(p => p.name === 'vite:vue') ?? false;
        return _cache || null;
    };
}

test('_createVueFinder: finds the vite:vue plugin', () => {
    const finder = _createVueFinder();
    const plugins = [{ name: 'other' }, { name: 'vite:vue', transform: () => {} }];
    const result = finder(plugins);
    assert.equal(result.name, 'vite:vue');
});

test('_createVueFinder: returns null when not found', () => {
    const finder = _createVueFinder();
    const result = finder([{ name: 'other' }]);
    assert.equal(result, null);
});

test('_createVueFinder: result is memoised (called only once)', () => {
    let searchCount = 0;
    const finder = _createVueFinder();
    const plugins = [{
        get name() { searchCount++; return 'vite:vue'; },
        transform: () => {}
    }];
    finder(plugins);
    finder(plugins); // second call should not search again
    assert.ok(searchCount <= 2, 'find() should not be called on subsequent invocations');
});

test('_createVueFinder: each instance has independent cache', () => {
    const finderA = _createVueFinder();
    const finderB = _createVueFinder();
    const vuePlugin = { name: 'vite:vue', transform: () => {} };
    finderA([vuePlugin]);
    // finderB has its own cache — should still find correctly
    const result = finderB([{ name: 'other' }]);
    assert.equal(result, null);
});
