#!/usr/bin/env node
// Walk Figma node tree → produce structured spec.md with concrete dimensions/colors/typography
// for AI code generation. Includes Codepresso SCSS token mapping.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIGMA_DATA = resolve(__dirname, "..", "figma-data");

// Codepresso SCSS color tokens (from _variables.scss)
const COLOR_MAP = {
  "1A61EA": "$color-main",
  "1B5EE0": "$color-main-d",
  "356DDE": "$color-sub-blue",
  "4269B8": "$color-info-txt-blue",
  "467DE8": "$color-txt-learning",
  "7E4CE0": "$color-txt-practicing",
  "BF4747": "$color-txt-no",
  "CC7E00": "$color-status-yellow",
  "0F7D68": "$color-status-green",
  "B83333": "$color-status-red",
  "399E6F": "$color-status-d-green",
  "6193F8": "$color-status-d-blue",
  "FFFFFF": "$color-white",
  "000000": "$color-black",
  "04091A": "$color-bg-d-1",
  "EAECF3": "$color-bg-l-1",
  "F3F4FD": "$color-bg-l-2",
  "FAFBFF": "$color-bg-lg-1",
  "313440": "$color-txt-3",
  "161C33": "$color-txt-d-1",
  "4E5566": "$color-txt-d-2",
  "838B9D": "$color-txt-d-3",
  "9098AA": "$color-txt-d-4",
  "9BA5C2": "$color-txt-l-1",
  "ABB5D1": "$color-txt-l-2",
  "353A4C": "$color-txt-l-3",
  "E7E9EF": "$color-d-txt-1",
  "D3D6E0": "$color-d-txt-2",
  "808BAA": "$color-d-txt-3",
  "D3D7E3": "$color-line-l-2",
  "E3E5F1": "$color-line-l-3",
  "AFB4C4": "$color-line-l-4",
  "09163B": "$color-line-d-3",
  "08154D": "$color-table-d-top",
  "F8F8FE": "$color-table-l-top",
  "C6CCDE": "$color-table-l-line",
  "901010": "$color-label-red",
  "00705A": "$color-label-green",
  "6B7699": "$color-label-gray",
};

function rgbToHex(r, g, b) {
  return [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, "0").toUpperCase()).join("");
}

function fillToToken(fills) {
  if (!fills || !fills.length) return null;
  const f = fills.find(x => x.type === "SOLID" && x.visible !== false);
  if (!f) return null;
  const { r, g, b } = f.color;
  const hex = rgbToHex(r, g, b);
  const a = f.opacity ?? f.color.a ?? 1;
  if (a < 0.99) return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a.toFixed(2)})`;
  return COLOR_MAP[hex] || `#${hex}`;
}

function fontSizeToToken(size) {
  const map = { 10: "$fs-10", 11: "$fs-11", 12: "$fs-12", 13: "$fs-13", 14: "$fs-14", 16: "$fs-16", 18: "$fs-18", 20: "$fs-20", 22: "$fs-22", 24: "$fs-24", 30: "$fs-30", 40: "$fs-40" };
  return map[Math.round(size)] || `${size}px`;
}

function fontWeightToToken(weight) {
  const map = { 400: "$fw-regular", 500: "$fw-medium", 600: "$fw-semibold", 700: "$fw-bold" };
  return map[weight] || weight;
}

function radiusToToken(r) {
  if (!r) return null;
  const map = { 2: "$radius-xs", 4: "$radius-sm", 6: "$radius-md", 8: "$radius-lg", 12: "$radius-xl", 16: "$radius-2xl", 100: "$radius-pill" };
  return map[Math.round(r)] || `${r}px`;
}

function spacingToToken(s) {
  if (s === 0) return "0";
  const map = { 4: "$space-1", 8: "$space-2", 12: "$space-3", 16: "$space-4", 20: "$space-5", 24: "$space-6", 32: "$space-8", 40: "$space-10", 48: "$space-12", 64: "$space-16", 80: "$space-20" };
  return map[Math.round(s)] || `${s}px`;
}

function nodeSpec(node, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return null;
  const out = {
    id: node.id,
    type: node.type,
    name: node.name,
  };
  if (node.absoluteBoundingBox) {
    out.size = { w: Math.round(node.absoluteBoundingBox.width), h: Math.round(node.absoluteBoundingBox.height) };
  }
  if (node.layoutMode) {
    out.layout = node.layoutMode; // VERTICAL / HORIZONTAL
    out.gap = spacingToToken(node.itemSpacing);
  }
  if (node.paddingTop !== undefined || node.paddingLeft !== undefined) {
    out.padding = {
      t: spacingToToken(node.paddingTop || 0),
      r: spacingToToken(node.paddingRight || 0),
      b: spacingToToken(node.paddingBottom || 0),
      l: spacingToToken(node.paddingLeft || 0),
    };
  }
  if (node.fills) {
    const token = fillToToken(node.fills);
    if (token) out.fill = token;
  }
  if (node.strokes && node.strokes.length) {
    const token = fillToToken(node.strokes);
    if (token) out.stroke = { color: token, weight: node.strokeWeight || 1 };
  }
  if (node.cornerRadius) out.radius = radiusToToken(node.cornerRadius);
  if (node.rectangleCornerRadii) {
    out.radius = node.rectangleCornerRadii.map(r => radiusToToken(r)).join(" ");
  }
  if (node.style) {
    out.text = {
      fontSize: fontSizeToToken(node.style.fontSize),
      fontWeight: fontWeightToToken(node.style.fontWeight),
      lineHeight: node.style.lineHeightPx ? `${Math.round(node.style.lineHeightPx)}px` : null,
      letterSpacing: node.style.letterSpacing ? `${node.style.letterSpacing.toFixed(2)}px` : null,
    };
  }
  if (node.characters) out.text_content = node.characters.slice(0, 80);
  if (node.componentId) out.component_ref = node.componentId;
  if (node.children && depth < maxDepth) {
    out.children = node.children.map(c => nodeSpec(c, depth + 1, maxDepth)).filter(Boolean);
  }
  return out;
}

function specToMarkdown(spec, depth = 0) {
  if (!spec) return "";
  const indent = "  ".repeat(depth);
  const lines = [];
  const head = `${spec.type} "${spec.name}"`;
  const meta = [];
  if (spec.size) meta.push(`${spec.size.w}×${spec.size.h}`);
  if (spec.layout) meta.push(`layout: ${spec.layout} gap=${spec.gap}`);
  if (spec.padding) meta.push(`pad: ${spec.padding.t}/${spec.padding.r}/${spec.padding.b}/${spec.padding.l}`);
  if (spec.fill) meta.push(`bg: ${spec.fill}`);
  if (spec.stroke) meta.push(`border: ${spec.stroke.weight}px ${spec.stroke.color}`);
  if (spec.radius) meta.push(`radius: ${spec.radius}`);
  if (spec.text) meta.push(`text: ${spec.text.fontSize}/${spec.text.fontWeight} lh:${spec.text.lineHeight}`);
  if (spec.text_content) meta.push(`"${spec.text_content}"`);
  if (spec.component_ref) meta.push(`📦 component`);
  lines.push(`${indent}- ${head} — ${meta.join(", ")}`);
  if (spec.children) {
    for (const c of spec.children) lines.push(specToMarkdown(c, depth + 1));
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const nodeFile = args.find(a => !a.startsWith("--")) || "node-742-61024.json";
  const data = JSON.parse(await fs.readFile(resolve(FIGMA_DATA, nodeFile), "utf-8"));
  const nodes = data.nodes || {};
  const lines = ["# Figma Spec (auto-generated)\n"];
  for (const [id, node] of Object.entries(nodes)) {
    const doc = node.document;
    const spec = nodeSpec(doc);
    lines.push(`## Node ${id} — ${doc.name}\n`);
    lines.push("```");
    lines.push(specToMarkdown(spec));
    lines.push("```\n");
    // Also save raw JSON
    await fs.writeFile(resolve(FIGMA_DATA, `spec-${id.replace(":", "-")}.json`), JSON.stringify(spec, null, 2));
  }
  const out = resolve(FIGMA_DATA, "spec.md");
  await fs.writeFile(out, lines.join("\n"));
  console.log(`Written: ${out}`);
  console.log(`Lines: ${lines.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
