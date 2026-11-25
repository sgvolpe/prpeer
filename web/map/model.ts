// Map model, without React: the nodes and edges of React Flow come from the PR data + the UI state.
// Folders are nested as in the worktree. A closed folder is a block; an open one, a container with its files
// (cards) and its subfolders (other blocks or containers). It is pure (no DOM) so it can be tested with node:test.
export type Level = 0 | 1 | 2; // only for the panel text: 0 modules, 1 files, 2 detail
export type FileInfo = {
  key: string; // short, unique file key (the one the rest of the UI uses)
  status: 'c' | 'l'; // changed | linked (unchanged)
  add: number; del: number;
  preview: string; // first lines of the largest section
  secs: [number, number][]; // [start line, length] of each section: draws the file's minimap
  total: number; // lines in the file
};
export type DirInfo = { key: string; raw: string; files: FileInfo[] };
export type MapData = { dirs: DirInfo[]; links: [string, string][] };
export type Sel = { t: 'file' | 'dir'; k: string };
export type Rect = { x: number; y: number; w: number; h: number };
export type View = {
  expanded: Set<string>; // open folders (by path)
  open: string | null; // the card unfolded with a click
  lines: Record<string, number>; // code lines each card shows (grows as you zoom in on it)
  codes: Record<string, string[]>; // code already loaded for each file ("+ text", "- text")
  sels: Sel[];
  hidden: (fileKey: string) => boolean;
  mood: (fileKey: string) => { l: 0 | 1 | 2; why: string[] };
  pos: Record<string, { x: number; y: number }>; // position of the top-level folders the user moved
  widths?: Record<string, number>; // width the user gave an open container: decides how many subfolder columns fit
  aspect?: number; // width/height of the map on screen: decides how top-level folders are laid out
  focus?: Record<string, 0 | 1 | 2>; // how much attention each card gets (0 background, 2 center of attention); missing = 2
  cardW?: number; // width a folder's row of cards may take when zoomed in (fits the visible map); missing = narrow cards
};

// How open a card is, from 0 to 1: it grows with the zoom, and is bigger the closer the card is to the point of attention.
// Cards barely on screen get 0. `dist` is the card's distance to that point over half the map's diagonal.
export const weightOf = (zoom: number, dist: number, visible: number): number =>
  visible < 0.25 ? 0 : Math.max(0, Math.min(1, (zoom - 0.8) / 3)) * Math.max(0.3, 1 - 0.7 * dist);
// Code lines for a weight: a few as context, many at the center of attention. Steps of 6 so small zoom changes don't re-layout the map.
export const linesOf = (w: number, floor = 0): number => {
  const x = Math.max(w, floor);
  return x < 0.06 ? 0 : Math.round((6 + x * x * 114) / 6) * 6;
};

export const COL_FILES = 8; // cards per column inside a module
export const BW = 230, BH = 96, PAD = 8, HEAD = 26, GAP = 6, CW = BW - PAD * 2, LINE = 15, ROW = 2 * BW + GAP + 2 * PAD;

export const levelOf = (zoom: number): Level => (zoom < 0.55 ? 0 : zoom < 1.5 ? 1 : 2);
export const previewLines = (p: string) => (p ? p.split('\n').slice(0, 6) : []);
const hasMm = (f: FileInfo) => f.secs.length > 1;

// Height of a card: the name, the minimap if it has several sections and, if open or zoomed in on, the code.
export function cardHeight(f: FileInfo, open: boolean, lines = 0): number {
  const n = lines > 0 ? lines : open ? previewLines(f.preview).length : 0;
  return 28 + (hasMm(f) ? 12 : 0) + (n ? n * LINE + 18 : 0) + (open && hasMm(f) ? 16 : 0);
}

export type TNode = { path: string; label: string; parent: string | null; kids: TNode[]; files: FileInfo[]; dirKey: string | null };
// The browser's i18n engine (web/i18n.js) may define globalThis.i18n; model.ts stays importable without it (node:test, no DOM).
const rootLabel = () => (globalThis as { i18n?: { t(k: string): string } }).i18n?.t('map.root') ?? 'raíz';
export const labelOf = (path: string) => (path === '.' ? rootLabel() : path.split('/').pop()!);
export const baseName = (key: string) => key.split('/').pop()!; // on the card only the name: the containing module already says the folder

// Folder tree from the folders that have files (intermediate ones appear on their own, with no files of their own).
export function buildTree(data: MapData): TNode[] {
  const byPath = new Map<string, TNode>(), roots: TNode[] = [];
  const ensure = (path: string): TNode => {
    let n = byPath.get(path);
    if (n) return n;
    const i = path.lastIndexOf('/'), parent = path === '.' || i < 0 ? null : path.slice(0, i);
    n = { path, label: labelOf(path), parent, kids: [], files: [], dirKey: null };
    byPath.set(path, n);
    (parent === null ? roots : ensure(parent).kids).push(n);
    return n;
  };
  for (const d of data.dirs) { const n = ensure(d.raw); n.files = d.files; n.dirKey = d.key; }
  const sort = (xs: TNode[]) => { xs.sort((a, b) => a.path.localeCompare(b.path)); xs.forEach(x => sort(x.kids)); };
  sort(roots);
  return roots;
}
const walk = (ns: TNode[], f: (n: TNode) => void) => ns.forEach(n => { f(n); walk(n.kids, f); });

// Compact packing: each piece goes to the highest spot (then the leftmost) where it overlaps no other piece and stays within `limit` width.
// It fills the gaps left by short pieces, so there is no empty space and no module far from view without need.
export function pack(items: { w: number; h: number }[], limit: number, gap: number, x0: number, y0: number, fixed: Rect[] = []): { x: number; y: number }[] {
  const placed: Rect[] = [...fixed], out: { x: number; y: number }[] = [];
  for (const it of items) {
    const xs = new Set<number>([x0]);
    for (const p of placed) xs.add(p.x + p.w + gap);
    let best: { x: number; y: number } | undefined;
    for (const x of [...xs].sort((a, b) => a - b)) {
      if (x > x0 && x + it.w > limit) continue;
      let y = y0;
      for (let moved = true; moved;) {
        moved = false;
        for (const p of placed) if (x < p.x + p.w + gap && p.x < x + it.w + gap && y < p.y + p.h + gap && p.y < y + it.h + gap) { y = p.y + p.h + gap; moved = true; }
      }
      if (!best || y < best.y) best = { x, y };
    }
    placed.push({ ...best!, w: it.w, h: it.h });
    out.push(best!);
  }
  return out;
}

type Lay = { w: number; h: number; open: boolean; cw: number; cards: { key: string; x: number; y: number; h: number }[]; kids: { n: TNode; lay: Lay; x: number; y: number }[] };
type Stats = { files: number; changed: number; add: number; del: number; moods: number[] };

export function buildFlow(data: MapData, v: View) {
  const roots = buildTree(data), fileNode = new Map<string, TNode>(), fileInfo = new Map<string, FileInfo>();
  walk(roots, n => { for (const f of n.files) { fileNode.set(f.key, n); fileInfo.set(f.key, f); } });
  const vis = new Map<string, boolean>();
  const visible = (n: TNode): boolean => { let r = vis.get(n.path); if (r === undefined) { r = n.files.some(f => !v.hidden(f.key)) || n.kids.some(visible); vis.set(n.path, r); } return r; };
  const stats = (n: TNode): Stats => {
    const s: Stats = { files: 0, changed: 0, add: 0, del: 0, moods: [0, 0, 0] };
    walk([n], m => { for (const f of m.files) { if (v.hidden(f.key)) continue; s.files++; if (f.status === 'c') { s.changed++; s.add += f.add; s.del += f.del; s.moods[v.mood(f.key).l]++; } } });
    return s;
  };

  // Meaningful order: most changed first and, from there, each module next to the one it relates to most (imports and usages).
  // Packing places the pieces in this order, so modules that work together end up as neighbors instead of in alphabetical order.
  const related = <T extends { n: TNode }>(xs: T[]): T[] => {
    if (xs.length < 3) return xs;
    const at = new Map<string, number>(); // file -> position of the sibling that contains it
    xs.forEach((x, i) => walk([x.n], m => m.files.forEach(f => at.set(f.key, i))));
    const w = xs.map(() => xs.map(() => 0));
    for (const [a, b] of data.links) { const i = at.get(a), j = at.get(b); if (i !== undefined && j !== undefined && i !== j) { w[i][j]++; w[j][i]++; } }
    const ch = xs.map(x => { const s = stats(x.n); return s.add + s.del; });
    const left = xs.map((_, i) => i), out: number[] = [];
    const best = (score: (c: number) => number) => left.reduce((b, c) => (score(c) - score(b) || ch[c] - ch[b] || b - c) > 0 ? c : b);
    while (left.length) {
      const last = out[out.length - 1];
      const pick = best(c => (last === undefined ? 0 : 3 * w[c][last] + out.reduce((s, p) => s + w[c][p], 0)));
      out.push(pick); left.splice(left.indexOf(pick), 1);
    }
    return out.map(i => xs[i]);
  };

  // code lines actually shown: those requested by zoom, capped at what the file has (until it loads, those of the preview)
  const shownLines = (f: FileInfo) => { const l = v.lines[f.key] ?? 0; return l > 0 ? Math.min(l, v.codes[f.key]?.length ?? previewLines(f.preview).length) : 0; };
  const layout = (n: TNode, forceW?: number): Lay => {
    if (!v.expanded.has(n.path)) return { w: BW, h: BH, open: false, cw: CW, cards: [], kids: [] };
    // cards go in columns (up to 3, 8 per column): a folder with 100 files can't be a tower
    const files = n.files.filter(f => !v.hidden(f.key)), cols = Math.min(3, Math.max(1, Math.ceil(files.length / COL_FILES))), per = Math.ceil(files.length / cols);
    const user = forceW ?? v.widths?.[n.path];
    // the width the user dragged wins at every zoom (wider or narrower); otherwise, zoomed in, the columns share the visible width
    const row = user !== undefined ? user - 2 * PAD : v.cardW ?? 0;
    const cw = Math.max(CW, Math.floor((row - (cols - 1) * GAP) / cols));
    const ys = Array(cols).fill(HEAD) as number[];
    const cards = files.map((f, i) => { const col = Math.floor(i / per), h = cardHeight(f, v.open === f.key, shownLines(f)), c = { key: f.key, x: PAD + col * (cw + GAP), y: ys[col], h }; ys[col] += h + GAP; return c; });
    let y = Math.max(...ys);
    const kids = related(n.kids.filter(visible).map(k => ({ n: k, lay: layout(k), x: 0, y: 0 })));
    // a single open subfolder takes the whole width given to the container: that way its own subfolders spread over more columns
    if (user !== undefined && kids.length === 1 && kids[0].lay.open) kids[0].lay = layout(kids[0].n, user - 2 * PAD);
    let w = Math.max(BW, cols * (cw + GAP) - GAP + 2 * PAD), h = y + (kids.length ? 0 : PAD - GAP);
    // width for the subfolders: the one the user chose or, failing that, the one that gives a shape similar to the screen's (more columns the wider the map)
    const area = kids.reduce((a, k) => a + (k.lay.w + GAP) * (k.lay.h + GAP), 0);
    const limit = user !== undefined ? user - PAD : Math.max(ROW, Math.round(Math.sqrt(area * (v.aspect ?? 1.5))) + PAD);
    if (user !== undefined) w = Math.max(w, user);
    pack(kids.map(k => k.lay), limit, GAP, PAD, y).forEach((p, i) => { // subfolders fill gaps, with just enough width for two blocks to fit
      kids[i].x = p.x; kids[i].y = p.y;
      w = Math.max(w, p.x + kids[i].lay.w + PAD); h = Math.max(h, p.y + kids[i].lay.h + PAD);
    });
    return { w, h, open: true, cw, cards, kids };
  };

  // top-level folders: a grid with the screen's proportions; the ones the user moved keep their place
  const tops = related(roots.filter(visible).map(n => ({ n, lay: layout(n), x: 0, y: 0 })));
  const area = tops.reduce((a, t) => a + (t.lay.w + 40) * (t.lay.h + 40), 0), limit = Math.max(BW + 80, Math.sqrt(area * (v.aspect ?? 1.5)));
  const fixed: Rect[] = [];
  for (const t of tops) { const s = v.pos[t.n.path]; if (s) { t.x = s.x; t.y = s.y; fixed.push({ x: s.x, y: s.y, w: t.lay.w, h: t.lay.h }); } }
  const free = tops.filter(t => !v.pos[t.n.path]);
  pack(free.map(t => t.lay), limit, 40, 40, 40, fixed).forEach((p, i) => { free[i].x = p.x; free[i].y = p.y; });

  // If a folder the user moved ends up where another one opened or grew, it is pushed down: nothing overlaps.
  const placed: Rect[] = [];
  for (const t of [...tops].sort((p, q) => p.y - q.y || p.x - q.x)) {
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) if (t.x < p.x + p.w + 40 && p.x < t.x + t.lay.w + 40 && t.y < p.y + p.h + 40 && p.y < t.y + t.lay.h + 40) { t.y = p.y + p.h + 40; moved = true; }
    }
    placed.push({ x: t.x, y: t.y, w: t.lay.w, h: t.lay.h });
  }

  const selFiles = new Set(v.sels.filter(s => s.t === 'file').map(s => s.k)), selDirs = new Set(v.sels.filter(s => s.t === 'dir').map(s => s.k));
  const nodes: NodeOut[] = [], rects: Record<string, Rect> = {};
  const emit = (n: TNode, lay: Lay, ax: number, ay: number, parentId: string | undefined, rx: number, ry: number, depth: number) => {
    const id = `d:${n.path}`, st = stats(n);
    nodes.push({
      id, type: 'folder', parentId, position: { x: rx, y: ry }, width: lay.w, height: lay.h, draggable: !parentId, selectable: false, dragHandle: '.fold-head',
      data: { path: n.path, label: n.label, parent: n.parent ?? '', dirKey: n.dirKey, expanded: lay.open, depth, ...st, sel: n.dirKey !== null && selDirs.has(n.dirKey) },
    });
    rects[id] = { x: ax, y: ay, w: lay.w, h: lay.h };
    for (const c of lay.cards) {
      const f = fileInfo.get(c.key)!, cid = `f:${f.key}`;
      nodes.push({
        id: cid, type: 'file', parentId: id, position: { x: c.x, y: c.y }, width: lay.cw, height: c.h, draggable: false, selectable: false,
        data: { file: f, open: v.open === f.key, sel: selFiles.has(f.key), mood: f.status === 'c' ? v.mood(f.key) : null, h: c.h, lines: shownLines(f), code: v.codes[f.key] ?? null, focus: v.focus?.[f.key] ?? 2 },
      });
      rects[cid] = { x: ax + c.x, y: ay + c.y, w: lay.cw, h: c.h };
    }
    for (const k of lay.kids) emit(k.n, k.lay, ax + k.x, ay + k.y, id, k.x, k.y, depth + 1);
  };
  for (const t of tops) emit(t.n, t.lay, t.x, t.y, undefined, t.x, t.y, 0);

  // Which node represents a file now: its card, or the closed block of its folder (or of the parent folder that contains it).
  const resolve = (id: string): string | undefined => {
    if (rects[id]) return id;
    let path: string | undefined = id.startsWith('f:') ? fileNode.get(id.slice(2))?.path : id.slice(2);
    while (path !== undefined) {
      if (rects[`d:${path}`]) return `d:${path}`;
      const i: number = path.lastIndexOf('/');
      path = i < 0 ? undefined : path.slice(0, i);
    }
    return undefined;
  };

  // Edges. If both ends are cards: one per link. If either is a closed block: one aggregated per pair, thicker the more links.
  const edges: EdgeOut[] = [], agg = new Map<string, { a: string; b: string; n: number; hit: boolean }>();
  const anySel = selFiles.size > 0;
  let idx = 0;
  const hitDir = (f: string) => { const k = fileNode.get(f)?.dirKey; return !!k && selDirs.has(k); };
  for (const [a, b] of data.links) {
    if (!fileInfo.has(a) || !fileInfo.has(b) || v.hidden(a) || v.hidden(b)) continue;
    const ea = resolve(`f:${a}`), eb = resolve(`f:${b}`);
    if (!ea || !eb || ea === eb) continue;
    const hit = selFiles.has(a) || selFiles.has(b);
    if (ea.startsWith('f:') && eb.startsWith('f:')) {
      const intra = fileNode.get(a) === fileNode.get(b), right = rects[eb].x >= rects[ea].x;
      edges.push({ id: `e:${a}>${b}`, source: ea, target: eb, type: intra ? 'arc' : 'default', sourceHandle: intra ? 'sr' : right ? 'sr' : 'sl', targetHandle: intra ? 'tr' : right ? 'tl' : 'tr', data: { idx: idx++, hit, dim: anySel && !hit, intra } });
      continue;
    }
    const k = ea < eb ? `${ea}\0${eb}` : `${eb}\0${ea}`, e = agg.get(k) ?? { a: ea, b: eb, n: 0, hit: false };
    e.n++; e.hit ||= hit || hitDir(a) || hitDir(b);
    agg.set(k, e);
  }
  for (const e of agg.values()) {
    const right = rects[e.b].x >= rects[e.a].x;
    edges.push({ id: `m:${e.a}>${e.b}`, source: e.a, target: e.b, sourceHandle: right ? 'sr' : 'sl', targetHandle: right ? 'tl' : 'tr', type: 'default', data: { idx: idx++, hit: e.hit, dim: false, count: e.n, intra: false } });
  }
  return { nodes, edges, rects, resolve };
}

// Which folders start open: top to bottom, those with changes, while the total of blocks and cards doesn't exceed `max`.
export function defaultExpanded(data: MapData, hidden: (k: string) => boolean, max = 24): Set<string> {
  const roots = buildTree(data), out = new Set<string>();
  const changed = (n: TNode): boolean => n.files.some(f => f.status === 'c' && !hidden(f.key)) || n.kids.some(changed);
  let items = roots.filter(changed).length;
  const queue = roots.filter(changed);
  while (queue.length) {
    const n = queue.shift()!, kids = n.kids.filter(changed), cost = n.files.filter(f => !hidden(f.key)).length + kids.length - 1;
    if (items + cost > max) continue;
    out.add(n.path); items += cost; queue.push(...kids);
  }
  return out;
}

// Depth of each folder (0 = top level): lets you open or close a whole level at once.
export function folderDepths(data: MapData): Map<string, number> {
  const out = new Map<string, number>();
  const go = (ns: TNode[], d: number) => ns.forEach(n => { out.set(n.path, d); go(n.kids, d + 1); });
  go(buildTree(data), 0);
  return out;
}

// Paths of the folders that contain a folder, itself included (to open them all so a file becomes visible).
export const pathsTo = (dir: string): string[] => (dir === '.' ? ['.'] : dir.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')));

export type NodeOut = {
  id: string; type: 'folder' | 'file'; position: { x: number; y: number }; width: number; height: number;
  parentId?: string; hidden?: boolean; draggable: boolean; selectable: false; dragHandle?: string; zIndex?: number;
  data: Record<string, unknown>;
};
export type EdgeOut = {
  id: string; source: string; target: string; sourceHandle: string; targetHandle: string; type: 'arc' | 'default'; hidden?: boolean;
  data: { idx: number; hit: boolean; dim: boolean; count?: number; intra: boolean };
};
