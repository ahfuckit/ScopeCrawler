/**
*@copyright Chris Singendonk 2024 - 2025
*/
(function (root) {
  'use strict';

  /**
   * Return a "default" root object for scanning, depending on environment.
   */
  function getDefaultSource() {
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof window !== 'undefined') return window;
    if (typeof global !== 'undefined') return global;
    return {};
  }

  /**
   * Internal helper: add seed values to a Set<string>.
   */
  function seedSet(set, values) {
    if (!values) return;
    const arr = Array.isArray(values) ? values : [values];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v != null) set.add(String(v));
    }
  }

  /**
   * Internal helper: apply matchers to a single key/value pair.
   *
   * Matchers: [{ type, value, transform? }]
   *   type: 'prefix' | 'suffix' | 'includes' | 'regex' | 'custom'
   *   value: string | RegExp | (key, value, sourceObj) => boolean
   *   transform: (key, value, matcherValue) => string | undefined
   */
  function applyMatchers(matchers, key, value, sourceObj, resultSet, onMatch) {
    for (let j = 0; j < matchers.length; j++) {
      const matcher = matchers[j];
      const mType = matcher.type;
      const mVal = matcher.value;
      let matched = false;

      switch (mType) {
        case 'prefix':
          matched = typeof mVal === 'string' && key.startsWith(mVal);
          break;
        case 'suffix':
          matched = typeof mVal === 'string' && key.endsWith(mVal);
          break;
        case 'includes':
          matched = typeof mVal === 'string' && key.includes(mVal);
          break;
        case 'regex':
          if (mVal instanceof RegExp) {
            // Reset lastIndex in case someone passed a /g or /y regex
            mVal.lastIndex = 0;
            matched = mVal.test(key);
          }
          break;
        case 'custom':
          if (typeof mVal === 'function') {
            try {
              matched = mVal(key, value, sourceObj);
            } catch {
              matched = false;
            }
          }
          break;
        default:
          // Unknown matcher type – ignore
          break;
      }

      if (!matched) continue;

      let out;
      if (typeof matcher.transform === 'function') {
        try {
          out = matcher.transform(key, value, mVal);
        } catch {
          out = undefined;
        }
      } else {
        out = key;
      }

      if (out != null && out !== '') {
        resultSet.add(String(out));
      }

      if (typeof onMatch === 'function') {
        try {
          onMatch({
            key,
            value,
            source: sourceObj,
            matcher,
            transformed: out,
          });
        } catch {}
      }
    }
  }

  /**
   * Collects string values from an object's keys based on flexible matcher rules.
   *
   * Options:
   *   - source   : object to scan (defaults to a global-like object)
   *   - defaults : string or string[] to seed into the result
   *   - extra    : string or string[] to additionally seed into the result
   *   - matchers : [{ type, value, transform? }]
   */
  function collectMembers({
    source = getDefaultSource(),
    defaults = [],
    extra = [],
    matchers = [],
    onMatch,
  } = {}) {
    const resultSet = new Set();

    // Seed with defaults + extra
    seedSet(resultSet, defaults);
    seedSet(resultSet, extra);

    if (!source) return Array.from(resultSet);

    let keys;
    try {
      keys = Object.keys(source);
    } catch {
      // If we can't even enumerate keys, just return what we have.
      return Array.from(resultSet);
    }

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      let value;

      // Some property getters can throw (e.g. cross-origin).
      try {
        value = source[key];
      } catch {
        continue;
      }

      applyMatchers(matchers, key, value, source, resultSet, onMatch);
    }

    return Array.from(resultSet);
  }

  /**
   * Collect member names from an object and its "family":
   *   - root
   *   - root.constructor
   *   - root.prototype
   *   - prototype chain
   *   - possible global alias via name
   *
   * Options:
   *   - root     : root object/function (e.g. Atomics, document)
   *   - defaults : seed values
   *   - extra    : extra seed values
   *   - matchers : same matcher objects as collectMembers
   */
  function collectMembersWide({
    root,
    defaults = [],
    extra = [],
    matchers = [],
    onMatch,
    expandChildren = [],
  } = {}) {
    const resultSet = new Set();

    // Seed initial values
    seedSet(resultSet, defaults);
    seedSet(resultSet, extra);

    if (!root) root = getDefaultSource();

    const sources = new Set();

    function addSource(obj) {
      if (!obj) return;
      const t = typeof obj;
      if (t !== 'object' && t !== 'function') return;
      if (sources.has(obj)) return;
      sources.add(obj);
    }

    // Root
    addSource(root);

    // Optionally walk one level down into selected properties for a wider scan
    const expandList = Array.isArray(expandChildren) ? expandChildren : [expandChildren];
    for (let i = 0; i < expandList.length; i++) {
      const childKey = expandList[i];
      if (typeof childKey !== 'string') continue;
      try {
        if (root && childKey in root) {
          addSource(root[childKey]);
        }
      } catch {}
    }

    // Constructor
    try {
      if (root && root.constructor) addSource(root.constructor);
    } catch {}

    // Prototype object if present
    try {
      if (root && root.prototype) addSource(root.prototype);
    } catch {}

    // Prototype chain
    try {
      let proto = Object.getPrototypeOf(root);
      while (proto && proto !== Object.prototype && proto !== Function.prototype) {
        addSource(proto);
        proto = Object.getPrototypeOf(proto);
      }
    } catch {}

    // Possible global alias by name
    try {
      const g = (typeof globalThis !== 'undefined'
        ? globalThis
        : (typeof window !== 'undefined'
          ? window
          : (typeof global !== 'undefined'
            ? global
            : null)));

      if (g) {
        const nameCandidates = [];

        try {
          if (root && typeof root === 'function' && root.name) {
            nameCandidates.push(root.name);
          }
        } catch {}

        try {
          if (root && root.prototype && root.prototype.name) {
            nameCandidates.push(root.prototype.name);
          }
        } catch {}

        try {
          if (root && root.constructor && root.constructor.name) {
            nameCandidates.push(root.constructor.name);
          }
        } catch {}

        for (let i = 0; i < nameCandidates.length; i++) {
          const nm = nameCandidates[i];
          if (!nm) continue;
          try {
            if (nm in g) addSource(g[nm]);
          } catch {}
        }
      }
    } catch {}

    // Walk each related source
    sources.forEach(function (src) {
      let keys = [];
      let names = [];
      const seen = new Set();

      try {
        keys = Object.keys(src);
      } catch {}

      try {
        names = Object.getOwnPropertyNames(src);
      } catch {}

      const allKeys = keys.concat(names);

      for (let i = 0; i < allKeys.length; i++) {
        const k = allKeys[i];
        if (seen.has(k)) continue;
        seen.add(k);

        let value;
        try {
          value = src[k];
        } catch {
          continue;
        }

        applyMatchers(matchers, k, value, src, resultSet, onMatch);
      }
    });

    return Array.from(resultSet);
  }

  // Expose API

  const api = {
    collectMembers,
    collectMembersWide,
  };

  // Preset matcher packs for common discovery patterns
  const matcherPacks = {
    domEvents: [
      { type: 'prefix', value: 'on' },
      { type: 'includes', value: 'EventListener' },
      { type: 'includes', value: 'EventTarget' },
    ],
    network: [
      { type: 'includes', value: 'fetch' },
      { type: 'includes', value: 'XHR' },
      { type: 'includes', value: 'Request' },
      { type: 'includes', value: 'Response' },
    ],
    console: [
      { type: 'includes', value: 'log' },
      { type: 'includes', value: 'warn' },
      { type: 'includes', value: 'error' },
      { type: 'includes', value: 'debug' },
    ],
  };

  api.matcherPacks = matcherPacks;
  api.getMatcherPack = function (name) {
    return matcherPacks[name] ? matcherPacks[name].slice() : [];
  };

  // Global namespace
  root.MemberCollector = api;

  // CommonJS (Node)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined'
    ? window
    : (typeof global !== 'undefined'
      ? global
      : this)));
