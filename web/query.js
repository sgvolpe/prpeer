// File search by path (worktree search box). Terms separated by space or comma; one match is enough.
//   text       -> substring of the path ("test", "billing/")
//   .ext       -> extension or name segment (".md", ".test"); doesn't confuse .py with .pyc
//   with * or ? -> wildcard on the name or on the full path ("*.md", "tests/*")
// Used in the browser (<script>) and in tests (import): publishes globalThis.pathQuery.
(() => {
  const esc = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const cache = new Map();
  const parseTerms = q => String(q || '').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const compile = term => {
    const t = term.toLowerCase();
    if (/[*?]/.test(t)) {
      const re = new RegExp('^' + t.split('*').map(p => p.split('?').map(esc).join('.')).join('.*') + '$');
      return (full, base) => re.test(base) || re.test(full);
    }
    if (t.startsWith('.') && t.length > 1) {
      const re = new RegExp(esc(t) + '(\\.|$)');
      return (_full, base) => re.test(base);
    }
    return full => full.includes(t);
  };
  const matchQuery = (q, path) => {
    let fns = cache.get(q);
    if (!fns) { fns = parseTerms(q).map(compile); cache.set(q, fns); }
    if (!fns.length) return false;
    const full = path.toLowerCase(), base = full.slice(full.lastIndexOf('/') + 1);
    return fns.some(f => f(full, base));
  };
  globalThis.pathQuery = { matchQuery, parseTerms };
})();
