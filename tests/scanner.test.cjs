const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = Object.fromEntries(['data1.json', 'data2.json', 'data3.json'].map(name =>
  [name, JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))]));

// Run the actual application script with a minimal DOM and file-backed fetch.
// This tests application logic and rendered strings, not browser layout.
async function app(options = {}) {
  const nodes = new Map();
  const requests = [];
  const element = () => ({
    innerHTML: '', textContent: '', className: '', children: [], attributes: {},
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    scrollIntoView() { this.scrolled = true; },
  });
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element,
  };
  const context = vm.createContext({
    document, console, setTimeout: callback => callback(),
    fetch: async name => {
      requests.push(name);
      if (options.networkFailure) throw new Error('Network unavailable');
      return {
        ok: name !== options.missing, status: name === options.missing ? 404 : 200,
        json: async () => {
          if (name === options.invalid) throw new SyntaxError('Invalid JSON');
          const data = structuredClone(files[name]);
          if (options.transform) options.transform(name, data);
          return data;
        },
      };
    },
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'HTML must contain a valid script element');
  const run = code => vm.runInContext(code, context);
  await run(script[1]);
  return { run, nodes, requests };
}

test('HTML tags, CSS colours and event attributes are free of pasted corruption', () => {
  assert.doesNotMatch(html, /\u200b|hashtag#/);
  assert.match(html, /<meta charset="UTF-8">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<style>[\s\S]*<\/style>/);
  assert.match(html, /onclick="applyRecalc/);
});

test('boots from all three JSON files and derives totals from included records', async () => {
  const { run, requests, nodes } = await app();
  assert.deepEqual(requests.sort(), Object.keys(files).sort());
  assert.deepEqual(JSON.parse(run('JSON.stringify(DATA.meta.stats)')), {
    entities: 44, tier1: 7, tier2: 37, rules: 20,
    rows: 26, in_scope: 5, out_scope: 5, untested: 16,
  });
  assert.match(nodes.get('content').innerHTML, /Regulatory horizon/);
});

for (const [label, options, expected] of [
  ['HTTP error', { missing: 'data2.json' }, /data2\.json \(HTTP 404\)/],
  ['invalid JSON', { invalid: 'data3.json' }, /Invalid JSON in data3\.json/],
  ['network failure', { networkFailure: true }, /Network unavailable/],
  ['missing required section', { transform: (name, data) => { if (name === 'data1.json') delete data.engine; } }, /Required scanner data is missing/],
]) {
  test(`boot displays an actionable message for ${label}`, async () => {
    const { nodes, run } = await app(options);
    assert.match(nodes.get('content').textContent, expected);
    assert.equal(nodes.get('content').attributes.role, 'alert');
    assert.equal(run('DATA'), null);
  });
}

test('every navigation page renders without throwing', async () => {
  const { run, nodes } = await app();
  for (const id of ['scanner', 'determinations', 'register', 'spotlight', 'coverage', 'method']) {
    run(`page='${id}';render()`);
    assert.ok(nodes.get('content').innerHTML.length > 100);
    assert.doesNotMatch(nodes.get('content').innerHTML, /undefined|NaN/);
  }
  run("page='register';render()");
  assert.match(nodes.get('psub').textContent, /26 included obligation rows/);
});

test('scanner is newest first and provides filters for every scanner jurisdiction', async () => {
  const { run, nodes } = await app();
  const output = run('pScanner()');
  assert.ok(output.indexOf('2026-05-29') < output.indexOf('2025-10-21'));
  assert.ok(nodes.get('chips').children.some(node => node.textContent === 'South Africa / Group'));
  run("jur='South Africa / Group';render()");
  assert.match(nodes.get('content').innerHTML, /CCBA moves/);
  assert.doesNotMatch(nodes.get('content').innerHTML, /Mexico NIS B-1 confirmed/);
  run("page='register';render()");
  assert.equal(run('jur'), 'all');
});

test('deadline-only mutations are visible and apply without changing scope', async () => {
  const { run } = await app();
  assert.match(run("evCard(DATA.scanner.find(e=>e.date==='2026-08-14'))"), /applyRecalc/);
  run("applyRecalc('2026-08-14')");
  assert.equal(run("getRule('R-CA-253').next_deadline"), '2026-11-10');
  assert.equal(run("evaluate('E001','R-CA-253').result"), 'in_scope');
});

test('rule and boundary changes apply once and reset restores the baseline', async () => {
  const { run } = await app();
  assert.equal(run("evaluate('E003','R-BR').result"), 'in_scope');
  run("applyRecalc('2026-06-01')");
  assert.equal(run("evaluate('E003','R-BR').result"), 'out_of_scope');
  run("applyRecalc('2026-06-01')");
  assert.equal(run("prevResults['D-BR']"), 'in_scope');
  run("applyRecalc('2025-10-21')");
  assert.equal(run("getFacts('E005').ownership_pct_ko"), 25);
  assert.equal(run("evaluate('E005','R-CCBA-boundary').result"), 'monitoring');
  run('resetEngine()');
  assert.equal(run("getFacts('E005').ownership_pct_ko"), 66.52);
  assert.equal(run("evaluate('E003','R-BR').result"), 'in_scope');
  assert.equal(run('Object.keys(recalcApplied).length'), 0);
  assert.doesNotThrow(() => run("applyRecalc('unknown-event')"));
});

test('injunction simulation toggles the effective rule and reset restores it', async () => {
  const { run } = await app();
  assert.equal(run("evaluate('E001','R-CA-261').result"), 'monitoring');
  run('simInjunction()');
  assert.equal(run("evaluate('E001','R-CA-261').result"), 'in_scope');
  run('simInjunction()');
  assert.equal(run("evaluate('E001','R-CA-261').result"), 'monitoring');
  run("DATA.engine.rules['R-CA-261'].enforcement_active=true;resetEngine();simInjunction()");
  assert.equal(run("getRule('R-CA-261').enforcement_active"), false);
});

test('non-engine changes highlight rows without claiming to recalculate verdicts', async () => {
  const { run } = await app();
  const baseline = run('JSON.stringify(DATA.obligations)');
  assert.match(run("evCard(DATA.scanner.find(e=>e.date==='2026-08-22'))"), /Highlight register rows/);
  run("applyRecalc('2026-08-22')");
  assert.equal(run('page'), 'register');
  assert.equal(run('JSON.stringify(DATA.obligations)'), baseline);
  assert.match(run('pRegister()'), /Stored register verdicts are unchanged/);
  assert.match(run('pRegister()'), /class="r flash"/);
});

test('register row IDs are unique, entity navigation works and rows are not truncated', async () => {
  const { run, nodes } = await app();
  const ids = [...run('pRegister()').matchAll(/id="row-([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 26);
  assert.equal(new Set(ids).size, 26);
  run("goEntity('E001')");
  assert.equal(nodes.get('row-OB0002').scrolled, true);
  run("for(let i=0;i<40;i++)DATA.obligations.push({...DATA.obligations[0],id:'EXTRA'+i})");
  assert.equal([...run('pRegister()').matchAll(/id="row-/g)].length, 66);
});

test('empty register coverage never renders NaN or phantom percentages', async () => {
  const { run } = await app({ transform: (name, data) => {
    if (name === 'data3.json') data.obligations = [];
  } });
  assert.doesNotMatch(run('pCoverage()'), /NaN|100% not yet tested/);
  assert.equal(run('DATA.meta.stats.rows'), 0);
});
