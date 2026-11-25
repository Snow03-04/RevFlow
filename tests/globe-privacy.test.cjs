require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const appearance = require("../src/lib/appearance.ts");
const filename = path.resolve(__dirname, "../src/components/live/globe/engine/privacy.js");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { protectGlobeFigures } = compiled.exports;

function setup(t, enabled = false) {
  const storage = new Map();
  const win = new EventTarget();
  const doc = { documentElement: { dataset: { privateFigures: "off", privateGlobe: enabled ? "on" : "off" } }, cookie: "" };
  let observer;
  for (const [key, value] of Object.entries({ window: win, document: doc, location: { protocol: "http:" },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { this.disconnected = true; } },
  })) {
    const old = Object.getOwnPropertyDescriptor(global, key);
    Object.defineProperty(global, key, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(global, key, old) : delete global[key]);
  }
  const node = (aria = null) => ({ aria, isConnected: true, sensitive: true,
    matches() { return this.sensitive; }, getAttribute() { return this.aria; },
    setAttribute(_key, value) { this.aria = value; }, removeAttribute() { this.aria = null; } });
  const nodes = [node(), node("false"), node("true")];
  const classes = new Set(["names"]);
  const root = { querySelector: () => ({ classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } }),
    querySelectorAll: () => nodes.filter(n => n.sensitive && n.isConnected) };
  let refreshes = 0;
  const dispose = protectGlobeFigures(root, () => refreshes++);
  return { nodes, node, classes, dispose, storage, win, observer, doc, refreshes: () => refreshes };
}

test("off leaves the globe's current eye and accessibility unchanged; Settings protects and restores exactly", t => {
  const f = setup(t);
  assert.deepEqual([...f.classes], ["names"]);
  assert.deepEqual(f.nodes.map(n => n.aria), [null, "false", "true"]);
  appearance.setPrivateGlobe(true);
  assert.ok(f.classes.has("private-money"));
  assert.ok(f.classes.has("names"), "the eye is not changed");
  assert.deepEqual(f.nodes.map(n => n.aria), ["true", "true", "true"]);
  assert.equal(f.refreshes(), 1, "refreshes tooltip values immediately");
  appearance.setPrivateGlobe(false);
  assert.deepEqual([...f.classes], ["names"]);
  assert.deepEqual(f.nodes.map(n => n.aria), [null, "false", "true"]);
  f.dispose();
});

test("initial privacy protects before data arrives and includes later orders, popups and replay values", t => {
  const f = setup(t, true);
  assert.ok(f.classes.has("private-money"));
  const popup = f.node(), replay = f.node();
  f.nodes.push(popup, replay);
  f.observer.callback();
  assert.equal(popup.aria, "true");
  assert.equal(replay.aria, "true");
  replay.sensitive = false;
  f.observer.callback();
  assert.equal(replay.aria, null, "non-financial banner text is not left hidden");
  appearance.setPrivateGlobe(false);
  assert.equal(popup.aria, null);
  f.dispose();
});

test("Settings changes in another tab and page restoration apply without remounting; disposal unsubscribes", t => {
  const f = setup(t);
  f.storage.set(appearance.PRIVATE_GLOBE_KEY, "on");
  const storageEvent = new Event("storage");
  Object.defineProperty(storageEvent, "key", { value: appearance.PRIVATE_GLOBE_KEY });
  f.win.dispatchEvent(storageEvent);
  assert.ok(f.classes.has("private-money"));
  f.storage.set(appearance.PRIVATE_GLOBE_KEY, "off");
  f.win.dispatchEvent(new Event("pageshow"));
  assert.ok(!f.classes.has("private-money"));
  f.dispose();
  assert.ok(f.observer.disconnected);
  appearance.setPrivateGlobe(true);
  assert.ok(!f.classes.has("private-money"));
});

test("the dashboard's profit option and the globe's are separate: neither switches the other", t => {
  const f = setup(t);
  appearance.setPrivateFigures(true);
  assert.deepEqual([...f.classes], ["names"], "blurring profit on the dashboard leaves the globe whole");
  assert.deepEqual(f.nodes.map(n => n.aria), [null, "false", "true"]);
  assert.equal(f.doc.documentElement.dataset.privateGlobe, "off");
  assert.equal(f.storage.get(appearance.PRIVATE_GLOBE_KEY), undefined);
  appearance.setPrivateGlobe(true);
  assert.ok(f.classes.has("private-money"));
  appearance.setPrivateFigures(false);
  assert.ok(f.classes.has("private-money"), "and showing profit again does not uncover the globe");
  assert.deepEqual([f.storage.get(appearance.PRIVATE_FIGURES_KEY), f.storage.get(appearance.PRIVATE_GLOBE_KEY)], ["off", "on"]);
  // A change of the dashboard's option in another tab is not the globe's business either.
  f.storage.set(appearance.PRIVATE_FIGURES_KEY, "on");
  const other = new Event("storage");
  Object.defineProperty(other, "key", { value: appearance.PRIVATE_FIGURES_KEY });
  f.win.dispatchEvent(other);
  assert.equal(f.doc.documentElement.dataset.privateFigures, "off", "the globe's listener leaves the dashboard's choice alone");
  assert.ok(f.classes.has("private-money"));
  f.dispose();
});
