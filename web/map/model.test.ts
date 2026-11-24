import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, BH, BW, CW, HEAD, PAD, baseName, buildFlow, buildTree, cardHeight, defaultExpanded, folderDepths, labelOf, levelOf, pathsTo, type DirInfo, type FileInfo, type MapData, type View } from './model.ts';

const f = (key: string, o: Partial<FileInfo> = {}): FileInfo => ({ key, status: 'c', add: 10, del: 2, preview: 'a\nb\nc', secs: [[1, 5]], total: 50, ...o });
const dirs: DirInfo[] = [
  { key: 'src/a', raw: 'src/a', files: [f('x.py'), f('y.py', { secs: [[1, 5], [20, 5]] }), f('u.py', { status: 'l', preview: '' })] },
  { key: 'src/a/deep', raw: 'src/a/deep', files: [f('d.py')] },
  { key: 'tests', raw: 'tests', files: [f('test_x.py')] },
  { key: '.', raw: '.', files: [f('README.md')] },
];
const data: MapData = { dirs, links: [['y.py', 'x.py'], ['test_x.py', 'x.py'], ['README.md', 'u.py'], ['d.py', 'x.py']] };
const view = (o: Partial<View> = {}): View => ({ expanded: new Set(), open: null, lines: {}, codes: {}, sels: [], hidden: () => false, mood: k => ({ l: k === 'x.py' ? 2 : 0, why: [] }), pos: {}, ...o });
const byId = (nodes: { id: string }[]) => Object.fromEntries(nodes.map(n => [n.id, n])) as Record<string, ReturnType<typeof buildFlow>['nodes'][number]>;

test('levelOf, baseName and pathsTo', () => {
  assert.deepEqual([0.1, 0.54, 0.55, 1, 1.49, 1.5, 3].map(levelOf), [0, 0, 1, 1, 1, 2, 2]);
  assert.equal(baseName('templates/base.html'), 'base.html');
  assert.deepEqual(pathsTo('a/b/c'), ['a', 'a/b', 'a/b/c']);
  assert.deepEqual(pathsTo('.'), ['.']);
});

test('labelOf: the root label is localized through globalThis.i18n when the engine is present', () => {
  const g = globalThis as { i18n?: unknown };
  assert.equal(labelOf('.'), 'raíz'); // no engine: Spanish fallback
  g.i18n = { t: (k: string) => (k === 'map.root' ? 'root' : k) };
  try { assert.deepEqual([labelOf('.'), labelOf('a/b')], ['root', 'b']); } finally { delete g.i18n; }
});

test('buildTree: folders are nested, including intermediate ones without files', () => {
  const t = buildTree({ dirs: [{ key: 'a/b/c', raw: 'a/b/c', files: [f('c.py')] }, { key: 'a', raw: 'a', files: [f('a.py')] }, { key: '.', raw: '.', files: [f('r.md')] }], links: [] });
  assert.deepEqual(t.map(n => n.path), ['.', 'a']);
  const a = t[1];
  assert.deepEqual([a.files.length, a.kids.map(k => k.path), a.kids[0].files.length, a.kids[0].kids[0].path, a.kids[0].kids[0].files[0].key], [1, ['a/b'], 0, 'a/b/c', 'c.py']);
  assert.equal(a.kids[0].dirKey, null); // intermediate: not a folder with files of its own
});

test('cardHeight: name, minimap and code depending on open or zoomed', () => {
  assert.equal(cardHeight(f('a'), false), 28);
  assert.equal(cardHeight(f('b', { secs: [[1, 3], [9, 3]] }), false), 40); // minimapa
  assert.equal(cardHeight(f('a'), true), 28 + 3 * 15 + 18);
  assert.equal(cardHeight(f('a'), false, 20), 28 + 20 * 15 + 18); // zoom on the card: more code
  assert.ok(cardHeight(f('a'), true, 40) > cardHeight(f('a'), true, 10));
});

test('all closed: one block per top-level folder and edges aggregated per pair', () => {
  const { nodes, edges } = buildFlow(data, view());
  assert.deepEqual(nodes.map(n => n.id).sort(), ['d:.', 'd:src', 'd:tests']); // src/a stays inside src
  const n = byId(nodes);
  assert.deepEqual([n['d:src'].width, n['d:src'].height, n['d:src'].data.expanded], [BW, BH, false]);
  assert.deepEqual([n['d:src'].data.changed, n['d:src'].data.files, n['d:src'].data.add, n['d:src'].data.moods], [3, 4, 30, [2, 0, 1]]); // counts everything inside
  const ids = edges.map(e => e.id).sort();
  assert.deepEqual(ids, ['m:d:.>d:src', 'm:d:tests>d:src']); // one aggregated edge per pair of blocks; links inside src draw nothing
  assert.equal(edges.every(e => e.id.startsWith('m:')), true);
  assert.equal(edges.find(e => e.id.includes('tests'))!.data.count, 1);
});

test('open folder: its files are cards and its subfolders are blocks nested inside the same container', () => {
  const { nodes, rects } = buildFlow(data, view({ expanded: new Set(['src', 'src/a']) }));
  const n = byId(nodes);
  assert.equal(n['d:src/a'].parentId, 'd:src');
  assert.equal(n['d:src/a/deep'].parentId, 'd:src/a');
  assert.equal(n['d:src/a/deep'].data.expanded, false);
  assert.deepEqual(['f:x.py', 'f:y.py', 'f:u.py'].map(id => n[id].parentId), ['d:src/a', 'd:src/a', 'd:src/a']);
  assert.deepEqual([n['f:x.py'].position.x, n['f:x.py'].position.y, n['f:x.py'].width], [PAD, HEAD, CW]);
  assert.equal(n['f:y.py'].position.y, HEAD + 28 + 6); // stacked with spacing
  const r = rects['d:src/a'], s = rects['d:src'];
  assert.ok(r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h); // the child fits inside the parent
  const d = rects['d:src/a/deep'];
  assert.ok(d.y >= rects['f:u.py'].y + rects['f:u.py'].h); // blocks go below the files
  assert.equal(nodes.indexOf(n['d:src']) < nodes.indexOf(n['d:src/a']), true); // parent before child (React Flow requires it)
});

test('edges with open folders: to the card if visible, otherwise to the block that contains it', () => {
  const { edges, resolve } = buildFlow(data, view({ expanded: new Set(['src', 'src/a']) }));
  const e = Object.fromEntries(edges.map(e => [e.id, e]));
  assert.equal(e['e:y.py>x.py'].type, 'arc'); // inside the same open folder
  assert.deepEqual([e['m:d:src/a/deep>f:x.py'].source, e['m:d:src/a/deep>f:x.py'].target, e['m:d:src/a/deep>f:x.py'].data.count], ['d:src/a/deep', 'f:x.py', 1]); // d.py is in a closed block
  assert.deepEqual([e['m:d:tests>f:x.py'].source, e['m:d:tests>f:x.py'].target], ['d:tests', 'f:x.py']);
  assert.equal(resolve('f:d.py'), 'd:src/a/deep');
  assert.equal(resolve('f:x.py'), 'f:x.py');
  assert.equal(buildFlow(data, view()).resolve('f:x.py'), 'd:src'); // all closed: the top-level parent folder
  assert.equal(buildFlow(data, view()).resolve('d:src/a/deep'), 'd:src');
});

test('hidden items disappear along with the folders left empty; linked ones do not count', () => {
  const hidden = (k: string) => k === 'test_x.py' || k === 'u.py';
  const { nodes } = buildFlow(data, view({ hidden, expanded: new Set(['src', 'src/a']) }));
  const ids = nodes.map(n => n.id);
  assert.ok(!ids.includes('d:tests') && !ids.includes('f:u.py'));
  const n = byId(nodes);
  assert.equal(n['d:src'].data.files, 3);
  assert.equal(n['d:src'].data.changed, 3);
});

test('selection: folders and files marked; relations of the selection are highlighted', () => {
  const { nodes, edges } = buildFlow(data, view({ expanded: new Set(['src', 'src/a']), sels: [{ t: 'file', k: 'x.py' }, { t: 'dir', k: 'tests' }] }));
  const n = byId(nodes);
  assert.equal(n['f:x.py'].data.sel, true);
  assert.equal(n['d:tests'].data.sel, true);
  assert.equal(edges.find(e => e.id === 'e:y.py>x.py')!.data.hit, true);
  assert.equal(edges.find(e => e.id === 'e:y.py>x.py')!.data.dim, false);
});

test('top-level folders: laid out according to the screen and the ones the user moved keep their place', () => {
  const wide = buildFlow(data, view({ aspect: 6 })).nodes.map(n => n.position);
  const tall = buildFlow(data, view({ aspect: 0.2 })).nodes.map(n => n.position);
  assert.ok(new Set(wide.map(p => p.y)).size < new Set(tall.map(p => p.y)).size); // wide: one row; tall: one column
  const moved = buildFlow(data, view({ pos: { tests: { x: 999, y: 111 } } })).nodes.find(n => n.id === 'd:tests')!;
  assert.deepEqual(moved.position, { x: 999, y: 111 });
});

test('defaultExpanded: opens top-down what has changes without exceeding the budget', () => {
  assert.deepEqual([...defaultExpanded(data, () => false)].sort(), ['.', 'src', 'src/a', 'src/a/deep', 'tests']);
  assert.deepEqual([...defaultExpanded(data, () => false, 5)].sort(), ['.', 'src', 'tests']); // src/a (3 files and a subfolder) would exceed the budget
  assert.deepEqual([...defaultExpanded(data, k => k !== 'README.md')], ['.']); // only what has visible changes
});

test('card code: reaches the node data', () => {
  const { nodes } = buildFlow(data, view({ expanded: new Set(['tests']), lines: { 'test_x.py': 12 }, codes: { 'test_x.py': ['+ a', '- b'] } }));
  const c = byId(nodes)['f:test_x.py'];
  assert.deepEqual([c.data.lines, c.data.code, c.height], [2, ['+ a', '- b'], cardHeight(f('test_x.py'), false, 2)]); // no more lines than there are: no blank space
  const big = byId(buildFlow(data, view({ expanded: new Set(['tests']), lines: { 'test_x.py': 40 }, codes: { 'test_x.py': Array(60).fill('+ x') } })).nodes)['f:test_x.py'];
  assert.equal(big.data.lines, 40);
  const loading = byId(buildFlow(data, view({ expanded: new Set(['tests']), lines: { 'test_x.py': 40 } })).nodes)['f:test_x.py']; // not loaded: the preview (3 lines)
  assert.equal(loading.data.lines, 3);
});

test('many files in a folder: they go in columns (up to 3) and the container widens', () => {
  const many: DirInfo[] = [{ key: 'big', raw: 'big', files: Array.from({ length: 20 }, (_, i) => f(`m${i}.py`)) }];
  const { nodes } = buildFlow({ dirs: many, links: [] }, view({ expanded: new Set(['big']) }));
  const n = byId(nodes), xs = new Set(nodes.filter(x => x.type === 'file').map(x => x.position.x));
  assert.equal(xs.size, 3); // 20 files -> 3 columns
  assert.equal(n['d:big'].width, 3 * (CW + 6) - 6 + 2 * PAD);
  assert.ok(n['d:big'].height < 20 * 34); // much shorter than a tower of 20 cards
  assert.equal(buildFlow({ dirs: [{ key: 's', raw: 's', files: [f('a.py'), f('b.py')] }], links: [] }, view({ expanded: new Set(['s']) })).nodes[0].width, BW); // few: one column
});

test('top-level folders: none overlaps another, even if the user moved them to an occupied spot or one opens', () => {
  const rectsOf = (v: View) => { const r = buildFlow(data, v).rects; return ['d:src', 'd:tests', 'd:.'].map(id => r[id]); };
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const v of [view({ pos: { tests: { x: 0, y: 0 }, src: { x: 10, y: 10 }, '.': { x: 20, y: 20 } } }), view({ expanded: new Set(['src', 'src/a']), pos: { tests: { x: 0, y: 40 }, src: { x: 0, y: 0 } } })]) {
    const [a, b, c] = rectsOf(v);
    assert.equal(overlap(a, b) || overlap(a, c) || overlap(b, c), false);
  }
});

test('pack: fills gaps instead of leaving rows with empty space and respects the maximum width', () => {
  const p = pack([{ w: 100, h: 300 }, { w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }], 250, 10, 0, 0);
  assert.deepEqual(p, [{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 110 }, { x: 110, y: 220 }]); // the small ones stack beside the tall one, not below it
  const wide = pack(Array(6).fill({ w: 100, h: 50 }), 1000, 10, 5, 7);
  assert.deepEqual([wide[0], wide[5]], [{ x: 5, y: 7 }, { x: 555, y: 7 }]); // if they fit, all in one row
  assert.ok(pack(Array(6).fill({ w: 100, h: 50 }), 250, 10, 0, 0).every(q => q.x + 100 <= 250)); // never exceeds the width
  assert.deepEqual(pack([{ w: 100, h: 50 }], 1000, 10, 0, 0, [{ x: 0, y: 0, w: 100, h: 100 }]), [{ x: 110, y: 0 }]); // dodges the fixed one
});

test('container with many subfolders: more columns the wider the screen, and the width chosen by the user wins', () => {
  const many: DirInfo[] = Array.from({ length: 12 }, (_, i) => ({ key: `p/k${i}`, raw: `p/k${i}`, files: [f(`k${i}.py`)] }));
  const cols = (o: Partial<View>) => new Set(buildFlow({ dirs: many, links: [] }, view({ expanded: new Set(['p']), ...o })).nodes.filter(n => n.id.startsWith('d:p/')).map(n => n.position.x)).size;
  assert.ok(cols({ aspect: 3 }) > cols({ aspect: 0.5 })); // wide screen: more columns
  assert.equal(cols({ widths: { p: 16 + 2 * BW + 6 } }), 2);
  assert.equal(cols({ widths: { p: 16 + 5 * BW + 24 } }), 5);
  const w = (n: number) => buildFlow({ dirs: many, links: [] }, view({ expanded: new Set(['p']), widths: { p: n } })).nodes.find(x => x.id === 'd:p')!;
  assert.ok(w(1500).width >= 1500 && w(1500).height < w(500).height); // wider, shorter
});

test('a single open subfolder takes the container width: widening it spreads its subfolders over more columns', () => {
  const deep: DirInfo[] = Array.from({ length: 12 }, (_, i) => ({ key: `a/b/k${i}`, raw: `a/b/k${i}`, files: [f(`k${i}.py`)] }));
  const run = (widths: Record<string, number>) => buildFlow({ dirs: deep, links: [] }, view({ expanded: new Set(['a', 'a/b']), widths }));
  const cols = (o: ReturnType<typeof buildFlow>) => new Set(o.nodes.filter(n => n.id.startsWith('d:a/b/')).map(n => n.position.x)).size;
  const narrow = run({ a: 16 + 2 * BW + 6 + 16 }), wide = run({ a: 16 + 5 * BW + 24 + 16 });
  assert.ok(cols(wide) > cols(narrow));
  assert.ok(wide.nodes.find(n => n.id === 'd:a/b')!.width <= wide.nodes.find(n => n.id === 'd:a')!.width - 16 + 1); // the child fits inside the parent
});

test('folderDepths: depth of each folder, 0 at the top level (includes intermediate ones)', () => {
  assert.deepEqual([...folderDepths(data)].sort(), [['.', 0], ['src', 0], ['src/a', 1], ['src/a/deep', 2], ['tests', 0]]);
});

test('related modules end up as neighbors rather than in alphabetical order', () => {
  const ds: DirInfo[] = ['a', 'b', 'c'].map(k => ({ key: k, raw: k, files: [f(`${k}.py`, { add: k === 'b' ? 1 : 10 })] }));
  const { nodes } = buildFlow({ dirs: ds, links: [['a.py', 'c.py']] }, view({ aspect: 0.2 })); // narrow screen: one column, the order is top to bottom
  const y = (id: string) => nodes.find(n => n.id === id)!.position.y;
  assert.ok(y('d:a') < y('d:c') && y('d:c') < y('d:b'));
});
