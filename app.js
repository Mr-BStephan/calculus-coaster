/* Calculus Coaster Simulator v3.2 — Chromebook Deployment Build
   Teacher-editable constants are grouped here.
*/
const COURSE_LENGTH = 100;       // meters
const MAX_HEIGHT = 40;           // meters
const MIN_HEIGHT = 0;            // meters
const INITIAL_SPEED = 1.5;       // m/s
const G = 9.81;                  // m/s^2
const CAT_PASS_OUT_G = 4.0;      // if felt G-force reaches this, the cat "passes out"
const UNDEFINED_G_FLASH_TIME = 0.9; // seconds to display UNDEFINED after a cusp/corner

// Live telemetry color thresholds (teacher-editable)
const SPEED_YELLOW = 15;         // m/s
const SPEED_RED = 25;            // m/s
const GFORCE_YELLOW = 3.0;       // g
const GFORCE_RED = 4.0;          // g

// Rounded Desmos coefficients should not create fake failures.
// These tolerances are also shown in the report.
const X_JOINT_TOL = 0.002;       // meters
const Y_JOINT_TOL = 0.05;        // meters
const SLOPE_JOINT_TOL = 0.03;    // slope units
const CONTACT_G_EPS = 0.015;     // prevents numerical chatter around zero normal force
const TURN_NUDGE_X = 0.015;       // meters; moves cart just inside reachable region after reversal

const SAMPLE_COUNT = 1800;
const DERIV_H = Math.max(0.001, COURSE_LENGTH / 100000);

const el = (id) => document.getElementById(id);
const canvas = el("coasterCanvas");
const ctx = canvas.getContext("2d");

let pieces = [];
let analysis = null;
let animationId = null;
let lastTs = null;
let inspectAnimationId = null;
let inspectLastTs = null;
let lastInspectX = 0;
let ride = null;
let effects = [];
let cartDisplayScale = 1.0;

const examples = {
  working: [
    "y=35-18*(3*(x/40)^2-2*(x/40)^3) {0<=x<=40}",
    "y=17+13*(3*((x-40)/35)^2-2*((x-40)/35)^3) {40<=x<=75}",
    "y=30-5*(3*((x-75)/25)^2-2*((x-75)/25)^3) {75<=x<=100}"
  ].join("\n"),

  nondifferentiable: [
    "y=20-0.2x {0<=x<=50}",
    "y=10+0.2(x-50) {50<=x<=100}"
  ].join("\n"),

  highG: [
    "y=20+15*cos(pi*x/20) {0<=x<=40}"
  ].join("\n"),

  pendulum: [
    "y=10+0.008(x-35)^2 {0<=x<=100}"
  ].join("\n"),

  discontinuous: [
    "y=20-0.1x {0<=x<=50}",
    "y=17-0.1(x-50) {50<=x<=100}"
  ].join("\n"),

  airborne: [
    "y=30-0.1x+5*cos(pi*x/10) {0<=x<=100}"
  ].join("\n"),

  endsEarly: [
    "y=30-0.2x {0<=x<=60}"
  ].join("\n")
};

el("courseSize").textContent = `${COURSE_LENGTH} m long × ${MAX_HEIGHT} m high`;
el("scrubSlider").max = COURSE_LENGTH;
el("scrubSlider").value = 0;
el("scrubMiddle").textContent = `${fmt(COURSE_LENGTH/2, 0)} m`;
el("scrubEnd").textContent = `${fmt(COURSE_LENGTH, 0)} m`;

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits);
}

function replaceLatexFrac(s) {
  // Converts simple/nested \frac{...}{...} forms by repeatedly replacing innermost pairs.
  let prev;
  const re = /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
  do {
    prev = s;
    s = s.replace(re, "(($1)/($2))");
  } while (s !== prev);
  return s;
}

function replaceLatexSqrt(s) {
  let prev;
  const re = /\\sqrt\s*\{([^{}]*)\}/g;
  do {
    prev = s;
    s = s.replace(re, "sqrt($1)");
  } while (s !== prev);
  return s;
}


// -----------------------------------------------------------------------------
// SELF-CONTAINED MATH EXPRESSION ENGINE
// Chromebook deployment build: no external library/CDN dependency.
//
// Supported:
//   numbers, x, pi, e
//   +  -  *  /  ^
//   implicit multiplication: 2x, 3(x+1), 2sin(x), (x+1)(x-1)
//   sin cos tan sec csc cot asin acos atan sqrt abs ln log log10 exp floor ceil
// -----------------------------------------------------------------------------

const SAFE_FUNCTION_JS = {
  sin: "Math.sin",
  cos: "Math.cos",
  tan: "Math.tan",
  asin: "Math.asin",
  acos: "Math.acos",
  atan: "Math.atan",
  sqrt: "Math.sqrt",
  abs: "Math.abs",
  ln: "Math.log",
  log: "Math.log",
  log10: "Math.log10",
  exp: "Math.exp",
  floor: "Math.floor",
  ceil: "Math.ceil",
  sec: "__sec",
  csc: "__csc",
  cot: "__cot"
};

const SAFE_VALUE_NAMES = new Set(["x", "pi", "e"]);
const SAFE_FUNCTION_NAMES = new Set(Object.keys(SAFE_FUNCTION_JS));

function tokenizeSafeExpression(expr) {
  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const numberMatch = expr.slice(i).match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      tokens.push({ type: "number", value: numberMatch[0] });
      i += numberMatch[0].length;
      continue;
    }

    const idMatch = expr.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (idMatch) {
      const name = idMatch[0].toLowerCase();
      if (!SAFE_VALUE_NAMES.has(name) && !SAFE_FUNCTION_NAMES.has(name)) {
        throw new Error(`Unsupported name "${idMatch[0]}".`);
      }
      tokens.push({
        type: SAFE_FUNCTION_NAMES.has(name) ? "function" : "value",
        value: name
      });
      i += idMatch[0].length;
      continue;
    }

    if ("+-*/^(),".includes(ch)) {
      const type =
        ch === "(" ? "lparen" :
        ch === ")" ? "rparen" :
        ch === "," ? "comma" :
        "operator";
      tokens.push({ type, value: ch });
      i++;
      continue;
    }

    throw new Error(`Unsupported character "${ch}".`);
  }

  const withImplicit = [];
  const canEndValue = t =>
    t && (t.type === "number" || t.type === "value" || t.type === "rparen");
  const canStartValue = t =>
    t && (t.type === "number" || t.type === "value" ||
          t.type === "function" || t.type === "lparen");

  for (const token of tokens) {
    const prev = withImplicit[withImplicit.length - 1];
    if (canEndValue(prev) && canStartValue(token)) {
      withImplicit.push({ type: "operator", value: "*" });
    }
    withImplicit.push(token);
  }

  return withImplicit;
}

function compileSafeExpression(expr) {
  const tokens = tokenizeSafeExpression(expr);
  let pos = 0;
  let usesX = false;

  const peek = () => tokens[pos] || null;
  const take = () => tokens[pos++] || null;

  function parseExpression() {
    return parseAddSub();
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (peek() && peek().type === "operator" && ["+", "-"].includes(peek().value)) {
      const op = take().value;
      const right = parseMulDiv();
      left = `(${left}${op}${right})`;
    }
    return left;
  }

  function parseMulDiv() {
    let left = parseUnary();
    while (peek() && peek().type === "operator" && ["*", "/"].includes(peek().value)) {
      const op = take().value;
      const right = parseUnary();
      left = `(${left}${op}${right})`;
    }
    return left;
  }

  function parseUnary() {
    if (peek() && peek().type === "operator" && ["+", "-"].includes(peek().value)) {
      const op = take().value;
      const inner = parseUnary();
      return op === "+" ? `(+(${inner}))` : `(-(${inner}))`;
    }
    return parsePower();
  }

  function parsePower() {
    let base = parsePrimary();
    if (peek() && peek().type === "operator" && peek().value === "^") {
      take();
      const exponent = parseUnary();
      base = `Math.pow(${base},${exponent})`;
    }
    return base;
  }

  function parsePrimary() {
    const token = take();
    if (!token) throw new Error("Expression ended unexpectedly.");

    if (token.type === "number") {
      return token.value;
    }

    if (token.type === "value") {
      if (token.value === "x") {
        usesX = true;
        return "x";
      }
      if (token.value === "pi") return "Math.PI";
      if (token.value === "e") return "Math.E";
    }

    if (token.type === "function") {
      const lp = take();
      if (!lp || lp.type !== "lparen") {
        throw new Error(`Function ${token.value} must use parentheses.`);
      }
      const arg = parseExpression();
      const rp = take();
      if (!rp || rp.type !== "rparen") {
        throw new Error(`Missing ")" after ${token.value}(...).`);
      }
      return `${SAFE_FUNCTION_JS[token.value]}(${arg})`;
    }

    if (token.type === "lparen") {
      const inner = parseExpression();
      const rp = take();
      if (!rp || rp.type !== "rparen") {
        throw new Error('Missing ")".');
      }
      return `(${inner})`;
    }

    throw new Error(`Unexpected token "${token.value}".`);
  }

  const jsExpr = parseExpression();
  if (pos !== tokens.length) {
    throw new Error(`Unexpected token "${tokens[pos].value}".`);
  }

  const evaluator = new Function(
    "x",
    `"use strict";
     const __sec = z => 1 / Math.cos(z);
     const __csc = z => 1 / Math.sin(z);
     const __cot = z => 1 / Math.tan(z);
     return (${jsExpr});`
  );

  return {
    usesX,
    evaluate(scope = {}) {
      const x = Number(scope.x ?? 0);
      return Number(evaluator(x));
    }
  };
}

function evaluateConstantExpression(expr) {
  const compiled = compileSafeExpression(expr);
  if (compiled.usesX) throw new Error("Domain endpoints cannot depend on x.");
  return compiled.evaluate({});
}

function normalizeExpression(raw) {
  let s = raw.trim();
  s = s.replace(/\\left|\\right/g, "");
  s = replaceLatexFrac(s);
  s = replaceLatexSqrt(s);

  // Remaining LaTeX grouping braces (for example x^{2} or e^{x}) become parentheses.
  // Domain braces have already been removed before the equation reaches this function.
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");

  const replacements = [
    [/\\arcsin/g, "asin"], [/\\arccos/g, "acos"], [/\\arctan/g, "atan"],
    [/\\sin/g, "sin"], [/\\cos/g, "cos"], [/\\tan/g, "tan"],
    [/\\sec/g, "sec"], [/\\csc/g, "csc"], [/\\cot/g, "cot"],
    [/\\ln/g, "log"], [/\\log/g, "log10"],
    [/\\exp/g, "exp"], [/\\pi/g, "pi"],
    [/\\cdot|\\times/g, "*"],
    [/−/g, "-"], [/–/g, "-"]
  ];
  for (const [re, value] of replacements) s = s.replace(re, value);

  // Basic absolute-value support: |expression| -> abs(expression)
  s = s.replace(/\|([^|]+)\|/g, "abs($1)");

  // Remove leading function labels.
  s = s.replace(/^\s*y\s*=\s*/i, "");
  s = s.replace(/^\s*[a-zA-Z]\w*\s*\(\s*x\s*\)\s*=\s*/i, "");

  // Desmos sometimes copies spaces between command and parentheses.
  s = s.replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|abs|log|log10|exp)\s+\(/g, "$1(");

  return s.trim();
}

function extractDomain(line) {
  let s = line.trim().replace(/\\left|\\right/g, "");
  s = s.replace(/\\leq?/g, "<=").replace(/\\geq?/g, ">=");
  s = s.replace(/≤/g, "<=").replace(/≥/g, ">=");

  // Prefer a final brace group that contains x and an inequality.
  const matches = [...s.matchAll(/\\?\{([^{}]*)\\?\}/g)];
  let chosen = null;
  for (const m of matches) {
    if (/x/i.test(m[1]) && /(<=|>=|<|>)/.test(m[1])) chosen = m;
  }
  if (!chosen) {
    throw new Error(`Missing a Desmos domain restriction in:\n${line}\nUse a restriction like {0<=x<=20}.`);
  }

  const domainText = chosen[1].replace(/\s+/g, "");
  const equationPart = (s.slice(0, chosen.index) + s.slice(chosen.index + chosen[0].length)).trim();

  let min = -Infinity, max = Infinity;
  let minInclusive = true, maxInclusive = true;

  // a <= x <= b (also reversed > chains)
  let m = domainText.match(/^(.+?)(<=|<)x(<=|<)(.+)$/i);
  if (m) {
    min = Number(evaluateConstantExpression(normalizeExpression(m[1])));
    max = Number(evaluateConstantExpression(normalizeExpression(m[4])));
    minInclusive = m[2] === "<=";
    maxInclusive = m[3] === "<=";
    return { equationPart, min, max, minInclusive, maxInclusive, raw: domainText };
  }

  m = domainText.match(/^(.+?)(>=|>)x(>=|>)(.+)$/i);
  if (m) {
    max = Number(evaluateConstantExpression(normalizeExpression(m[1])));
    min = Number(evaluateConstantExpression(normalizeExpression(m[4])));
    maxInclusive = m[2] === ">=";
    minInclusive = m[3] === ">=";
    return { equationPart, min, max, minInclusive, maxInclusive, raw: domainText };
  }

  // Two conditions separated by comma or "and".
  const parts = domainText.split(/,|and/i);
  for (const part of parts) {
    let q = part.match(/^x(<=|<|>=|>)(.+)$/i);
    if (q) {
      const val = Number(evaluateConstantExpression(normalizeExpression(q[2])));
      if (q[1].startsWith("<")) { max = val; maxInclusive = q[1] === "<="; }
      else { min = val; minInclusive = q[1] === ">="; }
      continue;
    }
    q = part.match(/^(.+?)(<=|<|>=|>)x$/i);
    if (q) {
      const val = Number(evaluateConstantExpression(normalizeExpression(q[1])));
      if (q[2].startsWith("<")) { min = val; minInclusive = q[2] === "<="; }
      else { max = val; maxInclusive = q[2] === ">="; }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`Could not read the domain restriction "${domainText}". Try {0<=x<=20}.`);
  }
  return { equationPart, min, max, minInclusive, maxInclusive, raw: domainText };
}

function parseLine(line, index) {
  const domain = extractDomain(line);
  if (!(domain.max > domain.min)) throw new Error(`Piece ${index + 1} has an invalid domain.`);
  const expr = normalizeExpression(domain.equationPart);
  let compiled;
  try {
    compiled = compileSafeExpression(expr);
    const test = compiled.evaluate({ x: (domain.min + domain.max) / 2 });
    if (!Number.isFinite(Number(test))) throw new Error("not finite");
  } catch (e) {
    throw new Error(`Piece ${index + 1} could not be evaluated:\n${line}\nParsed as: ${expr}`);
  }
  return {
    index,
    raw: line,
    expr,
    min: domain.min,
    max: domain.max,
    compiled,
    eval(x) {
      const v = Number(compiled.evaluate({ x }));
      if (!Number.isFinite(v)) throw new Error(`Function is undefined near x=${fmt(x, 3)}.`);
      return v;
    }
  };
}

function derivative(piece, x) {
  const h = Math.min(DERIV_H, Math.max((piece.max - piece.min) / 10000, 1e-5));
  if (x - h >= piece.min && x + h <= piece.max) {
    return (piece.eval(x + h) - piece.eval(x - h)) / (2 * h);
  }
  if (x + 2 * h <= piece.max) {
    return (-3 * piece.eval(x) + 4 * piece.eval(x + h) - piece.eval(x + 2*h)) / (2*h);
  }
  return (3 * piece.eval(x) - 4 * piece.eval(x - h) + piece.eval(x - 2*h)) / (2*h);
}

function secondDerivative(piece, x) {
  const h = Math.min(Math.max(DERIV_H * 7, 0.006), Math.max((piece.max - piece.min) / 3000, 1e-4));
  if (x - h >= piece.min && x + h <= piece.max) {
    return (piece.eval(x + h) - 2 * piece.eval(x) + piece.eval(x - h)) / (h*h);
  }
  if (x + 3*h <= piece.max) {
    return (2*piece.eval(x) - 5*piece.eval(x+h) + 4*piece.eval(x+2*h) - piece.eval(x+3*h)) / (h*h);
  }
  return (2*piece.eval(x) - 5*piece.eval(x-h) + 4*piece.eval(x-2*h) - piece.eval(x-3*h)) / (h*h);
}

function pieceForX(x) {
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (x >= p.min - X_JOINT_TOL && x <= p.max + X_JOINT_TOL) return p;
  }
  return null;
}

function inspectPieceIndex(x) {
  // Prefer the right-hand formula exactly at a piecewise boundary, except at the
  // final endpoint. This makes the slider deterministic at shared endpoints.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const isLast = i === pieces.length - 1;
    if (x >= p.min - X_JOINT_TOL && (x < p.max - X_JOINT_TOL || (isLast && x <= p.max + X_JOINT_TOL))) {
      return i;
    }
  }
  // Boundary/tolerance fallback.
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (x >= p.min - X_JOINT_TOL && x <= p.max + X_JOINT_TOL) return i;
  }
  return -1;
}

function speedFromHeight(y, y0) {
  const v2 = INITIAL_SPEED*INITIAL_SPEED + 2*G*(y0 - y);
  return v2 >= 0 ? Math.sqrt(v2) : NaN;
}

function normalG(piece, x, speed) {
  const p = derivative(piece, x);
  const q = secondDerivative(piece, x);
  const denom = Math.pow(1 + p*p, 1.5);
  const signedCurvature = q / denom;
  return (speed*speed*signedCurvature / G) + 1 / Math.sqrt(1 + p*p);
}

function classifyCard(id, text, cls) {
  const card = el(id);
  card.className = `summary-card ${cls || ""}`.trim();
  card.querySelector("strong").textContent = text;
}

function addReportRow(type, title, detail = "", value = "") {
  const wrap = document.createElement("div");
  wrap.className = `report-row ${type}`;
  const icon = type === "pass" ? "✓" : type === "warn" ? "!" : "×";
  wrap.innerHTML = `
    <div class="icon">${icon}</div>
    <div><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}</div>
    <code>${value}</code>`;
  el("report").appendChild(wrap);
}

function analyzeTrack() {
  stopAnimation();
  el("parseError").classList.add("hidden");
  el("warningBanner").classList.add("hidden");
  el("report").innerHTML = "";
  const lines = el("equations").value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) {
    showError("Paste at least one restricted Desmos function.");
    return;
  }

  try {
    pieces = lines.map(parseLine).sort((a,b) => a.min - b.min);
  } catch (err) {
    showError(err.message);
    return;
  }

  const joints = [];
  let coverageOK = true;
  if (Math.abs(pieces[0].min - 0) > X_JOINT_TOL) coverageOK = false;
  if (Math.abs(pieces[pieces.length - 1].max - COURSE_LENGTH) > X_JOINT_TOL) coverageOK = false;

  // Special case: a single function is allowed to end early.
  // The report still flags incomplete course coverage, but the simulator
  // treats the endpoint as the physical end of the rail and launches the cart.
  const singlePieceEndsEarly =
    pieces.length === 1 &&
    pieces[0].min <= X_JOINT_TOL &&
    pieces[0].max < COURSE_LENGTH - X_JOINT_TOL;

  let continuous = true;
  let smooth = true;

  for (let i = 0; i < pieces.length - 1; i++) {
    const a = pieces[i], b = pieces[i+1];
    const xGap = b.min - a.max;
    const sameX = Math.abs(xGap) <= X_JOINT_TOL;
    if (!sameX) coverageOK = false;

    const xa = a.max, xb = b.min;
    const ya = a.eval(xa), yb = b.eval(xb);
    const dy = yb - ya;
    const sa = derivative(a, xa), sb = derivative(b, xb);
    const ds = sb - sa;
    const cOK = sameX && Math.abs(dy) <= Y_JOINT_TOL;
    const dOK = cOK && Math.abs(ds) <= SLOPE_JOINT_TOL;
    if (!cOK) continuous = false;
    if (!dOK) smooth = false;
    joints.push({i, x:(xa+xb)/2, xa, xb, ya, yb, dy, sa, sb, ds, cOK, dOK, sameX});
  }

  if (!coverageOK) continuous = false;
  if (!continuous) smooth = false;

  let minY = Infinity, maxY = -Infinity;
  let extrema = 0;
  let maxPredG = -Infinity;
  let minPredG = Infinity;
  let maxSpeed = 0;
  let energyOK = true;
  let firstEnergyFailure = null;
  let firstContactLoss = null;
  let samplePoints = [];

  const y0 = pieces[0].eval(pieces[0].min);

  // Sample each piece independently so derivatives stay on their own formula.
  for (const p of pieces) {
    const n = Math.max(40, Math.round(SAMPLE_COUNT * (p.max - p.min) / COURSE_LENGTH));
    let prevSlope = null;
    let prevX = null;
    for (let j = 0; j <= n; j++) {
      const x = p.min + (p.max - p.min) * (j/n);
      const y = p.eval(x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const v = speedFromHeight(y, y0);
      const sample = {x, y, piece:p, speed:v, ng:NaN};
      samplePoints.push(sample);

      if (!Number.isFinite(v)) {
        if (energyOK) firstEnergyFailure = {x,y};
        energyOK = false;
      } else {
        maxSpeed = Math.max(maxSpeed, v);
        const ng = normalG(p, x, v);
        sample.ng = ng;
        maxPredG = Math.max(maxPredG, ng);
        minPredG = Math.min(minPredG, ng);
        if (!firstContactLoss && ng < -CONTACT_G_EPS && x > p.min + 0.03 && x < p.max - 0.03) {
          firstContactLoss = {x,y,ng};
        }
      }

      const s = derivative(p, x);
      if (prevSlope !== null && x > p.min + 0.03 && x < p.max - 0.03) {
        if ((prevSlope > 0.002 && s < -0.002) || (prevSlope < -0.002 && s > 0.002)) extrema++;
      }
      prevSlope = s;
      prevX = x;
    }
  }

  // Count smooth joint extrema (sign change through zero at a differentiable joint).
  for (const j of joints) {
    if (!j.dOK) continue;
    const left = j.sa, right = j.sb;
    // If both numerical endpoint slopes are ~0, inspect just inside the pieces.
    const a = pieces[j.i], b = pieces[j.i+1];
    const xl = Math.max(a.min, a.max - Math.max(0.02, (a.max-a.min)/1000));
    const xr = Math.min(b.max, b.min + Math.max(0.02, (b.max-b.min)/1000));
    const sl = derivative(a, xl), sr = derivative(b, xr);
    if ((sl > 0.002 && sr < -0.002) || (sl < -0.002 && sr > 0.002)) extrema++;
  }

  // Avoid over-counting sign jitter.
  extrema = Math.min(extrema, 99);

  const heightOK = minY >= MIN_HEIGHT - Y_JOINT_TOL && maxY <= MAX_HEIGHT + Y_JOINT_TOL;
  const extremaOK = extrema >= 1;
  const predictedComplete =
    !singlePieceEndsEarly &&
    continuous && smooth && heightOK && energyOK && !firstContactLoss;

  analysis = {
    joints, continuous, smooth, coverageOK, minY, maxY, heightOK, extrema, extremaOK,
    y0, energyOK, firstEnergyFailure, maxSpeed, maxPredG, minPredG, firstContactLoss,
    predictedComplete, samplePoints, singlePieceEndsEarly
  };

  renderReport();
  drawScene();
  resetRide();
  el("runBtn").disabled = false;
  el("scrubSlider").disabled = false;
  el("scrubSlider").value = 0;
  el("scrubReadout").textContent = "x = 0.0 m";
  el("statusText").textContent = "Track analyzed. Press Run Coaster or drag the playback slider.";
  localStorage.setItem("calculusCoasterDesign", el("equations").value);
}

function renderReport() {
  const a = analysis;
  classifyCard("continuousCard", a.continuous ? "PASS" : "FAIL", a.continuous ? "pass" : "fail");
  classifyCard("smoothCard", a.smooth ? "PASS" : "FAIL", a.smooth ? "pass" : "fail");
  classifyCard("extremaCard", `${a.extrema} found`, a.extremaOK ? "pass" : "fail");
  classifyCard(
    "completionCard",
    a.energyOK ? "Full track reachable" : "Reversal expected",
    a.energyOK ? "pass" : "warn"
  );

  const speedClass = a.maxSpeed >= SPEED_RED ? "fail" : (a.maxSpeed >= SPEED_YELLOW ? "warn" : "pass");
  classifyCard("maxSpeedCard", Number.isFinite(a.maxSpeed) ? `${fmt(a.maxSpeed,1)} m/s` : "—", speedClass);

  const gClass = a.maxPredG <= 4 && a.minPredG >= 0 ? "pass" : (a.firstContactLoss ? "fail" : "warn");
  classifyCard("maxGCard", Number.isFinite(a.maxPredG) ? `${fmt(a.maxPredG,2)} g` : "—", gClass);

  if (a.coverageOK) {
    addReportRow("pass", "Course length covered", `Track begins at x=0 and ends at x=${COURSE_LENGTH}.`);
  } else if (a.singlePieceEndsEarly) {
    addReportRow(
      "warn",
      "Track ends before the finish",
      `This single-piece track ends at x=${fmt(pieces[0].max,2)} m. During playback the cart will leave the rail and become a projectile.`,
      `ends at ${fmt(pieces[0].max,2)} m`
    );
  } else {
    addReportRow("fail", "Course coverage failure", `The pieces must cover the entire ${COURSE_LENGTH} m horizontal course with no x-domain gaps.`);
  }

  if (a.heightOK) addReportRow("pass", "Height constraint", `Track stays between ${MIN_HEIGHT} m and ${MAX_HEIGHT} m.`, `${fmt(a.minY)}–${fmt(a.maxY)} m`);
  else addReportRow("fail", "Height constraint", `Every point must stay between ${MIN_HEIGHT} m and ${MAX_HEIGHT} m.`, `${fmt(a.minY)}–${fmt(a.maxY)} m`);

  if (!a.joints.length && pieces.length === 1) {
    addReportRow("pass", "Single function", "No piecewise joints to test.");
  }

  a.joints.forEach((j, idx) => {
    const at = `joint ${idx+1} near x=${fmt(j.x,3)}`;
    if (!j.sameX) {
      addReportRow("fail", `Domain gap at ${at}`, `Horizontal domain mismatch = ${fmt(j.xb-j.xa,4)} m.`, `Δx=${fmt(j.xb-j.xa,4)}`);
      return;
    }
    if (j.cOK) {
      addReportRow("pass", `Continuous at ${at}`, `Endpoint height mismatch ${fmt(Math.abs(j.dy),4)} m; tolerance is ${Y_JOINT_TOL} m.`, `Δy=${fmt(j.dy,4)}`);
    } else {
      addReportRow("fail", `Discontinuous at ${at}`, `The cart will derail here. Height mismatch exceeds the ${Y_JOINT_TOL} m rounding tolerance.`, `Δy=${fmt(j.dy,4)}`);
    }
    if (j.dOK) {
      addReportRow("pass", `Matching slopes at ${at}`, `Left slope ${fmt(j.sa,4)}, right slope ${fmt(j.sb,4)}; tolerance is ${SLOPE_JOINT_TOL}.`, `Δm=${fmt(j.ds,4)}`);
    } else {
      addReportRow(
        "fail",
        `Not differentiable at ${at}`,
        j.cOK
          ? `The track has a corner/cusp. The cart stays on the continuous rail, but the idealized acceleration and G-force are undefined at the instant of the direction change.`
          : `Slope test is not accepted because the track is already discontinuous.`,
        `Δm=${fmt(j.ds,4)}`
      );
    }
  });

  if (a.extremaOK) addReportRow("pass", "Extrema requirement", `At least one interior local maximum/minimum was detected.`, `${a.extrema}`);
  else addReportRow("fail", "Extrema requirement", `Add at least one interior local maximum or minimum to the coaster.`);

  if (a.energyOK) {
    addReportRow(
      "pass",
      "Energy check",
      `With an initial speed of ${INITIAL_SPEED} m/s, the cart has enough mechanical energy to reach every track height.`
    );
  } else {
    addReportRow(
      "warn",
      "Turning point predicted",
      `The cart cannot climb to every track height. In the no-friction model it reaches zero speed, reverses direction, and rolls back downhill.`,
      `near x=${fmt(a.firstEnergyFailure.x,2)} m`
    );
  }

  const maxSpeedType = a.maxSpeed >= SPEED_RED ? "fail" : (a.maxSpeed >= SPEED_YELLOW ? "warn" : "pass");
  addReportRow(
    maxSpeedType,
    "Maximum speed reached",
    `Highest physically reachable speed predicted anywhere on the track.`,
    `${fmt(a.maxSpeed,1)} m/s`
  );

  if (a.firstContactLoss) {
    addReportRow("fail", "Predicted airborne launch", `The track curves downward too sharply for the available normal force near x=${fmt(a.firstContactLoss.x,2)} m.`, `${fmt(a.firstContactLoss.ng,2)} g`);
  } else {
    addReportRow("pass", "Track contact check", "No loss of contact predicted before the end of the course.");
  }

  if (a.maxPredG > 4) {
    addReportRow("warn", "High positive G-force", "Prototype warning threshold is 4 g. This is a design warning, not a medical safety certification.", `${fmt(a.maxPredG,2)} g`);
  } else {
    addReportRow("pass", "Positive G-force check", "Predicted maximum stays at or below the prototype 4 g warning threshold.", `${fmt(a.maxPredG,2)} g`);
  }

  addReportRow("warn", "Rounding tolerance is active",
    `For physics, endpoint gaps ≤ ${Y_JOINT_TOL} m and slope mismatches ≤ ${SLOPE_JOINT_TOL} are treated as matching. The report still shows the measured numerical difference.`);

  if (a.continuous && !a.smooth) {
    addReportRow(
      "warn",
      "Physical interpretation of corners/cusps",
      "Because the track is continuous, the cart remains on the rail. At a non-differentiable joint, the tangent direction changes instantaneously, so the idealized G-force is undefined."
    );
  }
}

function showError(msg) {
  el("parseError").textContent = msg;
  el("parseError").classList.remove("hidden");
  el("runBtn").disabled = true;
}

function resetRide() {
  stopAnimation();
  effects = [];
  if (!analysis || !pieces.length) return;
  const p = pieces[0];
  ride = {
    state: "track",
    x: p.min,
    y: p.eval(p.min),
    speed: INITIAL_SPEED,
    vx: 0, vy: 0,
    message: "",
    pieceIndex: 0,
    direction: 1,
    catPassedOut: false,
    undefinedGTimer: 0,
    joltTimer: 0,
    crossedJoints: new Set()
  };
  lastInspectX = ride.x;
  updateTelemetry();
  updateScrubFromRide();
  drawScene();
  el("warningBanner").classList.add("hidden");
  el("statusText").textContent = "Ready.";
}

function runRide() {
  if (!analysis) analyzeTrack();
  if (!analysis) return;
  resetRide();
  ride.state = "track";
  el("statusText").textContent = "Coaster running…";
  lastTs = performance.now();
  animationId = requestAnimationFrame(frame);
}

function stopInspectAnimation() {
  if (inspectAnimationId) cancelAnimationFrame(inspectAnimationId);
  inspectAnimationId = null;
  inspectLastTs = null;
}

function stopAnimation() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  lastTs = null;
  stopInspectAnimation();
}

function startInspectAnimation() {
  stopInspectAnimation();
  inspectLastTs = performance.now();

  const tick = (ts) => {
    if (!ride || ride.state !== "inspect") {
      stopInspectAnimation();
      return;
    }

    const dt = Math.min(0.04, Math.max(0, (ts - inspectLastTs) / 1000));
    inspectLastTs = ts;

    if (ride.undefinedGTimer > 0) {
      ride.undefinedGTimer = Math.max(0, ride.undefinedGTimer - dt);
    }
    if (ride.joltTimer > 0) {
      ride.joltTimer = Math.max(0, ride.joltTimer - dt);
    }

    stepEffects(dt);
    updateTelemetry();
    drawScene();

    if (ride.undefinedGTimer > 0 || ride.joltTimer > 0 || effects.length > 0) {
      inspectAnimationId = requestAnimationFrame(tick);
    } else {
      inspectAnimationId = null;
      inspectLastTs = null;
    }
  };

  inspectAnimationId = requestAnimationFrame(tick);
}

function frame(ts) {
  if (!ride) return;
  const rawDt = Math.min(0.04, (ts - lastTs) / 1000);
  lastTs = ts;
  const scale = Number(el("timeScale").value);
  const dt = rawDt * scale;

  if (ride.state === "track") stepTrack(dt);
  else if (ride.state === "airborne" || ride.state === "derailed") stepAir(dt);

  if (ride.undefinedGTimer > 0) {
    ride.undefinedGTimer = Math.max(0, ride.undefinedGTimer - dt);
  }
  if (ride.joltTimer > 0) {
    ride.joltTimer = Math.max(0, ride.joltTimer - dt);
  }

  stepEffects(dt);
  updateTelemetry();
  updateScrubFromRide();
  drawScene();

  if (["complete","stopped"].includes(ride.state)) {
    stopAnimation();
    return;
  }
  if (ride.state === "crashed" && effects.length === 0) {
    stopAnimation();
    return;
  }
  animationId = requestAnimationFrame(frame);
}

function currentPieceIndex(x) {
  for (let i = 0; i < pieces.length; i++) {
    if (x >= pieces[i].min - X_JOINT_TOL && x <= pieces[i].max + X_JOINT_TOL) return i;
  }
  return -1;
}

function launchFromTrack(label) {
  const i = Number.isInteger(ride.pieceIndex) ? ride.pieceIndex : currentPieceIndex(ride.x);
  const p = pieces[Math.max(0, Math.min(pieces.length - 1, i))];
  const xx = Math.min(p.max, Math.max(p.min, ride.x));
  const slope = derivative(p, xx);
  const denom = Math.sqrt(1+slope*slope);
  const direction = ride.direction === -1 ? -1 : 1;

  // Tangent velocity must point in the cart's actual direction of travel.
  ride.vx = direction * ride.speed / denom;
  ride.vy = direction * ride.speed * slope / denom;

  ride.state = label === "DERAILED" ? "derailed" : "airborne";
  ride.message = label;
  if (label === "DERAILED") {
    spawnExplosion(ride.x, ride.y, 0.7, 1.0);
  }
  showRideWarning(label === "DERAILED" ? "DERAILED — the track is not continuous/differentiable." : "AIRBORNE — the cart lost contact with the track.");
}

function reachableHeight() {
  return analysis.y0 + (INITIAL_SPEED * INITIAL_SPEED) / (2 * G);
}

function findTurningX(piece, xA, xB) {
  const targetY = reachableHeight();
  let lo = Math.min(xA, xB);
  let hi = Math.max(xA, xB);

  const f = x => piece.eval(x) - targetY;
  let fLo = f(lo);
  let fHi = f(hi);

  // If numerical noise means the interval does not strictly bracket the root,
  // return whichever endpoint is closer to the energy height.
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }

  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-8) return mid;

    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}

function reverseAtTurningPoint(piece, xFrom, xToward) {
  const turnX = findTurningX(piece, xFrom, xToward);

  // Flip direction once.
  ride.direction *= -1;
  ride.message = "Turning point";

  // If we leave the cart exactly on the zero-speed energy boundary, the next
  // animation frame also sees v≈0 and flips it back again. Move it a tiny
  // distance in the NEW direction (back downhill / into the reachable region)
  // so the following frame has a small positive speed.
  const nudgedX = Math.max(
    piece.min,
    Math.min(piece.max, turnX + ride.direction * TURN_NUDGE_X)
  );

  ride.x = nudgedX;
  ride.y = piece.eval(nudgedX);

  const nudgedSpeed = speedFromHeight(ride.y, analysis.y0);
  ride.speed = Number.isFinite(nudgedSpeed) ? nudgedSpeed : 0;

  const arrow = ride.direction > 0 ? "→" : "←";
  el("statusText").textContent =
    `TURNING POINT at x=${fmt(turnX,2)} m — reversing ${arrow}`;
  showRideWarning("TURNING POINT — speed reached 0, so the cart reversed direction.");
}

function handleNonDifferentiableJoint(joint, nextPieceIndex, nextX, nextY) {
  // The rail is continuous, so the cart does not leave the track.
  // But the tangent direction changes instantaneously, so the idealized
  // acceleration / G-force at the corner is undefined.
  ride.catPassedOut = true;
  ride.undefinedGTimer = UNDEFINED_G_FLASH_TIME;
  ride.joltTimer = UNDEFINED_G_FLASH_TIME;

  ride.pieceIndex = nextPieceIndex;
  ride.x = nextX;
  ride.y = nextY;

  showRideWarning("NON-DIFFERENTIABLE JOINT — G-force is undefined; the cart takes an instantaneous jolt.");
  el("statusText").textContent =
    `Continuous but not differentiable near x=${fmt(joint.x,2)} m — cart stays on track, G-force undefined.`;
}

function stepTrack(dt) {
  const i = ride.pieceIndex;
  if (i < 0 || i >= pieces.length) {
    ride.state = "crashed";
    ride.message = "Track bookkeeping error";
    showRideWarning("DERAILED — simulator lost the active track piece.");
    return;
  }

  const p = pieces[i];
  const direction = ride.direction === -1 ? -1 : 1;
  const x = Math.min(p.max, Math.max(p.min, ride.x));

  let y;
  try {
    y = p.eval(x);
  } catch {
    launchFromTrack("DERAILED");
    return;
  }

  let v = speedFromHeight(y, analysis.y0);

  // If numerical drift lands exactly at/just beyond an energy turning point,
  // use the same stable reversal helper instead of toggling direction in place.
  if (!Number.isFinite(v) || v < 0.025) {
    const toward = Math.max(
      p.min,
      Math.min(p.max, x + direction * Math.max(TURN_NUDGE_X, 0.03))
    );
    reverseAtTurningPoint(p, x, toward);
    return;
  }

  ride.speed = v;
  ride.y = y;

  const ng = normalG(p, x, v);
  if (ng < -CONTACT_G_EPS && x > p.min + 0.02 && x < p.max - 0.02) {
    launchFromTrack("AIRBORNE");
    return;
  }

  const slope = derivative(p, x);
  const dxdtMagnitude = v / Math.sqrt(1 + slope*slope);
  const nextX = x + direction * dxdtMagnitude * dt;

  // ------------------------------------------------------------
  // Detect an energy turning point BEFORE stepping into a region
  // that is too high to reach.
  // ------------------------------------------------------------
  const localCandidateX = Math.max(p.min, Math.min(p.max, nextX));
  if (Math.abs(localCandidateX - x) > 1e-12) {
    const candidateY = p.eval(localCandidateX);
    const candidateV = speedFromHeight(candidateY, analysis.y0);

    if (!Number.isFinite(candidateV)) {
      reverseAtTurningPoint(p, x, localCandidateX);
      return;
    }
  }

  // ------------------------------------------------------------
  // Moving RIGHT: handle the right endpoint / next piece.
  // ------------------------------------------------------------
  if (direction > 0 && nextX >= p.max) {
    if (i < pieces.length - 1) {
      const joint = analysis.joints[i];
      ride.x = p.max;
      ride.y = p.eval(p.max);
      ride.speed = speedFromHeight(ride.y, analysis.y0);

      if (!Number.isFinite(ride.speed)) {
        reverseAtTurningPoint(p, x, p.max);
        return;
      }

      if (!joint || !joint.cOK) {
        launchFromTrack("DERAILED");
        return;
      }

      const nextPiece = pieces[i + 1];
      ride.crossedJoints.add(i);

      if (!joint.dOK) {
        handleNonDifferentiableJoint(
          joint,
          i + 1,
          nextPiece.min,
          nextPiece.eval(nextPiece.min)
        );
        return;
      }

      ride.pieceIndex = i + 1;
      ride.x = nextPiece.min;
      ride.y = nextPiece.eval(nextPiece.min);
      return;
    }

    // Final right endpoint.
    ride.x = p.max;
    ride.y = p.eval(p.max);
    ride.speed = speedFromHeight(ride.y, analysis.y0);

    if (!Number.isFinite(ride.speed)) {
      reverseAtTurningPoint(p, x, p.max);
      return;
    }

    if (p.max < COURSE_LENGTH - X_JOINT_TOL) {
      // Physical end of rail before the finish: launch.
      const slopeAtEnd = derivative(p, p.max);
      const denom = Math.sqrt(1 + slopeAtEnd * slopeAtEnd);
      ride.vx = ride.direction * ride.speed / denom;
      ride.vy = ride.direction * ride.speed * slopeAtEnd / denom;
      ride.state = "airborne";
      ride.message = "Track ended";
      showRideWarning("TRACK ENDED — the cart left the rail and is now airborne.");
      el("statusText").textContent =
        `Track ended at x=${fmt(p.max,2)} m; the cart is now in projectile motion.`;
      return;
    }

    // Reaching x = COURSE_LENGTH still counts as completing the course.
    ride.state = "complete";
    ride.message = "Complete";
    el("statusText").textContent = "Ride complete.";
    showRideWarning("✓ COURSE COMPLETE");
    return;
  }

  // ------------------------------------------------------------
  // Moving LEFT: handle the left endpoint / previous piece.
  // ------------------------------------------------------------
  if (direction < 0 && nextX <= p.min) {
    if (i > 0) {
      const joint = analysis.joints[i - 1];
      ride.x = p.min;
      ride.y = p.eval(p.min);
      ride.speed = speedFromHeight(ride.y, analysis.y0);

      if (!Number.isFinite(ride.speed)) {
        reverseAtTurningPoint(p, x, p.min);
        return;
      }

      if (!joint || !joint.cOK) {
        launchFromTrack("DERAILED");
        return;
      }

      const prevPiece = pieces[i - 1];
      ride.crossedJoints.add(i - 1);

      if (!joint.dOK) {
        handleNonDifferentiableJoint(
          joint,
          i - 1,
          prevPiece.max,
          prevPiece.eval(prevPiece.max)
        );
        return;
      }

      ride.pieceIndex = i - 1;
      ride.x = prevPiece.max;
      ride.y = prevPiece.eval(prevPiece.max);
      return;
    }

    // First left endpoint. If it is the course boundary, there is no rail
    // beyond it, so the cart leaves the track rather than being forced forward.
    ride.x = p.min;
    ride.y = p.eval(p.min);
    ride.speed = speedFromHeight(ride.y, analysis.y0);

    if (!Number.isFinite(ride.speed)) {
      reverseAtTurningPoint(p, x, p.min);
      return;
    }

    const slopeAtEnd = derivative(p, p.min);
    const denom = Math.sqrt(1 + slopeAtEnd * slopeAtEnd);
    ride.vx = ride.direction * ride.speed / denom;
    ride.vy = ride.direction * ride.speed * slopeAtEnd / denom;
    ride.state = "airborne";
    ride.message = "Track ended";
    showRideWarning("TRACK ENDED — the cart left the rail and is now airborne.");
    el("statusText").textContent =
      `Track ended at x=${fmt(p.min,2)} m; the cart is now in projectile motion.`;
    return;
  }

  ride.x = nextX;
  ride.y = p.eval(ride.x);
}

function stepAir(dt) {
  ride.vy -= G * dt;
  ride.x += ride.vx * dt;
  ride.y += ride.vy * dt;
  ride.speed = Math.sqrt(ride.vx*ride.vx + ride.vy*ride.vy);

  // After leaving the rail, the cart keeps moving ballistically until it
  // reaches the ground. We intentionally do not end the simulation just
  // because it has moved beyond the track's horizontal course.
  if (ride.y <= MIN_HEIGHT) {
    ride.y = MIN_HEIGHT;
    spawnExplosion(ride.x, ride.y, 0.95, 1.35);
    ride.vx = 0;
    ride.vy = 0;
    ride.speed = 0;
    ride.state = "crashed";
    ride.message = "Ground impact";
    showRideWarning("GROUND IMPACT — the cart fell to the ground.");
    el("statusText").textContent = "Ride failed after leaving the track; the cart fell to the ground.";
    return;
  }
}

function spawnExplosion(x, y, duration = 0.8, scale = 1) {
  effects.push({ x, y, t: 0, duration, scale });
}

function stepEffects(dt) {
  if (!effects.length) return;
  for (const fx of effects) fx.t += dt;
  effects = effects.filter(fx => fx.t <= fx.duration);
}

function updateScrubFromRide() {
  if (!ride || !analysis) return;
  if (ride.x >= 0 && ride.x <= COURSE_LENGTH) {
    const x = Math.max(0, Math.min(COURSE_LENGTH, ride.x));
    el("scrubSlider").value = x;
    el("scrubReadout").textContent = `x = ${fmt(x,1)} m`;
    lastInspectX = x;
  }
}

function inspectCrossedTarget(a, b, target, tolerance = 0.075) {
  if (!Number.isFinite(a)) return Math.abs(b - target) <= tolerance;
  const lo = Math.min(a, b) - tolerance;
  const hi = Math.max(a, b) + tolerance;
  return target >= lo && target <= hi;
}

function inspectCatPassedOutByX(x) {
  // Treat the slider as a left-to-right replay timeline. If the cart has
  // already encountered >= CAT_PASS_OUT_G or a continuous cusp/corner,
  // keep the cat passed out at later slider positions.
  for (const j of analysis.joints) {
    if (j.cOK && !j.dOK && j.x <= x + 0.075) return true;
  }

  for (const q of analysis.samplePoints) {
    if (q.x > x + 0.075) continue;
    if (Number.isFinite(q.ng) && Math.max(0, q.ng) >= CAT_PASS_OUT_G) return true;
  }
  return false;
}

function firstInspectHighGEvent(a, b) {
  const lo = Math.min(a, b) - 0.075;
  const hi = Math.max(a, b) + 0.075;
  const forward = b >= a;
  let candidates = analysis.samplePoints.filter(
    q => q.x >= lo && q.x <= hi &&
         Number.isFinite(q.ng) && Math.max(0, q.ng) >= CAT_PASS_OUT_G
  );
  if (!candidates.length) return null;
  candidates.sort((u, v) => forward ? u.x - v.x : v.x - u.x);
  return candidates[0];
}

function inspectAtX(rawX) {
  if (!analysis || !pieces.length) return;

  // Stop physical playback and any previous preview animation, but remember
  // where the slider was so crossing an event can trigger it.
  const previousX = Number.isFinite(lastInspectX) ? lastInspectX : 0;
  stopAnimation();
  effects = [];

  const x = Math.max(0, Math.min(COURSE_LENGTH, Number(rawX)));
  const i = inspectPieceIndex(x);

  el("scrubSlider").value = x;
  el("scrubReadout").textContent = `x = ${fmt(x,1)} m`;

  // Track gaps / early track endings remain immediate warnings.
  if (i < 0) {
    lastInspectX = x;
    const last = pieces[pieces.length - 1];
    if (pieces.length === 1 && x > last.max && last.max < COURSE_LENGTH - X_JOINT_TOL) {
      el("statusText").textContent =
        `The rail ends at x=${fmt(last.max,2)} m. Run the coaster to watch it leave the track and fall.`;
      showRideWarning("TRACK ENDED — beyond this point the cart is airborne during playback.");
    } else {
      el("statusText").textContent = `No track exists at x=${fmt(x,2)} m.`;
      showRideWarning("TRACK GAP — no function covers this slider position.");
    }
    drawScene();
    return;
  }

  const p = pieces[i];
  const xx = Math.max(p.min, Math.min(p.max, x));
  const y = p.eval(xx);
  const v = speedFromHeight(y, analysis.y0);

  ride = {
    state: "inspect",
    x: xx,
    y,
    speed: Number.isFinite(v) ? v : 0,
    vx: 0,
    vy: 0,
    message: "Inspecting",
    pieceIndex: i,
    direction: x >= previousX ? 1 : -1,
    catPassedOut: inspectCatPassedOutByX(xx),
    undefinedGTimer: 0,
    joltTimer: 0,
    crossedJoints: new Set()
  };

  el("warningBanner").classList.add("hidden");

  // ------------------------------------------------------------
  // EVENT PREVIEW: crossing a piecewise joint
  // ------------------------------------------------------------
  const crossedJoints = analysis.joints.filter(
    j => inspectCrossedTarget(previousX, x, j.x)
  );
  const jointEvent = crossedJoints.length
    ? crossedJoints.sort((a, b) =>
        x >= previousX ? a.x - b.x : b.x - a.x
      )[0]
    : null;

  let eventAnimation = false;

  if (jointEvent) {
    if (!jointEvent.cOK) {
      // A discontinuity still represents derailment. During slider inspection
      // preview the crash point without replacing the slider with projectile motion.
      spawnExplosion(
        jointEvent.x,
        (jointEvent.ya + jointEvent.yb) / 2,
        0.8,
        0.8
      );
      eventAnimation = true;
      el("statusText").textContent =
        `Discontinuity near x=${fmt(jointEvent.x,2)} m — the cart would derail here.`;
      showRideWarning("DERAIL POINT — the track is discontinuous. Run Coaster to watch the full crash.");
    } else if (!jointEvent.dOK) {
      ride.catPassedOut = true;
      ride.undefinedGTimer = UNDEFINED_G_FLASH_TIME;
      ride.joltTimer = UNDEFINED_G_FLASH_TIME;
      eventAnimation = true;
      el("statusText").textContent =
        `Continuous but not differentiable near x=${fmt(jointEvent.x,2)} m — instantaneous jolt.`;
      showRideWarning("NON-DIFFERENTIABLE JOINT — G-force is UNDEFINED; the cat passes out.");
    }
  }

  // ------------------------------------------------------------
  // Other physical warnings when no joint event has priority.
  // ------------------------------------------------------------
  if (!jointEvent) {
    if (!Number.isFinite(v)) {
      el("statusText").textContent =
        `Inspecting x=${fmt(xx,2)} m — the cart does not have enough energy to reach this point.`;
      showRideWarning("NOT PHYSICALLY REACHABLE — insufficient mechanical energy.");
    } else {
      const ng = normalG(p, xx, v);
      const contactCrossed =
        analysis.firstContactLoss &&
        inspectCrossedTarget(previousX, x, analysis.firstContactLoss.x, 0.10);

      if (contactCrossed || ng < -CONTACT_G_EPS) {
        el("statusText").textContent =
          `Loss of track contact near x=${fmt(contactCrossed ? analysis.firstContactLoss.x : xx,2)} m.`;
        showRideWarning("AIRBORNE POINT — the cart would lose contact with the rail here.");
      } else {
        const highGEvent = firstInspectHighGEvent(previousX, x);
        if (highGEvent || Math.max(0, ng) >= CAT_PASS_OUT_G) {
          ride.catPassedOut = true;
          const gx = highGEvent ? highGEvent.x : xx;
          const gv = highGEvent ? Math.max(0, highGEvent.ng) : Math.max(0, ng);
          el("statusText").textContent =
            `High G-force near x=${fmt(gx,2)} m (${fmt(gv,2)} g).`;
          showRideWarning(`HIGH G-FORCE — ${fmt(gv,2)} g; the cat passes out.`);
        } else {
          el("statusText").textContent =
            `Inspecting x=${fmt(xx,2)} m. Drag through the ride or press Run Coaster.`;
        }
      }
    }
  }

  lastInspectX = x;
  updateTelemetry();
  drawScene();

  if (eventAnimation || effects.length > 0 || ride.joltTimer > 0 || ride.undefinedGTimer > 0) {
    startInspectAnimation();
  }
}

function showRideWarning(text) {
  const b = el("warningBanner");
  b.textContent = text;
  b.classList.remove("hidden");
}

function setTelemetryLevel(id, level) {
  const node = el(id);
  node.classList.remove("telemetry-green", "telemetry-yellow", "telemetry-red");
  if (level) node.classList.add(`telemetry-${level}`);
}

function levelForThreshold(value, yellowAt, redAt) {
  if (!Number.isFinite(value)) return null;
  if (value >= redAt) return "red";
  if (value >= yellowAt) return "yellow";
  return "green";
}

function updateTelemetry() {
  if (!ride) return;
  el("xReadout").textContent = `${fmt(ride.x,1)} m`;
  el("heightReadout").textContent = `${fmt(ride.y,1)} m`;
  const directionArrow =
    (ride.state === "track" || ride.state === "inspect") && ride.direction === -1 ? " ←" :
    (ride.state === "track" || ride.state === "inspect") ? " →" : "";
  el("speedReadout").textContent = `${fmt(ride.speed,1)} m/s${directionArrow}`;
  setTelemetryLevel(
    "speedReadout",
    levelForThreshold(ride.speed, SPEED_YELLOW, SPEED_RED)
  );

  let slope = NaN, ng = NaN;
  if (ride.state === "track" || ride.state === "complete" || ride.state === "stopped" || ride.state === "inspect") {
    const p = pieceForX(ride.x);
    if (p) {
      const xx = Math.min(p.max, Math.max(p.min, ride.x));
      slope = derivative(p, xx);
      if (Number.isFinite(ride.speed)) ng = Math.max(0, normalG(p, xx, ride.speed));
    }
  }
  el("slopeReadout").textContent = Number.isFinite(slope) ? fmt(slope,2) : "airborne";

  if (ride.undefinedGTimer > 0) {
    el("gReadout").textContent = "UNDEFINED";
    setTelemetryLevel("gReadout", "red");
  } else {
    el("gReadout").textContent = Number.isFinite(ng) ? `${fmt(ng,2)} g` : "0.00 g";
    setTelemetryLevel(
      "gReadout",
      levelForThreshold(Number.isFinite(ng) ? ng : 0, GFORCE_YELLOW, GFORCE_RED)
    );
  }

  const total = Math.max(1, G * Math.max(analysis?.y0 ?? ride.y, ride.y) + INITIAL_SPEED*INITIAL_SPEED/2);
  const pe = Math.max(0, G * ride.y);
  const ke = Math.max(0, ride.speed*ride.speed/2);
  const sum = Math.max(1e-6, pe+ke);
  el("peBar").style.width = `${Math.max(0, Math.min(100, 100*pe/sum))}%`;
  el("keBar").style.width = `${Math.max(0, Math.min(100, 100*ke/sum))}%`;
}


function drawBackgroundScene(ctx, sx, sy, viewMaxX, yMinDraw, yMaxDraw, padL, padT, plotW, plotH) {
  // Soft sky banding
  ctx.save();
  const sky = ctx.createLinearGradient(0, sy(yMaxDraw), 0, sy(yMinDraw));
  sky.addColorStop(0.0, "#e8f3ff");
  sky.addColorStop(0.45, "#f6fbff");
  sky.addColorStop(1.0, "#f3f7fc");
  ctx.fillStyle = sky;
  ctx.fillRect(sx(0), sy(yMaxDraw), sx(viewMaxX) - sx(0), sy(yMinDraw) - sy(yMaxDraw));
  ctx.restore();

  // Distant hills (very light so they do not compete with graph lines).
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#8fb3c9";
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(0));
  for (let x = 0; x <= viewMaxX; x += 2) {
    const y = 4.8 + 1.8 * Math.sin(x / 10) + 0.8 * Math.sin(x / 4.7);
    ctx.lineTo(sx(x), sy(y));
  }
  ctx.lineTo(sx(viewMaxX), sy(0));
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#7ca6bd";
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(0));
  for (let x = 0; x <= viewMaxX; x += 2) {
    const y = 2.8 + 1.3 * Math.sin((x + 8) / 7.8) + 0.7 * Math.cos(x / 3.9);
    ctx.lineTo(sx(x), sy(y));
  }
  ctx.lineTo(sx(viewMaxX), sy(0));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Semi-transparent tree for scale.
  const treeX = Math.min(viewMaxX * 0.12, 18);
  drawScaleTree(ctx, sx(treeX), sy(0), 0.92, 0.32);
}

function drawScaleTree(ctx, x, groundY, scale = 1, alpha = 0.3) {
  ctx.save();
  ctx.globalAlpha = alpha;

  // Trunk
  ctx.fillStyle = "#6f5238";
  const trunkW = 8 * scale;
  const trunkH = 44 * scale;
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);

  // Canopy
  ctx.fillStyle = "#6aa071";
  const clusters = [
    [-13, -48, 15], [0, -58, 18], [16, -47, 14], [-2, -38, 17]
  ];
  for (const [dx, dy, r] of clusters) {
    ctx.beginPath();
    ctx.arc(x + dx * scale, groundY + dy * scale, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCartCat(ctx, passedOut = false) {
  ctx.save();
  ctx.fillStyle = "#111111";
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (!passedOut) {
    // Upright cat
    ctx.beginPath();
    ctx.ellipse(-1, -9.5, 5.8, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(5.5, -13.5, 3.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(3.2, -15.0);
    ctx.lineTo(4.7, -19.0);
    ctx.lineTo(6.1, -15.3);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(6.5, -15.2);
    ctx.lineTo(8.0, -18.7);
    ctx.lineTo(9.0, -14.6);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-6.0, -10.8);
    ctx.quadraticCurveTo(-11.0, -16.0, -8.0, -21.0);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(6.7, -13.9, 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Passed-out cat: lying horizontally in the cart
    ctx.save();
    ctx.translate(-0.5, -9.8);
    ctx.rotate(-0.07);

    // Body
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.8, 4.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(9.2, -0.4, 3.3, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.beginPath();
    ctx.moveTo(7.8, -2.2);
    ctx.lineTo(8.8, -5.8);
    ctx.lineTo(10.0, -2.5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(10.3, -2.0);
    ctx.lineTo(11.6, -5.3);
    ctx.lineTo(12.0, -1.4);
    ctx.closePath();
    ctx.fill();

    // Tail limp behind
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-8.2, 0.0);
    ctx.quadraticCurveTo(-12.0, 2.0, -14.0, 0.4);
    ctx.stroke();

    // X eyes
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    for (const ex of [8.3, 10.0]) {
      ctx.beginPath();
      ctx.moveTo(ex - 0.7, -1.1);
      ctx.lineTo(ex + 0.7, 0.3);
      ctx.moveTo(ex + 0.7, -1.1);
      ctx.lineTo(ex - 0.7, 0.3);
      ctx.stroke();
    }
    ctx.restore();

    // Little dizzy stars above the cart
    ctx.save();
    ctx.strokeStyle = "rgba(255, 200, 0, 0.95)";
    ctx.lineWidth = 1.5;
    const stars = [[-4,-18],[2,-21],[9,-18]];
    for (const [sx, sy] of stars) {
      ctx.beginPath();
      ctx.moveTo(sx - 1.8, sy);
      ctx.lineTo(sx + 1.8, sy);
      ctx.moveTo(sx, sy - 1.8);
      ctx.lineTo(sx, sy + 1.8);
      ctx.moveTo(sx - 1.2, sy - 1.2);
      ctx.lineTo(sx + 1.2, sy + 1.2);
      ctx.moveTo(sx + 1.2, sy - 1.2);
      ctx.lineTo(sx - 1.2, sy + 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawScene() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  const padL = 58, padR = 24, padT = 24, padB = 48;
  const plotW = w-padL-padR, plotH = h-padT-padB;
  const yMinDraw = -5, yMaxDraw = MAX_HEIGHT + 2;

  // Keep a flying cart visible even after it passes beyond the course boundary.
  // The camera zooms out only as much as needed.
  const viewMaxX = (ride && ["airborne","derailed","crashed"].includes(ride.state))
    ? Math.max(COURSE_LENGTH, ride.x + 8)
    : COURSE_LENGTH;

  const sx = x => padL + (x/viewMaxX)*plotW;
  const sy = y => padT + ((yMaxDraw-y)/(yMaxDraw-yMinDraw))*plotH;

  drawBackgroundScene(ctx, sx, sy, viewMaxX, yMinDraw, yMaxDraw, padL, padT, plotW, plotH);

  // Grid.
  ctx.save();
  ctx.strokeStyle = "#dfe5ee";
  ctx.lineWidth = 1;
  ctx.font = "13px system-ui";
  ctx.fillStyle = "#7b8798";
  for (let x=0; x<=Math.ceil(viewMaxX/10)*10; x+=10) {
    if (x > viewMaxX + 0.001) break;
    ctx.beginPath(); ctx.moveTo(sx(x),sy(yMinDraw)); ctx.lineTo(sx(x),sy(yMaxDraw)); ctx.stroke();
    ctx.fillText(String(x), sx(x)-7, h-20);
  }
  for (let y=0; y<=MAX_HEIGHT; y+=5) {
    ctx.beginPath(); ctx.moveTo(sx(0),sy(y)); ctx.lineTo(sx(COURSE_LENGTH),sy(y)); ctx.stroke();
    ctx.fillText(String(y), 22, sy(y)+4);
  }
  // Centered axis titles
  ctx.save();
  ctx.font = "600 14px system-ui";
  ctx.fillStyle = "#667085";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // x-axis title centered beneath the plotting area
  ctx.fillText("x (m)", padL + plotW / 2, h - 7);

  // y-axis title centered vertically along the left side
  ctx.save();
  ctx.translate(11, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("height (m)", 0, 0);
  ctx.restore();

  ctx.restore();
  ctx.restore();

  // Ground.
  ctx.save();
  ctx.fillStyle = "#e7ecf3";
  ctx.fillRect(sx(0), sy(0), sx(viewMaxX)-sx(0), sy(yMinDraw)-sy(0));
  ctx.restore();

  // Track.
  if (analysis?.samplePoints?.length) {
    for (const p of pieces) {
      ctx.beginPath();
      let started = false;
      const pts = analysis.samplePoints.filter(q => q.piece === p);
      for (const q of pts) {
        const xx=sx(q.x), yy=sy(q.y);
        if (!started) { ctx.moveTo(xx,yy); started=true; } else ctx.lineTo(xx,yy);
      }
      ctx.strokeStyle = "#1c2b47";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.strokeStyle = "#9aa7ba";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Joint markers.
    for (const j of analysis.joints) {
      ctx.beginPath();
      ctx.arc(sx(j.x), sy((j.ya+j.yb)/2), 7, 0, Math.PI*2);
      ctx.fillStyle = j.dOK ? "#21845b" : "#c43d4b";
      ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle="#fff"; ctx.stroke();
    }

    if (analysis.firstEnergyFailure) {
      ctx.beginPath();
      ctx.arc(sx(analysis.firstEnergyFailure.x), sy(analysis.firstEnergyFailure.y), 9, 0, Math.PI*2);
      ctx.strokeStyle="#b7791f"; ctx.lineWidth=4; ctx.stroke();
    }
    if (analysis.firstContactLoss) {
      ctx.beginPath();
      ctx.arc(sx(analysis.firstContactLoss.x), sy(analysis.firstContactLoss.y), 10, 0, Math.PI*2);
      ctx.strokeStyle="#c43d4b"; ctx.lineWidth=4; ctx.stroke();
    }
  }

  // Cart.
  if (ride && ride.message !== "Ground impact" && Number.isFinite(ride.x) && Number.isFinite(ride.y)) {
    const cx=sx(ride.x), cy=sy(ride.y);
    let angle=0;
    let catPassedOut = !!ride.catPassedOut;

    if (ride.state === "track" || ride.state === "complete" || ride.state === "stopped" || ride.state === "inspect") {
      const p=pieceForX(ride.x);
      if (p) {
        const xx = Math.min(p.max, Math.max(p.min, ride.x));
        // Keep the cart upright on the tangent even when traveling left.
        // Direction is shown by motion and the telemetry arrow; rotating by π
        // would turn the cart and cat upside down.
        angle=Math.atan(derivative(p, xx));
        if (Number.isFinite(ride.speed)) {
          const feltG = Math.max(0, normalG(p, xx, ride.speed));
          if (feltG >= CAT_PASS_OUT_G) {
            ride.catPassedOut = true;
            catPassedOut = true;
          }
        }
      }
    } else if (Number.isFinite(ride.vx) && ride.vx !== 0) {
      angle=Math.atan2(-ride.vy, ride.vx) * -1;
    }

    ctx.save();
    const joltProgress = ride.joltTimer > 0 ? ride.joltTimer / UNDEFINED_G_FLASH_TIME : 0;
    const shakeX = ride.joltTimer > 0 ? Math.sin(ride.joltTimer * 85) * 3.2 * joltProgress : 0;
    const shakeY = ride.joltTimer > 0 ? Math.cos(ride.joltTimer * 71) * 2.0 * joltProgress : 0;
    ctx.translate(cx + shakeX, cy - 9 + shakeY);
    ctx.rotate(-angle);
    ctx.scale(cartDisplayScale, cartDisplayScale);
    ctx.fillStyle = ride.state === "airborne" ? "#c43d4b" : "#3157d5";
    ctx.fillRect(-13,-8,26,13);

    // Black cat rider scales with the cart.
    drawCartCat(ctx, catPassedOut);

    ctx.fillStyle="#18243b";
    ctx.beginPath(); ctx.arc(-8,7,4,0,Math.PI*2); ctx.arc(8,7,4,0,Math.PI*2); ctx.fill();
    ctx.restore();

    // Cusp/corner jolt sparks
    if (ride.joltTimer > 0) {
      const p = ride.joltTimer / UNDEFINED_G_FLASH_TIME;
      ctx.save();
      ctx.translate(cx, cy - 8);
      ctx.strokeStyle = `rgba(255, 170, 0, ${0.9 * p})`;
      ctx.lineWidth = 2;
      for (let k = 0; k < 10; k++) {
        const a = (Math.PI * 2 * k) / 10 + ride.joltTimer * 10;
        const r1 = 14;
        const r2 = 22 + 10 * (1 - p);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Explosion effects
  for (const fx of effects) {
    const progress = Math.max(0, Math.min(1, fx.t / fx.duration));
    const cx = sx(fx.x);
    const cy = sy(fx.y);
    const outer = (10 + 34 * progress) * fx.scale;
    const inner = Math.max(2, (18 - 8 * progress) * fx.scale);
    const fade = 1 - progress;

    ctx.save();
    ctx.globalAlpha = 0.28 * fade;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer * 1.7);
    halo.addColorStop(0, "rgba(255,230,120,0.95)");
    halo.addColorStop(0.35, "rgba(255,145,0,0.70)");
    halo.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, outer * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Fiery starburst
    ctx.save();
    ctx.translate(cx, cy);
    for (let k = 0; k < 14; k++) {
      const angle = (Math.PI * 2 * k) / 14 + progress * 0.9;
      const r1 = inner * 0.4;
      const r2 = outer * (0.78 + 0.18 * ((k % 3) / 2));
      ctx.strokeStyle = `rgba(255, ${Math.round(210 - 80 * progress)}, 0, ${0.8 * fade})`;
      ctx.lineWidth = Math.max(1.5, 4.5 * (1 - progress)) * fx.scale;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
      ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.restore();

    // Core fireball
    ctx.save();
    ctx.globalAlpha = 0.95 * fade + 0.05;
    ctx.fillStyle = "#ffd54f";
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff7a00";
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}


function setCartDisplayScale(value) {
  const parsed = Number(value);
  cartDisplayScale = Number.isFinite(parsed)
    ? Math.max(0.7, Math.min(2.2, parsed))
    : 1.0;

  el("cartSizeSlider").value = cartDisplayScale;
  el("cartSizeReadout").textContent = `${cartDisplayScale.toFixed(1)}×`;
  drawScene();
}

async function toggleProjectorMode() {
  const area = el("projectorArea");

  try {
    if (!document.fullscreenElement) {
      if (area.requestFullscreen) {
        await area.requestFullscreen();
      } else {
        el("statusText").textContent = "Fullscreen is not supported in this browser.";
      }
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    el("statusText").textContent = "Full Screen could not start. Browser permissions may be blocking it.";
  }
}

function syncFullscreenButton() {
  const isFullscreen = document.fullscreenElement === el("projectorArea");
  el("fullscreenBtn").textContent = isFullscreen ? "✕ Exit Full Screen" : "⛶ Full Screen";
  // Repaint after the fullscreen layout changes dimensions.
  requestAnimationFrame(drawScene);
}

el("exampleBtn").addEventListener("click", () => {
  const key = el("exampleSelect").value;
  el("equations").value = examples[key] || examples.working;
  analyzeTrack();
});
el("analyzeBtn").addEventListener("click", analyzeTrack);
el("runBtn").addEventListener("click", runRide);
el("resetBtn").addEventListener("click", resetRide);
el("cartSizeSlider").addEventListener("input", (event) => setCartDisplayScale(event.target.value));
el("timeScale").addEventListener("input", (event) => {
  el("animationSpeedReadout").textContent = `${Number(event.target.value).toFixed(2)}×`;
});
el("fullscreenBtn").addEventListener("click", toggleProjectorMode);
document.addEventListener("fullscreenchange", syncFullscreenButton);
el("scrubSlider").addEventListener("input", (event) => inspectAtX(event.target.value));
window.addEventListener("resize", drawScene);

const saved = localStorage.getItem("calculusCoasterDesign");
if (saved) el("equations").value = saved;
else el("equations").value = examples.working;

setCartDisplayScale(1.0);
el("animationSpeedReadout").textContent = `${Number(el("timeScale").value).toFixed(2)}×`;
drawScene();
