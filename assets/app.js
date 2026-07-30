const form = document.querySelector("#requestForm");

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const subject = encodeURIComponent("Заявка с сайта НТЦ Митра");
    const body = encodeURIComponent(
      [
        `Имя: ${data.get("name") || ""}`,
        `Компания: ${data.get("company") || ""}`,
        `Контакт: ${data.get("contact") || ""}`,
        "",
        "Задача:",
        data.get("message") || ""
      ].join("\n")
    );

    window.location.href = `mailto:info@stc-mitra.com?subject=${subject}&body=${body}`;
  });
}
