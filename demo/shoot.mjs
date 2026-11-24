// Walks through the demo story in the real app and saves one screenshot per scene.
// Usage: node demo/shoot.mjs <outDir> <url>   (LANG_UI=en shoots the English UI; default es). Keep the T labels in sync with web/locales.js.
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

await shot('01-vista-general');
await clickCard('refunds.py'); await sleep(1600);
await shot('02-semaforo');
await clickText('a', T.linked); await sleep(1800);
await clickCard('gateway.py'); await sleep(1600);
await shot('03-vinculados');
await clickSel('button[title^="' + T.fit + '"]'); await sleep(900);
const r = await rectOf(card('refunds.py'));
await zoomAt(r.x, r.y, 5); await sleep(1500);
await shot('04-zoom-codigo');
await clickSel('button[title^="' + T.fit + '"]'); await sleep(900);
await clickSel('[aria-label="' + T.closeAll + '"]'); await sleep(1500);
await click(...Object.values(await rectOf(`document.querySelector('[aria-label="${T.openLevel}"]')`)).slice(0, 2)); await sleep(1800);
await shot('05-modulos');
if (!process.env.IA) { ws.close(); proc.kill(); try { rmSync(prof, { recursive: true, force: true }); } catch {} process.exit(0); }
await clickSel('[aria-label="' + T.openAll + '"]'); await sleep(1800);
await clickCard('refunds.py'); await sleep(900);
await ev(`(()=>{const i=document.querySelector('#q');i.focus();})()`);
await cdp('Input.insertText', { text: T.question });
await ev(`document.querySelector('#f button').click()`);
let last = '', stable = 0;
for (let i = 0; i < 90 && stable < 4; i++) { await sleep(1000); const t = await ev(`document.querySelector('#thread')?.innerText ?? document.body.innerText.slice(-600)`); if (t === last && t.length > 40) stable++; else { stable = 0; last = t; } }
await sleep(800);
await shot('07-ia');
writeFileSync(join(OUT, 'ia.txt'), last);
ws.close(); proc.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
