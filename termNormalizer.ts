import { SolverConstraint, SolverModel, SolverVariable } from "./solverTypes";

function splitTopLevel(s: string, sep = ",") {
  const out: string[] = [];
  let cur = "";
  let p = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "(") p += 1;
    else if (ch === ")") p = Math.max(0, p - 1);
    else if (ch === "[") b += 1;
    else if (ch === "]") b = Math.max(0, b - 1);
    else if (ch === "{") c += 1;
    else if (ch === "}") c = Math.max(0, c - 1);
    if (ch === sep && p === 0 && b === 0 && c === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseNumericDomain(domainRaw: string): number[] | null {
  const s = String(domainRaw ?? "").trim();
  if (!s) return null;

  const union = splitTopLevel(s, "+").map((x) => x.trim()).filter(Boolean);
  if (union.length > 1) {
    const merged: number[] = [];
    for (const p of union) {
      const vals = parseNumericDomain(p);
      if (!vals) return null;
      merged.push(...vals);
    }
    return [...new Set(merged)].sort((a, b) => a - b);
  }

  const setMatch = s.match(/^\{([\s\S]*)\}$/);
  if (setMatch) {
    const inside = (setMatch[1] ?? "").trim();
    if (!inside) return [];
    const toks = splitTopLevel(inside, ",");
    const nums = toks.map((t) => Number(t.trim()));
    if (nums.some((x) => !Number.isFinite(x))) return null;
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  const stepMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*(?::|step)\s*(-?\d+(?:\.\d+)?)$/i);
  if (stepMatch) {
    const a = Number(stepMatch[1]);
    const b = Number(stepMatch[2]);
    const st = Number(stepMatch[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(st) || st === 0) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const step = Math.abs(st);
    const vals: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) vals.push(Number(v.toFixed(9)));
    return vals;
  }

  const rangeMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const vals: number[] = [];
    for (let v = lo; v <= hi; v += 1) vals.push(v);
    return vals;
  }

  return null;
}

function parseTupleDomain(domainRaw: string): number[][] | null {
  const s = String(domainRaw ?? "").trim();
  const m = s.match(/^\{([\s\S]*)\}$/);
  if (!m) return null;
  const inside = (m[1] ?? "").trim();
  if (!inside.includes("(")) return null;
  const tupleTokens = splitTopLevel(inside, ",").map((x) => x.trim()).filter(Boolean);
  if (tupleTokens.length === 0) return [];
  const tuples: number[][] = [];
  let arity: number | null = null;
  for (const tk of tupleTokens) {
    const tm = tk.match(/^\(([^)]*)\)$/);
    if (!tm) return null;
    const values = splitTopLevel(tm[1] ?? "", ",").map((x) => Number(x.trim()));
    if (values.some((v) => !Number.isFinite(v))) return null;
    if (arity === null) arity = values.length;
    if (arity <= 0 || values.length !== arity) return null;
    tuples.push(values);
  }
  return tuples;
}

type RawNode = { id: string; type: string; data?: any };

function flipOp(op: "<" | "<=" | ">" | ">=" | "==" | "!="): "<" | "<=" | ">" | ">=" | "==" | "!=" {
  if (op === "<") return ">";
  if (op === "<=") return ">=";
  if (op === ">") return "<";
  if (op === ">=") return "<=";
  return op;
}

function normalizeRelOp(opRaw: string): "<" | "<=" | ">" | ">=" | "==" | "!=" | null {
  const op = String(opRaw ?? "").trim();
  if (op === "=") return "==";
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") return op;
  return null;
}

function normalizeExprSyntax(exprRaw: string): string {
  let expr = String(exprRaw ?? "");
  expr = expr.replace(/\bdist\s*\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/gi, "abs(($1)-($2))");
  expr = expr.replace(/\^/g, "**");
  expr = expr.replace(/\bAND\b/gi, "&&");
  expr = expr.replace(/\bOR\b/gi, "||");
  expr = expr.replace(/\barcsin\b/gi, "asin");
  expr = expr.replace(/\barccos\b/gi, "acos");
  expr = expr.replace(/\barctan\b/gi, "atan");
  return expr;
}

function parseAffineExpr(exprRaw: string): { varName: string | null; constant: number } | null {
  const expr = String(exprRaw ?? "").trim();
  const varOnly = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
  if (varOnly) return { varName: varOnly[1], constant: 0 };

  const varWithConst = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*(-?\d+(?:\.\d+)?)$/);
  if (varWithConst) {
    const c = Number(varWithConst[3]);
    if (!Number.isFinite(c)) return null;
    return { varName: varWithConst[1], constant: varWithConst[2] === "-" ? -c : c };
  }

  const constOnly = expr.match(/^-?\d+(?:\.\d+)?$/);
  if (constOnly) {
    const c = Number(expr);
    if (!Number.isFinite(c)) return null;
    return { varName: null, constant: c };
  }

  return null;
}

export function buildSolverModelFromGraph(nodes: RawNode[]): { model: SolverModel; unsupportedConstraintIds: string[] } {
  const varNodes = nodes.filter((n) => n.type === "variable");
  const conNodes = nodes.filter((n) => n.type === "constraint" && n.data?.active !== false);

  const variables: SolverVariable[] = [];
  const byName = new Map<string, string>();
  const tupleByName = new Map<string, number[][]>();
  const tupleIdByName = new Map<string, string>();
  const tupleConstraintBuilt = new Set<string>();
  const tupleLinkConstraints: SolverConstraint[] = [];

  for (const v of varNodes) {
    const name = String(v.data?.name ?? v.id);
    const raw = String(v.data?.domain ?? "");
    const dom = parseNumericDomain(raw);
    if (dom && dom.length > 0) {
      variables.push({ id: v.id, name, domain: dom });
      byName.set(name, v.id);
      continue;
    }
    const tup = parseTupleDomain(raw);
    if (tup && tup.length > 0) {
      tupleByName.set(name, tup);
      tupleIdByName.set(name, v.id);
    }
  }

  const ensureTupleProjection = (varName: string, index1: number): { id: string; token: string } | null => {
    const tuples = tupleByName.get(varName);
    const baseId = tupleIdByName.get(varName);
    if (!tuples || !baseId || tuples.length === 0) return null;
    const idx = index1 - 1;
    if (idx < 0) return null;
    const vals = tuples.map((t) => t[idx]).filter((x) => Number.isFinite(x)) as number[];
    if (vals.length === 0) return null;
    const domain = [...new Set(vals)].sort((a, b) => a - b);
    const token = `${varName}__${index1}`;
    const id = `${baseId}__p${index1}`;
    if (!byName.has(token)) {
      variables.push({ id, name: `${varName}[${index1}]`, domain });
      byName.set(token, id);
    }
    return { id, token };
  };

  const ensureTupleLinkConstraint = (varName: string) => {
    if (tupleConstraintBuilt.has(varName)) return;
    const tuples = tupleByName.get(varName);
    const baseId = tupleIdByName.get(varName);
    if (!tuples || !baseId || tuples.length === 0) return;
    const arity = tuples[0]?.length ?? 0;
    if (!Number.isInteger(arity) || arity <= 0) return;

    const projectionIds: string[] = [];
    for (let i = 1; i <= arity; i += 1) {
      const proj = ensureTupleProjection(varName, i);
      if (!proj) return;
      projectionIds.push(proj.id);
    }

    const tupleClauses = tuples.map((tp) => `(${tp.map((v, idx) => `${projectionIds[idx]} == ${v}`).join(" && ")})`);
    const expr = tupleClauses.length === 1 ? tupleClauses[0] : `(${tupleClauses.join(" || ")})`;

    tupleLinkConstraints.push({
      id: `${baseId}__tuple_link`,
      name: `${varName} Tuple-Link`,
      active: true,
      scope: projectionIds,
      type: "expr_bool",
      payload: { varIds: projectionIds, expr },
      meta: { generated: true, tupleVar: varName },
    });

    tupleConstraintBuilt.add(varName);
  };

  const rewriteTupleRefs = (atomRaw: string): { expr: string; failed: boolean } => {
    let failed = false;
    const expr = String(atomRaw ?? "").replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]/g, (_m, vn, idxS) => {
      const idx = Number(idxS);
      const proj = ensureTupleProjection(vn, idx);
      ensureTupleLinkConstraint(vn);
      if (!proj) {
        failed = true;
        return _m;
      }
      return proj.token;
    });
    return { expr, failed };
  };

  const extractIdentifiers = (expr: string): string[] => {
    const out: string[] = [];
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(expr)) !== null) {
      const name = m[1];
      const next = expr[m.index + name.length] ?? "";
      if (next === "(") continue;
      out.push(name);
    }
    return [...new Set(out)];
  };

  const rewriteExprIdentifiersToIds = (expr: string): string =>
    String(expr ?? "").replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (full, nm, off, raw) => {
      const next = raw[Number(off) + String(nm).length] ?? "";
      if (next === "(") return full;
      return byName.get(String(nm)) ?? full;
    });

  const constraints: SolverConstraint[] = [];
  const unsupportedConstraintIds: string[] = [];

  const parseAtom = (atom: string) => {
    const rewritten = rewriteTupleRefs(atom);
    if (rewritten.failed) return null;
    const t = normalizeExprSyntax(rewritten.expr.trim());

    const ad = t.match(/^(?:allDifferent|all_different)\(([^)]*)\)$/i);
    if (ad) {
      const rawArgs = String(ad[1] ?? "").trim();
      const names = (rawArgs.includes(",") ? splitTopLevel(rawArgs, ",") : rawArgs.split(/\s+/))
        .map((x) => x.trim())
        .filter(Boolean);
      const varIds = names.map((n) => byName.get(n)).filter(Boolean) as string[];
      if (varIds.length >= 2) return { type: "all_different" as const, scope: varIds, payload: { varIds } };
      return null;
    }

    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*\s*(?:[+-]\s*-?\d+(?:\.\d+)?)?|\-?\d+(?:\.\d+)?)\s*(<=|>=|==|=|!=|<|>)\s*([A-Za-z_][A-Za-z0-9_]*\s*(?:[+-]\s*-?\d+(?:\.\d+)?)?|\-?\d+(?:\.\d+)?)$/);
    if (m) {
      const leftExpr = parseAffineExpr((m[1] ?? "").replace(/\s+/g, " "));
      const op = normalizeRelOp(m[2] ?? "");
      if (!op) return null;
      const rightExpr = parseAffineExpr((m[3] ?? "").replace(/\s+/g, " "));
      if (leftExpr && rightExpr) {
        if (leftExpr.varName && rightExpr.varName) {
          const leftId = byName.get(leftExpr.varName);
          const rightId = byName.get(rightExpr.varName);
          if (!leftId || !rightId) return null;
          const offset = rightExpr.constant - leftExpr.constant;
          return {
            type: Math.abs(offset) < 1e-12 ? ("binary_rel" as const) : ("binary_rel_offset" as const),
            scope: [leftId, rightId],
            payload: { leftVarId: leftId, rightVarId: rightId, op, ...(Math.abs(offset) < 1e-12 ? {} : { offset }) },
          };
        }
        if (leftExpr.varName && !rightExpr.varName) {
          const leftId = byName.get(leftExpr.varName);
          if (!leftId) return null;
          return { type: "unary_bound" as const, scope: [leftId], payload: { varId: leftId, op, constant: rightExpr.constant - leftExpr.constant } };
        }
        if (!leftExpr.varName && rightExpr.varName) {
          const rightId = byName.get(rightExpr.varName);
          if (!rightId) return null;
          return { type: "unary_bound" as const, scope: [rightId], payload: { varId: rightId, op: flipOp(op), constant: leftExpr.constant - rightExpr.constant } };
        }
      }
    }

    if (/\|\||&&/.test(t)) {
      const names = extractIdentifiers(t);
      const varIds = names.map((n) => byName.get(n)).filter(Boolean) as string[];
      if (varIds.length === 0) return null;
      const expr = rewriteExprIdentifiersToIds(t);
      return { type: "expr_bool" as const, scope: varIds, payload: { varIds, expr } };
    }

    const generic = t.match(/^(.*?)(<=|>=|==|=|!=|<|>)(.*)$/);
    if (!generic) return null;
    const leftRaw = normalizeExprSyntax(String(generic[1] ?? "").trim());
    const gop = normalizeRelOp(generic[2] ?? "");
    if (!gop) return null;
    const rightRaw = normalizeExprSyntax(String(generic[3] ?? "").trim());
    if (!leftRaw || !rightRaw) return null;

    const leftNames = extractIdentifiers(leftRaw);
    const rightNames = extractIdentifiers(rightRaw);
    const allNames = [...new Set([...leftNames, ...rightNames])];
    const varIds = allNames.map((n) => byName.get(n)).filter(Boolean) as string[];
    if (varIds.length === 0) return null;

    const leftExpr = rewriteExprIdentifiersToIds(leftRaw);
    const rightExpr = rewriteExprIdentifiersToIds(rightRaw);
    return { type: "expr_rel" as const, scope: varIds, payload: { varIds, leftExpr, rightExpr, op: gop } };
  };

  const parseAtomWithFallback = (atom: string) => {
    const parsed = parseAtom(atom);
    if (parsed) return parsed;

    const rewritten = rewriteTupleRefs(atom);
    if (rewritten.failed) return null;
    const t = normalizeExprSyntax(rewritten.expr.trim());
    if (!t) return null;

    const names = extractIdentifiers(t);
    if (names.length === 0) return null;
    const unresolved = names.filter((n) => !byName.has(n));
    if (unresolved.length > 0) return null;

    const varIds = names.map((n) => byName.get(n)).filter(Boolean) as string[];
    if (varIds.length === 0) return null;
    const expr = rewriteExprIdentifiersToIds(t);
    return { type: "expr_bool" as const, scope: varIds, payload: { varIds, expr } };
  };

  for (const c of conNodes) {
    const term = String(c.data?.term ?? "").trim();
    if (!term) continue;
    const atoms = splitTopLevel(term, ",").map((x) => x.trim()).filter(Boolean);
    let ok = true;
    atoms.forEach((a, idx) => {
      const parsed = parseAtomWithFallback(a);
      if (!parsed) {
        ok = false;
        return;
      }
      constraints.push({
        id: idx === 0 ? c.id : `${c.id}__${idx}`,
        name: String(c.data?.name ?? c.id),
        active: true,
        scope: parsed.scope,
        type: parsed.type,
        payload: parsed.payload as any,
        meta: { sourceConstraintId: c.id, sourceTerm: term, atom: a },
      });
    });
    if (!ok) unsupportedConstraintIds.push(c.id);
  }

  constraints.unshift(...tupleLinkConstraints);

  return {
    model: {
      version: 1,
      variables,
      constraints,
      options: { fullRebuild: true, incrementalHint: false, autoRecompute: false },
      meta: { source: "CSPGraphEditorWeb", normalization: "comma-split subset v3 + tuple projection + tuple link + expr fallback" },
    },
    unsupportedConstraintIds,
  };
}
