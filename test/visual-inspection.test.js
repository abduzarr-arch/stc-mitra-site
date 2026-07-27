import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const mockPort = 18183;
const appPort = 18184;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("visual assistant independently inspects photos and verifies normative references", async (context) => {
  let visionCalls = 0;
  let webCalls = 0;
  const citationLabel = "[норма]";
  const verifiedText = [
    "## 1. Резюме и достаточность исходных данных",
    "Представлена одна фотография железобетонной колонны. Для окончательного вывода требуются измерения.",
    "## 2. Проверенный анализ по фотографиям",
    "### Фото 1",
    "- **Наблюдается:** локальное нарушение однородности поверхности.",
    "- **Визуальный вывод:** признак требует инструментальной проверки.",
    "- **Статус:** Имеются признаки возможного несоответствия.",
    `- **Нормативное сопоставление:** проверить требования к качеству поверхности ${citationLabel}.`,
    "- **Что необходимо проверить:** размеры, глубину и состояние арматуры.",
    "- **Уровень уверенности:** средний.",
    "## 3. Согласованные выводы и разногласия",
    "Обследователи согласны, что несущая способность по фото не определяется.",
    "## 4. Признаки, требующие немедленной реакции",
    "Непосредственная опасность по представленному кадру не подтверждена.",
    "## 5. Измерения, испытания и документы",
    "Необходимы обмеры, простукивание и проверка исполнительной документации.",
    "## 6. Уточняющие вопросы по каждому фото",
    "1. Фото 1: каковы размеры и глубина участка?",
    "## 7. Порядок дальнейших действий",
    "1. Зафиксировать участок и организовать очный осмотр.",
    "## 8. Ограничения и момент привлечения НТЦ Митра",
    "Отчет не заменяет обследование и поверочный расчет."
  ].join("\n");
  const citationStart = verifiedText.indexOf(citationLabel);

  const mockServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

    if (req.url === "/responses" && Array.isArray(body.tools)) {
      webCalls += 1;
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
              title: "ФАУ ФЦС",
              url: "https://faufcc.ru/"
            }]
          }]
        }]
      }));
      return;
    }

    if (req.url === "/responses") {
      visionCalls += 1;
      const imageItems = body?.input?.[0]?.content?.filter((item) => item.type === "input_image") || [];
      assert.equal(imageItems.length, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: "Фото 1: наблюдается локальное изменение поверхности. Соответствие и несущая способность по фотографии не определяются. Требуются измерения и очный осмотр.",
            annotations: []
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

  const logPath = path.join(tmpdir(), `ntc-mitra-vision-${randomUUID()}.jsonl`);
  const app = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENAI_API_KEY: "test",
      OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}`,
      OPENAI_VISION_MODEL: "test-vision-a",
      OPENAI_VISION_REVIEW_MODEL: "test-vision-b",
      OPENAI_VISION_NORM_MODEL: "test-verifier",
      DIALOG_LOG_PATH: logPath
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

  const response = await fetch(`http://127.0.0.1:${appPort}/api/visual-inspection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: {
        construction_type: "Колонна",
        material: "Железобетон",
        stage: "После бетонирования",
        location: "Ось 4/Б, первый этаж",
        concern: "Требуется оценить локальное нарушение поверхности после распалубки."
      },
      photos: [{
        name: "column.jpg",
        description: "Общий вид локального участка колонны после распалубки, масштаб отсутствует.",
        data_url: "data:image/jpeg;base64,/9j/2Q=="
      }],
      consent: true
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(visionCalls, 2);
  assert.equal(webCalls, 1);
  assert.equal(payload.meta.photo_count, 1);
  assert.equal(payload.meta.verification_mode, "web");
  assert.match(payload.final_answer, /Имеются признаки возможного несоответствия/);
  assert.match(payload.final_answer, /\[Источник: ФАУ ФЦС\]\(https:\/\/faufcc\.ru\/\)/);
  const logContent = await readFile(logPath, "utf8");
  assert.doesNotMatch(logContent, /data:image/);
  assert.doesNotMatch(logContent, /\/9j\/2Q==/);
});
