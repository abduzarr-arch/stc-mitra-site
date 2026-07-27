const siteHeader = document.querySelector(".site-header");
const siteNav = siteHeader?.querySelector(".nav");

if (siteHeader && siteNav) {
  const menuButton = document.createElement("button");
  menuButton.className = "nav-toggle";
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", "site-navigation");
  menuButton.setAttribute("aria-label", "Открыть меню");
  menuButton.innerHTML = '<span aria-hidden="true">☰</span>';

  siteNav.id ||= "site-navigation";
  siteHeader.classList.add("has-nav-toggle");
  siteHeader.insertBefore(menuButton, siteNav);

  menuButton.addEventListener("click", () => {
    const isOpen = siteHeader.classList.toggle("nav-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
    menuButton.querySelector("span").textContent = isOpen ? "×" : "☰";
  });

  siteNav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    siteHeader.classList.remove("nav-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Открыть меню");
    menuButton.querySelector("span").textContent = "☰";
  });
}
