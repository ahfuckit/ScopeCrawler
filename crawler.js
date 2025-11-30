/**
*@copyright Chris Singendonk 2024
*/
/**
 * @fileoverview
 * Generic "member collector" utility + DOM-event-specific helpers.
 *
 * Provides:
 *   - collectMembers(options): core engine
 *   - getEventNames(events?): collect DOM event names (replaces _a1)
 *   - _a1(events?): legacy alias for getEventNames
 *   - getEventConstructors(source?): collect constructor names ending with "Event"
 */

/**
 * Predicate for custom matchers.
 * @callback MatcherPredicate
 * @param {string} key      - The property name on the source object.
 * @param {*} value         - The property value.
 * @param {Object} source   - The source object being scanned.
 * @returns {boolean}       - True if the property should be matched.
 */

/**
 * Transform function for matchers.
 * @callback MatcherTransform
 * @param {string} key          - The property name on the source object.
 * @param {*} value             - The property value.
 * @param {*} matcherValue      - The matcher "value" (string, RegExp, or predicate).
 * @returns {string|undefined}  - The value to add to the result set.
 */

/**
 * Supported matcher types for collectMembers.
 * @typedef {'prefix' | 'suffix' | 'includes' | 'regex' | 'custom'} MatcherType
 */

/**
 * Matcher description used by collectMembers.
 *
 * @typedef {Object} Matcher
 * @property {MatcherType} type
 *   How to match this entry:
 *   - "prefix"   -> key starts with `value` (string)
 *   - "suffix"   -> key ends with `value` (string)
 *   - "includes" -> key includes `value` (string)
 *   - "regex"    -> key matches `value` (RegExp)
 *   - "custom"   -> `value` is a MatcherPredicate
 *
 * @property {(string|RegExp|MatcherPredicate)} [value]
 *   Pattern used by this matcher (string, RegExp, or predicate).
 *
 * @property {MatcherTransform} [transform]
 *   Optional transform to derive the collected string from the matched property.
 *   Defaults to returning the raw key.
 */

/**
 * Options for collectMembers.
 *
 * @typedef {Object} CollectMembersOptions
 * @property {Object<string, *>} [source]
 *   Object whose enumerable own keys will be scanned. Defaults to a global-like
 *   object (window/globalThis/global) when omitted.
 *
 * @property {string|string[]} [defaults]
 *   Initial values to seed into the result set, before scanning the source.
 *
 * @property {string|string[]} [extra]
 *   Additional values to seed into the result set (e.g. user-specified).
 *
 * @property {Matcher[]} [matchers]
 *   List of matchers that determine which keys are collected and how.
 */

/**
 * Return a "default" root object for scanning, depending on environment.
 *
 * @returns {Object<string, *>} A best-effort global-ish object.
 * @private
 */
function getDefaultSource() {
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof global !== 'undefined') return global;
  return {};
}

/**
 * Collects string values from an object's keys based on flexible matcher rules.
 *
 * - Seeds a Set with `defaults` and `extra`.
 * - Safely iterates over `Object.keys(source)` (wrapped in try/catch).
 * - For each key:
 *     - Safely reads the property value (try/catch on `source[key]`).
 *     - Runs through each matcher:
 *         - prefix/suffix/includes/regex/custom (custom is also try/catch).
 *         - transform is also protected by try/catch.
 * - Returns a deduplicated array of results.
 *
 * Any property access / matcher / transform that throws is silently skipped,
 * without blowing up the whole traversal.
 *
 * @param {CollectMembersOptions} [options={}] Options for collection.
 * @returns {string[]} Deduplicated list of collected member names.
 */
function collectMembers({
  source = getDefaultSource(),
  defaults = [],
  extra = [],
  matchers = [],
} = {}) {
  /** @type {Set<string>} */
  var resultSet = new Set();

  /**
   * Normalize and add values into result set.
   * @param {string|string[]|undefined|null} values
   * @returns {void}
   * @private
   */
  function addAll(values) {
    if (!values) return;
    var arr = Array.isArray(values) ? values : [values];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v != null) resultSet.add(String(v));
    }
  }

  // Seed with defaults + extra
  addAll(defaults);
  addAll(extra);

  if (!source) return Array.from(resultSet);

  /** @type {string[]} */
  var keys;
  try {
    keys = Object.keys(source);
  } catch (e) {
    // If we can't even enumerate keys, just return what we have.
    return Array.from(resultSet);
  }

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value;

    // Safe property access: some getters can throw (e.g. cross-origin stuff).
    try {
      value = source[key];
    } catch (eAccess) {
      continue;
    }

    for (var j = 0; j < matchers.length; j++) {
      var matcher = matchers[j];
      var mType = matcher.type;
      var mVal = matcher.value;
      var matched = false;

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
          matched = mVal instanceof RegExp && mVal.test(key);
          break;
        case 'custom':
          if (typeof mVal === 'function') {
            try {
              matched = mVal(key, value, source);
            } catch (eCustom) {
              matched = false;
            }
          }
          break;
        default:
          // Unknown matcher type – skip.
          break;
      }

      if (matched) {
        var out;
        if (typeof matcher.transform === 'function') {
          try {
            out = matcher.transform(key, value, mVal);
          } catch (eTransform) {
            out = undefined;
          }
        } else {
          out = key;
        }

        if (out != null && out !== '') {
          resultSet.add(String(out));
        }
      }
    }
  }

  return Array.from(resultSet);
}

/**
 * Returns a list of DOM event names.
 *
 * Behavior:
 *   - Starts with a built-in list of common events (`defaults`).
 *   - If `events` is an array, they're added as "extra".
 *   - If `events` is not an array, `"loaded"` is added by default.
 *   - Scans the global-like object for properties starting with `"on"`
 *     (e.g. "onclick", "onkeyup") and strips the `"on"` prefix.
 *
 * Example:
 *   getEventNames();              // common events + ones derived from on* props
 *   getEventNames(['myCustom']);  // same, plus "myCustom"
 *
 * @param {string[] | undefined | null} events
 *   Optional custom event names to add. If not an array, `"loaded"` is used.
 * @returns {string[]} Deduplicated event name list.
 */
function getEventNames(events) {
  var defaults = [
    'click', 'submit', 'change', 'keydown', 'focus', 'blur', 'contextmenu',
    'dblclick', 'scroll', 'input', 'mousemove', 'mousedown', 'mouseup',
    'pointerdown', 'pointerup', 'pointermove', 'wheel', 'touchstart',
    'touchmove', 'touchend', 'paste', 'copy', 'cut'
  ];

  var extra = Array.isArray(events) ? events : ['loaded'];

  return collectMembers({
    defaults: defaults,
    extra: extra,
    matchers: [
      {
        // Match "onclick", "onkeyup", etc. -> "click", "keyup", ...
        type: 'prefix',
        value: 'on',
        transform: function (key, _value, prefix) {
          var p = typeof prefix === 'string' ? prefix : 'on';
          return key.slice(p.length);
        }
      }
    ]
  });
}

/**
 * Legacy alias for getEventNames.
 *
 * @deprecated Use getEventNames() instead for clarity.
 *
 * @param {string[] | undefined | null} b
 *   Optional custom event names to add.
 * @returns {string[]} Deduplicated event name list.
 */
function _a1(b) {
  return getEventNames(b);
}

/**
 * Collects names of constructor-like functions whose names end with "Event".
 *
 * By default, scans the same global-like object as collectMembers when
 * `source` is not provided.
 *
 * Example:
 *   const eventTypes = getEventConstructors();
 *   // ["Event", "UIEvent", "MouseEvent", "KeyboardEvent", ...]
 *
 * @param {Object<string, *>} [source]
 *   Object to scan. Defaults to a global-like object when omitted.
 * @returns {string[]} Deduplicated list of constructor names like "UIEvent".
 */
function getEventConstructors(source) {
  return collectMembers({
    source: source,
    matchers: [
      {
        type: 'custom',
        value: function (_key, val) {
          return (
            typeof val === 'function' &&
            typeof val.name === 'string' &&
            val.name.endsWith('Event')
          );
        },
        transform: function (_key, val) {
          return val && val.name ? val.name : String(_key);
        }
      }
    ]
  });
}

/* ------------------------------------------------------------------------- */
// Example usage (commented out):

// 1. Basic event names
const allEvents = getEventNames();
console.log(allEvents);

// 2. With custom events
const allEventsWithCustom = getEventNames(['myCustomEvent', 'anotherOne']);

// 3. Legacy call (same as getEventNames)
const legacyEvents = _a1(['foo']);

// 4. Collect constructor-style "Event" types
const eventTypes = getEventConstructors();
console.log(eventTypes);

/**
 * Collect member names from an object and its "family":
 *   - root
 *   - root.constructor
 *   - root.prototype
 *   - prototype chain
 *   - possible global alias via name
 *
 * Uses:
 *   - Object.keys(...)
 *   - Object.getOwnPropertyNames(...)
 *
 * Matchers work exactly like in collectMembers:
 *   type: 'prefix' | 'suffix' | 'includes' | 'regex' | 'custom'
 *
 * @param {Object} options
 * @param {*} options.root                Root object/function (e.g. Atomics, document).
 * @param {string|string[]} [options.defaults] Seed values.
 * @param {string|string[]} [options.extra]    Extra values to add.
 * @param {Matcher[]} [options.matchers]        Same matcher objects as collectMembers.
 * @returns {string[]} Deduplicated list of collected member names.
 */
function collectMembersWide({
  root,
  defaults = [],
  extra = [],
  matchers = [],
} = {}) {
  /** @type {Set<string>} */
  var resultSet = new Set();

  function addAll(values) {
    if (!values) return;
    var arr = Array.isArray(values) ? values : [values];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v != null) resultSet.add(String(v));
    }
  }

  // Seed initial values once
  addAll(defaults);
  addAll(extra);

  // Fallback root to the same global-ish default as collectMembers
  if (!root) root = (function getDefaultSource() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof global !== 'undefined') return global;
    return {};
  })();

  /** @type {Set<*>} */
  var sources = new Set();

  function addSource(obj) {
    if (!obj) return;
    var t = typeof obj;
    if (t !== 'object' && t !== 'function') return;
    if (sources.has(obj)) return;
    sources.add(obj);
  }

  // Root
  addSource(root);

  // Constructor
  try {
    if (root && root.constructor) addSource(root.constructor);
  } catch (e) {}

  // Prototype object if present
  try {
    if (root && root.prototype) addSource(root.prototype);
  } catch (e) {}

  // Prototype chain
  try {
    var proto = Object.getPrototypeOf(root);
    while (proto && proto !== Object.prototype && proto !== Function.prototype) {
      addSource(proto);
      proto = Object.getPrototypeOf(proto);
    }
  } catch (e) {}

  // Possible global alias by name (similar spirit to your globalThis[who.prototype.name])
  try {
    var g = (typeof globalThis !== 'undefined'
      ? globalThis
      : (typeof window !== 'undefined'
        ? window
        : (typeof global !== 'undefined'
          ? global
          : null)));

    if (g) {
      var nameCandidates = [];

      try {
        if (root && typeof root === 'function' && root.name) {
          nameCandidates.push(root.name);
        }
      } catch (e) {}

      try {
        if (root && root.prototype && root.prototype.name) {
          nameCandidates.push(root.prototype.name);
        }
      } catch (e) {}

      try {
        if (root && root.constructor && root.constructor.name) {
          nameCandidates.push(root.constructor.name);
        }
      } catch (e) {}

      for (var nc = 0; nc < nameCandidates.length; nc++) {
        var nm = nameCandidates[nc];
        if (!nm) continue;
        try {
          if (nm in g) addSource(g[nm]);
        } catch (e2) {}
      }
    }
  } catch (e) {}

  // Helper to apply matchers (same semantics as collectMembers)
  function applyMatchers(key, value, sourceObj) {
    for (var j = 0; j < matchers.length; j++) {
      var matcher = matchers[j];
      var mType = matcher.type;
      var mVal = matcher.value;
      var matched = false;

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
          matched = mVal instanceof RegExp && mVal.test(key);
          break;
        case 'custom':
          if (typeof mVal === 'function') {
            try {
              matched = mVal(key, value, sourceObj);
            } catch (eCustom) {
              matched = false;
            }
          }
          break;
        default:
          break;
      }

      if (matched) {
        var out;
        if (typeof matcher.transform === 'function') {
          try {
            out = matcher.transform(key, value, mVal);
          } catch (eTransform) {
            out = undefined;
          }
        } else {
          out = key;
        }

        if (out != null && out !== '') {
          resultSet.add(String(out));
        }
      }
    }
  }

  // Walk each related source and inspect:
  //   - Object.keys(...)
  //   - Object.getOwnPropertyNames(...)
  sources.forEach(function (src) {
    /** @type {string[]} */
    var keys = [];
    /** @type {string[]} */
    var names = [];
    var seen = new Set();

    try {
      keys = Object.keys(src);
    } catch (eKeys) {}

    try {
      names = Object.getOwnPropertyNames(src);
    } catch (eNames) {}

    var allKeys = keys.concat(names);

    for (var i = 0; i < allKeys.length; i++) {
      var k = allKeys[i];
      if (seen.has(k)) continue;
      seen.add(k);

      var value;
      try {
        value = src[k];
      } catch (eAccess) {
        continue;
      }

      applyMatchers(k, value, src);
    }
  });

  return Array.from(resultSet);
}
const atomicsWithA = collectMembersWide({
  root: typeof Atomics !== 'undefined' ? Atomics : undefined,
  matchers: [
    {
      type: 'includes',
      value: 'a', // case-sensitive; use regex for case-insensitive
    }
  ]
});

console.log('Atomics family names with "a":', atomicsWithA);
const documentWithAInsensitive = collectMembersWide({
  root: typeof document !== 'undefined' ? document : undefined,
  matchers: [
    {
      type: 'regex',
      value: /a/i
    }
  ]
});





function getAllMemberNames(source) {
return collectMembersWide({
  root: source || (typeof globalThis !== 'undefined' ? globalThis : {info:'no root source or globalThis defined'}),
  matchers: [
    {
      type: 'includes',
      value: ''
    }
  ]
})}

function addLoggingToFunctions(obj) {
  collectMembersWide({
    root: obj,
    matchers: [
      {
        type: 'includes',
        value: '', // match all member names
        transform: function (key, value) {
          // Only wrap functions
          if (typeof value === 'function') {
            try {
              // Wrap original function with a logging wrapper
              const original = value;
              obj[key] = function () {
                console.log('[LOG]', key, 'called with args:', arguments);
                return original.apply(this, arguments);
              };
            } catch (e) {
              // Some properties may be non-writable; ignore those
            }
          }

          // Still return something to collect if you care
          return key;
        }
      }
    ]
  });
}

// Example: instrument document API functions (in browsers)
if (typeof document !== 'undefined') {
  addLoggingToFunctions(document);
}
