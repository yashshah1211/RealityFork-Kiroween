/**
 * A small, safe expression language for user-written formulas. No eval, no property access,
 * no loops: a recursive-descent parser over a fixed grammar, with length and depth limits.
 *
 *   expr     := or
 *   or       := and ("or" and)*
 *   and      := cmp ("and" cmp)*
 *   cmp      := add (("<" | "<=" | ">" | ">=" | "==" | "!=") add)?
 *   add      := mul (("+" | "-") mul)*
 *   mul      := unary (("*" | "/") unary)*
 *   unary    := ("-" | "not") unary | pow
 *   pow      := primary ("^" unary)?
 *   primary  := number | "string" | name | name "(" args ")" | "(" expr ")"
 *
 * Functions: min, max, abs, round(x[, digits]), if(condition, then, else).
 * Values are numbers, yes/no (booleans) or text (only for == and != against category variables).
 */

export type ExprValue = number | boolean | string;

export type ExprNode =
  | { readonly t: "num"; readonly v: number }
  | { readonly t: "str"; readonly v: string }
  | { readonly t: "name"; readonly v: string }
  | { readonly t: "un"; readonly op: "-" | "not"; readonly a: ExprNode }
  | { readonly t: "bin"; readonly op: string; readonly a: ExprNode; readonly b: ExprNode }
  | { readonly t: "call"; readonly fn: string; readonly args: readonly ExprNode[] };

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

export const MAX_EXPRESSION_LENGTH = 500;
const MAX_DEPTH = 40;
const FUNCTIONS: Readonly<Record<string, readonly [number, number]>> = { min: [1, 20], max: [1, 20], abs: [1, 1], round: [1, 2], if: [3, 3] };
const KEYWORDS = new Set(["and", "or", "not", "true", "false"]);

type Tok = { k: "num" | "str" | "name" | "op" | "end"; v: string; pos: number };

function tokenize(src: string): Tok[] {
  if (src.length > MAX_EXPRESSION_LENGTH) throw new ExprError(`formula is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`unexpected "${c}" at position ${i + 1}`);
      out.push({ k: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "name", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError(`text starting at position ${i + 1} is not closed`);
      out.push({ k: "str", v: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!="].includes(two)) { out.push({ k: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/^(),<>".includes(c)) { out.push({ k: "op", v: c, pos: i }); i++; continue; }
    throw new ExprError(`unexpected "${c}" at position ${i + 1}`);
  }
  out.push({ k: "end", v: "", pos: src.length });
  return out;
}

export function parseExpression(src: string): ExprNode {
  if (src.trim() === "") throw new ExprError("the formula is empty");
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => peek().k === "op" && peek().v === v;
  const isWord = (v: string) => peek().k === "name" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}" at position ${peek().pos + 1}`);
    p++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new ExprError("the formula is nested too deeply");
  };
  const or = (): ExprNode => {
    enter();
    let a = and();
    while (isWord("or")) { p++; a = { t: "bin", op: "or", a, b: and() }; }
    depth--;
    return a;
  };
  const and = (): ExprNode => {
    let a = cmp();
    while (isWord("and")) { p++; a = { t: "bin", op: "and", a, b: cmp() }; }
    return a;
  };
  const cmp = (): ExprNode => {
    const a = add();
    const t = peek();
    if (t.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(t.v)) { p++; return { t: "bin", op: t.v, a, b: add() }; }
    return a;
  };
  const add = (): ExprNode => {
    let a = mul();
    while (isOp("+") || isOp("-")) { const op = toks[p++]!.v; a = { t: "bin", op, a, b: mul() }; }
    return a;
  };
  const mul = (): ExprNode => {
    let a = unary();
    while (isOp("*") || isOp("/")) { const op = toks[p++]!.v; a = { t: "bin", op, a, b: unary() }; }
    return a;
  };
  const unary = (): ExprNode => {
    enter();
    let n: ExprNode;
    if (isOp("-")) { p++; n = { t: "un", op: "-", a: unary() }; }
    else if (isWord("not")) { p++; n = { t: "un", op: "not", a: unary() }; }
    else n = pow();
    depth--;
    return n;
  };
  const pow = (): ExprNode => {
    const a = primary();
    if (isOp("^")) { p++; return { t: "bin", op: "^", a, b: unary() }; }
    return a;
  };
  const primary = (): ExprNode => {
    const t = peek();
    if (t.k === "num") {
      p++;
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new ExprError(`"${t.v}" is not a usable number`);
      return { t: "num", v };
    }
    if (t.k === "str") { p++; return { t: "str", v: t.v }; }
    if (t.k === "name") {
      p++;
      if (t.v === "true" || t.v === "false") return { t: "name", v: t.v };
      if (KEYWORDS.has(t.v)) throw new ExprError(`"${t.v}" cannot be used here (position ${t.pos + 1})`);
      if (isOp("(")) {
        const arity = FUNCTIONS[t.v];
        if (!arity) throw new ExprError(`unknown function "${t.v}"; available: ${Object.keys(FUNCTIONS).join(", ")}`);
        p++;
        const args: ExprNode[] = [];
        if (!isOp(")")) {
          args.push(or());
          while (isOp(",")) { p++; args.push(or()); }
        }
        expect(")");
        if (args.length < arity[0] || args.length > arity[1]) throw new ExprError(`${t.v}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} value(s)`);
        return { t: "call", fn: t.v, args };
      }
      return { t: "name", v: t.v };
    }
    if (isOp("(")) {
      p++;
      const n = or();
      expect(")");
      return n;
    }
    throw new ExprError(t.k === "end" ? "the formula ends too early" : `unexpected "${t.v}" at position ${t.pos + 1}`);
  };
  const n = or();
  if (peek().k !== "end") throw new ExprError(`unexpected "${peek().v}" at position ${peek().pos + 1}`);
  return n;
}

/** Every name the expression refers to (variables or other formulas), in first-use order. */
export function referencedNames(n: ExprNode, out: string[] = []): string[] {
  switch (n.t) {
    case "name":
      if (n.v !== "true" && n.v !== "false" && !out.includes(n.v)) out.push(n.v);
      break;
    case "un":
      referencedNames(n.a, out);
      break;
    case "bin":
      referencedNames(n.a, out);
      referencedNames(n.b, out);
      break;
    case "call":
      n.args.forEach((a) => referencedNames(a, out));
      break;
  }
  return out;
}

const kindOf = (v: ExprValue) => (typeof v === "number" ? "a number" : typeof v === "boolean" ? "yes/no" : "text");

/** Evaluate with a resolver for names. Throws ExprError for type errors and division by zero. */
export function evaluateNode(n: ExprNode, resolve: (name: string) => ExprValue): ExprValue {
  const num = (x: ExprValue, what: string): number => {
    if (typeof x !== "number") throw new ExprError(`${what} must be a number, but is ${kindOf(x)}`);
    return x;
  };
  const bool = (x: ExprValue, what: string): boolean => {
    if (typeof x !== "boolean") throw new ExprError(`${what} must be yes/no, but is ${kindOf(x)}`);
    return x;
  };
  const finite = (x: number) => {
    if (!Number.isFinite(x)) throw new ExprError("the result is too large to calculate");
    return x;
  };
  switch (n.t) {
    case "num":
    case "str":
      return n.v;
    case "name":
      return n.v === "true" ? true : n.v === "false" ? false : resolve(n.v);
    case "un": {
      const a = evaluateNode(n.a, resolve);
      return n.op === "-" ? -num(a, "the value after −") : !bool(a, 'the value after "not"');
    }
    case "call": {
      if (n.fn === "if") {
        const c = bool(evaluateNode(n.args[0]!, resolve), "the condition in if()");
        return evaluateNode(n.args[c ? 1 : 2]!, resolve);
      }
      const xs = n.args.map((a) => num(evaluateNode(a, resolve), `each value in ${n.fn}()`));
      if (n.fn === "min") return Math.min(...xs);
      if (n.fn === "max") return Math.max(...xs);
      if (n.fn === "abs") return Math.abs(xs[0]!);
      const d = xs[1] ?? 0;
      if (!Number.isInteger(d) || d < 0 || d > 10) throw new ExprError("round() digits must be a whole number from 0 to 10");
      const f = 10 ** d;
      return Math.round(xs[0]! * f) / f;
    }
    case "bin": {
      if (n.op === "and" || n.op === "or") {
        const a = bool(evaluateNode(n.a, resolve), `the value before "${n.op}"`);
        if (n.op === "and" ? !a : a) return a;
        return bool(evaluateNode(n.b, resolve), `the value after "${n.op}"`);
      }
      const a = evaluateNode(n.a, resolve);
      const b = evaluateNode(n.b, resolve);
      if (n.op === "==" || n.op === "!=") {
        if (typeof a !== typeof b) throw new ExprError(`cannot compare ${kindOf(a)} with ${kindOf(b)}`);
        return n.op === "==" ? a === b : a !== b;
      }
      const x = num(a, `the value before "${n.op}"`);
      const y = num(b, `the value after "${n.op}"`);
      switch (n.op) {
        case "+": return finite(x + y);
        case "-": return finite(x - y);
        case "*": return finite(x * y);
        case "/":
          if (y === 0) throw new ExprError("division by zero");
          return finite(x / y);
        case "^": return finite(x ** y);
        case "<": return x < y;
        case "<=": return x <= y;
        case ">": return x > y;
        default: return x >= y;
      }
    }
  }
}
