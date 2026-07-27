import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const mockPort = 18181;
const appPort = 18182;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("assistant runs draft and source-grounded verification end to end", async (context) => {
  const citationLabel = "[источник]";
  const verifiedText = [
    "Ответ носит справочный характер и не является юридической консультацией.",
    "## 1. Краткая квалификация ситуации",
    "Требуется фиксация фактов.",
    "## 2. Что сделать прямо сейчас",
    `1. Зафиксировать отклонение (основание: ГК РФ ${citationLabel}).`,
    "## 3. Пошаговый алгоритм",
    "1. Оформить акт (основание требует ручной проверки профильным специалистом).",
    "## 4. Какие документы оформить или запросить",
    "- Проектная документация.",
    "## 5. Нормативные основания",
    "- ГК РФ.",
    "## 6. Риски для участников",
    "- Технический риск.",
    "## 7. Когда привлекать НТЦ Митра",
    "- При необходимости поверочного расчета.",
    "## 8. Уточняющие вопросы",
    "1. На какой стадии выявлено отклонение?"
  ].join("\n");
  const citationStart = verifiedText.indexOf(citationLabel);

  const mockServer = createServer(async (req, res) => {
    if (req.url === "/chat/completions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "Черновой ответ с нормативными ссылками." } }]
      }));
      return;
    }
    if (req.url === "/responses") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: verifiedText,
            annotations: [{
              type: "url_citation",
              start_index: citationStart,
              end_index: citationStart + citationLabel.length,
              title: "Официальный интернет-портал правовой информации",
              url: "https://pravo.gov.ru/"
            }]
          }]
        }]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await listen(mockServer, mockPort);
  context.after(() => close(mockServer));

  const app = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      DEEPSEEK_API_KEY: "test",
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}`,
      DEEPSEEK_MODEL: "test-draft",
      OPENAI_API_KEY: "test",
      OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}`,
      OPENAI_VERIFIER_MODEL: "test-verifier",
      DIALOG_LOG_PATH: path.join(tmpdir(), `ntc-mitra-${randomUUID()}.jsonl`)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => app.kill());

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test server did not start")), 5000);
    app.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      resolve();
    });
    app.once("error", reject);
  });

  const response = await fetch(`http://127.0.0.1:${appPort}/api/normative-assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario: "defect_smr",
      message: "На строительной площадке выявлено отклонение геометрии несущей колонны.",
      consent: true
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.verification_mode, "web");
  assert.equal(payload.meta.source_count, 1);
  assert.match(payload.final_answer, /\[Источник: Официальный интернет-портал правовой информации\]\(https:\/\/pravo\.gov\.ru\/\)/);
  assert.equal(payload.sources[0].url, "https://pravo.gov.ru/");
});
