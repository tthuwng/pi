import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

function readPackageFile(relativePath) {
  return readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

function readRepoFile(relativePath) {
  return readFileSync(
    new URL(`../../../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

test("root prompt keeps sectioned-swarm details in the pi-subagents skill", () => {
  const rootAgents = readRepoFile("AGENTS.md");

  assert.match(rootAgents, /sectioned swarms/i);
  assert.match(
    rootAgents,
    /packages\/pi-subagents\/skills\/pi-subagents\/SKILL\.md/,
  );
  assert.match(rootAgents, /no-edit\/no-artifact\/no-live/i);
  assert.match(rootAgents, /async: false/i);
});

test("pi-subagents skill owns sectioned swarm routing protocol", () => {
  const skill = readPackageFile("skills/pi-subagents/SKILL.md");

  assert.match(skill, /Sectioned swarm protocol/i);
  assert.match(skill, /ordinary factual/i);
  assert.match(skill, /tiny/i);
  assert.match(skill, /one bounded review concern/i);
  assert.match(skill, /second targeted swarm/i);
  assert.match(skill, /smallest recipe-specific fanout/i);
  assert.match(skill, /three reviewers/i);
  assert.match(skill, /four or five/i);
  assert.match(skill, /six to nine/i);
  assert.match(skill, /12\+ children/i);
  assert.match(skill, /Group children by independent concern/i);
  assert.match(skill, /read-only|advisory/i);
  assert.match(skill, /private MCP/i);
  assert.match(skill, /cloud|database|live/i);
  assert.match(skill, /parent.*synthesis|synthesis.*parent/i);
  assert.match(skill, /set `async: false` explicitly/i);
  assert.match(skill, /unresolved material async work.*INCONCLUSIVE/i);
  assert.match(skill, /Observed user-language swarm triggers/i);
  assert.match(skill, /spawn many subagnets/i);
  assert.match(skill, /review with fresh eyes/i);
  assert.match(skill, /go through all edge cases/i);
});

test("recipe prompts point to sectioned swarm protocol without replacing their local contracts", () => {
  const parallelReview = readPackageFile("prompts/parallel-review.md");
  const qualityGate = readPackageFile("prompts/quality-gate.md");
  const generateFilter = readPackageFile("prompts/generate-filter.md");
  const researchDecision = readPackageFile("prompts/research-decision.md");
  const parallelContextBuild = readPackageFile(
    "prompts/parallel-context-build.md",
  );

  assert.match(parallelReview, /sectioned-swarm protocol/i);
  assert.match(parallelReview, /distinct adversarial angle/i);
  assert.match(parallelReview, /`async: false`/i);
  assert.match(parallelReview, /Reviewers must not edit files/i);
  assert.match(parallelReview, /synthesize the feedback/i);
  assert.match(parallelReview, /already approved implementation workflow/i);
  assert.match(parallelReview, /apply only fixes worth doing now/i);

  assert.match(qualityGate, /PASS \| FAIL \| INCONCLUSIVE/);
  assert.match(qualityGate, /sectioned-swarm protocol/i);
  assert.match(qualityGate, /async: false/);
  assert.match(qualityGate, /missing evidence|INCONCLUSIVE/i);
  assert.match(qualityGate, /parent synthesis is mandatory/i);
  assert.match(qualityGate, /review and synthesis only/i);
  assert.match(qualityGate, /Do not edit files/i);

  assert.match(generateFilter, /delegate` or `researcher` children/i);
  assert.match(generateFilter, /reviewer\/filter pass/i);
  assert.match(generateFilter, /reviewer\/filter fan-in is mandatory/i);
  assert.match(generateFilter, /async: false/);
  assert.match(generateFilter, /blocked or `INCONCLUSIVE`/i);
  assert.match(generateFilter, /shortlist|shortlisted/i);
  assert.match(generateFilter, /sectioned-swarm protocol/i);
  assert.doesNotMatch(generateFilter, /unless the parent/i);

  assert.match(researchDecision, /async: false/);

  for (const prompt of [
    parallelReview,
    qualityGate,
    generateFilter,
    researchDecision,
  ]) {
    assert.match(prompt, /no repo artifacts[\s\S]*artifacts: false/i);
    assert.match(prompt, /output: false/i);
    assert.match(prompt, /progress: false/i);
  }
  for (const prompt of [qualityGate, generateFilter, researchDecision]) {
    assert.doesNotMatch(
      prompt,
      /context: "fresh",\n\s+async: false,\n\s+artifacts: false,/,
    );
  }
  assert.match(parallelContextBuild, /strict no-artifact/i);
  assert.match(parallelContextBuild, /parent-only/i);
  assert.match(parallelContextBuild, /artifacts: false/i);
});

test("no-artifact constraints override swarm routing contracts", () => {
  const skill = readPackageFile("skills/pi-subagents/SKILL.md");

  assert.match(skill, /strict no-artifact/i);
  assert.match(skill, /no files/i);
  assert.match(skill, /inline only/i);
  assert.match(skill, /no subagents/i);
  assert.match(skill, /no repo artifacts/i);
  assert.match(skill, /artifacts: false/i);
  assert.match(skill, /output: false/i);
  assert.match(skill, /progress: false/i);
  assert.match(skill, /parallel-context-build/i);
  assert.match(skill, /block-or-ask|parent-only/i);
});

test("live-failure guardrails are explicit in pi-subagents skill", () => {
  const skill = readPackageFile("skills/pi-subagents/SKILL.md");

  assert.match(skill, /compare everything/i);
  assert.match(skill, /help me decide/i);
  assert.match(skill, /explain the options better[\s\S]*brainstorming/i);
  assert.match(skill, /research-decision/i);
  assert.match(skill, /do not interpret requested numbers literally/i);
  assert.match(skill, /spawn 20.*never launch 20/i);
  assert.match(skill, /compare everything between named targets/i);
  assert.match(skill, /do the checks again.*compare everything/i);
  assert.match(skill, /missing private.*target.*before.*subagents/i);
  assert.match(skill, /parallel writer.*block.*before.*child/i);
  assert.match(skill, /block directly.*do not launch.*reviewers/i);
  assert.match(skill, /launch sectioned workers to edit.*blocked directly/i);
});

test("user-language swarm corpus distinguishes strict and repo-artifact constraints", () => {
  const cases = JSON.parse(
    readPackageFile("test/nl-routing/user-language-swarm-cases.json"),
  );
  const subagentRoutes = new Set([
    "parallel-review",
    "quality-gate",
    "proposal-gate",
    "generate-filter",
    "research-decision",
    "parallel-context-build",
    "review-feedback",
  ]);

  assert.ok(
    cases.some(
      (testCase) =>
        /do not write artifacts|no files|inline only/i.test(testCase.prompt) &&
        testCase.expected?.route === "block-or-ask",
    ),
    "strict no-artifact wording must have a blocking case",
  );

  for (const testCase of cases) {
    if (!subagentRoutes.has(testCase.expected?.route)) continue;
    assert.doesNotMatch(
      testCase.prompt,
      /do not write artifacts|no files|inline only/i,
      `${testCase.name} expects subagents, so it must not use strict no-artifact wording`,
    );
    assert.match(
      testCase.prompt,
      /do not write repo artifacts|no repo artifacts|no project artifacts|don't write \.scratch files/i,
      `${testCase.name} must use repo-artifact wording when it expects subagents`,
    );
  }
});

test("all natural-language routing corpora distinguish strict and repo-artifact constraints", () => {
  const corpusDir = new URL("../nl-routing/", import.meta.url);
  const corpusFiles = readdirSync(corpusDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const strictNoArtifact = /do not write artifacts|no files|inline only/i;
  const repoNoArtifact =
    /do not write repo artifacts|no repo artifacts|no project artifacts|don't write \.scratch files/i;
  const directOrBlock = /direct|block|ask|small check then stop/i;

  for (const fileName of corpusFiles) {
    const cases = JSON.parse(
      readFileSync(new URL(fileName, corpusDir), "utf8"),
    );
    for (const testCase of cases) {
      const route = String(testCase.expected?.route ?? "");
      if (directOrBlock.test(route)) continue;
      if (
        !route &&
        /do not launch subagents|tiny|one-line/i.test(testCase.prompt)
      ) {
        continue;
      }
      assert.doesNotMatch(
        testCase.prompt,
        strictNoArtifact,
        `${fileName} ${testCase.name} expects subagents, so it must not use strict no-artifact wording`,
      );
      assert.match(
        testCase.prompt,
        repoNoArtifact,
        `${fileName} ${testCase.name} must use repo-artifact wording when it expects subagents`,
      );
    }
  }
});

test("proposal and sectioned corpora keep strict no-artifact controls", () => {
  const strictNoArtifact = /do not write artifacts|no files|inline only/i;

  const proposalCases = JSON.parse(
    readPackageFile("test/nl-routing/proposal-verification-cases.json"),
  );
  const proposalByName = new Map(
    proposalCases.map((testCase) => [testCase.name, testCase]),
  );
  for (const name of ["07-tiny-review-control", "08-tiny-options-control"]) {
    assert.match(
      proposalByName.get(name)?.prompt ?? "",
      strictNoArtifact,
      `${name} must stay strict no-artifact/no-subagent control`,
    );
    assert.match(
      proposalByName.get(name)?.prompt ?? "",
      /do not launch subagents|tiny|one-line/i,
      `${name} must remain a direct no-subagent control`,
    );
  }

  const sectionedCases = JSON.parse(
    readPackageFile("test/nl-routing/sectioned-swarm-cases.json"),
  );
  const sectionedByName = new Map(
    sectionedCases.map((testCase) => [testCase.name, testCase]),
  );
  for (const name of [
    "02-tiny-wording-direct",
    "06-pass-stop-no-extra-swarm",
    "08-missing-target-block",
  ]) {
    assert.match(
      sectionedByName.get(name)?.prompt ?? "",
      strictNoArtifact,
      `${name} must stay strict no-artifact control`,
    );
    assert.match(
      String(sectionedByName.get(name)?.expected?.route ?? ""),
      /direct|block|ask|small check then stop/i,
      `${name} must stay direct/blocking rather than subagent-allowing`,
    );
  }
});

test("all natural-language routing corpora stay runnable", () => {
  const corpusDir = new URL("../nl-routing/", import.meta.url);
  const corpusFiles = readdirSync(corpusDir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  assert.ok(
    corpusFiles.length >= 2,
    "expected proposal and sectioned-swarm corpora",
  );

  for (const fileName of corpusFiles) {
    const cases = JSON.parse(
      readFileSync(new URL(fileName, corpusDir), "utf8"),
    );
    assert.equal(Array.isArray(cases), true, `${fileName} must be an array`);
    assert.ok(cases.length > 0, `${fileName} must not be empty`);

    for (const testCase of cases) {
      assert.equal(typeof testCase.name, "string", `${fileName} case name`);
      assert.match(
        testCase.name,
        /^\d{2}-/,
        `${fileName} case ${testCase.name} must be ordered`,
      );
      assert.equal(
        typeof testCase.prompt,
        "string",
        `${fileName} case ${testCase.name} prompt`,
      );
      assert.match(
        testCase.prompt,
        /Do not edit files/,
        `${fileName} case ${testCase.name} must be read-only`,
      );
      assert.equal(
        testCase.thinking,
        "low",
        `${fileName} case ${testCase.name} thinking`,
      );
      if (testCase.expected !== undefined) {
        assert.equal(
          typeof testCase.expected,
          "object",
          `${fileName} case ${testCase.name} expected`,
        );
      }
    }
  }
});

test("user-language swarm corpus captures observed trigger phrasing", () => {
  const cases = JSON.parse(
    readPackageFile("test/nl-routing/user-language-swarm-cases.json"),
  );
  const byName = new Map(cases.map((testCase) => [testCase.name, testCase]));

  assert.ok(cases.length >= 30, "expected many observed-language cases");
  assert.ok(
    cases.some((testCase) =>
      /subagnets|subgantes|usabgnets/i.test(testCase.prompt),
    ),
    "expected typo-heavy subagent phrasing",
  );
  assert.ok(
    cases.some((testCase) => /fresh eyes/i.test(testCase.prompt)),
    "expected fresh-eyes review phrasing",
  );
  assert.ok(
    cases.some((testCase) =>
      /all edge cases|ALL flows|all possible flows/i.test(testCase.prompt),
    ),
    "expected exhaustive-flow phrasing",
  );

  const expectedRoutes = new Set(
    cases.map((testCase) => testCase.expected.route),
  );
  for (const route of [
    "parallel-review",
    "review",
    "quality-gate",
    "proposal-gate",
    "generate-filter",
    "research-decision",
    "brainstorming",
    "parallel-context-build",
    "review-feedback",
    "direct",
    "block-or-ask",
  ]) {
    assert.ok(expectedRoutes.has(route), `missing route ${route}`);
  }

  assert.match(byName.get("01-review-please").prompt, /review please/i);
  assert.equal(
    byName.get("01-review-please").expected.route,
    "parallel-review",
  );
  assert.match(
    byName.get("06-spawn-many-subagnets").prompt,
    /spawn many subagnets/i,
  );
  assert.equal(
    byName.get("06-spawn-many-subagnets").expected.route,
    "parallel-review",
  );
  assert.match(byName.get("13-give-ideas-first").prompt, /give you ideas/i);
  assert.equal(
    byName.get("13-give-ideas-first").expected.route,
    "generate-filter",
  );
  assert.match(
    byName.get("25-throughout-my-pi-usage").prompt,
    /throughout my pi usage/i,
  );
  assert.equal(
    byName.get("25-throughout-my-pi-usage").expected.route,
    "parallel-context-build",
  );
  assert.match(
    byName.get("11-compare-everything").prompt,
    /generate-filter\.md/,
  );
  assert.match(byName.get("11-compare-everything").prompt, /workflows\.ts/);
  assert.equal(byName.get("11-compare-everything").expected.route, "review");
  assert.equal(
    byName.get("16-explain-options-better").expected.route,
    "brainstorming",
  );
  assert.equal(byName.get("20-fix-review-loop").expected.route, "block-or-ask");
  assert.match(
    byName.get("20-fix-review-loop").expected.must,
    /edit authorization/i,
  );
  assert.equal(
    byName.get("28-go-through-each-benchamr").expected.route,
    "direct",
  );
  assert.match(
    byName.get("28-go-through-each-benchamr").expected.must,
    /bounded lookup/i,
  );
  assert.equal(
    byName.get("29-private-thread-block").expected.route,
    "block-or-ask",
  );
  assert.match(
    byName.get("29-private-thread-block").expected.must,
    /exact target/i,
  );
  assert.equal(
    byName.get("30-parallel-writers-refuse").expected.route,
    "block-or-ask",
  );
  assert.match(
    byName.get("30-parallel-writers-refuse").expected.must,
    /parallel writers/i,
  );
  assert.match(byName.get("31-tiny-one-sentence").prompt, /one sentence/i);
  assert.equal(byName.get("31-tiny-one-sentence").expected.route, "direct");
});

test("sectioned-swarm corpus covers required semantic routing expectations", () => {
  const cases = JSON.parse(
    readPackageFile("test/nl-routing/sectioned-swarm-cases.json"),
  );

  const byName = new Map(cases.map((testCase) => [testCase.name, testCase]));

  assert.deepEqual(
    [...byName.keys()],
    [
      "01-review-feedback-swarm",
      "02-tiny-wording-direct",
      "03-proposal-before-files",
      "04-generate-filter-required",
      "05-second-swarm-allowed",
      "06-pass-stop-no-extra-swarm",
      "07-file-first-quality-gate",
      "08-missing-target-block",
      "09-second-swarm-required",
    ],
  );

  assert.match(
    byName.get("01-review-feedback-swarm").expected.route,
    /review/i,
  );
  assert.match(
    byName.get("01-review-feedback-swarm").expected.mustNot,
    /write/i,
  );
  assert.equal(byName.get("02-tiny-wording-direct").expected.route, "direct");
  assert.match(
    byName.get("02-tiny-wording-direct").expected.mustNot,
    /subagent/i,
  );
  assert.match(
    byName.get("03-proposal-before-files").expected.route,
    /proposal gate/i,
  );
  assert.equal(
    byName.get("04-generate-filter-required").expected.route,
    "generate-filter",
  );
  assert.match(
    byName.get("04-generate-filter-required").expected.must,
    /filter\/fan-in/i,
  );
  assert.match(
    byName.get("05-second-swarm-allowed").expected.route,
    /when warranted/i,
  );
  assert.match(
    byName.get("06-pass-stop-no-extra-swarm").expected.route,
    /stop on pass/i,
  );
  assert.match(
    byName.get("07-file-first-quality-gate").expected.route,
    /hydrate target/i,
  );
  assert.match(
    byName.get("08-missing-target-block").expected.route,
    /block|ask/i,
  );
  assert.match(
    byName.get("08-missing-target-block").expected.mustNot,
    /blind swarm/i,
  );
  assert.match(
    byName.get("09-second-swarm-required").expected.route,
    /second targeted/i,
  );
  assert.match(
    byName.get("09-second-swarm-required").expected.must,
    /resolve disagreement/i,
  );
});
