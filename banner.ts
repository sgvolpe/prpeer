// Startup header: the logo (two eyes peeking over the orange bar) and a random quip. Plain ASCII so any terminal shows it.
export function banner() {
  const bill = process.stdout.isTTY && !process.env.NO_COLOR ? (s: string) => `\x1b[38;5;214m${s}\x1b[0m` : (s: string) => s;
  const quips = [
    'Peering at your diff so you do not have to squint.',
    'Reading 2,000 lines so you can pretend you did.',
    'LGTM is not a review. Let us fix that.',
    'Somewhere a file did not change and is about to break. Let us find it.',
    'Now with 100% fewer "looks fine to me".',
    'The duck has seen things. Mostly unhandled exceptions.',
  ];
  const quip = quips[Math.floor(Math.random() * quips.length)];
  // The duck's pose: where it looks, mouth open, hopping, facing the other way, leaning (-1 left, 1 right).
  // Extras: a speech bubble or doodle on the top row (say) and another bill color (hue, a 256-color code).
  type Pose = { eye?: string; talk?: boolean; hop?: boolean; flip?: boolean; tilt?: number; say?: string; hue?: number; walk?: string };
  const mirror = (s: string) => [...s].reverse().map(c => ({ '(': ')', ')': '(', '/': '\\', '\\': '/' } as Record<string, string>)[c] ?? c).join('');
  const W = 30; // logo column width, so the text to its right never moves
  // On a wide terminal the duck gets room to stroll: up to 60 extra columns, leaving the quip on screen.
  const roam = () => Math.max(0, Math.min(60, (process.stdout.columns || 0) - W - quip.length - 2));
  // x: how far the duck has strolled to the right; the text sits after the whole strolling area.
  const rows = ({ eye = '( o )', talk, hop, flip, tilt = 0, say = '', hue }: Pose, x = 0, room = 0) => {
    const o = hue ? (s: string) => `\x1b[38;5;${hue}m${s}\x1b[0m` : bill;
    let art = [
      String.raw`   .-----.   .-----.   `,
      String.raw`  /  .-.  \ /  .-.  \  `,
      ` |  ${eye}  |  ${eye}  | `,
      String.raw`.---------------------.`,
      talk ? String.raw`|  ==========\        |` : String.raw`|  ===========        |`,
      talk ? String.raw`|  ======    /        |` : String.raw`|  ======             |`,
      String.raw`'---------------------'`,
    ];
    if (flip) art = art.map(mirror);
    art = art.map((l, r) => ' '.repeat(x + 3 + Math.round(tilt * (3 - r) / 2)) + l);
    const box = hop ? [...art, ''] : ['', ...art]; // one spare row on top to hop into
    return box.map((l, r) => {
      const pad = l.padEnd(W + room);
      const body = r >= (hop ? 3 : 4) && r <= (hop ? 6 : 7) ? o(pad) : pad;
      return body + (r === 0 ? say : r === 5 ? 'P R   P E E R' : r === 6 ? quip : '');
    });
  };
  console.log([...rows({}, 0, process.stdout.isTTY && !process.env.NO_COLOR ? roam() : 0), '', ''].join('\n')); // the extra row is the walkway for the passers-by below
  // Passers-by: every so often a parade crosses the walkway under the duck. A bug runs, a reviewer knight chases it,
  // and a merge-conflict spook drifts behind. Each is [sprite, columns per tick, gap behind the one before].
  const parades: [string, number, number][][] = [
    [['~<:o:>~', 2, 0], ['o/=|==>', 2, 6], ['(~>.<~)', 1, 4]],
    [['(~o.o~)', 1, 0], ['(~^.^~)', 1, 3], ['(~-.-~)', 1, 3]], // a little pack of spooks out for a stroll
    [['<==|=\\o', -2, 0], ['~<:o:>~', -2, 5]], // and the bug chasing the knight back the other way
  ];
  const walkway = (t: number) => {
    const width = Math.min(process.stdout.columns || 80, 100);
    const cycle = 140; // ticks between parades; the parade walks during the first part of it
    const parade = parades[Math.floor(t / cycle) % parades.length];
    const step = t % cycle;
    const row = Array<string>(width).fill(' ');
    let lag = 0;
    for (const [sprite, speed, gap] of parade) {
      lag += gap + sprite.length;
      const x = speed > 0 ? step * speed - lag : width - 1 - step * -speed + lag - sprite.length;
      [...sprite].forEach((c, k) => { if (x + k >= 0 && x + k < width) row[x + k] = c; });
    }
    return row.join('').trimEnd();
  };
  // The duck idles, looks around, blinks, talks, hops, turns and leans, forever, redrawn in place.
  // Only on a real terminal so pipes and logs get one clean frame.
  if (!process.stdout.isTTY || process.env.NO_COLOR) return;
  if ((process.stdout.columns || 0) < W + quip.length + 2) return; // the logo rows already wrapped: redrawing in place would smear them
  let below = 10, col = 0; // rows from the top of the logo down to the cursor, and the cursor column; both follow everything printed after the banner
  const raw = process.stdout.write.bind(process.stdout) as (s: string) => boolean;
  for (const s of [process.stdout, process.stderr]) {
    const w = s.write.bind(s) as (...a: unknown[]) => boolean;
    s.write = ((chunk: unknown, ...rest: unknown[]) => {
      const [down, c] = advance(String(chunk), col, process.stdout.columns || 80);
      below += down; col = c;
      return w(chunk, ...rest);
    }) as typeof s.write;
  }
  const rep = (n: number, p: Pose) => Array<Pose>(n).fill(p);
  const script: Pose[] = [
    ...rep(4, {}), { eye: '(o  )' }, { eye: '(o  )' }, {}, { eye: '(  o)' }, { eye: '(  o)' }, {}, { eye: '( - )' }, {},
    { talk: true }, {}, { talk: true }, {}, { talk: true }, ...rep(2, {}),
    { hop: true }, {}, { hop: true }, {}, ...rep(2, {}),
    { tilt: -1 }, { tilt: -2 }, { tilt: -1 }, {}, { tilt: 1 }, { tilt: 2 }, { tilt: 1 }, {},
    { flip: true }, { flip: true, eye: '(o  )' }, { flip: true, talk: true }, { flip: true }, { flip: true, hop: true }, { flip: true }, {},
    { eye: '( - )' }, ...rep(3, {}),
    // quack, with a speech bubble
    { talk: true, say: '< QUACK!' }, { say: '< QUACK!' }, { talk: true, say: '< QUACK! QUACK!' }, ...rep(2, { say: '< QUACK! QUACK!' }), {},
    // party: the bill cycles colors and it hops among sparkles
    ...[196, 208, 226, 46, 51, 21, 129, 201].map((hue, k): Pose => ({ hue, hop: k % 2 === 0, say: k % 2 ? '  *  .  +' : ' +  .  *' })), {},
    // spots a bug
    { eye: '(O  )', say: '!' }, { eye: '(O  )', say: '!!' }, { eye: '(O  )', tilt: -1, say: '!!! a bug?' }, { eye: '(o  )', tilt: -1, say: '...nope, a feature' }, ...rep(3, { say: '...nope, a feature' }), {},
    // snack time: bugs crawl up the walkway to the bill and get eaten (the bill spans columns ~3-25)
    ...[0, 1].flatMap((): Pose[] => [
      ...[44, 40, 36, 32, 28].map((x): Pose => ({ eye: '(  o)', walk: ' '.repeat(x) + '~<:o:>~' })),
      { eye: '(  o)', talk: true, walk: ' '.repeat(25) + '~<:o:>~' },
      { eye: '( ^ )', say: '*CHOMP*', walk: '' }, { eye: '( ^ )', say: '*CHOMP*', walk: '' },
    ]),
    { eye: '( - )', talk: true, say: 'burp.', walk: '' }, { say: 'burp.', walk: '' }, { say: 'more bugs, please', walk: '' }, { walk: '' },
    // nap
    ...['z', 'z Z', 'z Z z', 'z Z z Z', 'z Z z'].map((say): Pose => ({ eye: '( - )', say })), { eye: '( o )', say: '!' }, ...rep(2, {}),
  ];
  let i = 0;
  let x = 0, dir = 1;
  const timer = setInterval(() => {
    if (below >= process.stdout.rows) return clearInterval(timer); // logo scrolled off screen: stop
    // save cursor, go up to the logo, rewrite each row (moving down without '\n' so the count above stays right), restore
    const t = i++, pose = script[t % script.length], room = roam();
    // Stroll back and forth (facing where it goes), but stand still while eating so the bugs reach the bill.
    // Re-read the width every tick, so resizing the window grows or shrinks the stroll.
    if (pose.walk === undefined && room > 0) {
      x += dir;
      if (x >= room || x <= 0) dir = -dir;
    }
    x = Math.min(x, room);
    const shown = { ...pose, flip: pose.flip !== (dir < 0 && room > 0) };
    const walk = pose.walk === undefined ? walkway(t) : pose.walk && ' '.repeat(x) + pose.walk;
    raw(`\x1b7\x1b[${below}A\r` + [...rows(shown, x, room), walk].map(l => `\x1b[2K${l}\x1b[1B\r`).join('') + '\x1b8');
  }, 160);
  timer.unref();
}

// Rows the cursor moves down when `s` is printed from column `col` of a terminal `cols` wide: newlines plus soft wraps
// (a long log line takes several rows). Returns [rows, new column]. Color and cursor escapes take no room.
// shortcut: counts every character as one column (emoji and CJK take two) and ignores reflow when the window is resized.
export function advance(s: string, col: number, cols: number): [number, number] {
  let rows = 0;
  for (const c of s.replace(/\x1b\[[\d;?]*[A-Za-z]|\x1b[78]/g, '')) {
    if (c === '\n') { rows++; col = 0; }
    else if (c === '\r') col = 0;
    else if (col >= cols) { rows++; col = 1; } // the terminal wraps only when a character arrives past the last column
    else col++;
  }
  return [rows, col];
}
