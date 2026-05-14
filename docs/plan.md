# `iobroker.iob2hass` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `iobroker.iob2hass` Bridge-Adapter per `docs/design.md` — a TypeScript ioBroker adapter that mirrors whitelisted ioBroker datapoints into Home Assistant via MQTT-Discovery, supports bidirectional commands, and is fully configurable through the ioBroker Admin UI.

**Architecture:** Classic ioBroker TypeScript adapter (`@iobroker/adapter-core`) with a thin orchestration layer in `main.ts` and pure-logic modules under `src/lib/` (matcher, sanitizer, discovery, loop-guard, reconcile). MQTT-Discovery to HA via `mqtt` library against Mosquitto. Configuration entirely in JsonConfig (no filesystem config). Test-driven for all pure logic; integration tests use `aedes` as in-process MQTT broker and `@iobroker/legacy-testing` for adapter lifecycle.

**Tech Stack:**
- Runtime: Node.js ≥ 20
- Language: TypeScript (target ES2022, module Node16)
- Adapter framework: `@iobroker/adapter-core` ^3.3.2 (analog `iobroker.hass`)
- MQTT client: `mqtt` ^5
- Test broker: `aedes` ^0.51
- Test runner: Mocha + `@iobroker/testing` + `@iobroker/legacy-testing`
- Lint/Format: `@iobroker/eslint-config` (bundles ESLint + Prettier presets)
- Release tooling: `@alcalzone/release-script` (analog hass-Fork)

**Working Directory:** `/Users/sschwill/development/HomeAssistant/adapters/ioBroker.iob2hass/`

All paths below are relative to this directory unless absolute.

---

## File Structure

```
adapters/ioBroker.iob2hass/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── eslint.config.mjs
├── prettier.config.mjs
├── io-package.json
├── README.md                       (already exists)
├── .gitignore                      (already exists)
├── LICENSE                         (MIT, added Task 1)
├── docs/
│   ├── design.md                   (already exists — spec)
│   └── plan.md                     (this file)
├── src/
│   ├── main.ts                     # Iob2HassAdapter — lifecycle, boot, wiring
│   ├── types.ts                    # Config + Mapping types, shared shapes
│   └── lib/
│       ├── sanitizer.ts            # DP-ID → entity-ID slug (pure)
│       ├── matcher.ts              # Glob → RegExp + match (pure)
│       ├── loop-guard.ts           # from-field filter (pure)
│       ├── discovery.ts            # common + overrides → Discovery-JSON (pure)
│       ├── config.ts               # JsonConfig native → normalized RuntimeConfig
│       ├── stats.ts                # info.* / stats.* adapter states
│       ├── mqtt-client.ts          # mqtt wrapper: LWT, retained publish, subscribe
│       ├── command-router.ts       # command_topic → setForeignStateAsync
│       └── reconcile.ts            # Discovery cleanup for orphans
├── admin/
│   ├── jsonConfig.json5            # UI schema (Verbindung / Verhalten / Whitelist / Overrides / Status)
│   └── i18n/
│       ├── de.json
│       └── en.json
└── test/
    ├── unit/
    │   ├── sanitizer.test.ts
    │   ├── matcher.test.ts
    │   ├── loop-guard.test.ts
    │   └── discovery.test.ts
    ├── integration/
    │   ├── mqtt-client.test.ts
    │   ├── command-router.test.ts
    │   ├── reconcile.test.ts
    │   └── boot.test.ts
    └── testPackageFiles.js
```

**Module boundaries:**
- `lib/*.ts` are pure or near-pure: no `adapter`-instance dependency in their signatures (passed as a thin interface argument when needed). Easier to test.
- `main.ts` owns the lifecycle and wires pure modules to the adapter API.
- `types.ts` is the single source of shared types. No re-exports from `lib/*`.

---

## Task 1: Project skeleton — config files

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `LICENSE`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "iobroker.iob2hass",
  "version": "0.0.1",
  "description": "Mirror selected ioBroker datapoints into Home Assistant via MQTT-Discovery",
  "author": {
    "name": "mokusone",
    "email": "14061880+mokusone@users.noreply.github.com"
  },
  "homepage": "https://github.com/mokusone/ioBroker.iob2hass",
  "license": "MIT",
  "keywords": ["ioBroker", "Home Assistant", "MQTT", "Bridge", "Mirror"],
  "repository": {
    "type": "git",
    "url": "https://github.com/mokusone/ioBroker.iob2hass"
  },
  "dependencies": {
    "@iobroker/adapter-core": "^3.3.2",
    "mqtt": "^5.10.1"
  },
  "devDependencies": {
    "@alcalzone/release-script": "^5.1.1",
    "@alcalzone/release-script-plugin-iobroker": "^5.1.2",
    "@alcalzone/release-script-plugin-license": "^5.1.1",
    "@iobroker/adapter-dev": "^1.5.0",
    "@iobroker/build-tools": "^3.0.1",
    "@iobroker/eslint-config": "^2.2.0",
    "@iobroker/legacy-testing": "^2.0.2",
    "@iobroker/testing": "^5.2.2",
    "@iobroker/types": "^7.0.7",
    "@types/mocha": "^10.0.10",
    "@types/node": "^22.10.5",
    "aedes": "^0.51.3",
    "mocha": "^11.0.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3"
  },
  "main": "build/main.js",
  "files": [
    "admin{,/!(src)/**}/!(tsconfig|tsconfig.*|.eslintrc).{json,json5}",
    "admin{,/!(src)/**}/*.{html,css,png,svg,jpg,js}",
    "build/",
    "io-package.json",
    "LICENSE"
  ],
  "scripts": {
    "build:tsc": "tsc -p tsconfig.build.json",
    "build": "npm run build:tsc",
    "lint": "eslint -c eslint.config.mjs",
    "test:unit": "mocha --require ts-node/register 'test/unit/**/*.test.ts' --exit",
    "test:integration": "mocha --require ts-node/register 'test/integration/**/*.test.ts' --exit --timeout 30000",
    "test:package": "mocha test/testPackageFiles.js --exit",
    "test": "npm run test:unit && npm run test:integration && npm run test:package",
    "release": "release-script",
    "release-patch": "release-script patch --yes",
    "release-minor": "release-script minor --yes",
    "release-major": "release-script major --yes",
    "translate": "translate-adapter"
  },
  "bugs": {
    "url": "https://github.com/mokusone/ioBroker.iob2hass/issues"
  },
  "readmeFilename": "README.md"
}
```

- [ ] **Step 2: Write `tsconfig.json`** (identical to hass-Fork)

```json
{
    "compileOnSave": true,
    "compilerOptions": {
        "noEmit": true,
        "allowJs": true,
        "checkJs": true,
        "skipLibCheck": true,
        "noEmitOnError": true,
        "outDir": "./build",
        "removeComments": false,
        "module": "Node16",
        "moduleResolution": "node16",
        "esModuleInterop": true,
        "resolveJsonModule": true,
        "strict": true,
        "target": "es2022",
        "sourceMap": true,
        "inlineSourceMap": false,
        "useUnknownInCatchVariables": false,
        "types": ["@iobroker/types"]
    },
    "include": ["src/**/*.ts", "src/**/*.d.ts"]
}
```

- [ ] **Step 3: Write `tsconfig.build.json`**

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "allowJs": false,
        "checkJs": false,
        "noEmit": false,
        "declaration": false,
        "rootDir": "src",
        "types": ["@iobroker/types"]
    },
    "include": ["src/**/*.ts", "src/**/*.d.ts"]
}
```

- [ ] **Step 4: Write `eslint.config.mjs`**

```js
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                allowDefaultProject: {
                    allow: ['*.js', '*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/check-param-names': 'off',
        },
    },
    {
        ignores: [
            'node_modules/**/*',
            'build/**/*',
            'admin/**/*',
            'test/**/*',
            'tmp/**/*',
            '**/*.mjs',
        ],
    },
];
```

- [ ] **Step 5: Write `prettier.config.mjs`**

```js
import prettierConfig from '@iobroker/eslint-config/prettier.config.mjs';

export default prettierConfig;
```

- [ ] **Step 6: Write `LICENSE`** — MIT text:

```
MIT License

Copyright (c) 2026 mokusone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json eslint.config.mjs prettier.config.mjs LICENSE
git commit -m "chore: project skeleton (package.json, tsconfig, lint, license)"
```

---

## Task 2: `io-package.json` (minimal, valid)

**Files:**
- Create: `io-package.json`

- [ ] **Step 1: Write `io-package.json`**

```json
{
    "common": {
        "name": "iob2hass",
        "version": "0.0.1",
        "news": {
            "0.0.1": {
                "en": "Initial scaffold",
                "de": "Initiales Skelett"
            }
        },
        "titleLang": {
            "en": "ioBroker → Home Assistant Bridge",
            "de": "ioBroker → Home Assistant Bridge"
        },
        "desc": {
            "en": "Mirrors selected ioBroker datapoints into Home Assistant via MQTT-Discovery",
            "de": "Spiegelt ausgewählte ioBroker-Datenpunkte per MQTT-Discovery nach Home Assistant"
        },
        "authors": ["mokusone <14061880+mokusone@users.noreply.github.com>"],
        "license": "MIT",
        "platform": "Javascript/Node.js",
        "mode": "daemon",
        "type": "general",
        "compact": true,
        "loglevel": "info",
        "icon": "iob2hass.png",
        "extIcon": "https://raw.githubusercontent.com/mokusone/ioBroker.iob2hass/main/admin/iob2hass.png",
        "keywords": ["mqtt", "homeassistant", "bridge"],
        "readme": "https://github.com/mokusone/ioBroker.iob2hass/blob/main/README.md",
        "connectionType": "local",
        "dataSource": "push",
        "adminUI": {
            "config": "json"
        },
        "dependencies": [{ "js-controller": ">=5.0.19" }],
        "globalDependencies": [{ "admin": ">=6.13.16" }]
    },
    "native": {
        "mqtt": {
            "host": "core-mosquitto",
            "port": 1883,
            "user": "",
            "password": "",
            "tls": false,
            "baseTopic": "iob2hass",
            "discoveryPrefix": "homeassistant"
        },
        "mode": "discover",
        "entityPrefix": "iob_",
        "autoDeleteOrphans": false,
        "markAsDiagnostic": false,
        "verboseDiscoverLog": false,
        "republishOnBoot": true,
        "whitelist": [],
        "overrides": []
    },
    "objects": [],
    "instanceObjects": [
        {
            "_id": "info.connection",
            "type": "state",
            "common": { "role": "indicator.connected", "name": "MQTT connection", "type": "boolean", "read": true, "write": false, "def": false },
            "native": {}
        },
        {
            "_id": "info.heartbeat",
            "type": "state",
            "common": { "role": "value", "name": "Last heartbeat (epoch ms)", "type": "number", "read": true, "write": false, "def": 0 },
            "native": {}
        },
        {
            "_id": "stats.subscribed",
            "type": "state",
            "common": { "role": "value", "name": "Subscribed patterns", "type": "number", "read": true, "write": false, "def": 0 },
            "native": {}
        },
        {
            "_id": "stats.published",
            "type": "state",
            "common": { "role": "value", "name": "Published states", "type": "number", "read": true, "write": false, "def": 0 },
            "native": {}
        },
        {
            "_id": "stats.unmapped",
            "type": "state",
            "common": { "role": "value", "name": "Unmapped events (discover mode)", "type": "number", "read": true, "write": false, "def": 0 },
            "native": {}
        },
        {
            "_id": "stats.errors",
            "type": "state",
            "common": { "role": "value", "name": "Errors", "type": "number", "read": true, "write": false, "def": 0 },
            "native": {}
        },
        {
            "_id": "cmd.cleanup",
            "type": "state",
            "common": { "role": "button", "name": "Cleanup all Discovery topics (use before uninstall)", "type": "boolean", "read": false, "write": true, "def": false },
            "native": {}
        }
    ]
}
```

- [ ] **Step 2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('io-package.json','utf8'))"`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add io-package.json
git commit -m "feat: io-package.json with native defaults and instance objects"
```

---

## Task 3: Shared types (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
// Runtime configuration shape (after normalization from native)
export interface RuntimeConfig {
    mqtt: {
        host: string;
        port: number;
        user: string;
        password: string;
        tls: boolean;
        baseTopic: string;
        discoveryPrefix: string;
    };
    mode: 'discover' | 'dry-run' | 'live';
    entityPrefix: string;
    autoDeleteOrphans: boolean;
    markAsDiagnostic: boolean;
    verboseDiscoverLog: boolean;
    republishOnBoot: boolean;
    whitelist: WhitelistEntry[];
    overrides: OverrideEntry[];
}

export interface WhitelistEntry {
    pattern: string;
    active: boolean;
    note?: string;
}

export interface OverrideEntry {
    pattern: string;
    domain?: HaDomain;
    unit?: string;
    role?: string;
    device_class?: string;
    state_class?: string;
    min?: number;
    max?: number;
}

export type HaDomain =
    | 'switch'
    | 'binary_sensor'
    | 'sensor'
    | 'light'
    | 'number'
    | 'text'
    | 'button'
    | 'climate'  // override-only in MVP
    | 'cover';   // override-only in MVP

export interface DiscoveryConfig {
    domain: HaDomain;
    payload: Record<string, unknown>;
}

// Subset of ioBroker.StateObject we read from
export interface IobStateObjectMinimal {
    common: {
        name?: string | { [lang: string]: string };
        type?: 'boolean' | 'number' | 'string' | 'mixed' | 'array' | 'object' | 'file';
        role?: string;
        unit?: string;
        min?: number;
        max?: number;
        read?: boolean;
        write?: boolean;
        states?: Record<string, string> | string[] | string;
    };
}

export interface MirrorEntry {
    dpId: string;          // original ioBroker DP id (e.g. "shelly.0.SHSW1#XYZ.Relay0.Switch")
    uniqueId: string;      // sanitized + prefixed id used in HA / topics
    domain: HaDomain;
    obj: IobStateObjectMinimal;
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): runtime config, whitelist, override, mirror entry shapes"
```

---

## Task 4: `sanitizer.ts` — DP-ID → entity slug (TDD)

**Files:**
- Create: `test/unit/sanitizer.test.ts`
- Create: `src/lib/sanitizer.ts`

- [ ] **Step 1: Write failing test**

`test/unit/sanitizer.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { sanitize, buildUniqueId } from '../../src/lib/sanitizer';

describe('sanitize', () => {
    it('lowercases', () => {
        assert.equal(sanitize('Shelly.0'), 'shelly_0');
    });
    it('replaces non [a-z0-9_] with underscore', () => {
        assert.equal(sanitize('shelly.0.SHSW1#abc'), 'shelly_0_shsw1_abc');
    });
    it('collapses multiple underscores', () => {
        assert.equal(sanitize('a..b##c'), 'a_b_c');
    });
    it('trims leading/trailing underscores', () => {
        assert.equal(sanitize('.foo.'), 'foo');
    });
    it('handles realistic Shelly DP', () => {
        assert.equal(
            sanitize('shelly.0.SHSW1#abc.Relay0.Switch'),
            'shelly_0_shsw1_abc_relay0_switch',
        );
    });
});

describe('buildUniqueId', () => {
    it('prepends entityPrefix', () => {
        assert.equal(
            buildUniqueId('shelly.0.Relay0', 'iob_'),
            'iob_shelly_0_relay0',
        );
    });
    it('handles empty prefix', () => {
        assert.equal(buildUniqueId('a.b', ''), 'a_b');
    });
});
```

- [ ] **Step 2: Run test — must FAIL**

Run: `npm run test:unit`
Expected: `Error: Cannot find module '../../src/lib/sanitizer'`.

- [ ] **Step 3: Implement `src/lib/sanitizer.ts`**

```typescript
/**
 * Sanitize an ioBroker DP-id into an HA-safe entity-id slug.
 * - lowercase
 * - non [a-z0-9_] → "_"
 * - collapse consecutive underscores
 * - trim edge underscores
 */
export function sanitize(dpId: string): string {
    return dpId
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/** Combine entity prefix and sanitized DP-id into a unique HA entity id slug. */
export function buildUniqueId(dpId: string, entityPrefix: string): string {
    return `${entityPrefix}${sanitize(dpId)}`;
}
```

- [ ] **Step 4: Run test — must PASS**

Run: `npm run test:unit`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sanitizer.ts test/unit/sanitizer.test.ts
git commit -m "feat(sanitizer): DP-id slug + unique-id builder with TDD"
```

---

## Task 5: `matcher.ts` — Glob matcher (TDD)

**Files:**
- Create: `test/unit/matcher.test.ts`
- Create: `src/lib/matcher.ts`

- [ ] **Step 1: Write failing test**

`test/unit/matcher.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { globToRegex, matches, anyMatches } from '../../src/lib/matcher';

describe('globToRegex', () => {
    it('escapes regex special chars except *', () => {
        const re = globToRegex('shelly.0.*');
        assert.equal(re.source, '^shelly\\.0\\..*$');
    });
    it('treats * as ".*"', () => {
        const re = globToRegex('*.Power');
        assert.equal(re.source, '^.*\\.Power$');
    });
});

describe('matches', () => {
    it('exact match', () => {
        assert.equal(matches('shelly.0.SHSW1', 'shelly.0.SHSW1'), true);
    });
    it('wildcard match', () => {
        assert.equal(matches('shelly.0.SHSW1.Power', 'shelly.0.*'), true);
        assert.equal(matches('homematic.0.x', 'shelly.0.*'), false);
    });
    it('cross-adapter wildcard match', () => {
        assert.equal(matches('shelly.0.SHSW1.Power', '*.Power'), true);
        assert.equal(matches('homematic.0.dev.Power', '*.Power'), true);
        assert.equal(matches('shelly.0.SHSW1.Energy', '*.Power'), false);
    });
    it('special chars in DP id are matched literally', () => {
        assert.equal(matches('shelly.0.SHSW1#abc', 'shelly.0.SHSW1#*'), true);
    });
});

describe('anyMatches', () => {
    it('returns true if any pattern matches', () => {
        assert.equal(
            anyMatches('shelly.0.x', ['homematic.0.*', 'shelly.0.*']),
            true,
        );
    });
    it('returns false if no pattern matches', () => {
        assert.equal(anyMatches('a.b', ['c.*', 'd.*']), false);
    });
});
```

- [ ] **Step 2: Run test — must FAIL**

Run: `npm run test:unit`
Expected: module not found.

- [ ] **Step 3: Implement `src/lib/matcher.ts`**

```typescript
const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

/** Convert a glob (with only `*` as wildcard) into an anchored RegExp. */
export function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(REGEX_SPECIAL, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

/** True if `id` matches the glob `pattern`. */
export function matches(id: string, pattern: string): boolean {
    return globToRegex(pattern).test(id);
}

/** True if `id` matches at least one of the glob patterns. */
export function anyMatches(id: string, patterns: string[]): boolean {
    return patterns.some(p => matches(id, p));
}
```

- [ ] **Step 4: Run test — must PASS**

Run: `npm run test:unit`
Expected: all matcher tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matcher.ts test/unit/matcher.test.ts
git commit -m "feat(matcher): glob-to-regex and match helpers with TDD"
```

---

## Task 6: `loop-guard.ts` — own-write filter (TDD)

**Files:**
- Create: `test/unit/loop-guard.test.ts`
- Create: `src/lib/loop-guard.ts`

- [ ] **Step 1: Write failing test**

`test/unit/loop-guard.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { isOwnWrite } from '../../src/lib/loop-guard';

describe('isOwnWrite', () => {
    const selfId = 'system.adapter.iob2hass.0';

    it('detects our own writes', () => {
        assert.equal(isOwnWrite({ from: selfId } as any, selfId), true);
    });
    it('passes foreign writes through', () => {
        assert.equal(isOwnWrite({ from: 'system.adapter.shelly.0' } as any, selfId), false);
    });
    it('treats missing from as foreign (safe default — pass through)', () => {
        assert.equal(isOwnWrite({} as any, selfId), false);
    });
});
```

- [ ] **Step 2: Run test — must FAIL**

Run: `npm run test:unit`

- [ ] **Step 3: Implement `src/lib/loop-guard.ts`**

```typescript
import type { State } from '@iobroker/types/build/iobroker';

/**
 * Returns true if the state event originates from our own adapter instance.
 * Such echoes from our own writes must be dropped to prevent loops.
 */
export function isOwnWrite(state: Partial<State> | null | undefined, selfId: string): boolean {
    return !!state && state.from === selfId;
}

/** Convenience: build the canonical self-id from instance number. */
export function buildSelfId(instance: number): string {
    return `system.adapter.iob2hass.${instance}`;
}
```

- [ ] **Step 4: Run test — must PASS**

Run: `npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/loop-guard.ts test/unit/loop-guard.test.ts
git commit -m "feat(loop-guard): own-write detection via state.from"
```

---

## Task 7: `discovery.ts` — domain selection (TDD, part 1/3)

**Files:**
- Create: `test/unit/discovery.test.ts`
- Create: `src/lib/discovery.ts`

- [ ] **Step 1: Write failing tests for domain selection**

`test/unit/discovery.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { selectDomain } from '../../src/lib/discovery';
import type { IobStateObjectMinimal } from '../../src/types';

function obj(common: Partial<IobStateObjectMinimal['common']>): IobStateObjectMinimal {
    return { common: { ...common } };
}

describe('selectDomain', () => {
    it('writable boolean → switch', () => {
        assert.equal(selectDomain(obj({ type: 'boolean', write: true })), 'switch');
    });
    it('readonly boolean → binary_sensor', () => {
        assert.equal(selectDomain(obj({ type: 'boolean', write: false })), 'binary_sensor');
    });
    it('writable number with dimmer role → light', () => {
        assert.equal(
            selectDomain(obj({ type: 'number', write: true, role: 'level.dimmer', min: 0, max: 100 })),
            'light',
        );
    });
    it('writable number without dimmer indicators → number', () => {
        assert.equal(
            selectDomain(obj({ type: 'number', write: true, role: 'value.power' })),
            'number',
        );
    });
    it('writable string → text', () => {
        assert.equal(selectDomain(obj({ type: 'string', write: true })), 'text');
    });
    it('writable mixed → text (fallback)', () => {
        assert.equal(selectDomain(obj({ type: 'mixed', write: true })), 'text');
    });
    it('readonly number → sensor', () => {
        assert.equal(selectDomain(obj({ type: 'number', write: false })), 'sensor');
    });
    it('readonly anything else → sensor', () => {
        assert.equal(selectDomain(obj({ type: 'string', write: false })), 'sensor');
    });
    it('missing write defaults to false (readonly)', () => {
        assert.equal(selectDomain(obj({ type: 'boolean' })), 'binary_sensor');
    });
});
```

- [ ] **Step 2: Run — must FAIL**

Run: `npm run test:unit`

- [ ] **Step 3: Implement `src/lib/discovery.ts` — domain selection only**

```typescript
import type { DiscoveryConfig, HaDomain, IobStateObjectMinimal, OverrideEntry, RuntimeConfig } from '../types';
import { buildUniqueId } from './sanitizer';
import { matches } from './matcher';

function isDimmer(common: IobStateObjectMinimal['common']): boolean {
    const role = common.role ?? '';
    const hasRange = common.min !== undefined && common.max !== undefined;
    return hasRange && /(level\.dimmer|level\.brightness)/.test(role);
}

export function selectDomain(obj: IobStateObjectMinimal): HaDomain {
    const c = obj.common;
    const write = c.write === true;
    const type = c.type;

    if (write) {
        if (type === 'boolean') return 'switch';
        if (type === 'number') {
            if (isDimmer(c)) return 'light';
            return 'number';
        }
        if (type === 'string') return 'text';
        return 'text'; // mixed / unknown writable → text
    }
    // read-only
    if (type === 'boolean') return 'binary_sensor';
    return 'sensor';
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery.ts test/unit/discovery.test.ts
git commit -m "feat(discovery): domain selection with TDD"
```

---

## Task 8: `discovery.ts` — device_class & state_class (TDD, part 2/3)

**Files:**
- Modify: `test/unit/discovery.test.ts`
- Modify: `src/lib/discovery.ts`

- [ ] **Step 1: Append failing tests for device_class heuristics**

Append to `test/unit/discovery.test.ts`:

```typescript
import { detectDeviceClass, detectStateClass } from '../../src/lib/discovery';

describe('detectDeviceClass', () => {
    it('value.power → power', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.power' })), 'power');
    });
    it('unit=W → power', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'W' })), 'power');
    });
    it('unit=kWh → energy', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'kWh' })), 'energy');
    });
    it('value.temperature → temperature', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.temperature' })), 'temperature');
    });
    it('unit=°C → temperature', () => {
        assert.equal(detectDeviceClass(obj({ unit: '°C' })), 'temperature');
    });
    it('value.humidity → humidity', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.humidity' })), 'humidity');
    });
    it('sensor.motion → motion', () => {
        assert.equal(detectDeviceClass(obj({ role: 'sensor.motion' })), 'motion');
    });
    it('sensor.window → opening', () => {
        assert.equal(detectDeviceClass(obj({ role: 'sensor.window' })), 'opening');
    });
    it('unit=V → voltage', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'V' })), 'voltage');
    });
    it('unit=A → current', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'A' })), 'current');
    });
    it('unknown → undefined', () => {
        assert.equal(detectDeviceClass(obj({ role: 'state' })), undefined);
    });
});

describe('detectStateClass', () => {
    it('energy → total_increasing', () => {
        assert.equal(detectStateClass(obj({ unit: 'kWh' })), 'total_increasing');
    });
    it('power → measurement', () => {
        assert.equal(detectStateClass(obj({ unit: 'W' })), 'measurement');
    });
    it('temperature → measurement', () => {
        assert.equal(detectStateClass(obj({ unit: '°C' })), 'measurement');
    });
    it('unknown → undefined', () => {
        assert.equal(detectStateClass(obj({ role: 'state' })), undefined);
    });
});
```

- [ ] **Step 2: Run — must FAIL**

- [ ] **Step 3: Extend `src/lib/discovery.ts` with detectors**

Append after `selectDomain`:

```typescript
const POWER_UNITS = new Set(['W', 'kW']);
const ENERGY_UNITS = new Set(['kWh', 'Wh', 'MWh']);
const TEMP_UNITS = new Set(['°C', '°F']);

export function detectDeviceClass(obj: IobStateObjectMinimal): string | undefined {
    const role = obj.common.role ?? '';
    const unit = obj.common.unit ?? '';

    if (role.includes('value.power') || POWER_UNITS.has(unit)) return 'power';
    if (role.includes('value.energy') || ENERGY_UNITS.has(unit)) return 'energy';
    if (role.includes('value.temperature') || TEMP_UNITS.has(unit)) return 'temperature';
    if (role.includes('value.humidity') || (role.includes('humidity') && unit === '%')) return 'humidity';
    if (role.includes('sensor.motion')) return 'motion';
    if (role.includes('sensor.window') || role.includes('sensor.door')) return 'opening';
    if (role.includes('value.voltage') || unit === 'V') return 'voltage';
    if (role.includes('value.current') || unit === 'A') return 'current';
    return undefined;
}

export function detectStateClass(obj: IobStateObjectMinimal): string | undefined {
    const dc = detectDeviceClass(obj);
    if (dc === 'energy') return 'total_increasing';
    if (dc === 'power' || dc === 'temperature' || dc === 'humidity' || dc === 'voltage' || dc === 'current') {
        return 'measurement';
    }
    return undefined;
}
```

- [ ] **Step 4: Run — must PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery.ts test/unit/discovery.test.ts
git commit -m "feat(discovery): device_class and state_class heuristics"
```

---

## Task 9: `discovery.ts` — `buildConfig()` with overrides (TDD, part 3/3)

**Files:**
- Modify: `test/unit/discovery.test.ts`
- Modify: `src/lib/discovery.ts`

- [ ] **Step 1: Append failing tests**

Append to `test/unit/discovery.test.ts`:

```typescript
import { buildConfig } from '../../src/lib/discovery';
import type { RuntimeConfig } from '../../src/types';

const baseConfig: RuntimeConfig = {
    mqtt: { host: 'h', port: 1883, user: '', password: '', tls: false, baseTopic: 'iob2hass', discoveryPrefix: 'homeassistant' },
    mode: 'live',
    entityPrefix: 'iob_',
    autoDeleteOrphans: false,
    markAsDiagnostic: false,
    verboseDiscoverLog: false,
    republishOnBoot: true,
    whitelist: [],
    overrides: [],
};

describe('buildConfig', () => {
    it('builds switch with availability + device + command_topic', () => {
        const cfg = buildConfig('shelly.0.Relay0', obj({ type: 'boolean', write: true, name: 'Relay 0' }), baseConfig, 0);
        assert.equal(cfg.domain, 'switch');
        const p = cfg.payload;
        assert.equal(p.unique_id, 'iob_shelly_0_relay0');
        assert.equal(p.object_id, 'iob_shelly_0_relay0');
        assert.equal(p.name, 'Relay 0');
        assert.equal(p.state_topic, 'iob2hass/state/iob_shelly_0_relay0');
        assert.equal(p.command_topic, 'iob2hass/cmd/iob_shelly_0_relay0');
        assert.deepEqual(p.availability, { topic: 'iob2hass/status', payload_available: 'online', payload_not_available: 'offline' });
        const dev = p.device as Record<string, unknown>;
        assert.deepEqual(dev.identifiers, ['iob2hass-0']);
        assert.equal(dev.name, 'ioBroker Bridge');
    });

    it('sensor for read-only number with power detection', () => {
        const cfg = buildConfig('shelly.0.Power', obj({ type: 'number', write: false, role: 'value.power', unit: 'W' }), baseConfig, 0);
        assert.equal(cfg.domain, 'sensor');
        assert.equal(cfg.payload.device_class, 'power');
        assert.equal(cfg.payload.state_class, 'measurement');
        assert.equal(cfg.payload.unit_of_measurement, 'W');
        assert.equal(cfg.payload.command_topic, undefined);
    });

    it('falls back name to sanitized id when common.name missing', () => {
        const cfg = buildConfig('shelly.0.x', obj({ type: 'boolean', write: false }), baseConfig, 0);
        assert.equal(cfg.payload.name, 'iob_shelly_0_x');
    });

    it('override unit patches auto-detected unit', () => {
        const cfg = buildConfig(
            'shelly.0.Power',
            obj({ type: 'number', write: false, role: 'value.power', unit: 'W' }),
            { ...baseConfig, overrides: [{ pattern: 'shelly.0.Power', unit: 'mW' }] },
            0,
        );
        assert.equal(cfg.payload.unit_of_measurement, 'mW');
        assert.equal(cfg.payload.device_class, 'power');  // not overridden
    });

    it('override domain switches domain entirely', () => {
        const cfg = buildConfig(
            'shelly.0.X',
            obj({ type: 'number', write: true }),
            { ...baseConfig, overrides: [{ pattern: '*.X', domain: 'light' }] },
            0,
        );
        assert.equal(cfg.domain, 'light');
    });

    it('later override wins over earlier (merge-by-order)', () => {
        const cfg = buildConfig(
            'shelly.0.Power',
            obj({ type: 'number', write: false }),
            {
                ...baseConfig,
                overrides: [
                    { pattern: '*.Power', unit: 'W', device_class: 'power' },
                    { pattern: 'shelly.0.Power', unit: 'mW' },
                ],
            },
            0,
        );
        assert.equal(cfg.payload.unit_of_measurement, 'mW');
        assert.equal(cfg.payload.device_class, 'power');  // from earlier, not overridden
    });

    it('markAsDiagnostic sets entity_category', () => {
        const cfg = buildConfig(
            'a.b',
            obj({ type: 'boolean', write: false }),
            { ...baseConfig, markAsDiagnostic: true },
            0,
        );
        assert.equal(cfg.payload.entity_category, 'diagnostic');
    });
});
```

- [ ] **Step 2: Run — must FAIL**

- [ ] **Step 3: Extend `src/lib/discovery.ts` with `buildConfig`**

Append to `src/lib/discovery.ts`:

```typescript
function resolveName(dpId: string, obj: IobStateObjectMinimal, uniqueId: string): string {
    const n = obj.common.name;
    if (typeof n === 'string' && n.length > 0) return n;
    if (n && typeof n === 'object') {
        return n.en ?? n.de ?? Object.values(n)[0] ?? uniqueId;
    }
    return uniqueId;
}

function applyOverrides(
    target: Record<string, unknown> & { domain?: string },
    dpId: string,
    overrides: OverrideEntry[],
): { domain?: HaDomain } {
    let domain: HaDomain | undefined;
    for (const ov of overrides) {
        if (!matches(dpId, ov.pattern)) continue;
        if (ov.domain) domain = ov.domain;
        if (ov.unit !== undefined) target.unit_of_measurement = ov.unit;
        if (ov.device_class !== undefined) target.device_class = ov.device_class;
        if (ov.state_class !== undefined) target.state_class = ov.state_class;
        if (ov.min !== undefined) target.min = ov.min;
        if (ov.max !== undefined) target.max = ov.max;
    }
    return { domain };
}

export function buildConfig(
    dpId: string,
    obj: IobStateObjectMinimal,
    config: RuntimeConfig,
    instance: number,
): DiscoveryConfig {
    const uniqueId = buildUniqueId(dpId, config.entityPrefix);
    const auto = selectDomain(obj);
    const deviceClass = detectDeviceClass(obj);
    const stateClass = detectStateClass(obj);

    const payload: Record<string, unknown> = {
        unique_id: uniqueId,
        object_id: uniqueId,
        name: resolveName(dpId, obj, uniqueId),
        state_topic: `${config.mqtt.baseTopic}/state/${uniqueId}`,
        availability: {
            topic: `${config.mqtt.baseTopic}/status`,
            payload_available: 'online',
            payload_not_available: 'offline',
        },
        device: {
            identifiers: [`iob2hass-${instance}`],
            name: 'ioBroker Bridge',
            manufacturer: 'iob2hass',
            model: 'Mirror-Bridge',
        },
    };

    if (deviceClass) payload.device_class = deviceClass;
    if (stateClass) payload.state_class = stateClass;
    if (obj.common.unit) payload.unit_of_measurement = obj.common.unit;
    if (config.markAsDiagnostic) payload.entity_category = 'diagnostic';

    // overrides patch the payload, may also switch domain
    const { domain: overrideDomain } = applyOverrides(payload, dpId, config.overrides);
    const domain: HaDomain = overrideDomain ?? auto;

    // schreibende Domains bekommen command_topic
    if (domain === 'switch' || domain === 'light' || domain === 'number' || domain === 'text' || domain === 'button') {
        payload.command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}`;
    }

    if (domain === 'switch') {
        payload.payload_on = true;
        payload.payload_off = false;
    }

    if (domain === 'light' && obj.common.max !== undefined) {
        payload.brightness_command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}/brightness`;
        payload.brightness_scale = obj.common.max;
    }

    return { domain, payload };
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npm run test:unit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery.ts test/unit/discovery.test.ts
git commit -m "feat(discovery): buildConfig with overrides, availability, command_topic"
```

---

## Task 10: `config.ts` — RuntimeConfig from native (with validation)

**Files:**
- Create: `src/lib/config.ts`
- Create: `test/unit/config.test.ts`

- [ ] **Step 1: Write failing test**

`test/unit/config.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { normalizeConfig, ConfigError } from '../../src/lib/config';

describe('normalizeConfig', () => {
    it('fills defaults for missing fields', () => {
        const cfg = normalizeConfig({});
        assert.equal(cfg.mqtt.host, 'core-mosquitto');
        assert.equal(cfg.mqtt.port, 1883);
        assert.equal(cfg.mqtt.baseTopic, 'iob2hass');
        assert.equal(cfg.mqtt.discoveryPrefix, 'homeassistant');
        assert.equal(cfg.mode, 'discover');
        assert.equal(cfg.entityPrefix, 'iob_');
        assert.deepEqual(cfg.whitelist, []);
        assert.deepEqual(cfg.overrides, []);
    });

    it('throws on invalid mode', () => {
        assert.throws(() => normalizeConfig({ mode: 'nope' }), ConfigError);
    });

    it('coerces active flag in whitelist entries', () => {
        const cfg = normalizeConfig({ whitelist: [{ pattern: 'a.*' }] });
        assert.equal(cfg.whitelist[0].active, true);  // default active
    });

    it('drops whitelist entries with empty pattern', () => {
        const cfg = normalizeConfig({ whitelist: [{ pattern: '', active: true }, { pattern: 'shelly.*' }] });
        assert.equal(cfg.whitelist.length, 1);
        assert.equal(cfg.whitelist[0].pattern, 'shelly.*');
    });

    it('drops override entries with empty pattern', () => {
        const cfg = normalizeConfig({ overrides: [{ pattern: '' }, { pattern: '*.X', unit: 'V' }] });
        assert.equal(cfg.overrides.length, 1);
    });
});
```

- [ ] **Step 2: Run — must FAIL**

- [ ] **Step 3: Implement `src/lib/config.ts`**

```typescript
import type { RuntimeConfig, WhitelistEntry, OverrideEntry } from '../types';

export class ConfigError extends Error {}

const DEFAULTS: RuntimeConfig = {
    mqtt: {
        host: 'core-mosquitto',
        port: 1883,
        user: '',
        password: '',
        tls: false,
        baseTopic: 'iob2hass',
        discoveryPrefix: 'homeassistant',
    },
    mode: 'discover',
    entityPrefix: 'iob_',
    autoDeleteOrphans: false,
    markAsDiagnostic: false,
    verboseDiscoverLog: false,
    republishOnBoot: true,
    whitelist: [],
    overrides: [],
};

function pickString(v: unknown, dflt: string): string {
    return typeof v === 'string' && v.length > 0 ? v : dflt;
}
function pickNumber(v: unknown, dflt: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}
function pickBool(v: unknown, dflt: boolean): boolean {
    return typeof v === 'boolean' ? v : dflt;
}

function normWhitelist(raw: unknown): WhitelistEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((e: any) => ({
            pattern: typeof e?.pattern === 'string' ? e.pattern.trim() : '',
            active: typeof e?.active === 'boolean' ? e.active : true,
            note: typeof e?.note === 'string' ? e.note : undefined,
        }))
        .filter(e => e.pattern.length > 0);
}

function normOverrides(raw: unknown): OverrideEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((e: any) => ({
            pattern: typeof e?.pattern === 'string' ? e.pattern.trim() : '',
            domain: typeof e?.domain === 'string' ? e.domain : undefined,
            unit: typeof e?.unit === 'string' ? e.unit : undefined,
            role: typeof e?.role === 'string' ? e.role : undefined,
            device_class: typeof e?.device_class === 'string' ? e.device_class : undefined,
            state_class: typeof e?.state_class === 'string' ? e.state_class : undefined,
            min: typeof e?.min === 'number' ? e.min : undefined,
            max: typeof e?.max === 'number' ? e.max : undefined,
        }))
        .filter(e => e.pattern.length > 0);
}

export function normalizeConfig(native: any): RuntimeConfig {
    const mode = native?.mode ?? DEFAULTS.mode;
    if (!['discover', 'dry-run', 'live'].includes(mode)) {
        throw new ConfigError(`Invalid mode: ${mode}`);
    }
    const mqtt = native?.mqtt ?? {};
    return {
        mqtt: {
            host: pickString(mqtt.host, DEFAULTS.mqtt.host),
            port: pickNumber(mqtt.port, DEFAULTS.mqtt.port),
            user: pickString(mqtt.user, DEFAULTS.mqtt.user),
            password: pickString(mqtt.password, DEFAULTS.mqtt.password),
            tls: pickBool(mqtt.tls, DEFAULTS.mqtt.tls),
            baseTopic: pickString(mqtt.baseTopic, DEFAULTS.mqtt.baseTopic),
            discoveryPrefix: pickString(mqtt.discoveryPrefix, DEFAULTS.mqtt.discoveryPrefix),
        },
        mode,
        entityPrefix: pickString(native?.entityPrefix, DEFAULTS.entityPrefix),
        autoDeleteOrphans: pickBool(native?.autoDeleteOrphans, DEFAULTS.autoDeleteOrphans),
        markAsDiagnostic: pickBool(native?.markAsDiagnostic, DEFAULTS.markAsDiagnostic),
        verboseDiscoverLog: pickBool(native?.verboseDiscoverLog, DEFAULTS.verboseDiscoverLog),
        republishOnBoot: pickBool(native?.republishOnBoot, DEFAULTS.republishOnBoot),
        whitelist: normWhitelist(native?.whitelist),
        overrides: normOverrides(native?.overrides),
    };
}
```

- [ ] **Step 4: Run — must PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts test/unit/config.test.ts
git commit -m "feat(config): runtime config normalization with defaults and validation"
```

---

## Task 11: `stats.ts` — Adapter-State counters

**Files:**
- Create: `src/lib/stats.ts`

This module is a thin wrapper. No new tests — covered by integration test in Task 18.

- [ ] **Step 1: Implement `src/lib/stats.ts`**

```typescript
import type { Adapter } from '@iobroker/adapter-core';

export class Stats {
    private counters: Record<string, number> = {
        subscribed: 0,
        published: 0,
        unmapped: 0,
        errors: 0,
    };

    constructor(private readonly adapter: Adapter) {}

    async reset(): Promise<void> {
        this.counters = { subscribed: 0, published: 0, unmapped: 0, errors: 0 };
        await Promise.all(Object.keys(this.counters).map(k => this.adapter.setStateAsync(`stats.${k}`, 0, true)));
    }

    async incr(key: 'subscribed' | 'published' | 'unmapped' | 'errors', by = 1): Promise<void> {
        this.counters[key] += by;
        await this.adapter.setStateAsync(`stats.${key}`, this.counters[key], true);
    }

    async setConnection(connected: boolean): Promise<void> {
        await this.adapter.setStateAsync('info.connection', connected, true);
    }

    async heartbeat(): Promise<void> {
        await this.adapter.setStateAsync('info.heartbeat', Date.now(), true);
    }
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stats.ts
git commit -m "feat(stats): adapter-state counters and connection/heartbeat helpers"
```

---

## Task 12: `mqtt-client.ts` — MQTT wrapper with aedes-based integration test

**Files:**
- Create: `src/lib/mqtt-client.ts`
- Create: `test/integration/mqtt-client.test.ts`

- [ ] **Step 1: Write failing integration test**

`test/integration/mqtt-client.test.ts`:

```typescript
import assert from 'node:assert/strict';
import net from 'node:net';
import Aedes from 'aedes';
import { MqttClient } from '../../src/lib/mqtt-client';

describe('MqttClient (against aedes)', function () {
    this.timeout(10_000);

    let broker: any;
    let server: net.Server;
    const PORT = 18831;

    beforeEach(done => {
        broker = new (Aedes as any)();
        server = net.createServer(broker.handle);
        server.listen(PORT, () => done());
    });

    afterEach(done => {
        server.close(() => broker.close(() => done()));
    });

    it('connects, publishes LWT online, and reports connected', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        assert.equal(c.isConnected(), true);
        await c.close();
    });

    it('publishes retained messages that survive', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained('iob2hass-test/state/x', 'hello');

        // second client subscribes and should receive retained payload
        const received: Array<{ topic: string; payload: string }> = [];
        const c2 = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test2' });
        await c2.connect();
        c2.onMessage((topic, payload) => received.push({ topic, payload }));
        await c2.subscribe('iob2hass-test/state/+');
        await new Promise(r => setTimeout(r, 200));

        assert.equal(received.length, 1);
        assert.equal(received[0].topic, 'iob2hass-test/state/x');
        assert.equal(received[0].payload, 'hello');

        await c.close();
        await c2.close();
    });
});
```

- [ ] **Step 2: Run — must FAIL** (module missing)

Run: `npm run test:integration`

- [ ] **Step 3: Implement `src/lib/mqtt-client.ts`**

```typescript
import * as mqtt from 'mqtt';

export interface MqttOptions {
    host: string;
    port: number;
    user?: string;
    password?: string;
    tls?: boolean;
    baseTopic: string;
}

type MessageHandler = (topic: string, payload: string) => void;

export class MqttClient {
    private client: mqtt.MqttClient | undefined;
    private handler: MessageHandler | undefined;

    constructor(private readonly opts: MqttOptions) {}

    async connect(): Promise<void> {
        const protocol = this.opts.tls ? 'mqtts' : 'mqtt';
        const url = `${protocol}://${this.opts.host}:${this.opts.port}`;
        const statusTopic = `${this.opts.baseTopic}/status`;
        this.client = mqtt.connect(url, {
            username: this.opts.user || undefined,
            password: this.opts.password || undefined,
            will: {
                topic: statusTopic,
                payload: Buffer.from('offline'),
                qos: 0,
                retain: true,
            },
            clean: true,
            reconnectPeriod: 5000,
        });

        await new Promise<void>((resolve, reject) => {
            const onConnect = (): void => {
                this.client!.removeListener('error', onError);
                resolve();
            };
            const onError = (err: Error): void => {
                this.client!.removeListener('connect', onConnect);
                reject(err);
            };
            this.client!.once('connect', onConnect);
            this.client!.once('error', onError);
        });

        // publish online after connect
        await this.publishRetained(statusTopic, 'online');

        this.client.on('message', (topic, payload) => {
            this.handler?.(topic, payload.toString());
        });
    }

    isConnected(): boolean {
        return this.client?.connected === true;
    }

    async publishRetained(topic: string, payload: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.publish(topic, payload, { retain: true, qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    async publish(topic: string, payload: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.publish(topic, payload, { retain: false, qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    async subscribe(topic: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.subscribe(topic, { qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    async close(): Promise<void> {
        if (!this.client) return;
        const statusTopic = `${this.opts.baseTopic}/status`;
        await this.publishRetained(statusTopic, 'offline').catch(() => undefined);
        await new Promise<void>(resolve => this.client!.end(false, {}, () => resolve()));
        this.client = undefined;
    }
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npm run test:integration`

- [ ] **Step 5: Commit**

```bash
git add src/lib/mqtt-client.ts test/integration/mqtt-client.test.ts
git commit -m "feat(mqtt-client): mqtt wrapper with LWT, retained publish, subscribe"
```

---

## Task 13: `command-router.ts` — HA → ioBroker writes

**Files:**
- Create: `src/lib/command-router.ts`
- Create: `test/integration/command-router.test.ts`

- [ ] **Step 1: Write failing test (with fake adapter)**

`test/integration/command-router.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { CommandRouter } from '../../src/lib/command-router';

function fakeAdapter() {
    const writes: Array<{ id: string; value: unknown; ack: boolean }> = [];
    return {
        writes,
        setForeignStateAsync: async (id: string, value: unknown, ack: boolean) => {
            writes.push({ id, value, ack });
        },
        log: { warn: () => undefined, error: () => undefined, debug: () => undefined },
    };
}

describe('CommandRouter', () => {
    it('routes command to setForeignStateAsync with ack=false for writable DP', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_shelly_0_relay0', 'shelly.0.Relay0', { common: { type: 'boolean', write: true } });

        await r.handleMessage('iob2hass/cmd/iob_shelly_0_relay0', 'true');

        assert.equal(a.writes.length, 1);
        assert.equal(a.writes[0].id, 'shelly.0.Relay0');
        assert.equal(a.writes[0].value, true);
        assert.equal(a.writes[0].ack, false);
    });

    it('parses numeric payload as number', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_x_y', 'x.y', { common: { type: 'number', write: true } });

        await r.handleMessage('iob2hass/cmd/iob_x_y', '42.5');
        assert.equal(a.writes[0].value, 42.5);
    });

    it('blocks writes to read-only DPs', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_x_y', 'x.y', { common: { type: 'boolean', write: false } });

        const before = a.writes.length;
        await r.handleMessage('iob2hass/cmd/iob_x_y', 'true');
        assert.equal(a.writes.length, before);
    });

    it('ignores unknown unique_id', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        await r.handleMessage('iob2hass/cmd/nonexistent', 'true');
        assert.equal(a.writes.length, 0);
    });
});
```

- [ ] **Step 2: Run — must FAIL**

- [ ] **Step 3: Implement `src/lib/command-router.ts`**

```typescript
import type { Adapter } from '@iobroker/adapter-core';
import type { IobStateObjectMinimal } from '../types';

interface MirrorRef {
    dpId: string;
    obj: IobStateObjectMinimal;
}

export class CommandRouter {
    private readonly mirrors = new Map<string, MirrorRef>();

    constructor(
        private readonly adapter: Adapter,
        private readonly baseTopic: string,
    ) {}

    registerMirror(uniqueId: string, dpId: string, obj: IobStateObjectMinimal): void {
        this.mirrors.set(uniqueId, { dpId, obj });
    }

    clear(): void {
        this.mirrors.clear();
    }

    async handleMessage(topic: string, payload: string): Promise<void> {
        const prefix = `${this.baseTopic}/cmd/`;
        if (!topic.startsWith(prefix)) return;
        const uniqueId = topic.slice(prefix.length).split('/')[0];
        const ref = this.mirrors.get(uniqueId);
        if (!ref) {
            this.adapter.log.debug(`Unknown command topic: ${topic}`);
            return;
        }
        if (ref.obj.common.write !== true) {
            this.adapter.log.warn(`Refusing write to read-only DP ${ref.dpId}`);
            return;
        }
        const value = parsePayload(payload, ref.obj.common.type);
        try {
            await this.adapter.setForeignStateAsync(ref.dpId, value as any, false);
        } catch (e) {
            this.adapter.log.error(`setForeignStateAsync(${ref.dpId}) failed: ${(e as Error).message}`);
        }
    }
}

function parsePayload(raw: string, type: string | undefined): unknown {
    if (type === 'boolean') {
        if (raw === 'true' || raw === '1' || raw === 'ON') return true;
        if (raw === 'false' || raw === '0' || raw === 'OFF') return false;
        return raw;
    }
    if (type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : raw;
    }
    return raw;
}
```

- [ ] **Step 4: Run — must PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/command-router.ts test/integration/command-router.test.ts
git commit -m "feat(command-router): HA → ioBroker write path with read-only guard"
```

---

## Task 14: `reconcile.ts` — Discovery cleanup for orphans

**Files:**
- Create: `src/lib/reconcile.ts`
- Create: `test/integration/reconcile.test.ts`

- [ ] **Step 1: Write failing test**

`test/integration/reconcile.test.ts`:

```typescript
import assert from 'node:assert/strict';
import net from 'node:net';
import Aedes from 'aedes';
import { MqttClient } from '../../src/lib/mqtt-client';
import { collectExistingDiscoveryTopics, publishOrphanDeletions } from '../../src/lib/reconcile';

describe('reconcile', function () {
    this.timeout(10_000);
    let broker: any;
    let server: net.Server;
    const PORT = 18832;

    beforeEach(done => {
        broker = new (Aedes as any)();
        server = net.createServer(broker.handle);
        server.listen(PORT, () => done());
    });

    afterEach(done => {
        server.close(() => broker.close(() => done()));
    });

    it('detects existing retained Discovery topics under prefix', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained(
            'homeassistant/switch/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );
        await c.publishRetained(
            'homeassistant/sensor/foreign_x/config',
            JSON.stringify({ unique_id: 'foreign_x' }),
        );

        const found = await collectExistingDiscoveryTopics(c, 'homeassistant', 'iob2hass-0', 2000);
        assert.deepEqual(found, ['homeassistant/switch/iob_a/config']);

        await c.close();
    });

    it('publishes empty retained payload for orphans only', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained(
            'homeassistant/switch/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );
        await c.publishRetained(
            'homeassistant/sensor/iob_b/config',
            JSON.stringify({ unique_id: 'iob_b', device: { identifiers: ['iob2hass-0'] } }),
        );

        const all = await collectExistingDiscoveryTopics(c, 'homeassistant', 'iob2hass-0', 2000);
        assert.equal(all.length, 2);

        // keep only iob_a
        const deleted = await publishOrphanDeletions(c, all, new Set(['iob_a']));
        assert.deepEqual(deleted, ['homeassistant/sensor/iob_b/config']);

        await c.close();
    });
});
```

- [ ] **Step 2: Run — must FAIL**

- [ ] **Step 3: Implement `src/lib/reconcile.ts`**

```typescript
import type { MqttClient } from './mqtt-client';

interface MqttClientInternal extends MqttClient {
    onMessage(handler: (topic: string, payload: string) => void): void;
    subscribe(topic: string): Promise<void>;
}

/**
 * Subscribes to `<discoveryPrefix>/+/+/config` for a short collection window
 * and returns topic-paths whose retained payload contains our identifier.
 */
export async function collectExistingDiscoveryTopics(
    client: MqttClient,
    discoveryPrefix: string,
    selfIdentifier: string,
    windowMs: number,
): Promise<string[]> {
    const found: string[] = [];
    const internal = client as MqttClientInternal;
    internal.onMessage((topic, payload) => {
        if (!topic.startsWith(`${discoveryPrefix}/`)) return;
        if (!topic.endsWith('/config')) return;
        try {
            const parsed = JSON.parse(payload);
            const ids = parsed?.device?.identifiers as string[] | undefined;
            if (Array.isArray(ids) && ids.includes(selfIdentifier)) {
                found.push(topic);
            }
        } catch {
            // ignore malformed configs
        }
    });
    await internal.subscribe(`${discoveryPrefix}/+/+/config`);
    await new Promise(r => setTimeout(r, windowMs));
    return found;
}

/**
 * For each existing topic whose unique_id is NOT in `keepUniqueIds`,
 * publishes an empty retained payload to delete it on the HA side.
 * Returns the list of topics that were deleted.
 */
export async function publishOrphanDeletions(
    client: MqttClient,
    existingTopics: string[],
    keepUniqueIds: Set<string>,
): Promise<string[]> {
    const deleted: string[] = [];
    for (const topic of existingTopics) {
        const match = topic.match(/\/([^/]+)\/config$/);
        const uniqueId = match?.[1];
        if (uniqueId && !keepUniqueIds.has(uniqueId)) {
            await client.publishRetained(topic, '');
            deleted.push(topic);
        }
    }
    return deleted;
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npm run test:integration`

- [ ] **Step 5: Commit**

```bash
git add src/lib/reconcile.ts test/integration/reconcile.test.ts
git commit -m "feat(reconcile): scan existing Discovery topics and delete orphans"
```

---

## Task 15: `main.ts` — adapter lifecycle and boot pipeline

**Files:**
- Create: `src/main.ts`

This is the orchestrator. No standalone unit tests (covered by `test/integration/boot.test.ts` in Task 18).

- [ ] **Step 1: Write `src/main.ts`**

```typescript
import * as utils from '@iobroker/adapter-core';
import { normalizeConfig } from './lib/config';
import { MqttClient } from './lib/mqtt-client';
import { CommandRouter } from './lib/command-router';
import { Stats } from './lib/stats';
import { buildConfig } from './lib/discovery';
import { buildUniqueId } from './lib/sanitizer';
import { isOwnWrite, buildSelfId } from './lib/loop-guard';
import { collectExistingDiscoveryTopics, publishOrphanDeletions } from './lib/reconcile';
import type { RuntimeConfig, IobStateObjectMinimal, MirrorEntry } from './types';

class Iob2HassAdapter extends utils.Adapter {
    private runtime!: RuntimeConfig;
    private mqtt!: MqttClient;
    private cmd!: CommandRouter;
    private stats!: Stats;
    private mirrors = new Map<string, MirrorEntry>();
    private selfId!: string;

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'iob2hass' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    private async onReady(): Promise<void> {
        this.selfId = buildSelfId(this.instance);
        try {
            this.runtime = normalizeConfig(this.config);
        } catch (e) {
            this.log.error(`Config error: ${(e as Error).message}`);
            return;
        }
        this.stats = new Stats(this as any);
        await this.stats.reset();

        // MQTT
        this.mqtt = new MqttClient({
            host: this.runtime.mqtt.host,
            port: this.runtime.mqtt.port,
            user: this.runtime.mqtt.user || undefined,
            password: this.runtime.mqtt.password || undefined,
            tls: this.runtime.mqtt.tls,
            baseTopic: this.runtime.mqtt.baseTopic,
        });

        try {
            await this.mqtt.connect();
            await this.stats.setConnection(true);
        } catch (e) {
            this.log.error(`MQTT connect failed: ${(e as Error).message}`);
            await this.stats.setConnection(false);
            return;
        }

        this.cmd = new CommandRouter(this as any, this.runtime.mqtt.baseTopic);
        this.mqtt.onMessage((topic, payload) => this.onMqttMessage(topic, payload));

        // Build mirror set for active whitelist
        await this.buildAndPublishMirrors();

        // Reconcile orphan discoveries
        if (this.runtime.autoDeleteOrphans && this.runtime.whitelist.length > 0) {
            const keep = new Set(Array.from(this.mirrors.values()).map(m => m.uniqueId));
            const selfIdentifier = `iob2hass-${this.instance}`;
            const existing = await collectExistingDiscoveryTopics(this.mqtt, this.runtime.mqtt.discoveryPrefix, selfIdentifier, 2000);
            const deleted = await publishOrphanDeletions(this.mqtt, existing, keep);
            if (deleted.length > 0) {
                this.log.info(`Deleted ${deleted.length} orphan Discovery topics`);
            }
        }

        // Subscribe to state changes per active whitelist pattern
        for (const w of this.runtime.whitelist) {
            if (!w.active) continue;
            await this.subscribeForeignStatesAsync(w.pattern);
            await this.stats.incr('subscribed');
        }

        // Subscribe to MQTT command topics + HA birth
        await this.mqtt.subscribe(`${this.runtime.mqtt.baseTopic}/cmd/#`);
        await this.mqtt.subscribe(`${this.runtime.mqtt.discoveryPrefix}/status`);

        // Subscribe to own cmd.cleanup state (button)
        await this.subscribeStatesAsync('cmd.cleanup');

        await this.stats.heartbeat();
        this.log.info(`Adapter ready, mode=${this.runtime.mode}, mirrors=${this.mirrors.size}`);
    }

    private async buildAndPublishMirrors(): Promise<void> {
        this.mirrors.clear();
        this.cmd.clear();
        const allKeep = new Set<string>();
        for (const w of this.runtime.whitelist) {
            if (!w.active) continue;
            const objects = await this.getForeignObjectsAsync(w.pattern, 'state');
            for (const [dpId, obj] of Object.entries(objects ?? {})) {
                if (!obj) continue;
                const minimal: IobStateObjectMinimal = { common: (obj as any).common ?? {} };
                const uniqueId = buildUniqueId(dpId, this.runtime.entityPrefix);
                if (allKeep.has(uniqueId)) continue;
                const dc = buildConfig(dpId, minimal, this.runtime, this.instance);
                const entry: MirrorEntry = { dpId, uniqueId, domain: dc.domain, obj: minimal };
                this.mirrors.set(uniqueId, entry);
                allKeep.add(uniqueId);
                this.cmd.registerMirror(uniqueId, dpId, minimal);

                if (this.runtime.mode === 'live') {
                    const topic = `${this.runtime.mqtt.discoveryPrefix}/${dc.domain}/${uniqueId}/config`;
                    await this.mqtt.publishRetained(topic, JSON.stringify(dc.payload));
                } else if (this.runtime.mode === 'dry-run') {
                    this.log.info(`[dry-run] would publish ${dc.domain}/${uniqueId}: ${JSON.stringify(dc.payload)}`);
                }
            }
        }

        if (this.runtime.mode === 'live' && this.runtime.republishOnBoot) {
            await this.republishAllStates();
        }
    }

    private async republishAllStates(): Promise<void> {
        for (const m of this.mirrors.values()) {
            const st = await this.getForeignStateAsync(m.dpId);
            if (st?.val !== undefined && st.val !== null) {
                await this.publishMirrorState(m, st.val);
            }
        }
    }

    private async publishMirrorState(m: MirrorEntry, val: unknown): Promise<void> {
        const topic = `${this.runtime.mqtt.baseTopic}/state/${m.uniqueId}`;
        const payload = typeof val === 'string' ? val : JSON.stringify(val);
        await this.mqtt.publish(topic, payload);
        await this.stats.incr('published');
    }

    private async onMqttMessage(topic: string, payload: string): Promise<void> {
        // HA birth
        if (topic === `${this.runtime.mqtt.discoveryPrefix}/status`) {
            if (payload === 'online') {
                this.log.info('HA birth message received → republishing all states');
                await this.republishAllStates();
            }
            return;
        }
        // command
        if (topic.startsWith(`${this.runtime.mqtt.baseTopic}/cmd/`)) {
            await this.cmd.handleMessage(topic, payload);
            return;
        }
    }

    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state) return;

        // own cmd.cleanup button?
        if (id === `${this.namespace}.cmd.cleanup` && state.val === true && state.ack === false) {
            await this.cleanupAllDiscoveryTopics();
            await this.setStateAsync('cmd.cleanup', false, true);
            return;
        }

        // foreign state of a mirror?
        if (isOwnWrite(state, this.selfId)) return;
        const uniqueId = buildUniqueId(id, this.runtime.entityPrefix);
        const m = this.mirrors.get(uniqueId);
        if (!m) {
            if (this.runtime.mode === 'discover') {
                await this.stats.incr('unmapped');
                if (this.runtime.verboseDiscoverLog) {
                    this.log.info(`[discover] unmapped: ${id}`);
                }
            }
            return;
        }
        if (this.runtime.mode !== 'live') return;
        await this.publishMirrorState(m, state.val);
    }

    private async cleanupAllDiscoveryTopics(): Promise<void> {
        const selfIdentifier = `iob2hass-${this.instance}`;
        const existing = await collectExistingDiscoveryTopics(this.mqtt, this.runtime.mqtt.discoveryPrefix, selfIdentifier, 2000);
        for (const topic of existing) {
            await this.mqtt.publishRetained(topic, '');
        }
        this.log.info(`Cleaned up ${existing.length} Discovery topics`);
    }

    private async onUnload(callback: () => void): Promise<void> {
        try {
            await this.mqtt?.close();
            await this.stats?.setConnection(false);
        } catch {
            // ignore
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Iob2HassAdapter(options);
} else {
    new Iob2HassAdapter();
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. (If `setForeignStateAsync` types complain, that is expected to be resolved by the `@iobroker/types` package — fix any import gaps that surface.)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): adapter lifecycle, boot, state pipeline, HA birth, cleanup button"
```

---

## Task 16: `admin/jsonConfig.json5` — UI schema

**Files:**
- Create: `admin/jsonConfig.json5`

- [ ] **Step 1: Write `admin/jsonConfig.json5`**

```json5
{
    type: 'tabs',
    items: {
        connection: {
            type: 'panel',
            label: 'tab_connection',
            items: {
                'mqtt.host':            { type: 'text',     label: 'mqtt_host', newLine: true,  sm: 12, md: 6, lg: 4 },
                'mqtt.port':            { type: 'number',   label: 'mqtt_port', min: 1, max: 65535, sm: 12, md: 3, lg: 2 },
                'mqtt.tls':             { type: 'checkbox', label: 'mqtt_tls',  sm: 12, md: 3, lg: 2 },
                'mqtt.user':            { type: 'text',     label: 'mqtt_user', newLine: true, sm: 12, md: 6, lg: 4 },
                'mqtt.password':        { type: 'password', label: 'mqtt_password', sm: 12, md: 6, lg: 4 },
                'mqtt.baseTopic':       { type: 'text',     label: 'mqtt_base_topic', newLine: true, sm: 12, md: 6, lg: 4 },
                'mqtt.discoveryPrefix': { type: 'text',     label: 'mqtt_discovery_prefix', sm: 12, md: 6, lg: 4 },
            },
        },
        behavior: {
            type: 'panel',
            label: 'tab_behavior',
            items: {
                mode: {
                    type: 'select',
                    label: 'mode',
                    options: [
                        { value: 'discover',  label: 'mode_discover' },
                        { value: 'dry-run',   label: 'mode_dryrun' },
                        { value: 'live',      label: 'mode_live' },
                    ],
                    sm: 12, md: 4, lg: 3,
                },
                entityPrefix:       { type: 'text',     label: 'entity_prefix', sm: 12, md: 4, lg: 3 },
                autoDeleteOrphans:  { type: 'checkbox', label: 'auto_delete_orphans', newLine: true, sm: 12, md: 6, lg: 4 },
                markAsDiagnostic:   { type: 'checkbox', label: 'mark_as_diagnostic', sm: 12, md: 6, lg: 4 },
                verboseDiscoverLog: { type: 'checkbox', label: 'verbose_discover_log', newLine: true, sm: 12, md: 6, lg: 4 },
                republishOnBoot:    { type: 'checkbox', label: 'republish_on_boot', sm: 12, md: 6, lg: 4 },
            },
        },
        whitelist: {
            type: 'panel',
            label: 'tab_whitelist',
            items: {
                whitelist: {
                    type: 'table',
                    label: 'whitelist_label',
                    items: [
                        { attr: 'pattern', type: 'text',     title: 'col_pattern', width: '60%' },
                        { attr: 'active',  type: 'checkbox', title: 'col_active',  width: '10%' },
                        { attr: 'note',    type: 'text',     title: 'col_note',    width: '30%' },
                    ],
                },
            },
        },
        overrides: {
            type: 'panel',
            label: 'tab_overrides',
            items: {
                overrides: {
                    type: 'table',
                    label: 'overrides_label',
                    items: [
                        { attr: 'pattern',      type: 'text', title: 'col_pattern',      width: '25%' },
                        { attr: 'domain',       type: 'text', title: 'col_domain',       width: '10%' },
                        { attr: 'unit',         type: 'text', title: 'col_unit',         width: '10%' },
                        { attr: 'role',         type: 'text', title: 'col_role',         width: '10%' },
                        { attr: 'device_class', type: 'text', title: 'col_device_class', width: '15%' },
                        { attr: 'state_class',  type: 'text', title: 'col_state_class',  width: '15%' },
                        { attr: 'min',          type: 'number', title: 'col_min',        width: '7%' },
                        { attr: 'max',          type: 'number', title: 'col_max',        width: '8%' },
                    ],
                },
            },
        },
    },
    i18n: true,
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/jsonConfig.json5
git commit -m "feat(admin): JsonConfig UI with five tabs"
```

---

## Task 17: i18n translations

**Files:**
- Create: `admin/i18n/en.json`
- Create: `admin/i18n/de.json`

- [ ] **Step 1: Write `admin/i18n/en.json`**

```json
{
  "tab_connection": "Connection",
  "tab_behavior": "Behavior",
  "tab_whitelist": "Whitelist",
  "tab_overrides": "Overrides",
  "mqtt_host": "MQTT host",
  "mqtt_port": "MQTT port",
  "mqtt_user": "MQTT user",
  "mqtt_password": "MQTT password",
  "mqtt_tls": "TLS",
  "mqtt_base_topic": "Base topic",
  "mqtt_discovery_prefix": "Discovery prefix",
  "mode": "Mode",
  "mode_discover": "Discover (log only, no publish)",
  "mode_dryrun": "Dry-run (log Discovery JSON, no publish)",
  "mode_live": "Live (publish to MQTT)",
  "entity_prefix": "Entity prefix",
  "auto_delete_orphans": "Auto-delete orphan Discovery topics on boot",
  "mark_as_diagnostic": "Mark mirror entities as diagnostic",
  "verbose_discover_log": "Verbose discover log",
  "republish_on_boot": "Republish all states on boot",
  "whitelist_label": "Datapoint patterns to mirror",
  "overrides_label": "Overrides (merged top-to-bottom)",
  "col_pattern": "Pattern",
  "col_active": "Active",
  "col_note": "Note",
  "col_domain": "Domain",
  "col_unit": "Unit",
  "col_role": "Role",
  "col_device_class": "Device class",
  "col_state_class": "State class",
  "col_min": "Min",
  "col_max": "Max"
}
```

- [ ] **Step 2: Write `admin/i18n/de.json`**

```json
{
  "tab_connection": "Verbindung",
  "tab_behavior": "Verhalten",
  "tab_whitelist": "Whitelist",
  "tab_overrides": "Overrides",
  "mqtt_host": "MQTT-Host",
  "mqtt_port": "MQTT-Port",
  "mqtt_user": "MQTT-Benutzer",
  "mqtt_password": "MQTT-Passwort",
  "mqtt_tls": "TLS",
  "mqtt_base_topic": "Basis-Topic",
  "mqtt_discovery_prefix": "Discovery-Präfix",
  "mode": "Modus",
  "mode_discover": "Discover (nur loggen, kein Publish)",
  "mode_dryrun": "Dry-Run (Discovery-JSON loggen, kein Publish)",
  "mode_live": "Live (auf MQTT publishen)",
  "entity_prefix": "Entity-Präfix",
  "auto_delete_orphans": "Verwaiste Discovery-Topics beim Start löschen",
  "mark_as_diagnostic": "Mirror-Entities als diagnostic markieren",
  "verbose_discover_log": "Discover-Log ausführlich",
  "republish_on_boot": "Alle States beim Start neu publishen",
  "whitelist_label": "Zu spiegelnde Datenpunkt-Patterns",
  "overrides_label": "Overrides (von oben nach unten gemergt)",
  "col_pattern": "Pattern",
  "col_active": "Aktiv",
  "col_note": "Notiz",
  "col_domain": "Domain",
  "col_unit": "Einheit",
  "col_role": "Rolle",
  "col_device_class": "Device class",
  "col_state_class": "State class",
  "col_min": "Min",
  "col_max": "Max"
}
```

- [ ] **Step 3: Commit**

```bash
git add admin/i18n/en.json admin/i18n/de.json
git commit -m "feat(i18n): English and German translations for admin UI"
```

---

## Task 18: Boot smoke test (integration)

**Files:**
- Create: `test/integration/boot.test.ts`

Verifies that a real adapter instance starts, connects to a local aedes broker, publishes LWT, and shuts down cleanly with an empty whitelist (no errors).

- [ ] **Step 1: Build first**

Run: `npm run build`
Expected: `build/main.js` exists.

- [ ] **Step 2: Write `test/integration/boot.test.ts`**

```typescript
import assert from 'node:assert/strict';
import net from 'node:net';
import Aedes from 'aedes';
import { tests } from '@iobroker/testing';
import path from 'node:path';

const PORT = 18833;
let broker: any;
let server: net.Server;

before(done => {
    broker = new (Aedes as any)();
    server = net.createServer(broker.handle);
    server.listen(PORT, () => done());
});

after(done => {
    server.close(() => broker.close(() => done()));
});

tests.integration(path.join(__dirname, '..', '..'), {
    defineAdditionalTests({ suite }) {
        suite('iob2hass smoke test', getHarness => {
            it('starts with empty whitelist and reaches ready', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('iob2hass', {
                    native: {
                        mqtt: { host: '127.0.0.1', port: PORT, user: '', password: '', tls: false, baseTopic: 'iob2hass-it', discoveryPrefix: 'homeassistant' },
                        mode: 'discover',
                        entityPrefix: 'iob_',
                        autoDeleteOrphans: false,
                        markAsDiagnostic: false,
                        verboseDiscoverLog: false,
                        republishOnBoot: true,
                        whitelist: [],
                        overrides: [],
                    },
                });
                await harness.startAdapterAndWait();
                const state = await harness.states.getStateAsync('iob2hass.0.info.connection');
                assert.equal(state?.val, true);
                await harness.stopAdapter();
            });
        });
    },
});
```

- [ ] **Step 3: Write `test/testPackageFiles.js`**

```js
'use strict';
const path = require('node:path');
const { tests } = require('@iobroker/testing');
tests.packageFiles(path.join(__dirname, '..'));
```

- [ ] **Step 4: Run integration test**

Run: `npm run test:integration`
Expected: smoke test passes, adapter reaches `info.connection=true`.

- [ ] **Step 5: Commit**

```bash
git add test/integration/boot.test.ts test/testPackageFiles.js
git commit -m "test(integration): boot smoke test against in-process aedes broker"
```

---

## Task 19: Finalize README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README content with full version**

```markdown
# iobroker.iob2hass

ioBroker-Adapter, der ausgewählte ioBroker-Datenpunkte per MQTT-Discovery als Mirror-Entities in Home Assistant verfügbar macht. Gedacht als temporäre Bridge während einer Migration von ioBroker zu Home Assistant.

## Funktionsweise

- **Whitelist-basiert**: kein DP wird automatisch durchgelassen. Du pflegst im Admin eine Liste von DP-Patterns (z.B. `shelly.0.*`).
- **Drei Modi**: `discover` (sammelt unmapped States), `dry-run` (zeigt Discovery-JSON im Log), `live` (publisht).
- **HA-Mirror-Entities** mit konfigurierbarem Präfix (Default `iob_`). Alle Entities hängen am gemeinsamen HA-Gerät `ioBroker Bridge`.
- **Schreibrichtung**: HA → ioBroker über `command_topic` pro Entity. Read-only-DPs werden geschützt.
- **Loop-Schutz** über `from`-Feld der ioBroker-State-Events.
- **Cleanup**: optional autonom beim Boot (Flag) oder per Admin-Button „HA-Seite bereinigen".

## Setup

1. Adapter installieren (Custom-URL: `https://github.com/mokusone/ioBroker.iob2hass`).
2. Instanz öffnen, Tab „Verbindung": MQTT-Host/Port/User/Passwort eintragen.
3. Modus `discover` lassen, Adapter starten.
4. Im Tab „Whitelist" Patterns hinzufügen.
5. Modus auf `dry-run` umstellen, Discovery-JSONs im Log prüfen.
6. Modus auf `live` umstellen — Mirror-Entities erscheinen in HA.
7. Einmalig in HA das Gerät `ioBroker Bridge` einer eigenen Area (z.B. „Bridge-Quelle") zuweisen.

## Konfiguration im Detail

Siehe [docs/design.md](docs/design.md) für vollständige Spezifikation.

## Stack

- TypeScript, `@iobroker/adapter-core`, `mqtt`
- Test: Mocha, `@iobroker/testing`, `aedes` als In-Process-Broker
- Lint: `@iobroker/eslint-config`

## Tests laufen lassen

```bash
npm install
npm run lint
npm test
```

## Lizenz

MIT — siehe [LICENSE](LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: full README with setup walk-through"
```

---

## Task 20: Tag and push first release-candidate

- [ ] **Step 1: Run full test suite**

Run: `npm run lint && npm run build && npm test`
Expected: all green.

- [ ] **Step 2: Tag and push**

```bash
git tag v0.0.1
git push origin main --tags
```

- [ ] **Step 3: Verify**

GitHub Actions (when set up later) will trigger from tag; for now manual verification: `git log --oneline`, GitHub-Repo-Seite zeigt die Commits.

---

## Implementation Notes (read before starting)

- **Order matters**: Tasks 4–9 (pure-logic with TDD) lay the groundwork for Task 15 (orchestration). Do them in order.
- **`@iobroker/types` quirks**: `Adapter.setForeignStateAsync` returns `Promise<string | undefined>` (the id). Treat return value as void in our code.
- **`mqtt` library async**: the npm `mqtt` library exposes callback APIs; the wrapper in Task 12 promisifies them. Do not try to add `mqtt-async` or similar — extra deps not needed.
- **`@iobroker/testing` paths**: `tests.integration(rootDir, …)` expects the adapter root with a valid `io-package.json`. Make sure Task 1 + 2 + 15 + 18 are all committed before running.
- **State payload encoding** (Task 15, `publishMirrorState`): strings go through as-is; everything else is JSON-stringified. HA-MQTT-Discovery for `switch` expects `payload_on=true` (we configured booleans); for `number`/`sensor` HA accepts numbers as plain text — `JSON.stringify(42)` → `"42"` is what HA wants.
- **Glob match in Task 14**: `collectExistingDiscoveryTopics` matches against `device.identifiers` containing our instance ID. This is the only safe way to attribute existing retained Discovery to our bridge — relying on entity-prefix alone would conflict if the user changes the prefix between runs.
- **Commit frequency**: each task ends with one commit. Do not batch.

---

## Self-Review (already performed by the plan author)

- **Spec coverage**: every section of `docs/design.md` maps to a task (Section 2 grand-decisions are reflected in Tasks 1, 2, 10, 12; Section 3 architecture in Tasks 3–15; Section 4 data-flow in Tasks 13, 14, 15, 18; Section 5 JsonConfig in Tasks 16, 17; Section 6 Discovery-Mapping in Tasks 7, 8, 9; Section 7 error handling in Tasks 10, 13; Section 8 tests in Tasks 4–9, 12, 13, 14, 18; Section 9 lifecycle in Task 15 plus README setup walk-through Task 19).
- **Placeholder scan**: no TBD/TODO/“implement later" instances; every step has executable code or commands.
- **Type consistency**: `MirrorEntry`, `RuntimeConfig`, `WhitelistEntry`, `OverrideEntry`, `IobStateObjectMinimal`, `HaDomain` defined once in Task 3, used consistently in Tasks 4–15. `buildUniqueId`, `selectDomain`, `buildConfig`, `normalizeConfig`, `MqttClient`, `CommandRouter`, `Stats`, `collectExistingDiscoveryTopics`, `publishOrphanDeletions`, `isOwnWrite`, `buildSelfId` — each is defined exactly once and imported by name.
- **Open MVP gap**: `climate`/`cover` domain-auto-detection is intentionally omitted (override-only, see Spec §6.1). Documented in design.md §11. No task needed.

---

## Execution

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session, batch checkpoints for review.
