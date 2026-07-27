import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";

const RETENTION_DAYS = 90;
const LOG_PATH = process.env.DIALOG_LOG_PATH || "/data/assistant-dialogs.jsonl";
let writeQueue = Promise.resolve();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function withinRetention(timestamp) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) >= cutoff;
}

export function createConversationId(value) {
  const candidate = String(value || "").trim();
  return /^[a-f0-9-]{20,64}$/i.test(candidate) ? candidate : randomUUID();
}

export async function appendDialogEntry(entry) {
  const record = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  };

  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    let existing = [];
    try {
      const content = await readFile(LOG_PATH, "utf8");
      existing = content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((item) => item && withinRetention(item.timestamp));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    existing.push(record);
    await writeFile(LOG_PATH, `${existing.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    return record;
  });

  return writeQueue;
}

export async function readDialogEntries() {
  let content;
  try {
    content = await readFile(LOG_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && withinRetention(entry.timestamp))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function isAdminAuthorized(req) {
  const expected = String(process.env.ADMIN_LOG_TOKEN || "");
  const expectedUser = String(process.env.ADMIN_LOG_USER || "admin");
  if (!expected) return false;

  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;

  let username = "";
  let password = "";
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return false;
    username = decoded.slice(0, separatorIndex);
    password = decoded.slice(separatorIndex + 1);
  } catch {
    return false;
  }

  if (username !== expectedUser) return false;
  const actualBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requestAdminAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="NTC Mitra dialogs", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end("Требуется авторизация.");
}

export function renderDialogsPage(entries) {
  const conversations = new Map();
  for (const entry of entries) {
    const key = entry.conversation_id || entry.id;
    if (!conversations.has(key)) conversations.set(key, []);
    conversations.get(key).push(entry);
  }

  const cards = [...conversations.entries()].map(([conversationId, items]) => {
    const sorted = items.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const first = sorted[0];
    const exchanges = sorted.map((item, index) => `
      <section class="exchange">
        <h3>${index === 0 ? "Первичный запрос" : `Уточнение ${index}`}</h3>
        ${item.refinement ? `<div class="block"><strong>Уточнение</strong><p>${escapeHtml(item.refinement)}</p></div>` : ""}
        ${index === 0 ? `<div class="block"><strong>Запрос пользователя</strong><p>${escapeHtml(item.message)}</p></div>` : ""}
        <details>
          <summary>Ответ помощника</summary>
          <pre>${escapeHtml(item.answer)}</pre>
        </details>
        <p class="meta">Проверка: ${item.verification_mode === "web" ? "веб-поиск по источникам" : "только модель, нужна ручная сверка"}${Array.isArray(item.sources) ? ` · источников: ${item.sources.length}` : ""}</p>
      </section>
    `).join("");

    return `
      <article class="dialog">
        <header>
          <div>
            <strong>${escapeHtml(first.scenario || "Без категории")}</strong>
            <span>${new Date(first.timestamp).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</span>
          </div>
          <code>${escapeHtml(conversationId)}</code>
        </header>
        ${exchanges}
      </article>
    `;
  }).join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Журнал диалогов | НТЦ Митра</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f2f5f7;color:#15232d;font:15px/1.5 Arial,sans-serif}
    main{width:min(1180px,calc(100% - 32px));margin:32px auto}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:24px}
    h1{margin:0;font-size:32px}.muted,span{color:#687783}.actions{display:flex;gap:10px}.button{display:inline-block;padding:10px 14px;border:1px solid #bcc8cf;background:#fff;color:#15232d;text-decoration:none;font-weight:700}
    .dialog{margin-bottom:18px;border:1px solid #d4dde2;background:#fff}.dialog>header{display:flex;justify-content:space-between;gap:16px;padding:16px 18px;background:#eaf0f3}
    .dialog>header div{display:grid;gap:2px}.dialog code{font-size:12px;color:#687783}.exchange{padding:18px;border-top:1px solid #e1e7ea}.exchange h3{margin:0 0 12px;font-size:18px}
    .block{margin:10px 0}.block p{margin:5px 0;white-space:pre-wrap}details{margin-top:12px}summary{cursor:pointer;font-weight:800;color:#d65a27}
    pre{max-height:520px;overflow:auto;white-space:pre-wrap;margin:12px 0 0;padding:16px;background:#f7f9fa;border:1px solid #dce4e8;font:14px/1.55 Arial,sans-serif}.meta{margin:10px 0 0;color:#687783;font-size:12px}
    .empty{padding:32px;border:1px solid #d4dde2;background:#fff}@media(max-width:700px){.top,.dialog>header{align-items:flex-start;flex-direction:column}.actions{flex-wrap:wrap}}
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div><h1>Журнал диалогов</h1><p class="muted">${entries.length} сообщений, ${conversations.size} диалогов. Хранение: последние ${RETENTION_DAYS} дней.</p></div>
      <div class="actions"><a class="button" href="/admin/dialogs.csv">Скачать CSV</a><a class="button" href="/">На сайт</a></div>
    </div>
    ${cards || '<div class="empty">Сохраненных диалогов пока нет.</div>'}
  </main>
</body>
</html>`;
}

export function renderDialogsCsv(entries) {
  const header = [
    "timestamp",
    "conversation_id",
    "scenario",
    "type",
    "message",
    "refinement",
    "answer",
    "draft_provider",
    "verifier_provider",
    "verification_mode",
    "source_count"
  ];
  const rows = entries.map((entry) => [
    entry.timestamp,
    entry.conversation_id,
    entry.scenario,
    entry.refinement ? "refinement" : "initial",
    entry.message,
    entry.refinement,
    entry.answer,
    entry.draft_provider,
    entry.verifier_provider,
    entry.verification_mode,
    Array.isArray(entry.sources) ? entry.sources.length : 0
  ].map(csvCell).join(","));
  return `\uFEFF${header.map(csvCell).join(",")}\n${rows.join("\n")}`;
}
