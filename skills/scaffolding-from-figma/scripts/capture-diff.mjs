#!/usr/bin/env node
// Capture Human + AI pages from local Nuxt dev server with same data,
// then pixel-diff them. This is the truly fair comparison.

import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "..", ".env") });

const LOCAL_BASE = process.env.LOCAL_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.JWT_TOKEN;
const ASSESSMENT_ID = process.env.ASSESSMENT_ID || "1291";

const TARGETS = [
  {
    name: "human",
    url: `${LOCAL_BASE}/dashboard/proSkillManager/assessment/${ASSESSMENT_ID}`,
  },
  {
    name: "ai-v3",
    url: `${LOCAL_BASE}/playground/ai-v3`,
  },
];

async function capture(browser, target) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  // Use the same JWT cookie for both — local dev still validates against stage API
  await page.setCookie(
    {
      name: "AccessToken",
      value: TOKEN,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "AccessToken",
      value: TOKEN,
      domain: ".codepresso.io",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "Policy",
      value: encodeURIComponent(JSON.stringify({ necessary: true, performance: true })),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
    }
  );

  console.log(`[${target.name}] -> ${target.url}`);
  // First nav with domcontentloaded (faster), then wait for idle
  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 180000 });
    console.log(`  DOM loaded, waiting for network idle...`);
    try {
      await page.waitForNetworkIdle({ idleTime: 3000, timeout: 60000 });
    } catch {}
  } catch (e) {
    console.warn(`  nav warn: ${e.message.split("\n")[0]}`);
  }
  // Wait extra for lazy fetches
  await new Promise(r => setTimeout(r, 8000));

  const outDir = resolve(__dirname, "..", "results", "local-capture");
  await fs.mkdir(outDir, { recursive: true });
  const png1080 = resolve(outDir, `${target.name}-1920x1080.png`);
  const pngFull = resolve(outDir, `${target.name}-fullpage.png`);
  await page.screenshot({ path: png1080, fullPage: false });
  await page.screenshot({ path: pngFull, fullPage: true });
  console.log(`  saved: ${png1080}`);
  console.log(`  finalUrl: ${page.url()}`);
  await page.close();
  return png1080;
}

async function diff(humanPng, aiPng, outPng) {
  const a = PNG.sync.read(await fs.readFile(humanPng));
  const b = PNG.sync.read(await fs.readFile(aiPng));
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height);
  function pad(p) {
    if (p.width === W && p.height === H) return p;
    const out = new PNG({ width: W, height: H });
    out.data.fill(255);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const s = (y * p.width + x) * 4, d = (y * W + x) * 4;
        out.data[d] = p.data[s]; out.data[d+1] = p.data[s+1];
        out.data[d+2] = p.data[s+2]; out.data[d+3] = p.data[s+3];
      }
    }
    return out;
  }
  const a2 = pad(a), b2 = pad(b);
  const out = new PNG({ width: W, height: H });
  const mismatched = pixelmatch(a2.data, b2.data, out.data, W, H, { threshold: 0.1, diffColor: [255, 0, 0] });
  await fs.writeFile(outPng, PNG.sync.write(out));
  const total = W * H;
  return {
    width: W, height: H, total_pixels: total,
    mismatched_pixels: mismatched,
    error_rate_pct: Math.round((mismatched / total) * 10000) / 100,
    match_rate_pct: Math.round(((total - mismatched) / total) * 10000) / 100,
  };
}

async function main() {
  if (!TOKEN) { console.error("ERR: JWT_TOKEN missing"); process.exit(1); }
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  try {
    const humanPng = await capture(browser, TARGETS[0]);
    const aiPng = await capture(browser, TARGETS[1]);
    const outDir = resolve(__dirname, "..", "results", "local-capture");
    const diffOut = resolve(outDir, "diff.png");
    const result = await diff(humanPng, aiPng, diffOut);
    await fs.writeFile(resolve(outDir, "result.json"), JSON.stringify(result, null, 2));
    console.log("\nResult:", JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
