const siteHeader = document.querySelector(".site-header");
const siteNav = siteHeader?.querySelector(".nav");

if (siteHeader && siteNav) {
  const menuButton = document.createElement("button");
  const menuIcon = document.createElement("span");

  menuButton.className = "nav-toggle";
  menuButton.type = "button";
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", "site-navigation");
  menuButton.setAttribute("aria-label", "Open menu");
  menuIcon.setAttribute("aria-hidden", "true");
  menuIcon.textContent = "\u2630";
  menuButton.append(menuIcon);

  siteNav.id ||= "site-navigation";
  siteHeader.classList.add("has-nav-toggle");
  siteHeader.insertBefore(menuButton, siteNav);

  const setMenuState = (isOpen, returnFocus = false) => {
    siteHeader.classList.toggle("nav-open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    menuIcon.textContent = isOpen ? "\u00d7" : "\u2630";
    if (!isOpen && returnFocus) menuButton.focus();
  };

  menuButton.addEventListener("click", () => {
    setMenuState(!siteHeader.classList.contains("nav-open"));
  });

  siteNav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    setMenuState(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !siteHeader.classList.contains("nav-open")) return;
    setMenuState(false, true);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && siteHeader.classList.contains("nav-open")) {
      setMenuState(false);
    }
  });
}

const requestForm = document.querySelector("#requestForm");

if (requestForm) {
  const submitButton = requestForm.querySelector('button[type="submit"]');
  const formStatus = requestForm.querySelector("#formStatus");
  const defaultButtonText = submitButton?.textContent || "Send technical enquiry";
  const successMessage = "Thank you. Your enquiry has been sent. We will review the available information and contact you regarding the required inputs and calculation scope.";
  const errorMessage = "The enquiry could not be sent. Please try again or contact us at info@stc-mitra.com.";
  const validationMessage = "Please check the required fields and enter a valid email address.";

  const setFormStatus = (message, state = "") => {
    if (!formStatus) return;
    formStatus.textContent = message;
    if (state) formStatus.dataset.state = state;
    else delete formStatus.dataset.state;
  };

  requestForm.addEventListener("invalid", () => {
    setFormStatus(validationMessage, "error");
  }, true);

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requestForm.checkValidity()) {
      setFormStatus(validationMessage, "error");
      requestForm.reportValidity();
      return;
    }
    if (!submitButton || submitButton.disabled) return;

    const payload = Object.fromEntries(new FormData(requestForm).entries());
    submitButton.disabled = true;
    submitButton.textContent = "Submitting\u2026";
    requestForm.setAttribute("aria-busy", "true");
    setFormStatus("Sending your enquiry\u2026");

    try {
      const response = await fetch(requestForm.action, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 400 || response.status === 422) {
          setFormStatus(validationMessage, "error");
          return;
        }
        throw new Error(`Enquiry endpoint returned ${response.status}`);
      }

      requestForm.reset();
      setFormStatus(successMessage, "success");
    } catch {
      setFormStatus(errorMessage, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = defaultButtonText;
      requestForm.removeAttribute("aria-busy");
    }
  });
}

const projectCatalog = document.querySelector("[data-project-catalog]");
const projectFilterButtons = [...document.querySelectorAll("[data-project-filter]")];
const projectFilterStatus = document.querySelector("[data-project-filter-status]");

if (projectCatalog && projectFilterButtons.length) {
  const projectRecords = [...projectCatalog.querySelectorAll("[data-project-category]")];

  const applyProjectFilter = (selectedFilter) => {
    let visibleCount = 0;

    for (const record of projectRecords) {
      const categories = record.dataset.projectCategory?.split(/\s+/).filter(Boolean) || [];
      const isVisible = selectedFilter === "all" || categories.includes(selectedFilter);
      record.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    }

    for (const button of projectFilterButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.projectFilter === selectedFilter));
    }

    if (projectFilterStatus) {
      const activeButton = projectFilterButtons.find((button) => button.dataset.projectFilter === selectedFilter);
      const label = activeButton?.textContent?.trim() || "selected category";
      projectFilterStatus.textContent = selectedFilter === "all"
        ? `Showing all ${visibleCount} projects.`
        : `Showing ${visibleCount} ${label.toLowerCase()} projects.`;
    }
  };

  for (const button of projectFilterButtons) {
    button.addEventListener("click", () => applyProjectFilter(button.dataset.projectFilter || "all"));
  }
}
