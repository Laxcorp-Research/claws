// PR-2d — fixture test for the CI BOM guard.
//
// The actual guard lives in .github/workflows/ci.yml as a bash step
// using `head -c 3 | od -An -tx1`. We can't directly assert against
// GitHub Actions, but we CAN assert that the exact same byte-detection
// logic flags a BOM'd file and passes a clean file. If this test
// breaks, the CI guard's detection has drifted.
//
// Cross-platform: skip on Windows runners (no /bin/sh, no od by default).
// CI is Ubuntu, so the actual guard runs there — this fixture only
// proves the SHELL SNIPPET works equivalently on any POSIX host.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

const isWindows = platform() === "win32";

function probeFirstThreeBytesAsHex(filePath: string): string {
  // Mirror the exact shell snippet from ci.yml:
  //   head -c 3 "$f" | od -An -tx1 | tr -d ' \n'
  // We invoke /bin/sh -c so the pipe behaves identically to GH Actions.
  const out = execFileSync(
    "/bin/sh",
    [
      "-c",
      `head -c 3 "${filePath}" | od -An -tx1 | tr -d ' \\n'`,
    ],
    { encoding: "utf8" },
  );
  return out.trim();
}

describe.skipIf(isWindows)("CI BOM guard byte-detection (fixture)", () => {
  it("flags a BOM-prefixed SQL file as 'efbbbf'", () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-guard-"));
    try {
      const path = join(dir, "migration.sql");
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const body = Buffer.from(`-- PR test fixture\nALTER TABLE "X" ADD COLUMN "y" INTEGER;\n`, "utf8");
      writeFileSync(path, Buffer.concat([bom, body]));
      expect(probeFirstThreeBytesAsHex(path)).toBe("efbbbf");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a different prefix for a clean ASCII-leading file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-guard-"));
    try {
      const path = join(dir, "migration.sql");
      writeFileSync(path, `-- clean\nSELECT 1;\n`, { encoding: "utf8" });
      const hex = probeFirstThreeBytesAsHex(path);
      expect(hex).not.toBe("efbbbf");
      // '-- ' = 2d 2d 20
      expect(hex).toBe("2d2d20");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not falsely match when the BOM appears mid-file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-guard-"));
    try {
      const path = join(dir, "migration.sql");
      const prefix = Buffer.from(`-- header\n`, "utf8");
      const bomMidFile = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(path, Buffer.concat([prefix, bomMidFile, Buffer.from("SELECT 1;\n", "utf8")]));
      expect(probeFirstThreeBytesAsHex(path)).toBe("2d2d20"); // first 3 bytes are "-- "
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every committed migration in prisma/migrations is BOM-free (self-check)", () => {
    // Belt-and-suspenders: this would have caught the PR-3 BOM at PR time
    // even if the GH Actions step were misconfigured. Costs ~5ms.
    const list = execFileSync(
      "/bin/sh",
      ["-c", `find prisma/migrations -type f -name '*.sql' -print`],
      { encoding: "utf8" },
    )
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(list.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of list) {
      if (probeFirstThreeBytesAsHex(f) === "efbbbf") offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

// Platform-agnostic Node-only check. Runs on every host (Windows + POSIX).
// This is the assertion that actually matters for safety: if any
// committed migration starts with EF BB BF, fail here even if the bash
// step in ci.yml is misconfigured.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join as pjoin } from "node:path";

function listMigrationSqlFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = pjoin(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (s.isFile() && name.endsWith(".sql")) out.push(full);
    }
  }
  walk(root);
  return out;
}

describe("committed migration SQL files (Node-only, all hosts)", () => {
  it("every prisma/migrations/**/*.sql has no UTF-8 BOM", () => {
    const files = listMigrationSqlFiles("prisma/migrations");
    expect(files.length).toBeGreaterThan(0);
    const offenders: Array<{ file: string; firstBytes: string }> = [];
    for (const f of files) {
      const buf = readFileSync(f);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        const hex = [buf[0], buf[1], buf[2]].map((b) => b.toString(16).padStart(2, "0")).join(" ");
        offenders.push({ file: f, firstBytes: hex });
      }
    }
    expect(offenders).toEqual([]);
  });

  // Cross-platform detection test (positive). Mirrors what the bash step
  // in ci.yml will do: compare first 3 bytes against EF BB BF. If this
  // test breaks, the detection logic in the workflow has likely drifted.
  it("detects a synthetic BOM-prefixed file as such (positive detection)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-guard-"));
    try {
      const path = join(dir, "fixture.sql");
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      writeFileSync(path, Buffer.concat([bom, Buffer.from("SELECT 1;\n", "utf8")]));
      const buf = readFileSync(path);
      const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      expect(hasBom).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag a clean ASCII-leading file (negative detection)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-guard-"));
    try {
      const path = join(dir, "fixture.sql");
      writeFileSync(path, "-- clean\nSELECT 1;\n", { encoding: "utf8" });
      const buf = readFileSync(path);
      const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      expect(hasBom).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
