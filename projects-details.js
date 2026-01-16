/* Enhances NSC Projects panels with structured "Production details" under the CTA buttons.
   Data source: <script type="application/json" id="projectsData"> in index.html */

const __nsProjectsDetailsMount = () => (function () {
  const getProjectsData = () => {
    const el = document.getElementById("projectsData");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "null");
    } catch {
      return null;
    }
  };

  const initialsFromName = (name) => {
    if (!name) return "?";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const a = parts[0] && parts[0][0] ? parts[0][0] : "";
    const b = parts.length > 1 && parts[parts.length - 1] && parts[parts.length - 1][0] ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase() || "?";
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  };

  const buildMore = (project) => {
    const hasPartners = Array.isArray(project?.partners) && project.partners.length > 0;
    const hasTalent = Array.isArray(project?.talent) && project.talent.length > 0;
    const hasBudget = !!(project?.budget && (project.budget.text || project.budget.label));
    if (!hasPartners && !hasTalent && !hasBudget) return null;

    const more = el("div", "projectsTabPanel__more");

    if (hasPartners) {
      const section = el("div", "projectMeta");
      section.appendChild(el("div", "projectMeta__k", "Partners"));

      const row = el("div", "projectMeta__logos");
      project.partners.forEach((partner) => {
        if (!partner || !partner.name) return;
        const label = String(partner.name);
        const href = partner.href ? String(partner.href) : "";
        const logo = partner.logo ? String(partner.logo) : "";

        const wrap = href ? document.createElement("a") : document.createElement("div");
        wrap.className = "projectMeta__logoWrap";
        if (href) {
          wrap.href = href;
          wrap.target = "_blank";
          wrap.rel = "noopener noreferrer";
          wrap.setAttribute("aria-label", label);
        }

        if (logo) {
          const img = document.createElement("img");
          img.className = "projectMeta__logo";
          img.src = logo;
          img.alt = label;
          img.loading = "lazy";
          img.decoding = "async";
          wrap.appendChild(img);
        } else {
          const pill = el("span", "projectMeta__pill", label);
          wrap.appendChild(pill);
        }

        row.appendChild(wrap);
      });

      section.appendChild(row);
      more.appendChild(section);
    }

    if (hasTalent) {
      const section = el("div", "projectMeta");
      section.appendChild(el("div", "projectMeta__k", "Director & Lead"));

      const grid = el("div", "projectMeta__people");
      project.talent.forEach((person) => {
        if (!person || !person.name) return;

        const imdb = person.imdb ? String(person.imdb) : "";
        const card = imdb ? document.createElement("a") : document.createElement("div");
        card.className = "personCard";
        if (imdb) {
          card.href = imdb;
          card.target = "_blank";
          card.rel = "noopener noreferrer";
          card.setAttribute("aria-label", `${person.name} on IMDb`);
        }
        const hasImage = !!person.image;

        if (hasImage) {
          const img = document.createElement("img");
          img.className = "personCard__photo";
          img.src = person.image;
          img.alt = person.alt || person.name;
          img.loading = "lazy";
          img.decoding = "async";
          card.appendChild(img);
        } else {
          const avatar = el("div", "personCard__avatar", initialsFromName(person.name));
          avatar.setAttribute("aria-hidden", "true");
          card.appendChild(avatar);
        }

        const meta = el("div", "personCard__meta");
        meta.appendChild(el("div", "personCard__name", String(person.name)));
        if (person.role) meta.appendChild(el("div", "personCard__role", String(person.role)));
        card.appendChild(meta);

        grid.appendChild(card);
      });

      section.appendChild(grid);
      more.appendChild(section);
    }

    if (hasBudget) {
      const section = el("div", "projectMeta");
      section.appendChild(el("div", "projectMeta__k", project.budget?.label || "Budget"));
      section.appendChild(el("div", "projectMeta__budget", project.budget?.text || ""));
      more.appendChild(section);
    }

    return more;
  };

  const enhanceProjectsPanels = () => {
    const data = getProjectsData();
    if (!Array.isArray(data) || !data.length) return false;

    const panels = document.querySelectorAll(".projectsTabPanel");
    if (!panels.length) return false;

    let didAny = false;
    panels.forEach((panel) => {
      const idx = Number(panel.dataset.index);
      if (!Number.isFinite(idx)) return;
      const project = data[idx];
      if (!project) return;
      if (panel.querySelector(".projectsTabPanel__more")) return;

      const more = buildMore(project);
      if (!more) return;

      const links = panel.querySelector(".projectsTabPanel__links");
      if (links && links.parentElement) {
        links.insertAdjacentElement("afterend", more);
      } else {
        panel.appendChild(more);
      }
      didAny = true;
    });

    return didAny;
  };

  const waitForPanelsThenEnhance = () => {
    // Try immediately (covers the case where mountProjects already ran).
    if (enhanceProjectsPanels()) return;

    // If mountProjects runs later (e.g., on screen activation), observe DOM mutations
    // and enhance as soon as the panels appear.
    const root = document.getElementById("projectsList")?.parentElement || document.body;
    if (!root || !("MutationObserver" in window)) return;

    const obs = new MutationObserver(() => {
      if (enhanceProjectsPanels()) {
        try { obs.disconnect(); } catch {}
      }
    });

    obs.observe(root, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForPanelsThenEnhance);
  } else {
    waitForPanelsThenEnhance();
  }
})();

// Delay until unlocked if the NDA/password gate is active.
if (window.__NS_GATE_LOCKED__) {
  window.addEventListener("ns:unlocked", __nsProjectsDetailsMount, { once: true });
} else {
  __nsProjectsDetailsMount();
}

