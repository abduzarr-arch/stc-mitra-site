const assistantForm = document.querySelector("#normativeAssistantForm");
const assistantResult = document.querySelector("#normativeAssistantResult");
let latestAssistantState = null;

function trackAssistantGoal(name, params = {}) {
  window.mitraAnalytics?.goal(name, params);
}

function setAssistantResult(html, className = "") {
  if (!assistantResult) return;
  assistantResult.className = `assistant-result ${className}`.trim();
  assistantResult.innerHTML = html;
}

function setButtonBusy(button, isBusy, busyText, idleText) {
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : idleText;
}

function renderAssistantLoading(mode = "initial") {
  const title = mode === "refinement"
    ? "Уточнение принято. Помощник обновляет алгоритм"
    : "Запрос принят. Помощник формирует алгоритм";
  const description = mode === "refinement"
    ? "Сейчас учитываем ваше уточнение, заново структурируем ответ и проверяем нормативные основания."
    : "Обычно это занимает немного времени: первый контур готовит алгоритм, затем второй контур проверяет ссылки и формулировки.";

  return `
    <div class="assistant-loading" role="status" aria-live="polite">
      <div class="assistant-loading-indicator" aria-hidden="true"></div>
      <div>
        <h3>${title}</h3>
        <p>${description}</p>
        <ol>
          <li>Квалифицируем ситуацию.</li>
          <li>Собираем пошаговый порядок действий.</li>
          <li>Проверяем нормативные основания.</li>
        </ol>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  const links = [];
  const withPlaceholders = String(value).replace(
    /\[([^\]]{1,180})\]\((https?:\/\/[^\s)]+)\)/gi,
    (match, label, url) => {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return match;
        const index = links.push({
          label: escapeHtml(label),
          url: escapeHtml(parsed.toString())
        }) - 1;
        return `MITRA_LINK_${index}_END`;
      } catch {
        return match;
      }
    }
  );

  return escapeHtml(withPlaceholders)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/MITRA_LINK_(\d+)_END/g, (match, index) => {
      const link = links[Number(index)];
      return link
        ? `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.label}</a>`
        : match;
    });
}

function stripServiceBlocks(value) {
  let text = String(value || "").trim();
  text = text.replace(/```(?:json|yaml)?[\s\S]*?```/gi, (block) => {
    const lower = block.toLowerCase();
    return lower.includes("checked_claims") ||
      lower.includes("original_claim") ||
      lower.includes("source_requested") ||
      lower.includes("overall_risk") ||
      lower.includes("requires_human_review")
      ? ""
      : block;
  });

  const markers = [
    "\"checked_claims\"",
    "\"original_claim\"",
    "\"source_requested\"",
    "\"overall_risk\"",
    "\"requires_human_review\""
  ];
  const serviceIndex = markers
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (serviceIndex >= 0) {
    text = text.slice(0, serviceIndex);
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeAssistantMarkdown(value) {
  let text = stripServiceBlocks(value);

  text = text
    .replace(/\s*---\s*/g, "\n\n")
    .replace(/\s+(#{1,3}\s+)/g, "\n\n$1")
    .replace(/^#\s+/gm, "## ")
    .replace(/^#{3}\s+/gm, "## ")
    .replace(/\s+(\d+\.\s+[А-ЯA-ZЁ])/g, "\n\n$1")
    .replace(/\s+(\*\*[А-ЯA-ZЁ][^*]{2,80}:\*\*)/g, "\n\n$1")
    .replace(/\s+(-\s+[А-ЯA-ZЁ])/g, "\n$1")
    .replace(/\s+(Шаг\s+\d+[:.])/gi, "\n\n$1")
    .replace(/^\s*#{1,3}\s*$/gm, "");

  const requiredSections = [
    "## 1. Краткая квалификация ситуации",
    "## 2. Что сделать прямо сейчас",
    "## 3. Пошаговый алгоритм",
    "## 4. Какие документы оформить или запросить",
    "## 5. Нормативные основания",
    "## 6. Риски для участников",
    "## 7. Когда привлекать НТЦ Митра",
    "## 8. Уточняющие вопросы"
  ];

  const hasSections = requiredSections.some((section) => text.includes(section)) ||
    /^#{0,3}\s*\d+\.\s+(Краткая|Что сделать|Пошаговый|Какие документы|Нормативные|Риски|Когда привлекать|Уточняющие)/im.test(text);
  if (!hasSections) {
    text = `## 1. Ответ помощника\n${text}`;
  }

  return text;
}

function markdownToAssistantHtml(markdown) {
  const text = normalizeAssistantMarkdown(markdown);
  const lines = text.split(/\r?\n/);
  const html = [];
  let currentSection = null;
  let listType = null;
  let orderedCounter = 0;

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  function closeSection() {
    closeList();
    if (currentSection) {
      html.push("</section>");
      currentSection = null;
    }
    orderedCounter = 0;
  }

  function appendToLastListItem(content) {
    const lastIndex = html.length - 1;
    if (lastIndex < 0 || !html[lastIndex].endsWith("</li>")) return false;
    html[lastIndex] = html[lastIndex].replace("</li>", `<p class="assistant-item-note">${content}</p></li>`);
    return true;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      closeSection();
      currentSection = true;
      html.push(`<section class="assistant-section"><h3>${renderInlineMarkdown(heading[1])}</h3>`);
      continue;
    }

    const numberedHeading = line.match(/^(\d+)\.\s+(Краткая|Что сделать|Пошаговый|Какие документы|Нормативные|Риски|Когда привлекать|Уточняющие)(.+)$/i);
    if (numberedHeading) {
      closeSection();
      currentSection = true;
      html.push(`<section class="assistant-section"><h3>${renderInlineMarkdown(line)}</h3>`);
      continue;
    }

    const boldHeading = line.match(/^\*\*([^*]{3,90}):\*\*$/);
    if (boldHeading) {
      closeSection();
      currentSection = true;
      html.push(`<section class="assistant-section"><h3>${renderInlineMarkdown(boldHeading[1])}</h3>`);
      continue;
    }

    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push(`<ol start="${orderedCounter + 1}">`);
        listType = "ol";
      }
      orderedCounter += 1;
      html.push(`<li>${renderInlineMarkdown(ordered[2])}</li>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    if (listType && /^\((основание|статус|примечание|важно|требуется)/i.test(line)) {
      if (appendToLastListItem(renderInlineMarkdown(line))) {
        continue;
      }
    }

    closeList();
    if (!currentSection) {
      currentSection = true;
      html.push("<section class=\"assistant-section\">");
    }
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeSection();
  return html.join("");
}

function renderVerificationStatus(payload) {
  const mode = payload?.meta?.verification_mode;
  const sourceCount = Number(payload?.meta?.source_count || 0);
  if (mode === "web" && sourceCount > 0) {
    return `<div class="assistant-verification">Проверка выполнена с поиском по нормативным источникам. Использованных источников: ${sourceCount}.</div>`;
  }
  return `<div class="assistant-verification manual">Автоматическая проверка по внешним источникам была недоступна. Точные статьи, пункты и статус документов необходимо сверить вручную.</div>`;
}

function renderVerificationSources(sources = []) {
  const validSources = sources.filter((source) => {
    try {
      return ["http:", "https:"].includes(new URL(source.url).protocol);
    } catch {
      return false;
    }
  }).slice(0, 12);

  if (!validSources.length) return "";
  const items = validSources.map((source) => {
    const label = escapeHtml(source.title || new URL(source.url).hostname);
    const url = escapeHtml(new URL(source.url).toString());
    return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
  }).join("");

  return `
    <details class="assistant-history assistant-sources">
      <summary>Источники, использованные при проверке (${validSources.length})</summary>
      <div class="assistant-history-content"><ul>${items}</ul></div>
    </details>
  `;
}

function renderAssistantHistory(history = []) {
  if (!history.length) return "";
  const items = history.slice(-3).reverse().map((item, index) => `
    <details class="assistant-history">
      <summary>Предыдущая версия ответа${index === 0 ? "" : ` (${index + 1})`}</summary>
      <div class="assistant-history-content">
        ${item.refinement ? `<p class="assistant-refinement-note">Уточнение: ${escapeHtml(item.refinement)}</p>` : ""}
        <div class="assistant-answer">${markdownToAssistantHtml(item.answer)}</div>
      </div>
    </details>
  `).join("");
  return items;
}

function renderAssistantAnswer(payload, options = {}) {
  const answerHtml = markdownToAssistantHtml(payload.final_answer || "Ответ пуст.");
  const refinementNote = options.refinement
    ? `<div class="assistant-refinement-note">Ответ актуализирован с учетом уточнения: ${escapeHtml(options.refinement)}</div>`
    : "";
  const refineHtml = `
    <form class="assistant-refine" id="assistantRefineForm">
      <label>
        <span>Уточнить алгоритм</span>
        <textarea name="refinement" rows="4" minlength="10" required placeholder="Например: дефект выявлен после бетонирования, акта скрытых работ пока нет, подрядчик просит разрешить продолжение работ. Уточните порядок действий с учетом этого факта."></textarea>
      </label>
      <button class="button ghost" type="submit">Уточнить ответ</button>
    </form>
  `;
  return `${renderVerificationStatus(payload)}${refinementNote}<div class="assistant-answer">${answerHtml}</div>${renderVerificationSources(payload.sources)}${renderAssistantHistory(options.history)}${refineHtml}`;
}

if (assistantForm) {
  assistantForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(assistantForm);
    const message = String(data.get("message") || "").trim();
    const scenario = String(data.get("scenario") || "defect_smr");
    const consent = data.get("consent") === "on";

    if (!message) {
      setAssistantResult("<p class=\"assistant-error\">Опишите ситуацию перед отправкой.</p>", "assistant-error");
      return;
    }
    if (!consent) {
      setAssistantResult("<p class=\"assistant-error\">Подтвердите согласие на сохранение диалога.</p>", "assistant-error");
      return;
    }

    const button = assistantForm.querySelector("button");
    setButtonBusy(button, true, "Алгоритм формируется...", "Сформировать алгоритм");
    trackAssistantGoal("assistant_start", { scenario });
    setAssistantResult(renderAssistantLoading(), "assistant-result-loading");

    try {
      const response = await fetch("/api/normative-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, message, consent })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Сервер помощника пока не подключен.");
      }

      latestAssistantState = {
        scenario,
        message,
        answer: payload.final_answer || "",
        conversationId: payload.conversation_id || "",
        history: []
      };
      trackAssistantGoal("assistant_answer", { scenario });
      setAssistantResult(renderAssistantAnswer(payload));
    } catch (error) {
      trackAssistantGoal("assistant_error", { scenario });
      setAssistantResult(
        `<p class="assistant-error">Помощник пока не ответил.</p><p>${escapeHtml(error.message)}</p>`,
        "assistant-error"
      );
    } finally {
      setButtonBusy(button, false, "Алгоритм формируется...", "Сформировать алгоритм");
    }
  });
}

if (assistantResult) {
  assistantResult.addEventListener("submit", async (event) => {
    const refineForm = event.target.closest("#assistantRefineForm");
    if (!refineForm) return;
    event.preventDefault();

    const refinement = String(new FormData(refineForm).get("refinement") || "").trim();
    if (!refinement || !latestAssistantState) return;

    const previousHtml = assistantResult.innerHTML;
    const button = refineForm.querySelector("button");
    setButtonBusy(button, true, "Уточняю алгоритм...", "Уточнить ответ");
    setAssistantResult(renderAssistantLoading("refinement"), "assistant-result-loading");
    trackAssistantGoal("assistant_refinement_start", {
      scenario: latestAssistantState.scenario
    });

    try {
      const response = await fetch("/api/normative-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: latestAssistantState.scenario,
          message: latestAssistantState.message,
          previous_answer: latestAssistantState.answer,
          refinement,
          conversation_id: latestAssistantState.conversationId,
          consent: true
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Сервер помощника пока не подключен.");
      }

      const previousState = latestAssistantState;
      latestAssistantState = {
        ...latestAssistantState,
        answer: payload.final_answer || "",
        conversationId: payload.conversation_id || latestAssistantState.conversationId,
        last_refinement: refinement,
        history: [
          ...(latestAssistantState.history || []),
          { answer: previousState.answer, refinement }
        ].slice(-3)
      };
      trackAssistantGoal("assistant_refinement_answer", {
        scenario: latestAssistantState.scenario
      });
      setAssistantResult(renderAssistantAnswer(payload, {
        refinement,
        history: latestAssistantState.history
      }));
    } catch (error) {
      trackAssistantGoal("assistant_refinement_error", {
        scenario: latestAssistantState.scenario
      });
      assistantResult.innerHTML = previousHtml;
      const restoredRefineForm = assistantResult.querySelector("#assistantRefineForm");
      const restoredButton = restoredRefineForm?.querySelector("button");
      setButtonBusy(restoredButton, false, "Уточняю алгоритм...", "Уточнить ответ");
      const note = document.createElement("p");
      note.className = "assistant-error";
      note.textContent = `Не удалось уточнить ответ: ${error.message}`;
      (restoredRefineForm || assistantResult).append(note);
    } finally {
      setButtonBusy(button, false, "Уточняю алгоритм...", "Уточнить ответ");
    }
  });
}
