// Graba clips cortos (niveles, zoom, vinculados) de la demo en la app real: un jpg por cuadro. Usage: node demo/clips.mjs <outDir> <url>  (LANG_UI=en para la interfaz en inglés)
// Después: python demo/mkclips.py <outDir> <carpeta de GIFs>. Los helpers son los de shoot.mjs.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.argv[2], URL = process.argv[3], CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LANG = process.env.LANG_UI === 'en' ? 'en' : 'es';
const T = { es: { linked: 'ver vinculados', fit: 'Encuadrar todo', closeAll: 'Cerrar todo', openLevel: 'Abrir un nivel', openAll: 'Abrir todo', question: '¿Qué archivos podrían romperse con este PR aunque no cambien?' },
  en: { linked: 'show linked', fit: 'Fit everything', closeAll: 'Close all', openLevel: 'Open one level', openAll: 'Open all', question: 'Which files could break with this PR even if they do not change?' } }[LANG];
const W = 1440, H = 810, DPR = 4 / 3, PORT = 9333;
mkdirSync(OUT, { recursive: true });
const prof = join(tmpdir(), 'prpeer-shoot-' + Date.now());
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; pend.set(i, d => (d.error ? fail(new Error(method + ': ' + d.error.message)) : ok(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const rectOf = sel => ev(`(()=>{const e=${sel};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const card = name => `[...document.querySelectorAll('.card')].find(c=>c.querySelector('.nm')?.textContent==='${name}')`;
const clickCard = async name => { const r = await rectOf(card(name)); if (!r) throw new Error('no card ' + name); await click(r.x, r.y - r.h / 4); };
const clickText = async (tag, text) => { const r = await rectOf(`[...document.querySelectorAll('${tag}')].find(e=>e.textContent.trim().includes(${JSON.stringify(text)})&&e.children.length<3)`); if (!r) throw new Error('no ' + text); await click(r.x, r.y); };
const clickSel = async sel => { const r = await rectOf(`document.querySelector(${JSON.stringify(sel)})`); if (!r) throw new Error('no ' + sel); await click(r.x, r.y); }; // los botones de la barra del mapa son íconos: se buscan por title o aria-label
const shot = async name => { const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64')); console.log('shot', name); };
const zoomAt = async (x, y, steps, dy = -140) => { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); for (let i = 0; i < steps; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(140); } };

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage['prpeer:lang']=${JSON.stringify(LANG)}}catch{}` });
await cdp('Page.navigate', { url: URL });
await sleep(3500);
await ev(`[...document.body.children].forEach(e => { if (e.tagName === 'BUTTON' && getComputedStyle(e).position === 'fixed') e.style.display = 'none'; })`); // botones flotantes de idioma y tema: tapan el texto del panel en las capturas


// ---- clips: una carpeta por clip con los cuadros (jpg) y manifest.json [{f, ms}] para armar el GIF (demo/mkclips.py)
const clips = {};
let cur = null;
const begin = async name => {
  cur = clips[name] = [];
  mkdirSync(join(OUT, name), { recursive: true });
  await cdp('Page.navigate', { url: URL });
  await sleep(3200);
  await ev(`[...document.body.children].forEach(e => { if (e.tagName === 'BUTTON' && getComputedStyle(e).position === 'fixed') e.style.display = 'none'; })`);
};
const frame = async ms => {
  const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const f = `${String(cur.length).padStart(3, '0')}.jpg`;
  writeFileSync(join(OUT, ...[Object.keys(clips).at(-1), f]), Buffer.from(data, 'base64'));
  cur.push({ f, ms });
};
// una acción y lo que dura su animación: `n` cuadros rápidos y uno final, ya quieto, que se sostiene `hold` ms
const act = async (fn, { n = 5, gap = 90, hold = 1100 } = {}) => {
  await fn();
  for (let i = 0; i < n; i++) { await frame(150); await sleep(gap); }
  await sleep(500); await frame(hold);
};

// 1. niveles de carpetas: cerrar todo, abrir de a un nivel, abrir todo
await begin('levels');
await frame(1400);
await act(() => clickSel('[aria-label="' + T.closeAll + '"]'), { hold: 1300 });
await act(() => clickSel('[aria-label="' + T.openLevel + '"]'), { hold: 1300 });
await act(() => clickSel('[aria-label="' + T.openLevel + '"]'), { hold: 1300 });
await act(() => clickSel('[aria-label="' + T.openAll + '"]'), { hold: 1800 });

// 2. zoom semántico sobre refunds.py: se acerca, aparece el código, se aleja
await begin('zoom');
await frame(1200);
const r = await rectOf(card('refunds.py'));
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
for (let i = 0; i < 6; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -140 }); await sleep(260); await frame(170); }
await sleep(500); await frame(1500);
for (let i = 0; i < 6; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: 140 }); await sleep(260); await frame(170); }
await sleep(500); await frame(1400);

// 3. vinculados: mostrarlos y seleccionar gateway.py para ver quién lo usa
await begin('linked');
await frame(1200);
await act(() => clickText('a', T.linked), { hold: 1200 });
await act(() => clickCard('gateway.py'), { n: 4, hold: 2600 });

for (const [name, list] of Object.entries(clips)) { writeFileSync(join(OUT, name, 'manifest.json'), JSON.stringify(list)); console.log(name, list.length, 'cuadros'); }
ws.close(); proc.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
