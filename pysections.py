"""Usage: python3 pysections.py <file.py>... -> JSON {file: {symbols, imports, doc, total} | {error}}"""
import ast, json, sys

DEFS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def visit(node, prefix, parent_is_class, out):
    for c in ast.iter_child_nodes(node):
        if isinstance(c, DEFS):
            is_class = isinstance(c, ast.ClassDef)
            out.append({
                "name": prefix + c.name,
                "kind": "class" if is_class else ("method" if parent_is_class else "fn"),
                "start": min([c.lineno] + [d.lineno for d in c.decorator_list]),
                "end": c.end_lineno,
                "doc": (ast.get_docstring(c) or None) and ast.get_docstring(c)[:1500],
            })
            visit(c, prefix + c.name + ".", is_class, out)
        else:
            visit(c, prefix, parent_is_class, out)


def analyze(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    tree = ast.parse(text)
    syms = []
    visit(tree, "", False, syms)
    imps = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imps += [{"module": a.name, "names": [], "level": 0} for a in n.names]
        elif isinstance(n, ast.ImportFrom):
            imps.append({"module": n.module or "", "names": [a.name for a in n.names if a.name != "*"], "level": n.level})
    doc = ast.get_docstring(tree)
    return {"symbols": syms, "imports": imps, "doc": doc and doc[:1500],
            "total": text.count("\n") + (1 if text and not text.endswith("\n") else 0)}


res = {}
for p in sys.argv[1:]:
    try:
        res[p] = analyze(p)
    except Exception as e:  # SyntaxError, unreadable file: the caller falls back to the @@ header
        res[p] = {"error": f"{type(e).__name__}: {e}"}
print(json.dumps(res))
