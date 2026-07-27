import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/assistant.js", import.meta.url), "utf8");
const context = vm.createContext({
  document: { querySelector: () => null },
  window: {},
  URL
});

vm.runInContext(`${source}
globalThis.testApi = {
  markdownToAssistantHtml,
  stripServiceBlocks
};`, context);

test("ordered lists continue numbering after a paragraph", () => {
  const html = context.testApi.markdownToAssistantHtml(`
## 2. Что сделать прямо сейчас
1. Первое действие
(основание: СП 70)
1. Второе действие
Пояснение между пунктами
1. Третье действие
`);

  assert.match(html, /<ol start="1">/);
  assert.match(html, /<ol start="3">/);
  assert.doesNotMatch(html, /<ol start="2">[\s\S]*<ol start="1">/);
});

test("http links are clickable and unsafe schemes remain text", () => {
  const html = context.testApi.markdownToAssistantHtml(`
## 5. Нормативные основания
- [Официальный источник](https://pravo.gov.ru/)
- [Небезопасная ссылка](javascript:alert(1))
`);

  assert.match(html, /href="https:\/\/pravo\.gov\.ru\/"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("internal verification JSON is removed", () => {
  const cleaned = context.testApi.stripServiceBlocks(`
Публичный ответ
\`\`\`json
{"checked_claims":[],"overall_risk":"medium"}
\`\`\`
`);

  assert.equal(cleaned, "Публичный ответ");
});
