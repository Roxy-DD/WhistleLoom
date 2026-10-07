/**
 * 让 skill 的参考文档接受同一套回归：文档里写下的数字（时值表、哨笛调、音高与曲速范围、
 * 格式登记表、调式前缀……）必须和 js/ 里的代码一致。
 *
 * 为什么要进测试套件而不是只在需要时手动跑：参考文档是最容易被读、最少被复查的那类文本。
 * 代码改了、文档没跟上，读者拿到的是「看起来权威的错话」——本项目就出现过文档声称某个
 * 记法能识别、实际是静默降级的情况。放进 node --test 之后，它和别的回归一样不会漏。
 *
 * 具体的断言在 .agents/skills/music-to-whistle-score/scripts/check-facts.mjs 里，
 * 这样「手动跑一遍」和「测试跑一遍」是同一份逻辑，不会各说各话。
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(
  ROOT,
  ".agents",
  "skills",
  "music-to-whistle-score",
  "scripts",
  "check-facts.mjs",
);

test("skill 文档里写的数字与行为，和 js/ 里的代码一致", async () => {
  const { runChecks } = await import(pathToFileURL(CHECKER).href);
  const failures = runChecks(ROOT);
  assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}\n`);
});

test("skill 的 ABC 校验脚本可以载入，并且用的是编辑器自己的解析器", async () => {
  const { loadEditor } = await import(
    pathToFileURL(
      path.join(ROOT, ".agents", "skills", "music-to-whistle-score", "scripts", "editor-vm.mjs"),
    ).href
  );
  const editor = loadEditor(ROOT);
  // 不是「能载入就行」——真跑一遍，确认拿到的是真解析器而不是空壳。
  const score = editor.parseAbc("X:1\nT:校验\nM:6/8\nL:1/8\nK:Ddor\nD2 E F2 G | A2 ^c d3 |\n");
  assert.equal(score.tonic, "D");
  assert.equal(score.mode, "dorian");
  assert.equal(score.meter, "6/8");
  assert.equal(score.events.length, 7);
  // 解析器把「改了什么」记在这儿，界面读的就是它。
  assert.ok(Array.isArray(editor.warnings));
});
