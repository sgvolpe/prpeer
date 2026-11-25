import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Background, BackgroundVariant, BaseEdge, Handle, NodeResizeControl, Panel, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesInitialized, useNodesState, useReactFlow, useViewport, type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BW, baseName, buildFlow, defaultExpanded, folderDepths, levelOf, linesOf, pathsTo, previewLines, weightOf, type EdgeOut, type FileInfo, type Level, type MapData, type Rect, type Sel } from './model.ts';

type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
// Bridge to the regular interface (app.js): it decides the selection, what is hidden and the step-by-step; the map draws it.
export type MapApi = {
  data: MapData;
  posKey: string; // where the top-level folders the user moved are remembered
  snapshot(): { v: number; sels: Sel[]; open: string | null }; // the same object until something changes
  subscribe(cb: () => void): () => void;
  hidden(fileKey: string): boolean;
  mood(fileKey: string): { l: 0 | 1 | 2; why: string[] };
  onLevel(level: Level): void;
  cardClick(key: string, e: Mods): void;
  dirClick(dir: string, e: Mods): void;
  ctxMenu(e: React.MouseEvent, target: Sel | { t: 'pane' }): void;
  pinned(): ReadonlySet<string>; // cards pinned open from the right-click menu
  reviewed?(fileKey: string): boolean; // marked as reviewed by the user
  ci?(fileKey: string): string[] | null; // what the failed CI checks say about this file
  ext?(fileKey: string): string[] | null; // what in this file changes for whoever uses the code (signatures, endpoints…)
  stale?(fileKey: string): boolean; // reviewed at an earlier push and changed since
  openDiff(key: string): void;
  onView(view: { key: string; w: number }[]): void; // cards on screen and the focus each has (0..1): the AI explains with them as context
  code(key: string): Promise<string[]>; // the file's changed code ("+ text", "- text"), to show more as the zoom gets closer
};
export type MapCtrl = { focus?: (key: string) => void; fit?: () => void; step?: (dir: 1 | -1) => void; levels?: (n: number) => void; only?: (keys: string[], dir: string) => void; show?: (keys: string[], detail?: number) => void };
type Ops = { toggle(path: string): void; width(path: string, w: number, end: boolean): void; resetWidth(path: string): void };

const Api = createContext<MapApi | null>(null);
const OpsCtx = createContext<Ops | null>(null);
// client i18n engine (web/i18n.js), loaded before the map bundle
const $t = (key: string, vars?: Record<string, string | number>): string => (window as unknown as { i18n: { t(k: string, v?: Record<string, string | number>): string } }).i18n.t(key, vars);
const LBL = ['calm', 'attention', 'risky'].map(k => $t('mood.' + k));
const LEVEL_NAME = [0, 1, 2].map(i => $t('map.lvl.' + i));
const MAX_EDGES = 60; // with more relations the map is an unreadable tangle: they hide themselves (those of the selection stay visible)
type EdgeMode = 'auto' | 'on' | 'off';
// Local semantic zoom: what is under the cursor opens when zooming in and closes when zooming out; the rest of the map does not change.
const OPEN_PX = 240; // a closed block that measures this much on screen opens
const CLOSE_PX = 120; // an open folder whose block would measure less than this on screen closes

// invisible handles: each node can be connected from any side (edges choose based on where the other end falls)
const Handles = () => (
  <>
    <Handle className="h" type="target" position={Position.Left} id="tl" />
    <Handle className="h" type="target" position={Position.Right} id="tr" />
    <Handle className="h" type="source" position={Position.Left} id="sl" />
    <Handle className="h" type="source" position={Position.Right} id="sr" />
  </>
);

type FileData = { file: FileInfo; open: boolean; sel: boolean; mood: { l: 0 | 1 | 2; why: string[] } | null; h: number; lines: number; code: string[] | null; focus: 0 | 1 | 2 };
const FileNode = memo(function FileNode({ data }: NodeProps) {
  const api = useContext(Api)!;
  const { file: f, open, sel, mood, h, lines, code, focus } = data as unknown as FileData;
  const shown = lines > 0 ? (code ?? previewLines(f.preview)).slice(0, lines) : open ? previewLines(f.preview) : [];
  const t = f.add + f.del, many = f.secs.length > 1, seen = api.reviewed?.(f.key), ci = api.ci?.(f.key), ext = api.ext?.(f.key);
  const cls = ['card', f.status, 't3', `fx${focus}`, t > 200 && 'big', sel && 'sel', open && 'open', seen && 'seen', ci && 'cifail', 'nodrag', 'nopan'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ height: h }} draggable
      onClick={e => api.cardClick(f.key, e)} onDoubleClick={() => api.openDiff(f.key)} onContextMenu={e => api.ctxMenu(e, { t: 'file', k: f.key })}
      onDragStart={e => e.dataTransfer.setData('text/plain', f.key)}>
      <Handles />
      <div className="hd">
        {api.pinned().has(f.key) && <span title="📌">📌</span>}
        {mood && <i className={`md m${mood.l}`} title={`${LBL[mood.l]}: ${mood.why.join(', ')}`} />}
        <span className="nm" title={f.key}>{baseName(f.key)}</span>
        {ci && <span className="ci" title={ci.join('\n')}>✗ CI</span>}
        {ext && <span className="ext" title={`${$t('surf.tip')}\n${ext.join('\n')}`}>⇄</span>}
        {seen && <span className="ok" title={$t('seen.tip')}>✓</span>}
        {api.stale?.(f.key) && <span className="stl" title={$t('stale.badge')}>↻</span>}
        {f.status === 'c' && <span className="st"><span className="a">+{f.add}</span> <span className="x">−{f.del}</span>{many ? ` · ${f.secs.length} fn` : ''}</span>}
      </div>
      {shown.length > 0 && <pre>{shown.map((l, i) => <span key={i} className={l[0] === '+' ? 'p' : 'm'}>{l}</span>)}</pre>}
      {open && many && lines === 0 && <div className="more">{$t('map.moreChanges', { n: f.secs.length - 1 })}</div>}
      {many && <div className="mm">{f.secs.map(([s, n], i) => <b key={i} style={{ left: `${(s / f.total) * 100}%`, width: `${Math.max(1.5, (n / f.total) * 100)}%` }} />)}</div>}
      {f.status === 'c' && t > 0 && <i className="bar" style={{ width: `${Math.min(100, (Math.log10(t + 1) / 2.8) * 100)}%`, background: `linear-gradient(90deg,var(--add) ${(f.add / t) * 100}%,var(--del) 0)` }} />}
    </div>
  );
});

type FolderData = { path: string; label: string; parent: string; dirKey: string | null; expanded: boolean; depth: number; files: number; changed: number; add: number; del: number; moods: number[]; sel: boolean };
const stat = (d: FolderData) => `${$t('map.changed', { n: d.changed })} · +${d.add} −${d.del}${d.files > d.changed ? ` · ${$t('map.linked', { n: d.files - d.changed })}` : ''}`;
const FolderNode = memo(function FolderNode({ data }: NodeProps) {
  const api = useContext(Api)!, ops = useContext(OpsCtx)!;
  const { zoom } = useViewport();
  const d = data as unknown as FolderData;
  const ev = {
    onClick: (e: React.MouseEvent) => (d.dirKey ? api.dirClick(d.dirKey, e) : ops.toggle(d.path)), // a folder with no files of its own just opens or closes
    onContextMenu: (e: React.MouseEvent) => { if (d.dirKey) api.ctxMenu(e, { t: 'dir', k: d.dirKey }); },
    onDoubleClick: () => ops.toggle(d.path),
  };
  if (!d.expanded) { // closed block: name, totals and status of everything it contains
    const title = Math.min(22, Math.max(14, 14 / zoom)), small = Math.min(12, Math.max(10, 10 / zoom)); // capped: the block always measures the same and the text has to fit
    return (
      <div className={`fold mod fold-head${d.sel ? ' sel' : ''}`} title={`${d.path === '.' ? $t('map.root') : d.path}/\n${$t('map.dblOpen')}`} {...ev}>
        <Handles />
        <b className="t" style={{ fontSize: title }}>{d.label}/</b>
        {d.parent && <span className="p" style={{ fontSize: small }}>{d.parent}</span>}
        <span className="s" style={{ fontSize: small }}>{stat(d)}</span>
        <span className="mo" style={{ fontSize: small }}>
          {d.moods[2] > 0 && <span className="md m2" title={$t('map.moods.risky')} />}{d.moods[2] > 0 && d.moods[2]}
          {d.moods[1] > 0 && <span className="md m1" title={$t('map.moods.attention')} />}{d.moods[1] > 0 && d.moods[1]}
          {d.moods[0] > 0 && <span className="md m0" title={$t('map.moods.calm')} />}{d.moods[0] > 0 && d.moods[0]}
        </span>
      </div>
    );
  }
  return ( // open folder: container with its files and subfolders inside; widened or narrowed by dragging the right edge
    <div className={`fold nest${d.sel ? ' sel' : ''}`} style={{ background: `color-mix(in srgb, var(--tx) ${3 + Math.min(d.depth, 4) * 2}%, var(--bg))` }}>
      <NodeResizeControl position="right" resizeDirection="horizontal" minWidth={BW} maxWidth={4000} className="rzh rzr"
        onResize={(_, p) => ops.width(d.path, p.width, false)} onResizeEnd={(_, p) => ops.width(d.path, p.width, true)} />
      <Handles />
      <b className="fold-head" title={`${d.path === '.' ? $t('map.root') : d.path}/\n${$t('map.dblClose')}`} {...ev}><span className="caret" role="button" aria-label={$t('tree.collapseTip')} onClick={e => { e.stopPropagation(); ops.toggle(d.path); }}>▾</span> {d.label}/ <small>{stat(d)}</small></b>
    </div>
  );
});

// links within the same folder: arc along the right edge (the source and target handles are on the same side)
function ArcEdge({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps) {
  const k = 16 + ((data as { idx: number }).idx % 4) * 8;
  return <BaseEdge id={id} style={style} path={`M${sourceX} ${sourceY} C${sourceX + k} ${sourceY},${targetX + k} ${targetY},${targetX} ${targetY}`} />;
}

const nodeTypes = { file: FileNode, folder: FolderNode };
const edgeTypes = { arc: ArcEdge };

function toEdge(e: EdgeOut): Edge {
  const { hit, dim, intra, count } = e.data, agg = count !== undefined;
  const stroke = hit ? 'var(--tx)' : intra ? '#b48cff' : agg ? '#4aa3ff88' : '#4aa3ff99';
  const width = hit ? 2.5 : agg ? Math.min(4, 1 + Math.log2(count ?? 1) * 0.6) : 1.5; // thin: thick ones covered the content
  return {
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: e.type, selectable: false, focusable: false, hidden: e.hidden,
    data: e.data, style: { stroke, strokeWidth: width, strokeDasharray: agg ? undefined : '4 3', opacity: dim ? 0.15 : 1 }, zIndex: hit ? 5 : 0,
  };
}

const readSaved = (key: string): Record<string, { x: number; y: number }> => {
  try {
    const raw = JSON.parse(localStorage[key] || '{}') as Record<string, [unknown, unknown]>;
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, v] of Object.entries(raw)) { const x = parseFloat(String(v[0])), y = parseFloat(String(v[1])); if (Number.isFinite(x) && Number.isFinite(y)) out[k] = { x, y }; }
    return out;
  } catch { return {}; }
};
const extentOf = (rects: Record<string, Rect>): [[number, number], [number, number]] => {
  const rs = Object.values(rects), pad = 160;
  return [[Math.min(...rs.map(r => r.x)) - pad, Math.min(...rs.map(r => r.y)) - pad], [Math.max(...rs.map(r => r.x + r.w)) + pad, Math.max(...rs.map(r => r.y + r.h)) + pad]];
};
const contains = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const MAXZ = 4; // past this the text only gets bigger, it shows nothing new
const FIT_PAD = { top: '96px', x: '24px', bottom: '24px' } as const; // the top bar and the zoom toolbar float over the map

function Inner({ api, ctrl }: { api: MapApi; ctrl: MapCtrl }) {
  const snap = useSyncExternalStore(api.subscribe, api.snapshot);
  const { zoom, x: vx, y: vy } = useViewport();
  const level = levelOf(zoom);
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const posKey = api.posKey + ':t';
  const pos = useRef(readSaved(posKey));
  const aspect = useRef((() => { const r = document.querySelector('#rf')?.getBoundingClientRect(); return r && r.height > 0 ? r.width / r.height : 1.5; })());
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(api.data, api.hidden));
  const lines = useRef<Record<string, number>>({}), codes = useRef<Record<string, string[]>>({});
  const rects = useRef<Record<string, Rect>>({});
  const quiet = useRef(false);
  const tiers = useRef<Record<string, 0 | 1 | 2>>({}), loading = useRef(new Set<string>()), sentView = useRef(''), showDetail = useRef(8), minRef = useRef(0.08);
  const wheel = useRef<{ target: number; raf: number; px: number; py: number }>({ target: 1, raf: 0, px: 0, py: 0 });
  const [rev, setRev] = useState(0);
  const edgesKey = api.posKey + ':edges';
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(() => { try { const v = localStorage[edgesKey]; return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; } });
  const [edgeInfo, setEdgeInfo] = useState({ n: 0, hiding: false });
  const showing = useRef<{ keys: string[] } | null>(null), shown = useRef<string[]>([]); // what the story asks to show
  const pending = useRef<string | null>(null); // file to center on once its folder finishes opening

  const widthKey = api.posKey + ':w';
  const widths = useRef<Record<string, number>>((() => { try { const r = JSON.parse(localStorage[widthKey] || '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(r).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) as Record<string, number>; } catch { return {}; } })());
  const saveWidths = () => { try { localStorage[widthKey] = JSON.stringify(widths.current); } catch { /* no storage */ } };
  const toggle = (path: string) => setExpanded(s => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const ops = useRef<Ops>({ toggle, width: () => {}, resetWidth: () => {} }).current;
  ops.toggle = toggle;
  ops.width = (path, w, end) => { widths.current[path] = Math.round(w); if (end) saveWidths(); setRev(r => r + 1); };
  ops.resetWidth = path => { delete widths.current[path]; saveWidths(); setRev(r => r + 1); };

  // What is under the cursor does not move when the map is rearranged: after each change the view is shifted so that
  // the same node (or the block that replaces it) keeps the pointed spot.
  const cursor = useRef<{ cx: number; cy: number; px: number; py: number; t: number } | undefined>(undefined);
  const prev = useRef<Record<string, Rect> | undefined>(undefined);
  // Smooth zoom shared by the wheel, the buttons, the keys, the slider and double click: the view eases toward `target`, anchored on (px, py).
  const ease = (target: number, px: number, py: number) => {
    const st = wheel.current;
    st.target = Math.min(MAXZ, Math.max(minRef.current, target)); st.px = px; st.py = py;
    if (st.raf) return;
    const step = () => {
      const { x, y, zoom: z0 } = rf.getViewport(), done = Math.abs(st.target - z0) < z0 * 0.002, z = done ? st.target : z0 + (st.target - z0) * 0.35, k = z / z0;
      rf.setViewport({ zoom: z, x: st.px - (st.px - x) * k, y: st.py - (st.py - y) * k });
      st.raf = done ? 0 : requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };
  useEffect(() => {
    const el = document.getElementById('rf') as HTMLElement | null;
    if (!el) return;
    const at = (e: MouseEvent | WheelEvent) => { const r = el.getBoundingClientRect(); cursor.current = { cx: e.clientX, cy: e.clientY, px: e.clientX - r.left, py: e.clientY - r.top, t: Date.now() }; };
    // in capture: React Flow's zoom may cut the event before it reaches this element
    el.addEventListener('mousemove', at, true); el.addEventListener('wheel', at, { passive: true, capture: true });
    // Smooth zoom: each wheel notch moves a target and the view eases toward it (anchored on the cursor), instead of jumping in steps.
    const st = wheel.current;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest('.tb')) return;
      e.preventDefault(); e.stopPropagation(); moved.current = true;
      const dy = Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1)));
      if (!st.raf) st.target = rf.getViewport().zoom;
      st.target = Math.min(MAXZ, Math.max(minRef.current, st.target * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022))));
      const r = el.getBoundingClientRect();
      // over a card, zooming in stops when it fills the map's width: past that its code runs off the sides and can't be read
      const P = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), card = Object.entries(rects.current).find(([id, q]) => id.startsWith('f:') && contains(q, P))?.[1];
      if (card && dy < 0) st.target = Math.min(st.target, Math.max((el.clientWidth - 24) / card.w, rf.getViewport().zoom));
      ease(st.target, e.clientX - r.left, e.clientY - r.top);
    };
    // double click on the empty canvas: zoom in ×2 on that spot (shift: out), with the same easing as the wheel
    const onDbl = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest('.react-flow__pane') || (e.target as Element).closest('.react-flow__node')) return;
      const r = el.getBoundingClientRect(); moved.current = true; cursor.current = { cx: e.clientX, cy: e.clientY, px: e.clientX - r.left, py: e.clientY - r.top, t: Date.now() };
      ease(rf.getViewport().zoom * (e.shiftKey ? 0.5 : 2), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    el.addEventListener('dblclick', onDbl);
    return () => { el.removeEventListener('mousemove', at, true); el.removeEventListener('wheel', at, true); el.removeEventListener('wheel', onWheel, true); el.removeEventListener('dblclick', onDbl); cancelAnimationFrame(st.raf); st.raf = 0; };
  }, []);
  const underCursor = () => {
    const c = cursor.current;
    if (!c || Date.now() - c.t > 2500) return undefined; // the cursor is elsewhere (the panel, the tree…)
    return { c, P: rf.screenToFlowPosition({ x: c.cx, y: c.cy }) };
  };
  const keepFocus = (f: ReturnType<typeof buildFlow>) => {
    const u = underCursor(), old = prev.current;
    if (!u || !old) return;
    let best: string | undefined, area = Infinity;
    for (const [id, r] of Object.entries(old)) if (contains(r, u.P) && r.w * r.h < area) { area = r.w * r.h; best = id; }
    const now = best && f.resolve(best), r0 = best && old[best], r1 = now && f.rects[now];
    if (!now || !r0 || !r1) return;
    const Pn = { x: r1.x + Math.min(u.P.x - r0.x, r1.w), y: r1.y + Math.min(u.P.y - r0.y, r1.h) }, { zoom: z, x, y } = rf.getViewport();
    const nx = u.c.px - Pn.x * z, ny = u.c.py - Pn.y * z;
    if (Math.abs(nx - x) > 0.5 || Math.abs(ny - y) > 0.5) {
      quiet.current = true; rf.setViewport({ x: nx, y: ny, zoom: z }); // the view's own correction is not a user move: it doesn't re-weigh
    }
  };

  const rebuild = () => {
    const box = document.getElementById('rf');
    if (box && box.clientHeight > 0) aspect.current = box.clientWidth / box.clientHeight; // top-level folders are laid out according to the map's current size
    const f = buildFlow(api.data, { expanded, open: snap.open, lines: lines.current, codes: codes.current, sels: snap.sels, hidden: api.hidden, mood: api.mood, pos: pos.current, widths: widths.current, aspect: aspect.current, focus: tiers.current, cardW: cardW.current });
    keepFocus(f);
    rects.current = f.rects; prev.current = f.rects;
    setNodes(f.nodes as unknown as Node[]);
    const all = f.edges.map(toEdge), n = all.filter(e => !e.hidden).length;
    const hiding = edgeMode === 'off' || (edgeMode === 'auto' && n > MAX_EDGES);
    // manually ('off') all are hidden, including the white ones of the selection; only automatic hiding leaves them
    setEdges(hiding ? all.map(e => ((e.data as { hit?: boolean } | undefined)?.hit && edgeMode !== 'off' ? e : { ...e, hidden: true })) : all);
    setEdgeInfo({ n, hiding });
    const k = pending.current, r = k && f.rects[`f:${k}`];
    if (k && r) { pending.current = null; rf.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom: Math.max(1.4, rf.getViewport().zoom), duration: 350 }); }
    const sh = showing.current;
    if (sh) { // the story asks to show some files: they are framed together, with their code in view
      showing.current = null;
      const rs = sh.keys.map(x => f.rects[`f:${x}`]).filter(Boolean);
      if (rs.length) {
        const x0 = Math.min(...rs.map(q => q.x)), y0 = Math.min(...rs.map(q => q.y)), x1 = Math.max(...rs.map(q => q.x + q.w)), y1 = Math.max(...rs.map(q => q.y + q.h));
        moved.current = true;
        const el = document.getElementById('rf'), pad = 1.5; // 25 % of breathing room on each side
        const z = el ? Math.min(el.clientWidth / ((x1 - x0) * pad), el.clientHeight / ((y1 - y0) * pad), rs.length === 1 ? 2.2 : 1.6) : 1;
        rf.setCenter((x0 + x1) / 2, (y0 + y1) / 2, { zoom: Math.max(0.05, z), duration: 700 });
      }
    }
  };
  useEffect(() => { api.onLevel(level); }, [level]);
  useEffect(() => { rebuild(); }, [snap, rev, edgeMode, expanded]);

  // Local semantic zoom: zooming in on a closed block opens it; zooming out on an open folder closes it; zooming in on a card
  // shows more code. Only what is under the cursor: the rest of the map stays as it was.
  const lastZoom = useRef(zoom), focusZoom = useRef(zoom);
  // Zoomed in, cards widen to use the visible map (#rf already excludes the open side panels). Steps of 40 so it doesn't re-layout every frame.
  const cardW = useRef(0);
  useEffect(() => {
    const el = document.getElementById('rf');
    // gradual: from zoom 0.9 the cards start widening and reach the full visible width at 1.8 (smoothstep), in steps of 16
    const t = Math.max(0, Math.min(1, (zoom - 0.9) / 0.9)), s = t * t * (3 - 2 * t);
    const full = el ? Math.min(1200, (el.clientWidth * 0.85) / zoom) : 0, w = s > 0 && full > BW ? Math.floor((BW + (full - BW) * s) / 16) * 16 : 0;
    if (w !== cardW.current) { cardW.current = w; setRev(r => r + 1); }
  }, [zoom, rev]);
  // The card being zoomed into stays whole on screen sideways (while it fits): otherwise its code runs off the edge and can't be read.
  useEffect(() => {
    const el = document.getElementById('rf'), u = underCursor();
    const r = u && Object.entries(rects.current).find(([id, q]) => id.startsWith('f:') && contains(q, u.P))?.[1];
    if (!el || !r) return;
    const { x, y, zoom: z } = rf.getViewport(), W = el.clientWidth, m = 12, L = r.x * z + x, R = (r.x + r.w) * z + x;
    const dx = r.w * z > W - 2 * m ? 0 : L < m ? m - L : R > W - m ? W - m - R : 0;
    if (Math.abs(dx) > 0.5) rf.setViewport({ x: x + dx, y, zoom: z });
  }, [zoom, rev]);
  useEffect(() => {
    const dz = zoom - lastZoom.current;
    lastZoom.current = zoom;
    const u = underCursor();
    if (!u || Math.abs(dz) < 1e-4) return;
    const hits = Object.entries(rects.current).filter(([, r]) => contains(r, u.P)).sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h);
    const card = hits.find(([id]) => id.startsWith('f:'));
    if (dz > 0) {
      const closed = hits.find(([id]) => id.startsWith('d:') && !expanded.has(id.slice(2)));
      if (closed && !card && closed[1].w * zoom >= OPEN_PX) { toggle(closed[0].slice(2)); return; }
    } else {
      const open = hits.find(([id]) => id.startsWith('d:') && expanded.has(id.slice(2)));
      if (open && BW * zoom < CLOSE_PX) { toggle(open[0].slice(2)); return; }
    }
  }, [zoom]);

  // Focus: every card on screen is context. Each gets a weight from the zoom and its distance to the point of attention (cursor, or
  // the center of the map); the heavier, the more code it shows and the stronger it is drawn. Moving away does the opposite.
  useEffect(() => {
    const el = document.getElementById('rf');
    if (!el) return;
    if (quiet.current) { quiet.current = false; return; }
    const dz = zoom - focusZoom.current; focusZoom.current = zoom;
    const W = el.clientWidth, H = el.clientHeight, u = underCursor(), fx = u ? u.c.px : W / 2, fy = u ? u.c.py : H / 2, half = Math.hypot(W, H) / 2;
    const pins = api.pinned(), picked = new Set([...snap.sels.filter(s => s.t === 'file').map(s => s.k), ...(snap.open ? [snap.open] : [])]);
    const ws: Record<string, { w: number; on: boolean }> = {};
    // the card under the cursor is the one being looked at: it grows much more than the rest, which shrink
    const hov = u && Object.entries(rects.current).find(([id, r]) => id.startsWith('f:') && contains(r, u.P))?.[0];
    let top = 0;
    for (const [id, r] of Object.entries(rects.current)) {
      if (!id.startsWith('f:')) continue;
      const sx = r.x * zoom + vx, sy = r.y * zoom + vy, sw = r.w * zoom, sh = r.h * zoom;
      const ix = Math.max(0, Math.min(sx + sw, W) - Math.max(sx, 0)), iy = Math.max(0, Math.min(sy + sh, H) - Math.max(sy, 0));
      const vis = (ix * iy) / Math.min(sw * sh, (W * H) / 4), w = weightOf(zoom, Math.hypot(sx + sw / 2 - fx, sy + sh / 2 - fy) / half, vis);
      ws[id.slice(2)] = { w: !hov ? w : id === hov ? Math.min(1, w * 1.6) : w * 0.45, on: vis >= 0.25 };
      top = Math.max(top, ws[id.slice(2)].w);
    }
    let changed = false;
    const view: { key: string; w: number }[] = [];
    for (const [key, { w, on }] of Object.entries(ws)) {
      const sel = picked.has(key), pin = pins.has(key), score = pin ? 1 : !on ? 0 : zoom < 0.6 || sel ? 1 : top > 0 ? Math.max(0.1, w / top) : 0.1;
      if (on || pin) {
        if (on) view.push({ key, w: Math.round(score * 10) / 10 });
        const tier = (score >= 0.75 ? 2 : score >= 0.35 ? 1 : 0) as 0 | 1 | 2;
        if ((tiers.current[key] ?? 2) !== tier) { tiers.current[key] = tier; changed = true; }
      }
      const free = moved.current || pin || sel; // until the user touches the map it stays the overview: no code opens by itself
      const raw = Math.min(Math.max(free && (on || pin) ? linesOf(w, pin ? 0.6 : sel ? 0.25 : 0) : 0, shown.current.includes(key) ? showDetail.current : 0), codes.current[key]?.length ?? Infinity), cur = lines.current[key] ?? 0;
      // zooming in only grows cards and zooming out only shrinks them: otherwise each re-layout re-weighs them and they oscillate under the cursor
      const want = !on || !free ? raw : dz > 0 ? Math.max(cur, raw) : dz < 0 ? Math.min(cur, raw) : raw;
      if (want !== cur && (want === 0 || cur === 0 || Math.abs(want - cur) >= 12)) {
        if (want > 0) lines.current[key] = want; else delete lines.current[key];
        changed = true;
      }
      if (want > 6 && !codes.current[key] && !loading.current.has(key)) {
        loading.current.add(key);
        api.code(key).then(c => { codes.current[key] = c; setRev(r => r + 1); }).catch(() => { /* no code: the preview stays */ });
      }
    }
    const sig = JSON.stringify(view);
    if (sig !== sentView.current) { sentView.current = sig; api.onView(view); }
    if (changed) setRev(r => r + 1);
  }, [zoom, vx, vy, snap]); // not `rev`: opening a card moves the layout, and re-weighing after that would make cards open and close in a loop


  const [minZoom, setMinZoom] = useState(0.08);
  const [extent, setExtent] = useState<[[number, number], [number, number]]>([[-1e5, -1e5], [1e5, 1e5]]);
  minRef.current = minZoom;
  useEffect(() => {
    const rs = Object.values(rects.current), el = document.getElementById('rf');
    if (!rs.length || !el) return;
    const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
    const fit = Math.min(el.clientWidth / (x1 - x0 + 160), el.clientHeight / (y1 - y0 + 160));
    setMinZoom(Math.max(0.03, Math.min(0.5, fit * 0.85))); // you can zoom out a little past the fit-all view, but not into the void
    setExtent(extentOf(rects.current)); // and you can't pan far from the content either
  }, [nodes.length, rev]);
  const ready = useNodesInitialized(), fitted = useRef(false), moved = useRef(false);
  useEffect(() => { if (ready && !fitted.current) { fitted.current = true; rf.fitView({ padding: FIT_PAD, maxZoom: 2 }); } }, [ready]);
  useEffect(() => { // React Flow takes a moment to have the new nodes: it re-fits several times while the user has not touched the view
    if (!nodes.length || fitted.current) return;
    fitted.current = true;
    for (const ms of [30, 200, 600]) setTimeout(() => { if (!moved.current) rf.fitView({ padding: FIT_PAD, maxZoom: 2 }); }, ms);
  }, [nodes.length]);
  // the side panels change the map's width: as long as the user has not moved the view, it re-fits
  useEffect(() => {
    const el = document.getElementById('rf');
    if (!el) return;
    const ro = new ResizeObserver(() => { if (moved.current) return; setRev(r => r + 1); setTimeout(() => { if (!moved.current) rf.fitView({ padding: FIT_PAD, maxZoom: 2 }); }, 60); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  ctrl.fit = () => { moved.current = false; rf.fitView({ padding: FIT_PAD, maxZoom: 2, duration: 300 }); };
  ctrl.show = (keys, detail = 8) => {
    showDetail.current = detail; // opens those files' folders, shows them `detail` lines of code and frames the set
    for (const k of shown.current) if (!keys.includes(k)) delete lines.current[k];
    shown.current = keys;
    const dirs = api.data.dirs.filter(d => d.files.some(f => keys.includes(f.key)));
    for (const k of keys) {
      lines.current[k] = detail;
      if (!codes.current[k]) api.code(k).then(c => { codes.current[k] = c; setRev(r => r + 1); }).catch(() => { /* no code: the preview stays */ });
    }
    showing.current = { keys };
    setExpanded(s => new Set([...s, ...dirs.flatMap(d => pathsTo(d.raw))]));
    setRev(r => r + 1);
  };
  ctrl.step = dir => act.current.stepLevel(dir);
  ctrl.levels = n => setLevels(n);
  ctrl.only = (keys, dir) => { setExpanded(new Set(pathsTo(dir))); ctrl.show?.(keys, 0); }; // the rest closes, this folder is framed
  ctrl.focus = key => { // opens the folders that contain it and centers it
    const dir = api.data.dirs.find(d => d.files.some(f => f.key === key));
    if (!dir) return;
    pending.current = key;
    setExpanded(s => new Set([...s, ...pathsTo(dir.raw)]));
    setRev(r => r + 1);
  };

  // Toolbar: zoom and folder levels. The zoom targets the center of the map so that it also opens and closes folders like the wheel.
  const depths = useMemo(() => folderDepths(api.data), [api.data]);
  let maxDepth = 0, openLevels = 0;
  for (const d of depths.values()) maxDepth = Math.max(maxDepth, d + 1);
  for (const p of expanded) openLevels = Math.max(openLevels, (depths.get(p) ?? -1) + 1);
  const aimCenter = () => {
    const r = document.getElementById('rf')?.getBoundingClientRect();
    if (r) cursor.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, px: r.width / 2, py: r.height / 2, t: Date.now() };
  };
  const zoomCenter = (z: number) => { aimCenter(); moved.current = true; const c = cursor.current!; ease(z, c.px, c.py); };
  const zoomBy = (dir: 1 | -1) => zoomCenter((wheel.current.raf ? wheel.current.target : rf.getViewport().zoom) * (dir > 0 ? 1.5 : 1 / 1.5)); // repeated presses accumulate
  const panBy = (dx: number, dy: number) => { moved.current = true; cancelAnimationFrame(wheel.current.raf); wheel.current.raf = 0; const v = rf.getViewport(); rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 180 }); };
  const setLevels = (n: number) => {
    const to = Math.max(0, Math.min(maxDepth, n));
    setExpanded(new Set([...depths].filter(([, d]) => d < to).map(([p]) => p)));
    setTimeout(() => ctrl.fit?.(), 350); // after the open/close animation, the result is framed
  };
  const act = useRef({ zoomBy, panBy, stepLevel: (_: number) => {} });
  act.current = { zoomBy, panBy, stepLevel: dir => setLevels(openLevels + dir) };
  useEffect(() => { // shortcuts: + and − zoom, 0 fits, arrows pan, [ closes one folder level and ] opens one
    const PAN: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest('input,textarea,select,dialog,[contenteditable]')) return;
      const p = PAN[e.key];
      if (p) { const s = e.shiftKey ? 360 : 120; act.current.panBy(p[0] * s, p[1] * s); }
      else if (e.key === '+' || e.key === '=') act.current.zoomBy(1);
      else if (e.key === '-' || e.key === '_') act.current.zoomBy(-1);
      else if (e.key === '0') ctrl.fit?.();
      else if (e.key === '[') act.current.stepLevel(-1);
      else if (e.key === ']') act.current.stepLevel(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const pct = Math.round(Math.max(0, Math.min(1, Math.log(zoom / minZoom) / Math.log(MAXZ / minZoom))) * 100);

  return (
    <OpsCtx.Provider value={ops}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        className="dark" onPaneContextMenu={e => api.ctxMenu(e as React.MouseEvent, { t: 'pane' })} minZoom={minZoom} maxZoom={MAXZ} translateExtent={extent} elementsSelectable={false} nodesConnectable={false} zoomOnDoubleClick={false} onlyRenderVisibleElements onMoveStart={e => { if (e) moved.current = true; }}
        onNodeDragStop={(_, n) => { // only top-level folders move; the rest settles inside them
          if (n.type !== 'folder' || n.parentId) return;
          pos.current[(n.data as unknown as FolderData).path] = { x: n.position.x, y: n.position.y };
          try { localStorage[posKey] = JSON.stringify(Object.fromEntries(Object.entries(pos.current).map(([k, p]) => [k, [p.x, p.y]]))); } catch { /* no storage */ }
          setRev(r => r + 1);
        }}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <Panel position="top-center" className="tb">
          <div className="tbg" role="group" aria-label={$t('map.zoom')}>
            <button onClick={() => zoomBy(-1)} title={$t('map.zoomOut.tip')} aria-label={$t('map.zoomOut')}>−</button>
            <input type="range" min={0} max={100} value={pct} aria-label={$t('map.zoom')} title={$t('map.zoom')}
              onChange={e => zoomCenter(minZoom * Math.pow(MAXZ / minZoom, Number(e.target.value) / 100))} style={{ '--p': `${pct}%` } as React.CSSProperties} />
            <button onClick={() => zoomBy(1)} title={$t('map.zoomIn.tip')} aria-label={$t('map.zoomIn')}>+</button>
            <button className="pct" onClick={() => zoomCenter(1)} title={$t('map.zoomReset')}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => ctrl.fit?.()} title={$t('map.fit')}>⤢</button>
          </div>
          <div className="tbg" role="group" aria-label={$t('map.folders')}>
            <button onClick={() => setLevels(0)} disabled={openLevels === 0} title={$t('map.closeAll.tip')} aria-label={$t('map.closeAll')}>⊟</button>
            <button onClick={() => setLevels(openLevels - 1)} disabled={openLevels === 0} title={$t('map.closeOne.tip')} aria-label={$t('map.closeOne')}>−</button>
            <span className="lv" title={$t('map.levelsOpen', { a: openLevels, b: maxDepth })}>{openLevels}/{maxDepth}</span>
            <button onClick={() => setLevels(openLevels + 1)} disabled={openLevels >= maxDepth} title={$t('map.openOne.tip')} aria-label={$t('map.openOne')}>+</button>
            <button onClick={() => setLevels(maxDepth)} disabled={openLevels >= maxDepth} title={$t('map.openAll.tip')} aria-label={$t('map.openAll')}>⊞</button>
          </div>
        </Panel>
        <Panel position="bottom-center">
          <button className="lvl edgebtn" title={$t('map.edges.tip')}
            onClick={() => { const m: EdgeMode = edgeInfo.hiding ? 'on' : 'off'; setEdgeMode(m); try { localStorage[edgesKey] = m; } catch { /* no storage */ } }}>
            {$t(edgeInfo.hiding ? 'map.edges.show' : 'map.edges.hide', { n: edgeInfo.n })}
          </button> <span className="lvl">{LEVEL_NAME[level]}</span></Panel>
      </ReactFlow>
    </OpsCtx.Provider>
  );
}

export default function MapView({ api, ctrl }: { api: MapApi; ctrl: MapCtrl }) {
  return <Api.Provider value={api}><ReactFlowProvider><Inner api={api} ctrl={ctrl} /></ReactFlowProvider></Api.Provider>;
}
