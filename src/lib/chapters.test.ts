import assert from "node:assert/strict";
import test from "node:test";
import { countWords, splitIntoChapters } from "./chapters";

function para(words: number, seed = "word") {
  return Array.from({ length: words }, (_, i) => `${seed}${i}`).join(" ");
}

test("keeps existing chapters and does not tear a section across units", () => {
  const text = [
    "Chapter 1 — Arrival",
    "",
    "Section 1 — Harbor",
    "",
    para(200, "harbor"),
    "",
    "Section 2 — Lanterns",
    "",
    para(200, "lantern"),
    "",
    "Section 3 — Fog",
    "",
    para(200, "fog"),
    "",
    "Section 4 — Tide",
    "",
    para(200, "tide"),
    "",
    "Section 5 — Letters",
    "",
    para(200, "letter"),
    "",
    "Chapter 2 — Departure",
    "",
    "Section 1 — Ticket",
    "",
    para(180, "ticket"),
    "",
    "Section 2 — Wake",
    "",
    para(180, "wake"),
  ].join("\n");

  const units = splitIntoChapters(text);
  assert.ok(units.length >= 3, "long chapter 1 should pack into multiple reading units");

  const chapter1 = units.filter((u) => u.groupIndex === 1);
  const chapter2 = units.filter((u) => u.groupIndex === 2);
  assert.ok(chapter1.length >= 2);
  assert.equal(chapter2.length, 1);

  // Every named section heading appears in exactly one unit (not split across two).
  for (const marker of [
    "Section 1 — Harbor",
    "Section 2 — Lanterns",
    "Section 3 — Fog",
    "Section 4 — Tide",
    "Section 5 — Letters",
  ]) {
    const hits = units.filter((u) => u.content.includes(marker));
    assert.equal(hits.length, 1, `${marker} should stay in one reading unit`);
  }

  // Free preview group covers all of logical chapter 1.
  assert.ok(chapter1.every((u) => u.groupIndex === 1));
});

test("oversized section splits on paragraph boundaries only", () => {
  const uniqueA = "ALPHA_UNIQUE_MARKER " + para(500, "alpha");
  const uniqueB = "BETA_UNIQUE_MARKER " + para(500, "beta");
  const uniqueC = "GAMMA_UNIQUE_MARKER " + para(500, "gamma");

  const text = [
    "Chapter 1 — Long Form",
    "",
    "Section 1 — Dense",
    "",
    uniqueA,
    "",
    uniqueB,
    "",
    uniqueC,
  ].join("\n");

  const units = splitIntoChapters(text);
  assert.ok(units.length >= 2);

  for (const marker of ["ALPHA_UNIQUE_MARKER", "BETA_UNIQUE_MARKER", "GAMMA_UNIQUE_MARKER"]) {
    const hits = units.filter((u) => u.content.includes(marker));
    assert.equal(hits.length, 1, `${marker} paragraph must not be torn`);
  }

  assert.ok(units.every((u) => u.groupIndex === 1));
  assert.ok(units.every((u) => countWords(u.content) > 0));
});

test("numbered headings without Chapter keyword become logical chapters", () => {
  const text = [
    "1. Beginnings",
    "",
    para(120, "begin"),
    "",
    "2. Middles",
    "",
    para(120, "middle"),
    "",
    "3. Endings",
    "",
    para(120, "end"),
  ].join("\n");

  const units = splitIntoChapters(text);
  assert.equal(units.length, 3);
  assert.deepEqual(
    units.map((u) => u.groupIndex),
    [1, 2, 3]
  );
  assert.match(units[0].title, /Beginnings/);
});
