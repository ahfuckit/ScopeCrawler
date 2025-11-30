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
    } = options || {};

    const wrappedKeys = new Set();

    // Clone matchers and inject transforms that do the wrapping
    const loggingMatchers = matchers.map(function (m) {
      // Shallow copy so we don't mutate the caller's matcher object
      const clone = {
        type: m.type,
        value: m.value,
        transform: m.transform
      };

      clone.transform = function (key, value, matcherValue) {
        // Preserve any existing transform, but run our wrapper logic too.
        const originalTransform = m.transform;

        if (!wrappedKeys.has(key) && typeof value === 'function') {
          try {
            const originalFn = value;

            // Replace obj[key] with a logging wrapper
            obj[key] = function () {
              const args = Array.prototype.slice.call(arguments);
              let result;
              let error;

              try {
                result = originalFn.apply(this, args);
              } catch (err) {
                error = err;
              }

              try {
                logger({
                  label,
                  key,
                  args,
                  result,
                  error,
                  thisArg: this
                });
              } catch (_logErr) {
                // Swallow logging errors so we don't break the app
              }

              if (error) {
                throw error;
              }
              return result;
            };

            wrappedKeys.add(key);
          } catch (e) {
            // Non-writable / non-configurable properties, etc. Ignore.
          }
        }

        // Run any original transform to still feed names back into the collector
        if (typeof originalTransform === 'function') {
          try {
            return originalTransform(key, value, matcherValue);
          } catch (e) {
            return undefined;
          }
        }

        return key;
      };

      return clone;
    });

    MC.collectMembersWide({
      root: obj,
      matchers: loggingMatchers,
    });
  }

  // Attach to the same namespace as the collectors
  MC.addLoggingToFunctions = addLoggingToFunctions;

})(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined'
    ? window
    : (typeof global !== 'undefined'
      ? global
      : this)));
