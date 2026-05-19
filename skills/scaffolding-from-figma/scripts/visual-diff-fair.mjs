#!/usr/bin/env node
// Compute real pixel-level visual diff between Human reference and AI fair renders.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "node:fs/promises";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES = resolve(__dirname, "..", "samples");
const RESULTS = resolve(__dirname, "..", "results");

async function loadPng(p) {
  const buf = await fs.readFile(p);
  return PNG.sync.read(buf);
}

async function resizeToMatch(a, b) {
  // Simple: pad smaller to bigger with white
  const W = Math.max(a.width, b.width);
  const H = Math.max(a.height, b.height);
  function pad(p) {
    if (p.width === W && p.height === H) return p;
    const out = new PNG({ width: W, height: H });
    out.data.fill(255);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const sIdx = (y * p.width + x) * 4;
        const dIdx = (y * W + x) * 4;
        out.data[dIdx] = p.data[sIdx];
        out.data[dIdx + 1] = p.data[sIdx + 1];
        out.data[dIdx + 2] = p.data[sIdx + 2];
        out.data[dIdx + 3] = p.data[sIdx + 3];
      }
    }
    return out;
  }
  return [pad(a), pad(b)];
}

async function diff(humanPath, aiPath, outPath) {
  const [a, b] = await resizeToMatch(await loadPng(humanPath), await loadPng(aiPath));
  const out = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, out.data, a.width, a.height, {
    threshold: 0.1,
    includeAA: true,
    alpha: 0.5,
    aaColor: [255, 255, 0],
    diffColor: [255, 0, 0],
  });
  await fs.writeFile(outPath, PNG.sync.write(out));
  const total = a.width * a.height;
  return {
    width: a.width,
    height: a.height,
    total_pixels: total,
    mismatched_pixels: mismatched,
    error_rate_pct: Math.round((mismatched / total) * 10000) / 100,
    match_rate_pct: Math.round(((total - mismatched) / total) * 10000) / 100,
  };
}

async function main() {
  const results = {};
  for (const lvl of ["high", "mid", "low"]) {
    const h = resolve(SAMPLES, lvl, "reference", "screen-1920x1080.png");
    const a = resolve(SAMPLES, lvl, "ai", "render-final-1920x1080.png");
    const out = resolve(RESULTS, `visual-diff-${lvl}.png`);
    const r = await diff(h, a, out);
    results[lvl] = r;
    console.log(`[${lvl}] error: ${r.error_rate_pct}% (${r.mismatched_pixels.toLocaleString()} / ${r.total_pixels.toLocaleString()})`);
  }
  await fs.writeFile(resolve(RESULTS, "visual-diff.json"), JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
