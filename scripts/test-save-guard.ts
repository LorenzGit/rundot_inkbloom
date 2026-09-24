/**
 * Contract test for the save system's remote-write guard.
 *
 * A failed or timed-out RUN storage read used to load defaults and let the
 * next flush write them over the player's real cloud save. This replays that
 * boot against the REAL save module with a fake RUN storage and asserts the
 * cloud copy survives.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks scripts/test-save-guard.ts
 */
import { mock } from "node:test";

const localStorageData = new Map<string, string>();
Object.assign(globalThis, {
    window: Object.assign(globalThis, {
        localStorage: {
            getItem: (key: string) => localStorageData.get(key) ?? null,
            setItem: (key: string, value: string) => void localStorageData.set(key, value),
            removeItem: (key: string) => void localStorageData.delete(key),
        },
    }),
});

const cloud = new Map<string, string>();
const fake = { host: true, readsFail: 0, writes: 0 };

mock.module(new URL("../src/sdk/runSdk.ts", import.meta.url).href, {
    namedExports: {
        getRunCapabilities: () => ({ host: fake.host, mock: false, storage: fake.host }),
        async readAppStorage(key: string) {
            if (fake.readsFail > 0) {
                fake.readsFail -= 1;
                return { ok: false, value: null };
            }
            return { ok: true, value: cloud.get(key) ?? null };
        },
        async writeAppStorage(key: string, value: string) {
            fake.writes += 1;
            cloud.set(key, value);
            return true;
        },
    },
});

const { saveSystem, SAVE_VERSION } = await import("../src/systems/save.ts");
const { store } = await import("../src/state/store.ts");

const failures: string[] = [];
function expect(condition: boolean, message: string): void {
    if (!condition) failures.push(message);
}
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SAVE_KEY = "inkbloom-save";
const realSave = JSON.stringify({
    version: SAVE_VERSION,
    settings: {},
    progress: { discoveries: [], pagesTorn: 31, strokes: 777 },
    commerce: { ownsKit: true, paper: "rag" },
});
cloud.set(SAVE_KEY, realSave);

// 1. Boot read times out (and so does the immediate background retry):
//    defaults in memory, cloud untouched by flushes.
fake.readsFail = 2;
const source = await saveSystem.load();
expect(source === "unavailable", `failed read should report "unavailable", got "${source}"`);
store.patch({ strokes: store.get().strokes + 5 });
const flushed = await saveSystem.flush();
expect(flushed === false, "flush must fail while the cloud save is unverified");
expect(cloud.get(SAVE_KEY) === realSave, "cloud save was overwritten after a failed read");

// 2. The background retry recovers the real save, then writes resume.
await tick(2_300);
expect(store.get().strokes === 777, `retry should apply the real save (strokes ${store.get().strokes})`);
expect(store.get().ownsKit === true, "retry should restore the Kit entitlement");
store.patch({ strokes: 800 });
expect((await saveSystem.flush()) === true, "flush should succeed once the cloud read succeeded");
expect(JSON.parse(cloud.get(SAVE_KEY) ?? "{}").progress?.strokes === 800, "verified flush should reach the cloud");

// 3. A save from a newer build is never overwritten.
const newer = JSON.stringify({ version: SAVE_VERSION + 1, settings: {}, progress: { strokes: 5 } });
cloud.set(SAVE_KEY, newer);
const fresh = await import(`../src/systems/save.ts?newer`);
await fresh.saveSystem.load();
store.patch({ strokes: 1 });
expect((await fresh.saveSystem.flush()) === false, "flush must refuse to overwrite a newer build's save");
expect(cloud.get(SAVE_KEY) === newer, "newer-build save was overwritten");

// 4. An unreadable save is backed up before a new player's first write.
cloud.clear();
cloud.set(SAVE_KEY, "{not json");
const corrupt = await import(`../src/systems/save.ts?corrupt`);
expect((await corrupt.saveSystem.load()) === "defaults", "unreadable save should load defaults");
expect(cloud.get(`${SAVE_KEY}-unreadable-backup`) === "{not json", "unreadable save was not backed up");
store.patch({ strokes: 3 });
expect((await corrupt.saveSystem.flush()) === true, "a verified new player must be able to save");

// 5. Offline (no host) still saves locally.
fake.host = false;
const offline = await import(`../src/systems/save.ts?offline`);
await offline.saveSystem.load();
store.patch({ strokes: 42 });
expect((await offline.saveSystem.flush()) === true, "offline flush should write localStorage");
expect(localStorageData.has(SAVE_KEY), "offline flush did not reach localStorage");

// 6. Host attaches after an offline load: first flush must not clobber the cloud.
cloud.set(SAVE_KEY, realSave);
fake.host = true;
expect((await offline.saveSystem.flush()) === false, "late-attach flush must wait for a cloud read");
expect(cloud.get(SAVE_KEY) === realSave, "late attach overwrote the cloud save");

if (failures.length) {
    console.error(`save guard: ${failures.length} failure(s)\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
}
console.log("save guard: all checks passed");
process.exit(0);
