(function (root) {
  'use strict';

  const MC = root.MemberCollector;
  if (!MC || typeof MC.collectMembersWide !== 'function') {
    // MemberCollector not present – nothing to do.
    return;
  }

  /**
   * Add logging wrappers around functions on an object (and its "family")
   * discovered via collectMembersWide.
   *
   * @param {Object} obj - Root object to instrument (e.g. document, window, some API object).
   * @param {Object} [options]
   * @param {Array}  [options.matchers]
   *   Matchers passed to collectMembersWide. Defaults to "match all names".
   * @param {Function} [options.logger]
   *   Logging function. Defaults to console.log.
   *   Signature: (info: { key, args, result, error, thisArg, label }) => void
   * @param {string} [options.label]
   *   Label prefix for logs. Default: "[LOG]".
   */
  function addLoggingToFunctions(obj, options) {
    if (!obj) return;

    const {
      matchers = [
        {
          type: 'includes',
          value: '' // match all member names
        }
      ],
      logger = console.log.bind(console),
      label = '[LOG]',
      wrapTarget = 'root', // 'root' | 'prototype' | 'owner'
      awaitPromises = false,
      expandChildren = [],
    } = options || {};

    const wrappedTargets = new WeakMap();

    function markWrapped(target, key) {
      if (!target) return false;
      let set = wrappedTargets.get(target);
      if (!set) {
        set = new Set();
        wrappedTargets.set(target, set);
      }
      if (set.has(key)) return true;
      set.add(key);
      return false;
    }

    function runLogger(info) {
      try {
        logger(info);
      } catch (_logErr) {
        // Ignore logger failures
      }
    }

    function resolveTarget(sourceObj) {
      if (wrapTarget === 'owner') return sourceObj || obj;
      if (wrapTarget === 'prototype') {
        try {
          if (sourceObj && typeof sourceObj === 'function' && sourceObj.prototype) {
            return sourceObj.prototype;
          }
        } catch {}

        try {
          const proto = Object.getPrototypeOf(sourceObj);
          if (proto) return proto;
        } catch {}

        return obj;
      }
      // Default: patch on the root object provided by the caller
      return obj;
    }

    function wrapFunction(key, value, sourceObj) {
      if (typeof value !== 'function') return;
      const target = resolveTarget(sourceObj);
      if (!target) return;

      // Skip if already wrapped on this target
      if (markWrapped(target, key)) return;

      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (descriptor && descriptor.get && !descriptor.set && !descriptor.writable) {
          return;
        }
      } catch {}

      const originalFn = target[key];

      try {
        target[key] = function () {
          const args = Array.prototype.slice.call(arguments);
          let result;
          let error;

          try {
            result = originalFn.apply(this, args);
          } catch (err) {
            error = err;
            runLogger({ label, key, args, result, error, thisArg: this, phase: 'call' });
            throw err;
          }

          if (awaitPromises && result && typeof result.then === 'function') {
            runLogger({ label, key, args, result, thisArg: this, phase: 'call' });
            return result.then((resolved) => {
              runLogger({ label, key, args, result: resolved, thisArg: this, phase: 'resolved' });
              return resolved;
            }).catch((err) => {
              runLogger({ label, key, args, error: err, thisArg: this, phase: 'rejected' });
              throw err;
            });
          }

          runLogger({ label, key, args, result, error, thisArg: this, phase: 'call' });
          return result;
        };
      } catch (e) {
        // Non-writable / non-configurable properties, etc. Ignore.
      }
    }

    MC.collectMembersWide({
      root: obj,
      matchers,
      onMatch: function (info) {
        wrapFunction(info.key, info.value, info.source);
      },
      expandChildren,
    });
  }

  // Attach to the same namespace as the collectors
  MC.addLoggingToFunctions = addLoggingToFunctions;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign({}, module.exports, {
      addLoggingToFunctions,
      withLogger(target, opts) {
        addLoggingToFunctions(target, opts);
        return MC;
      },
    });
  }

})(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined'
    ? window
    : (typeof global !== 'undefined'
      ? global
      : this)));
