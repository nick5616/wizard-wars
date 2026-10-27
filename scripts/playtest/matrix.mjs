import fs from 'node:fs';
const S = process.argv[2];
const r = JSON.parse(fs.readFileSync(`${S}/results.json`, 'utf8'));
const lv = ['clean', 'typical', 'bad', 'awful'];
const sym = (x) => (x == null ? '-' : x.ok ? 'P' : 'F');
const group = (name, test) => {
  const items = Object.keys(r).filter(test);
  const row = lv.map((l) => { const xs = items.map((i) => r[i][l]).filter(Boolean); return xs.length === 0 ? '-' : xs.every((x) => x.ok) ? `P(${xs.length})` : `F(${xs.filter((x) => !x.ok).length}/${xs.length})`; });
  console.log(name.padEnd(46) + row.map((c) => c.padEnd(10)).join(''));
};
console.log('item'.padEnd(46) + lv.map((c) => c.padEnd(10)).join(''));
for (const p of ['boot', 'menus: SP', 'menus: duel', 'menus: no', 'input', 'match:', 'match #2', 'defeat', 'chaos', 'summon', 'move']) group(p, (i) => i.startsWith(p));
for (const c of ['fire', 'ice', 'dark', 'sword', 'druid', 'crystalmancer']) group(`sweep ${c}`, (i) => i.startsWith(`sweep: ${c}`));
console.log('--- failing items');
for (const [i, v] of Object.entries(r)) for (const l of lv) if (v[l] && !v[l].ok) console.log(`[${l}] ${i} -- ${String(v[l].detail).slice(0, 200)}`);
