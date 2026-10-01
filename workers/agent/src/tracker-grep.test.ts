import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfig } from "./config";
import { getTemplateFiles } from "./template";

// #93: every agent-built game's deploy.yml grepped web/src for bare words like
// `segment` and `amplitude`, so any snake game (segments) or audio/physics
// code (amplitude) failed the compliance job and never deployed. These run the
// workflow step's real shell against fixture game code.

/** The exact shell of the workflow's "No tracking SDKs in source" step. */
function trackerStepScript(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l.includes("- name: No tracking SDKs in source"));
  if (start < 0) throw new Error("tracker step not found");
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  const indent = (l: string) => l.length - l.trimStart().length;
  const base = indent(lines[runAt]!);
  const body: string[] = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() && indent(l) <= base) break;
    body.push(l);
  }
  const strip = Math.min(...body.filter((l) => l.trim()).map(indent));
  return body.map((l) => l.slice(strip)).join("\n");
}

/** Run the step in a temp game repo whose web/src/game.ts is `source`. */
function runStep(yaml: string, source: string): number {
  const dir = mkdtempSync(join(tmpdir(), "tracker-step-"));
  try {
    mkdirSync(join(dir, "web", "src"), { recursive: true });
    writeFileSync(join(dir, "web", "src", "game.ts"), source);
    writeFileSync(join(dir, "step.sh"), trackerStepScript(yaml));
    return spawnSync("bash", ["step.sh"], { cwd: dir, encoding: "utf8" }).status ?? -1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAN: Record<string, string> = {
  "snake segments": "const segments: Segment[] = []; function growSegment(s: Segment) { segments.push(s); }",
  "line-segment collision": "export function collideSegment(a: Vec, b: Vec) { return segmentIntersect(a, b); }",
  "audio amplitude": "osc.frequency.value = 440; const amplitude = 0.3; gain.gain.value = amplitude * envelope;",
  "wave amplitude field": "const wave = { amplitude: 12, period: 2 }; y = wave.amplitude * Math.sin(t);",
  "segmentation word": "// image segmentation step for the puzzle board",
};

const TRACKERS: Record<string, string> = {
  "Amplitude SDK import": "import * as amplitude from '@amplitude/analytics-browser';",
  "Amplitude init call": "amplitude.init('API_KEY');",
  "Segment track call": "window.analytics.track('level_complete');",
  "Segment browser SDK": "AnalyticsBrowser.load({ writeKey: 'x' });",
  "Segment CDN": "s.src = 'https://cdn.segment.com/analytics.js/v1/x/analytics.min.js';",
  "GA gtag call": "gtag('config', 'G-XXXX');",
  Mixpanel: "import mixpanel from 'mixpanel-browser';",
  PostHog: "posthog.init('phc_x');",
  Hotjar: "window.hotjar = window.hotjar || {};",
};

const yaml = getTemplateFiles(getConfig("games"))[".github/workflows/deploy.yml"]!;

describe("agent game workflow tracker grep (#93)", () => {
  it.each(Object.entries(CLEAN))("passes ordinary game code: %s", (_label, source) => {
    expect(runStep(yaml, source)).toBe(0);
  });
  it.each(Object.entries(TRACKERS))("still blocks a real tracker: %s", (_label, source) => {
    expect(runStep(yaml, source)).toBe(1);
  });
});
