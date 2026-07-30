const siteHeader = document.querySelector(".site-header");
const siteNav = siteHeader?.querySelector(".nav");

if (siteHeader && siteNav) {
  const menuButton = document.createElement("button");
  menuButton.className = "nav-toggle";
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", "site-navigation");
  menuButton.setAttribute("aria-label", "Open menu");
  menuButton.innerHTML = '<span aria-hidden="true">☰</span>';

  siteNav.id ||= "site-navigation";
  siteHeader.classList.add("has-nav-toggle");
  siteHeader.insertBefore(menuButton, siteNav);

  menuButton.addEventListener("click", () => {
    const isOpen = siteHeader.classList.toggle("nav-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    menuButton.querySelector("span").textContent = isOpen ? "×" : "☰";
  });

  siteNav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    siteHeader.classList.remove("nav-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open menu");
    menuButton.querySelector("span").textContent = "☰";
  });
}

const requestForm = document.querySelector("#requestForm");

if (requestForm) {
  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(requestForm);
    const subject = encodeURIComponent("Project enquiry from stc-mitra.com");
    const body = encodeURIComponent([
      `Name: ${data.get("name") || ""}`,
      `Company: ${data.get("company") || ""}`,
      `Contact: ${data.get("contact") || ""}`,
      "",
      "Project / engineering issue:",
      data.get("message") || ""
    ].join("\n"));

    window.location.href = `mailto:info@stc-mitra.com?subject=${subject}&body=${body}`;
  });
}
