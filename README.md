# ScopeCrawler

**ScopeCrawler** is a tiny JavaScript utility for poking around object scopes and APIs:

- Collect member names from objects and their prototype families.
- Apply flexible matcher rules (prefix/suffix/includes/regex/custom).
- Optionally auto-wrap functions with logging to see how an API is actually used at runtime.

Think of it as `Object.keys` with a searchlight and a notebook.

---

## Contents

- [Motivation](#motivation)
- [Files](#files)
- [Installation / Usage](#installation--usage)
  - [Browser](#browser)
  - [Node / Bundler](#node--bundler)
- [API](#api)
  - [`MemberCollector.collectMembers`](#membercollectorcollectmembers)
  - [`MemberCollector.collectMembersWide`](#membercollectorcollectmemberswide)
  - [`MemberCollector.addLoggingToFunctions`](#membercollectoraddloggingtofunctions)
- [Matchers](#matchers)
- [Examples](#examples)
  - [Collecting global-ish stuff](#collecting-global-ish-stuff)
  - [Scanning a specific API](#scanning-a-specific-api)
  - [Logging calls to an object](#logging-calls-to-an-object)
- [What’s in Development](#whats-in-development)
- [Caveats](#caveats)
- [License / Attribution](#license--attribution)

---

## Motivation

Modern runtimes ship with a *lot* of APIs.

ScopeCrawler is a small introspection helper for:

- Enumerating “what actually lives on this thing?”  
- Discovering patterns across an object + its constructor/prototype chain.  
- Instrumenting functions on an object to log how they’re being called in the wild.

It’s deliberately generic: it doesn’t know about DOM, Node, or any specific library. You point it at a root object, give it some matching rules, and it collects names or wraps functions.

---

## Files

- **`crawler.js`**  
  Core collector logic. Exposes `MemberCollector` with:
  - `collectMembers`
  - `collectMembersWide`

- **`scope-logger.js`**  
  Adds a higher-level helper:
  - `MemberCollector.addLoggingToFunctions`

`scope-logger.js` expects `MemberCollector` to already be present on `globalThis` (e.g. by loading `crawler.js` first).

---

## Installation / Usage

### Browser

Include the scripts (order matters: crawler first, then logger):

```html
<script src="crawler.js"></script>
<script src="scope-logger.js"></script>
<script>
  // Global namespace
  const MC = window.MemberCollector;

  const names = MC.collectMembers();
  console.log(names);
</script>
````

### Node / Bundler

This repo is just plain JS files, so you can either:

#### 1. Use the global-style API (mirroring the browser)

```js
require('./crawler.js');       // attaches MemberCollector to globalThis
require('./scope-logger.js');  // extends it with addLoggingToFunctions

const MC = globalThis.MemberCollector;

const names = MC.collectMembers({
  source: globalThis,
});
```

#### 2. Or import the module export from `crawler.js`

`crawler.js` also sets `module.exports = api;`, so:

```js
const MC = require('./crawler.js');
// If you also want logging helpers, load scope-logger.js once:
require('./scope-logger.js');  // augments MC on globalThis

// MC.collectMembers / MC.collectMembersWide are now available,
// and MC.addLoggingToFunctions is attached by scope-logger.
```

---

## API

### `MemberCollector.collectMembers`

```js
MemberCollector.collectMembers(options?) => string[]
```

Collects string values (usually property names) from a single object based on match rules.

**Options:**

* `source` (object, default: a global-like object)
  Object to scan. If omitted, it falls back to `globalThis` / `window` / `global`.

* `defaults` (string | string[])
  Values to seed into the result set.

* `extra` (string | string[])
  Additional values to seed into the result set.

* `matchers` (Array<Matcher>)
  Matcher objects that decide which keys to keep and how to transform them.

Returns a **deduplicated array of strings**.

---

### `MemberCollector.collectMembersWide`

```js
MemberCollector.collectMembersWide(options?) => string[]
```

Like `collectMembers`, but walks a wider “family” of the given root:

* `root`
* `root.constructor`
* `root.prototype`
* Items in the prototype chain
* Potential global aliases (e.g. `globalThis[root.name]` if it exists)

**Options:**

* `root` (object/function, default: global-like object)
  Root object or function (e.g. `Atomics`, `document`, some library object).

* `defaults`, `extra`, `matchers`
  Same meaning as in `collectMembers`.

Returns a **deduplicated array of strings** found across all related sources.

---

### `MemberCollector.addLoggingToFunctions`

Defined in `scope-logger.js`.

```js
MemberCollector.addLoggingToFunctions(obj, options?)
```

Discovers function members on `obj` (and its “family”) via `collectMembersWide` and replaces them with thin wrappers that:

* Call the original function.
* Send a structured log to a `logger` callback.
* Preserve return values and rethrow errors.

**Parameters:**

* `obj` (object/function)
  Root object to instrument. Functions on this object will be wrapped in place.

* `options` (object, optional):

  * `matchers` (Array<Matcher>, default: `[{ type: 'includes', value: '' }]`)
    Matchers for names to consider wrapping. By default, it matches *all* keys.
  * `logger` (function, default: `console.log.bind(console)`)
    Called with:

    ```js
    {
      label,  // string
      key,    // property name
      args,   // array of arguments
      result, // return value (if no error)
      error,  // error thrown (if any)
      thisArg // `this` during the call
    }
    ```
  * `label` (string, default: `"[LOG]"`)
    Label prefix to tag log entries.

Wrapped keys are tracked so they’re not re-wrapped if you call this multiple times.

---

## Matchers

A matcher is an object of the form:

```ts
type Matcher = {
  type: 'prefix' | 'suffix' | 'includes' | 'regex' | 'custom';
  value: string | RegExp | ((key, value, sourceObj) => boolean);
  transform?: (key, value, matcherValue) => string | undefined;
};
```

* **`type: 'prefix'`**
  Matches if `key.startsWith(value)`.

* **`type: 'suffix'`**
  Matches if `key.endsWith(value)`.

* **`type: 'includes'`**
  Matches if `key.includes(value)`.

* **`type: 'regex'`**
  Uses a `RegExp` to test the key. Any `lastIndex` is reset before testing.

* **`type: 'custom'`**
  `value` is a function: `(key, value, sourceObj) => boolean`.
  You’re free to look at the key, its current property value, or the source object.

* **`transform`** (optional)
  Receives `(key, value, matcherValue)` and can return:

  * A string to add to the result set, or
  * `undefined` / empty string to skip adding.

If `transform` is omitted, the key itself is added.

When used with `addLoggingToFunctions`, `transform` is overridden internally to install wrappers, but any original `transform` is still called to produce the string that ends up in the result set.

---

## Examples

### Collecting global-ish stuff

```js
// All top-level names on a global-like object
const names = MemberCollector.collectMembers();
console.log(names);

// Only names starting with "on" (e.g. event handlers)
const events = MemberCollector.collectMembers({
  matchers: [
    { type: 'prefix', value: 'on' }
  ]
});
```

### Scanning a specific API

```js
// Suppose you want to discover methods on `document` and friends
const domMethods = MemberCollector.collectMembersWide({
  root: document,
  matchers: [
    {
      type: 'regex',
      value: /^get|^query/,
      transform(key) {
        // turn "getElementById" into "document.getElementById"
        return `document.${key}`;
      }
    }
  ]
});

console.log(domMethods);
```

### Logging calls to an object

```js
// Log calls to any function whose name includes "fetch" on globalThis
MemberCollector.addLoggingToFunctions(globalThis, {
  matchers: [
    { type: 'includes', value: 'fetch' }
  ],
  logger(info) {
    const { label, key, args, result, error, phase } = info;
    const prefix = `[${phase || 'call'}]`;
    if (error) {
      console.warn(label, prefix, key, 'threw', error, 'with args', args);
    } else {
      console.log(label, prefix, key, 'called with', args, '=>', result);
    }
  },
  label: '[ScopeCrawler]',
  // instrument on the owning object/prototype instead of the root
  wrapTarget: 'owner',
  // log resolution / rejection when a wrapped function returns a Promise
  awaitPromises: true,
  // optionally scan one level into specific children
  expandChildren: ['navigator', 'performance']
});
```

You can also point it at library instances, custom API objects, etc.

---

## What’s in Development

This project is intentionally small and new improvements are landing incrementally.

### Recent improvements

- **Async-aware logging wrappers**
  * `addLoggingToFunctions` now supports an `awaitPromises` option that logs Promise resolution/rejection in addition to the immediate call without changing return types.
- **More precise wrapping targets**
  * Control where patches are applied via `wrapTarget`: `root`, `prototype`, or the owning object discovered by `collectMembersWide`.
- **Preset matcher packs**
  * Shortcut configs exposed under `MemberCollector.matcherPacks` (and `getMatcherPack`) for DOM events, network-related methods, and console/debug-style methods.
- **Shallow vs deep scans**
  * `collectMembersWide` and the logger accept `expandChildren` to optionally walk one level into specific properties (e.g. `window.navigator`, `window.performance`).
- **Better Node ergonomics**
  * `require('scopecrawler').withLogger(...)` augments the global collector and returns it for easy chaining.

All of this is still intentionally lightweight: the goal is to keep ScopeCrawler as a small, composable primitive you can plug into bigger logging/visualization systems, not a monolithic devtools replacement.

---

## Caveats

* **Host objects can be weird.**
  Some properties throw when accessed (e.g. cross-origin frames). The collectors catch these and skip problematic properties.

* **Non-configurable / non-writable props.**
  `addLoggingToFunctions` silently skips members it can’t overwrite.

* **Firehose risk.**
  If you log “all functions on `window`,” you will absolutely get spammed. Start specific (e.g. match `fetch`, `XMLHttpRequest`, or a library namespace).

* **Global mutation.**
  The logger helper replaces methods on the original object. That’s the whole point, but don’t forget you did that.

---

## License / Attribution

Copyright © 2024–2025
**Chris Singendonk**

See source file headers for licensing and usage terms.

If you’re interested in using ScopeCrawler in something or shipping it inside a tool, reach out and attribute appropriately.
