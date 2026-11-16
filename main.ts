import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------- deterministic PRNG ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------- framebuffer (2048 supersample, design space is 1024) ----------
const SS = 2048;
const fb = new Uint8Array(SS * SS * 3);
type RGB = [number, number, number];
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const INK = hex("#16222e");
const INK2 = hex("#0d1117");
const SIL = hex("#1c2733");
const CREAM = hex("#f6ead2");
const PAGE_SHADE = hex("#e3d0a8");
const PAPER = hex("#f9f1dc");
const CRIM = hex("#d2342c");
const CRIM_D = hex("#a8231d");
const CRIM_L = hex("#ef6a55");
const GOLD = hex("#f4b942");
const GOLD_L = hex("#ffe9a8");

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= SS || y >= SS || a <= 0) return;
  const i = (y * SS + x) * 3;
  const ia = 1 - a;
  fb[i] = Math.round(fb[i] * ia + c[0] * a);
  fb[i + 1] = Math.round(fb[i + 1] * ia + c[1] * a);
  fb[i + 2] = Math.round(fb[i + 2] * ia + c[2] * a);
}
// design coords -> supersample coords
const X = (v: number): number => v * 2;

function fillRectD(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(X(x))), x1 = Math.min(SS, Math.ceil(X(x + w)));
  const y0 = Math.max(0, Math.floor(X(y))), y1 = Math.min(SS, Math.ceil(X(y + h)));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blendPx(xx, yy, c, a);
}

function fillPoly(pts: number[][], c: RGB, a = 1): void {
  const p = pts.map((q) => [X(q[0]), X(q[1])]);
  let minY = Infinity, maxY = -Infinity;
  for (const q of p) { minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(SS - 1, Math.ceil(maxY));
  for (let yy = y0; yy <= y1; yy++) {
    const yc = yy + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const A = p[i], B = p[(i + 1) % p.length];
      if ((A[1] <= yc && B[1] > yc) || (B[1] <= yc && A[1] > yc)) {
        xs.push(A[0] + ((yc - A[1]) / (B[1] - A[1])) * (B[0] - A[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k])), xb = Math.min(SS - 1, Math.ceil(xs[k + 1]));
      for (let xx = xa; xx <= xb; xx++) blendPx(xx, yy, c, a);
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const CX = X(cx), CY = X(cy), R = X(r);
  const x0 = Math.max(0, Math.floor(CX - R)), x1 = Math.min(SS - 1, Math.ceil(CX + R));
  const y0 = Math.max(0, Math.floor(CY - R)), y1 = Math.min(SS - 1, Math.ceil(CY + R));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = xx - CX, dy = yy - CY;
    if (dx * dx + dy * dy <= R * R) blendPx(xx, yy, c, a);
  }
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, rotDeg: number, c: RGB, a = 1): void {
  const th = (rotDeg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  const R = Math.max(rx, ry);
  const CX = X(cx), CY = X(cy);
  const x0 = Math.max(0, Math.floor(CX - X(R))), x1 = Math.min(SS - 1, Math.ceil(CX + X(R)));
  const y0 = Math.max(0, Math.floor(CY - X(R))), y1 = Math.min(SS - 1, Math.ceil(CY + X(R)));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = (xx - CX) / 2, dy = (yy - CY) / 2;
    const lx = dx * co + dy * si, ly = -dx * si + dy * co;
    if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) blendPx(xx, yy, c, a);
  }
}
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x1 + dx * t, y1 + dy * t, w / 2, c, a);
  }
}
function polyline(pts: number[][], w: number, c: RGB, a = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c, a);
}
function rotPt(cx: number, cy: number, x: number, y: number, deg: number): number[] {
  const th = (deg * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  return [cx + x * co - y * si, cy + x * si + y * co];
}
function rotPoly(cx: number, cy: number, local: number[][], deg: number): number[][] {
  return local.map((q) => rotPt(cx, cy, q[0], q[1], deg));
}
function vGrad(cTop: RGB, cBot: RGB): void {
  for (let yy = 0; yy < SS; yy++) {
    const t = yy / (SS - 1);
    const c: RGB = [0, 1, 2].map((k) => Math.round(cTop[k] + (cBot[k] - cTop[k]) * t)) as RGB;
    for (let xx = 0; xx < SS; xx++) { const i = (yy * SS + xx) * 3; fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; }
  }
}
function radialGlow(cx: number, cy: number, r: number, c: RGB, maxA: number): void {
  const CX = X(cx), CY = X(cy), R = X(r);
  const x0 = Math.max(0, Math.floor(CX - R)), x1 = Math.min(SS - 1, Math.ceil(CX + R));
  const y0 = Math.max(0, Math.floor(CY - R)), y1 = Math.min(SS - 1, Math.ceil(CY + R));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d = Math.hypot(xx - CX, yy - CY) / R;
    if (d < 1) blendPx(xx, yy, c, maxA * (1 - d) * (1 - d));
  }
}
function strokeCircle(cx: number, cy: number, r: number, w: number, c: RGB, a = 1): void {
  const pts: number[][] = [];
  for (let i = 0; i <= 72; i++) { const t = (i / 72) * Math.PI * 2; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  polyline(pts, w, c, a);
}
// quadratic curve sampler
function quad(p0: number[], p1: number[], p2: number[], n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

// ================= SCENE =================
// room
vGrad(hex("#1b2f4a"), hex("#0a141f"));
// faint wall stars / dust in upper right
for (let i = 0; i < 26; i++) {
  const sx = 560 + rand() * 440, sy = 40 + rand() * 300, sr = 1 + rand() * 2.2;
  fillCircle(sx, sy, sr, GOLD_L, 0.25 + rand() * 0.3);
}
// lamp glow (behind everything warm)
radialGlow(165, 330, 560, GOLD, 0.34);
radialGlow(165, 330, 220, hex("#ffd97a"), 0.35);

// desk: top trapezoid + front face
fillPoly([[0, 742], [1024, 706], [1024, 932], [0, 932]], hex("#96683a"));
fillPoly([[0, 800], [1024, 772], [1024, 932], [0, 932]], hex("#7a4b28"), 0.55);
fillPoly([[0, 932], [1024, 932], [1024, 1024], [0, 1024]], hex("#54331b"));
fillRectD(0, 928, 1024, 7, INK, 0.55);
// wood grain lines on desk top
for (let i = 0; i < 5; i++) {
  const yy = 790 + i * 28;
  thickLine(20, yy, 1004, yy - 22, 3, hex("#54331b"), 0.28);
}

// light cone from lamp toward book
fillPoly([[168, 352], [330, 838], [930, 838]], GOLD, 0.13);
fillPoly([[168, 352], [430, 838], [820, 838]], GOLD_L, 0.08);

// lamp: base, stem, arm, shade, bulb
fillEllipse(96, 722, 58, 15, 0, INK);
fillEllipse(96, 716, 52, 12, 0, hex("#2c3e50"));
thickLine(96, 712, 118, 452, 15, INK);
thickLine(118, 452, 158, 338, 15, INK);
thickLine(96, 712, 118, 452, 7, hex("#3d546e"));
fillPoly([[112, 252], [218, 252], [192, 348], [138, 348]], INK);
fillPoly([[120, 260], [210, 260], [188, 340], [144, 340]], GOLD);
fillPoly([[120, 260], [210, 260], [202, 292], [128, 292]], GOLD_L, 0.65);
fillCircle(165, 344, 17, GOLD_L);
fillCircle(165, 344, 9, hex("#fff6d8"));
radialGlow(165, 344, 90, GOLD_L, 0.5);

// book shadow
fillEllipse(515, 898, 385, 42, 0, INK2, 0.45);
// book cover (slightly larger, underneath)
fillPoly([[138, 662], [512, 714], [512, 928], [162, 906]], hex("#6e1d18"));
fillPoly([[512, 714], [886, 662], [862, 906], [512, 928]], hex("#571612"));
// pages
fillPoly([[155, 645], [512, 695], [512, 905], [175, 885]], CREAM);
fillPoly([[512, 695], [869, 645], [849, 885], [512, 905]], hex("#f1e2c2"));
// page shading near spine + outer edges
fillPoly([[452, 682], [512, 695], [512, 905], [452, 892]], PAGE_SHADE, 0.55);
fillPoly([[512, 695], [572, 682], [572, 892], [512, 905]], PAGE_SHADE, 0.45);
fillPoly([[155, 645], [512, 695], [512, 716], [168, 668]], hex("#fff8e6"), 0.7);
fillPoly([[512, 695], [869, 645], [856, 668], [512, 716]], hex("#fff3da"), 0.55);
// page edge lines
polyline([[175, 885], [512, 905], [849, 885]], 5, PAGE_SHADE);
thickLine(512, 695, 512, 905, 6, hex("#c9b183"));
thickLine(512, 695, 512, 905, 2.5, hex("#8f7648"));
// faint printed-paper texture lines on both pages (no text, just paper feel)
for (let i = 0; i < 4; i++) {
  const yy = 742 + i * 36;
  thickLine(196, yy + (512 - 196) * 0.028, 452, yy + 14, 3, PAGE_SHADE, 0.30);
  thickLine(572, yy + 14, 812, yy + (812 - 512) * 0.028, 3, PAGE_SHADE, 0.26);
}
// small pop-up paper scenery standing on the pages: two hills + a tiny star
fillPoly([[206, 872], [268, 806], [330, 872]], INK, 0.85);
fillPoly([[214, 868], [268, 814], [322, 868]], PAPER);
fillPoly([[330, 872], [378, 824], [426, 872]], INK, 0.85);
fillPoly([[338, 868], [378, 830], [418, 868]], PAGE_SHADE);
fillPoly([[700, 866], [724, 830], [736, 858], [764, 838], [758, 866]], GOLD, 0.9);

// ---------- coaster ----------
// track path (main line, no loop segment)
const lift = quad([238, 668], [330, 545], [430, 470], 16);
const descent = quad([430, 470], [505, 492], [560, 560], 10);
const mid = quad([560, 560], [625, 528], [700, 520], 8);
const dive = quad([700, 520], [840, 570], [988, 802], 18);
const trackPts = [...lift, ...descent.slice(1), ...mid.slice(1), ...dive.slice(1)];

// trestle supports: short A-frame posts from the track down to the page's
// top surface line (the pop-up base) — short, sparse, triangular.
function pageY(x: number): number {
  return x < 512 ? 659 + (x - 155) * 0.10 : 695 - (x - 512) * 0.135;
}
const supportXs = [285, 392, 468, 585, 700];
for (const sx of supportXs) {
  let best = trackPts[0], bd = 1e9;
  for (const p of trackPts) { const d = Math.abs(p[0] - sx); if (d < bd) { bd = d; best = p; } }
  const by = pageY(sx);
  if (best[1] < by - 14) {
    thickLine(sx - 12, by, sx, best[1] + 4, 7, INK, 0.8);
    thickLine(sx + 12, by, sx, best[1] + 4, 7, INK, 0.8);
    thickLine(sx - 12, by, sx, best[1] + 4, 3.5, PAPER);
    thickLine(sx + 12, by, sx, best[1] + 4, 3.5, PAPER);
    thickLine(sx - 15, by, sx + 15, by, 5, PAPER, 0.95);
  }
}
// the loop's base touches the page directly: one short centre post
thickLine(330, 624, 330, 668, 9, INK, 0.85); thickLine(330, 624, 330, 668, 5.5, PAPER);

// loop-the-loop (left page)
strokeCircle(330, 560, 71, 19, INK);
strokeCircle(330, 560, 71, 12, CRIM);
strokeCircle(330, 560, 71, 4, CRIM_L, 0.8);
// loop ties
for (let i = 0; i < 8; i++) {
  const t = (i / 8) * Math.PI * 2;
  thickLine(330 + 62 * Math.cos(t), 560 + 62 * Math.sin(t), 330 + 80 * Math.cos(t), 560 + 80 * Math.sin(t), 5, PAPER);
}

// main track: ink underlay, crimson rail, highlight
polyline(trackPts, 19, INK);
polyline(trackPts, 12, CRIM);
polyline(trackPts.map((p) => [p[0], p[1] - 3]), 4, CRIM_L, 0.75);
// track ties along dive + lift
for (let i = 2; i < trackPts.length - 1; i += 2) {
  const p = trackPts[i], q = trackPts[i + 1];
  const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2;
  thickLine(p[0] - 13 * Math.cos(ang), p[1] - 13 * Math.sin(ang), p[0] + 13 * Math.cos(ang), p[1] + 13 * Math.sin(ang), 5, PAPER, 0.95);
}
// re-draw rail centre over ties on the dive so ties read as sleepers under rail
const diveRail = dive;
polyline(diveRail, 10, CRIM);
polyline(diveRail.map((p) => [p[0], p[1] - 3]), 3.5, CRIM_L, 0.8);

// gold flag at crest
thickLine(430, 470, 430, 402, 7, INK);
thickLine(430, 470, 430, 402, 3.5, GOLD);
fillPoly([[430, 400], [482, 413], [430, 428]], INK);
fillPoly([[431, 404], [474, 413], [431, 424]], GOLD);
// sparkle burst at crest
for (let i = 0; i < 8; i++) {
  const t = (i / 8) * Math.PI * 2 + 0.4;
  const r1 = 26, r2 = 40 + (i % 2) * 10;
  thickLine(452 + r1 * Math.cos(t), 414 + r1 * Math.sin(t), 452 + r2 * Math.cos(t), 414 + r2 * Math.sin(t), 4, GOLD, 0.85);
}

// ---------- speed streaks (behind train, parallel to dive ~38deg) ----------
const diveDir = [Math.cos(0.66), Math.sin(0.66)];
const perp = [-diveDir[1], diveDir[0]];
const streakBase: number[][] = [[706, 512], [736, 552], [700, 572], [782, 560], [742, 614], [822, 622], [806, 668]];
for (const s of streakBase) {
  const len = 30 + rand() * 28;
  const off = -12 - rand() * 12;
  const cxp = s[0] + perp[0] * off, cyp = s[1] + perp[1] * off;
  thickLine(cxp - diveDir[0] * len, cyp - diveDir[1] * len, cxp, cyp, 3.5 + rand() * 2.5, CREAM, 0.42);
}

// ---------- train cars (back to front) ----------
function rider(cx: number, cy: number, s: number, deg: number, flip: number): void {
  // torso + head + both arms up, as ink silhouette, drawn in car-local space then rotated
  const head = rotPt(cx, cy, 0, -13 * s, deg);
  fillCircle(head[0], head[1], 7.2 * s, SIL);
  const sh = rotPt(cx, cy, 0, -4 * s, deg);
  const hip = rotPt(cx, cy, 0, 9 * s, deg);
  thickLine(sh[0], sh[1], hip[0], hip[1], 9 * s, SIL);
  const a1 = rotPt(cx, cy, -13 * s * flip, -23 * s, deg);
  const a2 = rotPt(cx, cy, 12 * s * flip, -25 * s, deg);
  thickLine(sh[0], sh[1], a1[0], a1[1], 5 * s, SIL);
  thickLine(sh[0], sh[1], a2[0], a2[1], 5 * s, SIL);
  fillCircle(a1[0], a1[1], 2.8 * s, SIL);
  fillCircle(a2[0], a2[1], 2.8 * s, SIL);
}
function car(cx: number, cy: number, deg: number, w: number, h: number, riders: number): void {
  const hw = w / 2, hh = h / 2;
  // shadow / ink outline body
  fillPoly(rotPoly(cx, cy, [[-hw - 4, -hh + 6], [hw + 4, -hh + 6], [hw + 2, hh + 5], [-hw - 2, hh + 5]], deg), INK);
  // body
  fillPoly(rotPoly(cx, cy, [[-hw, -hh + 8], [hw, -hh + 8], [hw - 3, hh], [-hw + 3, hh]], deg), CRIM);
  fillPoly(rotPoly(cx, cy, [[-hw, -hh + 8], [hw, -hh + 8], [hw - 1, -hh + 22], [-hw + 1, -hh + 22]], deg), CRIM_L, 0.55);
  // gold trim stripe
  const g1 = rotPt(cx, cy, -hw + 4, hh - 10, deg), g2 = rotPt(cx, cy, hw - 4, hh - 10, deg);
  thickLine(g1[0], g1[1], g2[0], g2[1], 5, GOLD);
  // nose highlight on leading (downhill) side
  const n1 = rotPt(cx, cy, hw - 2, -hh + 10, deg), n2 = rotPt(cx, cy, hw - 8, hh - 2, deg);
  thickLine(n1[0], n1[1], n2[0], n2[1], 6, GOLD_L, 0.8);
  // wheels
  for (const wx of [-hw + 16, hw - 16]) {
    const wp = rotPt(cx, cy, wx, hh + 3, deg);
    fillCircle(wp[0], wp[1], 10, INK2);
    fillCircle(wp[0], wp[1], 4, GOLD);
  }
  // riders on top: anchored at the top edge so head + raised arms read
  // clearly against the sky, torso just crossing the car's rim.
  for (let i = 0; i < riders; i++) {
    const lx = riders === 1 ? 0 : (i - (riders - 1) / 2) * (w * 0.34);
    const rp = rotPt(cx, cy, lx, -hh + 3, deg);
    rider(rp[0], rp[1], Math.max(0.66, w / 112), deg, i % 2 === 0 ? 1 : -1);
  }
}
car(548, 548, 8, 82, 38, 1);
car(642, 538, -6, 94, 42, 2);
car(742, 578, 26, 112, 48, 2);
car(876, 702, 37, 158, 68, 2);

// burst lines ahead of the front car's nose (about to burst out)
for (let i = 0; i < 7; i++) {
  const t = -0.9 + i * 0.3;
  const bx = 946 + 62 * Math.cos(t + 0.6), by = 756 + 62 * Math.sin(t + 0.6);
  thickLine(946 + 28 * Math.cos(t + 0.6), 756 + 28 * Math.sin(t + 0.6), bx, by, 5, GOLD, 0.9);
}
radialGlow(940, 752, 150, GOLD, 0.18);

// ---------- paper scraps tumbling ----------
const scrapCols: RGB[] = [CREAM, GOLD, CRIM, PAPER, GOLD_L];
const scrapSpots: number[][] = [
  [492, 408], [548, 452], [610, 470], [700, 452], [790, 500], [852, 560],
  [958, 600], [990, 700], [1012, 812], [930, 842], [620, 392], [388, 372], [1014, 470],
];
for (let i = 0; i < scrapSpots.length; i++) {
  const s = scrapSpots[i];
  const sz = 11 + rand() * 15, deg = rand() * 360, col = scrapCols[i % scrapCols.length];
  const local = [[-sz, -sz * 0.62], [sz, -sz * 0.5], [sz * 0.8, sz * 0.62], [-sz * 0.8, sz * 0.55]];
  fillPoly(rotPoly(s[0], s[1], local.map((q) => [q[0] * 1.18, q[1] * 1.18]), deg), INK, 0.9);
  fillPoly(rotPoly(s[0], s[1], local, deg), col);
  if (i % 3 === 0) {
    const f = rotPoly(s[0], s[1], [[0, -sz * 0.62], [sz, -sz * 0.5], [0, 0]], deg);
    fillPoly(f, PAGE_SHADE, 0.7);
  }
}

// ---------- cat: startled witness leaping off the right edge ----------
{
  const cx = 932, cy = 548;
  // tail (curved, arched high)
  const tail = quad([cx - 52, cy - 6], [cx - 88, cy - 52], [cx - 62, cy - 86], 10);
  polyline(tail, 13, INK2);
  polyline(tail, 13, INK2);
  // back legs trailing
  thickLine(cx - 44, cy + 12, cx - 82, cy + 30, 13, INK2);
  thickLine(cx - 38, cy + 18, cx - 66, cy + 48, 13, INK2);
  // body, arched
  fillEllipse(cx, cy, 58, 24, -16, INK2);
  fillEllipse(cx - 4, cy - 8, 48, 17, -16, INK2);
  // front legs reaching forward/down
  thickLine(cx + 44, cy + 8, cx + 80, cy + 22, 13, INK2);
  thickLine(cx + 38, cy + 16, cx + 66, cy + 42, 13, INK2);
  // head
  fillCircle(cx + 58, cy - 20, 21, INK2);
  // ears
  fillPoly([[cx + 44, cy - 36], [cx + 48, cy - 56], [cx + 58, cy - 40]], INK2);
  fillPoly([[cx + 60, cy - 40], [cx + 70, cy - 58], [cx + 76, cy - 38]], INK2);
  // startled eye (single gold dot)
  fillCircle(cx + 66, cy - 22, 3.2, GOLD_L);
}

// vignette corners
radialGlow(0, 0, 420, INK2, 0.20);
radialGlow(1024, 0, 420, INK2, 0.20);
radialGlow(1024, 1024, 460, INK2, 0.22);
radialGlow(0, 1024, 460, INK2, 0.18);

// ================= downscale x2 + subtle grain =================
const OW = 1024;
const out = new Uint8Array(OW * OW * 3);
const grainRand = mulberry32(777);
const blockNoise: number[] = [];
for (let i = 0; i < 256 * 256; i++) blockNoise.push(Math.round((grainRand() - 0.5) * 7));
for (let y = 0; y < OW; y++) for (let x = 0; x < OW; x++) {
  let r = 0, g = 0, b = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const i = ((y * 2 + dy) * SS + (x * 2 + dx)) * 3;
    r += fb[i]; g += fb[i + 1]; b += fb[i + 2];
  }
  const n = blockNoise[(y >> 2) * 256 + (x >> 2)];
  const o = (y * OW + x) * 3;
  out[o] = Math.max(0, Math.min(255, Math.round(r / 4) + n));
  out[o + 1] = Math.max(0, Math.min(255, Math.round(g / 4) + n));
  out[o + 2] = Math.max(0, Math.min(255, Math.round(b / 4) + n));
}
// sparse speckle grain
for (let i = 0; i < 2600; i++) {
  const x = Math.floor(grainRand() * OW), y = Math.floor(grainRand() * OW);
  const o = (y * OW + x) * 3, d = grainRand() > 0.5 ? 9 : -9;
  out[o] = Math.max(0, Math.min(255, out[o] + d));
  out[o + 1] = Math.max(0, Math.min(255, out[o + 1] + d));
  out[o + 2] = Math.max(0, Math.min(255, out[o + 2] + d));
}

// ================= PNG encoder =================
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable.push(c >>> 0);
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OW, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(OW * (OW * 3 + 1));
for (let y = 0; y < OW; y++) {
  raw[y * (OW * 3 + 1)] = 0;
  Buffer.from(out.buffer, y * OW * 3, OW * 3).copy(raw, y * (OW * 3 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
console.log("wrote", join(outDir, "entry.png"), png.length, "bytes");
