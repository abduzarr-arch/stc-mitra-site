const visualForm = document.querySelector("#visualInspectionForm");
const visualResult = document.querySelector("#visualInspectionResult");
const photoInput = document.querySelector("#visualPhotoInput");
const photoList = document.querySelector("#visualPhotoList");

const MAX_PHOTOS = 5;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1800;
let preparedPhotos = [];
let latestVisualState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value) {
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
        return `MITRA_VISUAL_LINK_${index}_END`;
      } catch {
        return match;
      }
    }
  );

  return escapeHtml(withPlaceholders)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/MITRA_VISUAL_LINK_(\d+)_END/g, (match, index) => {
      const link = links[Number(index)];
      return link
        ? `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.label}</a>`
        : match;
    });
}

function normalizeMarkdown(value) {
  const text = String(value || "")
    .replace(/\s*---\s*/g, "\n\n")
    .replace(/\s+(#{1,3}\s+)/g, "\n\n$1")
    .replace(/^#\s+/gm, "## ")
    .replace(/^#{3}\s+/gm, "## ")
    .replace(/\s+(\d+\.\s+[А-ЯA-ZЁ])/g, "\n\n$1")
    .replace(/\s+(-\s+[А-ЯA-ZЁ])/g, "\n$1")
    .replace(/^\s*#{1,3}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return /^#{1,3}\s+/m.test(text) ? text : `## 1. Отчет визуального осмотра\n${text}`;
}

function markdownToHtml(markdown) {
  const lines = normalizeMarkdown(markdown).split(/\r?\n/);
  const html = [];
  let sectionOpen = false;
  let listType = "";
  let orderedCounter = 0;

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  }

  function closeSection() {
    closeList();
    if (sectionOpen) html.push("</section>");
    sectionOpen = false;
    orderedCounter = 0;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      closeSection();
      sectionOpen = true;
      const isPhoto = /^Фото\s+\d+/i.test(heading[1]);
      html.push(`<section class="assistant-section${isPhoto ? " visual-photo-report" : ""}"><h3>${renderInline(heading[1])}</h3>`);
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
      html.push(`<li>${renderInline(ordered[2])}</li>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    closeList();
    if (!sectionOpen) {
      sectionOpen = true;
      html.push('<section class="assistant-section">');
    }
    html.push(`<p>${renderInline(line)}</p>`);
  }

  closeSection();
  return html.join("");
}

function setResult(html, className = "") {
  if (!visualResult) return;
  visualResult.className = `assistant-result visual-result ${className}`.trim();
  visualResult.innerHTML = html;
}

function setBusy(button, busy, busyText, idleText) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function loadingHtml(refinement = false) {
  return `
    <div class="assistant-loading" role="status">
      <div class="assistant-loading-indicator" aria-hidden="true"></div>
      <div>
        <h3>${refinement ? "Уточнение принято" : "Фотографии приняты"}</h3>
        <p>${refinement ? "Повторно анализируем снимки с учетом новых данных." : "Два обследователя независимо изучают снимки, затем проверяются нормативные основания."}</p>
        <ol>
          <li>Фиксируем только наблюдаемые признаки.</li>
          <li>Сопоставляем независимые выводы.</li>
          <li>Проверяем нормативные источники.</li>
        </ol>
      </div>
    </div>
  `;
}

function sourceList(sources = []) {
  const valid = sources.filter((source) => {
    try {
      return ["http:", "https:"].includes(new URL(source.url).protocol);
    } catch {
      return false;
    }
  }).slice(0, 12);
  if (!valid.length) return "";

  return `
    <details class="assistant-history assistant-sources">
      <summary>Источники нормативной проверки (${valid.length})</summary>
      <div class="assistant-history-content">
        <ul>${valid.map((source) => {
          const url = new URL(source.url);
          return `<li><a href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || url.hostname)}</a></li>`;
        }).join("")}</ul>
      </div>
    </details>
  `;
}

function historyHtml(history = []) {
  if (!history.length) return "";
  return history.slice(-2).reverse().map((item) => `
    <details class="assistant-history">
      <summary>Предыдущая версия отчета</summary>
      <div class="assistant-history-content">
        ${item.refinement ? `<p class="assistant-refinement-note">Уточнение: ${escapeHtml(item.refinement)}</p>` : ""}
        <div class="assistant-answer">${markdownToHtml(item.answer)}</div>
      </div>
    </details>
  `).join("");
}

function renderAnswer(payload, options = {}) {
  const verified = payload?.meta?.verification_mode === "web" && Number(payload?.meta?.source_count || 0) > 0;
  const verification = verified
    ? `<div class="assistant-verification">Нормативное сопоставление выполнено с поиском по источникам. Источников: ${Number(payload.meta.source_count)}.</div>`
    : `<div class="assistant-verification manual">Веб-проверка нормативных ссылок была недоступна. Статус документов и точные пункты необходимо сверить вручную.</div>`;
  const note = options.refinement
    ? `<div class="assistant-refinement-note">Отчет обновлен с учетом уточнения: ${escapeHtml(options.refinement)}</div>`
    : "";
  const refine = `
    <form class="assistant-refine visual-refine" id="visualRefineForm">
      <label>
        <span>Ответить на уточняющие вопросы</span>
        <textarea name="refinement" rows="5" minlength="10" required placeholder="Например: фото 2 сделано в осях 4/Б на следующий день после распалубки; ширина раскрытия по щупу около 0,3 мм; трещина продолжается на боковую грань."></textarea>
      </label>
      <button class="button ghost" type="submit">Повторить анализ с уточнением</button>
    </form>
  `;
  return `${verification}${note}<div class="assistant-answer">${markdownToHtml(payload.final_answer)}</div>${sourceList(payload.sources)}${historyHtml(options.history)}${refine}`;
}

function canvasToDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Не удалось подготовить изображение."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Не удалось прочитать подготовленное изображение."));
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.82);
  });
}

async function loadImageSource(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(context, width, height) {
          context.drawImage(bitmap, 0, 0, width, height);
        },
        close() {
          bitmap.close();
        }
      };
    } catch {
      // Fall through to the image element path for older mobile browsers.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`${file.name}: браузер не смог открыть изображение.`));
      image.src = objectUrl;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(context, width, height) {
        context.drawImage(image, 0, 0, width, height);
      },
      close() {
        URL.revokeObjectURL(objectUrl);
      }
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function prepareImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error(`${file.name}: разрешены только JPEG, PNG и WebP.`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name}: исходный файл больше 20 МБ.`);
  }

  const source = await loadImageSource(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  source.draw(context, width, height);
  source.close();

  return {
    id: crypto.randomUUID(),
    name: file.name.slice(0, 120),
    dataUrl: await canvasToDataUrl(canvas),
    description: ""
  };
}

function renderPhotoCards() {
  if (!photoList) return;
  photoList.innerHTML = preparedPhotos.map((photo, index) => `
    <article class="visual-photo-card" data-photo-id="${escapeHtml(photo.id)}">
      <div class="visual-photo-preview">
        <img src="${photo.dataUrl}" alt="Загруженное фото ${index + 1}">
        <span>Фото ${index + 1}</span>
      </div>
      <div class="visual-photo-context">
        <div class="visual-photo-heading">
          <strong>${escapeHtml(photo.name)}</strong>
          <button type="button" class="visual-remove-photo" aria-label="Удалить фото ${index + 1}" title="Удалить фото">×</button>
        </div>
        <label>
          <span>Что показано на фото ${index + 1}?</span>
          <textarea rows="4" minlength="10" maxlength="1200" required placeholder="Элемент и его расположение; где именно виден признак; примерные размеры; когда обнаружен; есть ли масштаб или результаты измерений.">${escapeHtml(photo.description)}</textarea>
        </label>
      </div>
    </article>
  `).join("");
}

async function addSelectedPhotos(files) {
  const available = MAX_PHOTOS - preparedPhotos.length;
  if (available <= 0) throw new Error(`Можно загрузить не более ${MAX_PHOTOS} фотографий.`);
  const selected = [...files].slice(0, available);
  for (const file of selected) {
    preparedPhotos.push(await prepareImage(file));
    renderPhotoCards();
  }
  if (files.length > available) {
    throw new Error(`Добавлены первые ${available} файлов. Максимум: ${MAX_PHOTOS}.`);
  }
}

if (photoInput) {
  photoInput.addEventListener("change", async () => {
    const files = [...photoInput.files];
    photoInput.value = "";
    if (!files.length) return;
    const dropzone = document.querySelector(".visual-dropzone");
    dropzone?.classList.add("is-preparing");
    try {
      await addSelectedPhotos(files);
    } catch (error) {
      setResult(`<p class="assistant-error">${escapeHtml(error.message)}</p>`, "assistant-error");
    } finally {
      dropzone?.classList.remove("is-preparing");
    }
  });
}

if (photoList) {
  photoList.addEventListener("input", (event) => {
    const card = event.target.closest(".visual-photo-card");
    if (!card || event.target.tagName !== "TEXTAREA") return;
    const photo = preparedPhotos.find((item) => item.id === card.dataset.photoId);
    if (photo) photo.description = event.target.value;
  });

  photoList.addEventListener("click", (event) => {
    const button = event.target.closest(".visual-remove-photo");
    if (!button) return;
    const card = button.closest(".visual-photo-card");
    preparedPhotos = preparedPhotos.filter((item) => item.id !== card.dataset.photoId);
    renderPhotoCards();
  });
}

function collectContext() {
  const data = new FormData(visualForm);
  return {
    construction_type: String(data.get("construction_type") || "").trim(),
    material: String(data.get("material") || "").trim(),
    stage: String(data.get("stage") || "").trim(),
    location: String(data.get("location") || "").trim(),
    concern: String(data.get("concern") || "").trim()
  };
}

async function submitInspection({ refinement = "", button, history = [] } = {}) {
  const context = latestVisualState?.context || collectContext();
  const consent = latestVisualState ? true : new FormData(visualForm).get("consent") === "on";
  const descriptionsValid = preparedPhotos.every((photo) => photo.description.trim().length >= 10);

  if (!preparedPhotos.length) throw new Error("Добавьте хотя бы одну фотографию.");
  if (!descriptionsValid) throw new Error("Дайте пояснение не короче 10 символов к каждому фото.");
  if (!consent) throw new Error("Подтвердите согласие на передачу изображений для анализа.");

  setBusy(button, true, refinement ? "Повторный анализ..." : "Анализируем фотографии...", refinement ? "Повторить анализ с уточнением" : "Провести визуальный анализ");
  setResult(loadingHtml(Boolean(refinement)), "assistant-result-loading");
  window.mitraAnalytics?.goal(refinement ? "visual_refinement_start" : "visual_inspection_start", {
    photo_count: preparedPhotos.length
  });

  const response = await fetch("/api/visual-inspection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context,
      photos: preparedPhotos.map((photo) => ({
        name: photo.name,
        description: photo.description.trim(),
        data_url: photo.dataUrl
      })),
      previous_answer: latestVisualState?.answer || "",
      refinement,
      conversation_id: latestVisualState?.conversationId || "",
      consent
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Не удалось выполнить анализ.");

  const previousState = latestVisualState;
  latestVisualState = {
    context,
    answer: payload.final_answer || "",
    conversationId: payload.conversation_id || previousState?.conversationId || "",
    history
  };
  if (previousState?.answer) {
    latestVisualState.history = [
      ...history,
      { answer: previousState.answer, refinement }
    ].slice(-2);
  }
  window.mitraAnalytics?.goal(refinement ? "visual_refinement_answer" : "visual_inspection_answer", {
    photo_count: preparedPhotos.length
  });
  setResult(renderAnswer(payload, {
    refinement,
    history: latestVisualState.history
  }));
}

if (visualForm) {
  visualForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!visualForm.reportValidity()) return;
    const button = visualForm.querySelector('button[type="submit"]');
    try {
      await submitInspection({ button });
    } catch (error) {
      window.mitraAnalytics?.goal("visual_inspection_error");
      setResult(`<p class="assistant-error">Анализ не завершен.</p><p>${escapeHtml(error.message)}</p>`, "assistant-error");
    } finally {
      setBusy(button, false, "Анализируем фотографии...", "Провести визуальный анализ");
    }
  });
}

if (visualResult) {
  visualResult.addEventListener("submit", async (event) => {
    const refineForm = event.target.closest("#visualRefineForm");
    if (!refineForm) return;
    event.preventDefault();
    const refinement = String(new FormData(refineForm).get("refinement") || "").trim();
    if (refinement.length < 10 || !latestVisualState) return;

    const previousHtml = visualResult.innerHTML;
    const button = refineForm.querySelector("button");
    try {
      await submitInspection({
        refinement,
        button,
        history: latestVisualState.history || []
      });
    } catch (error) {
      window.mitraAnalytics?.goal("visual_refinement_error");
      visualResult.innerHTML = previousHtml;
      const restoredForm = visualResult.querySelector("#visualRefineForm");
      const note = document.createElement("p");
      note.className = "assistant-error";
      note.textContent = `Не удалось повторить анализ: ${error.message}`;
      (restoredForm || visualResult).append(note);
    } finally {
      setBusy(button, false, "Повторный анализ...", "Повторить анализ с уточнением");
    }
  });
}
