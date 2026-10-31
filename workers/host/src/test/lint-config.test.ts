import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// platform#399: this test used to spawn `pnpm lint`. On Windows pnpm is a `.cmd`
// shim, which `spawnSync` cannot start without a shell, so it failed with ENOENT
// before pnpm ran. Biome's bin is a plain Node script, so the test runs it with
// `process.execPath` and works the same on every platform.

const hostDir = fileURLToPath(new URL("../..", import.meta.url));
const biomeBin = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

/** The arguments of the package's `lint` script, e.g. `['lint', 'src/']` for `biome lint src/`. */
function lintScriptArgs(): string[] {
  const pkg = JSON.parse(readFileSync(`${hostDir}package.json`, "utf8")) as {
    scripts: { lint: string };
  };
  const [command, ...args] = pkg.scripts.lint.trim().split(/\s+/);
  expect(command, "the lint script runs biome directly").toBe("biome");
  return args;
}

it("runs the lint script through biome without needing pnpm or a shell", () => {
  expect(lintScriptArgs()).toEqual(["lint", "src/"]);
  const result = spawnSync(process.execPath, [biomeBin, "--version"], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
});

it("lints host source and rejects invalid code rather than ignoring the worker tree", () => {
  const probe = fileURLToPath(new URL(`lint-probe-${randomUUID()}.ts`, import.meta.url));
  const run = () =>
    spawnSync(process.execPath, [biomeBin, ...lintScriptArgs()], {
      cwd: hostDir,
      encoding: "utf8",
      timeout: 20_000,
    });
  try {
    writeFileSync(probe, "const value = 1; console.log(value);\n");
    const good = run();
    expect(good.error).toBeUndefined();
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(good.stdout + good.stderr).toMatch(/Checked [1-9]\d* files?/);
    writeFileSync(probe, "const value = 1; value = 2; console.log(value);\n");
    const bad = run();
    expect(bad.error).toBeUndefined();
    expect(bad.status).not.toBe(0);
    expect(bad.stdout + bad.stderr).toContain("noConstAssign");
  } finally {
    unlinkSync(probe);
  }
}, 60_000);
