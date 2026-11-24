import type { Payload } from './ask.ts';

type Full = Payload & { files: (Payload['files'][number] & { hunks?: unknown })[] };

// What travels in the HTML: without the section lines (the bulk of the weight). Per file, only a preview of the first
// lines of its largest section remains (the map card); the rest is requested via /api/file when that file is opened.
const PREVIEW = 6;
export function slimPayload(p: Full) {
  return {
    ...p,
    files: p.files.map(({ hunks: _h, sections, ...f }) => {
      const big = [...sections].sort((a, b) => b.add + b.del - (a.add + a.del))[0];
      return {
        ...f,
        preview: big ? big.lines.slice(0, PREVIEW).map(l => `${l.k} ${l.t.slice(0, 160)}`).join('\n') : '',
        sections: sections.map(({ lines: _l, ...s }) => s),
      };
    }),
  };
}

// The full lines of a file, in the same order as its sections.
export function fileLines(p: Full, path: string) {
  const f = p.files.find(x => x.path === path);
  return f ? f.sections.map(s => s.lines) : null;
}
