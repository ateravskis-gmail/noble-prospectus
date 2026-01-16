/* Refactor NCN Projects screen to use the same layout as NSC Projects:
   - Left media stage
   - Tabs row
   - Panel with description/details/CTAs
   - "Brand Sponsors" + "Produced" section under CTAs

   Data source: <script type="application/json" id="ncnProjectsData"> in index.html
*/

(function () {
  const getData = () => {
    const el = document.getElementById("ncnProjectsData");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "null");
    } catch {
      return null;
    }
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  };

  const ytThumbFromHref = (href) => {
    if (!href) return "";
    const s = String(href);
    let id = "";
    const m1 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    const m2 = s.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
    const m3 = s.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/);
    id = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || "";
    if (!id) return "";
    // hqdefault is usually safe; maxresdefault often 404s.
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  };

  const mount = () => {
    const data = getData();
    if (!Array.isArray(data) || !data.length) return;

    const section = document.querySelector(".ncnProjectsScreen");
    if (!section) return;

    // Hide the legacy UI (main.js binds it; we don't want it visible once v2 is mounted)
    const legacy = document.getElementById("ncnTabs");
    if (legacy) legacy.style.display = "none";

    // Add an image background layer similar to NSC projects (swaps per active item)
    const bgWrap = section.querySelector(".ncnProjectsScreen__bg");
    if (bgWrap && !bgWrap.querySelector("#ncnProjectsBgImage")) {
      const img = document.createElement("img");
      img.id = "ncnProjectsBgImage";
      img.className = "ncnProjectsScreen__bgImage";
      img.src = "";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      bgWrap.insertBefore(img, bgWrap.firstChild);
    }

    const bgImg = document.getElementById("ncnProjectsBgImage");
    const bgVideo = document.getElementById("ncnProjectsBgVideo");
    if (bgVideo) bgVideo.style.opacity = "0";

    const setBgImage = async (src) => {
      if (!bgImg || !src) return;
      const current = bgImg.getAttribute("src") || "";
      if (current === src && parseFloat(getComputedStyle(bgImg).opacity || "0") > 0) return;

      const preload = () =>
        new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = resolve;
          im.onerror = reject;
          im.src = src;
        });

      const fadeOut = () => {
        if (window.gsap) {
          return new Promise((resolve) => {
            window.gsap.killTweensOf(bgImg);
            window.gsap.to(bgImg, { opacity: 0, duration: 0.22, ease: "power2.out", onComplete: resolve });
          });
        }
        bgImg.style.opacity = "0";
        return Promise.resolve();
      };

      const fadeIn = () => {
        const targetOpacity = 0.35;
        if (window.gsap) {
          return new Promise((resolve) => {
            window.gsap.killTweensOf(bgImg);
            window.gsap.to(bgImg, { opacity: targetOpacity, duration: 0.35, ease: "power2.out", onComplete: resolve });
          });
        }
        bgImg.style.opacity = String(targetOpacity);
        return Promise.resolve();
      };

      await fadeOut();
      try {
        await preload();
      } catch {}
      bgImg.setAttribute("src", src);
      await fadeIn();
    };

    // Prevent double-mount
    if (section.querySelector("#ncnProjectsV2")) return;

    document.body?.classList?.add("has-ncn-projects-v2");

    const host = el("div", "projects ncnProjectsV2");
    host.id = "ncnProjectsV2";

    // Media
    const media = el("div", "projectsMedia");
    media.setAttribute("aria-label", "Project media");
    const stage = el("div", "projectsMedia__stage");
    stage.id = "ncnProjectsMediaStage";
    stage.setAttribute("aria-hidden", "true");
    media.appendChild(stage);
    media.appendChild(el("div", "projectsMedia__meta"));

    // Panel
    const panel = el("div", "projectsPanel");
    const list = el("div", "projectsList");
    list.id = "ncnProjectsList";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "NCN Projects");
    panel.appendChild(list);
    panel.appendChild(el("div", "projectsHint subtle", "Hover or focus a project to preview"));

    host.appendChild(media);
    host.appendChild(panel);

    // Insert into the existing frame, right after the H2
    const h2 = section.querySelector(".h2");
    const frame = section.querySelector(".frame");
    if (h2 && h2.parentElement) {
      h2.insertAdjacentElement("afterend", host);
    } else if (frame) {
      frame.appendChild(host);
    } else {
      section.appendChild(host);
    }

    const itemBtns = [];
    const stageItems = [];

    for (let i = 0; i < data.length; i++) {
      const p = data[i];

      // Stage item (image or video)
      const mediaWrap = el("div", "projectsMedia__item");
      mediaWrap.dataset.index = String(i);

      if (p.media?.type === "video") {
        const v = document.createElement("video");
        v.className = "projectsMedia__video";
        v.playsInline = true;
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.preload = "metadata";
        const src = document.createElement("source");
        src.src = p.media.src;
        src.type = "video/mp4";
        v.appendChild(src);
        mediaWrap.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = p.poster || "";
        img.alt = p.alt || p.title || "";
        img.decoding = "async";
        img.loading = "lazy";
        mediaWrap.appendChild(img);
      }

      stage.appendChild(mediaWrap);
      stageItems[i] = mediaWrap;

      // Tab button
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = "projectsTab";
      tabBtn.dataset.index = String(i);
      tabBtn.textContent = p.title;
      tabBtn.setAttribute("role", "tab");
      tabBtn.setAttribute("aria-selected", "false");

      // Tab panel
      const tabPanel = el("div", "projectsTabPanel");
      tabPanel.dataset.index = String(i);
      tabPanel.setAttribute("role", "tabpanel");
      tabPanel.setAttribute("aria-hidden", "true");

      const description = el("p", "projectsTabPanel__description", p.description || "");
      const details = el("p", "projectsTabPanel__details", p.details || "");
      tabPanel.appendChild(description);
      if (p.details) tabPanel.appendChild(details);

      if (Array.isArray(p.links) && p.links.length) {
        const links = el("div", "projectsTabPanel__links");
        p.links.forEach((link) => {
          if (!link || !link.href) return;
          const a = document.createElement("a");
          a.href = link.href;
          a.className = "btn btn--ghost projectsTabPanel__link";
          a.textContent = link.text || "View";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          links.appendChild(a);
        });
        tabPanel.appendChild(links);
      }

      // "Brand Sponsors" + "Produced" (under CTAs)
      const hasSponsors = Array.isArray(p.sponsors) && p.sponsors.length > 0;
      const hasProduced = Array.isArray(p.produced) && p.produced.length > 0;
      if (hasSponsors || hasProduced) {
        const more = el("div", "projectsTabPanel__more");

        if (hasSponsors) {
          const section = el("div", "projectMeta");
          section.appendChild(el("div", "projectMeta__k", "Brand Sponsors"));

          const row = el("div", "projectMeta__logos");
          p.sponsors.forEach((s) => {
            if (!s || !s.name) return;
            const label = String(s.name);
            const href = s.href ? String(s.href) : "";
            const logo = s.logo ? String(s.logo) : "";

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
              wrap.appendChild(el("span", "projectMeta__pill", label));
            }

            row.appendChild(wrap);
          });

          section.appendChild(row);
          more.appendChild(section);
        }

        if (hasProduced) {
          const section = el("div", "projectMeta");
          section.appendChild(el("div", "projectMeta__k", "Produced"));

          const grid = el("div", "producedGrid");
          p.produced.forEach((prod) => {
            if (!prod || !prod.title || !prod.href) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "producedItem producedItem--modal";
            btn.addEventListener("click", () => {
              if (typeof window.openNobleEmbedModal === "function") {
                window.openNobleEmbedModal(prod.href);
                return;
              }
              // Fallback: open in new tab
              window.open(String(prod.href), "_blank", "noopener,noreferrer");
            });

            const thumb = prod.thumb || ytThumbFromHref(prod.href);
            if (thumb) {
              const img = document.createElement("img");
              img.className = "producedItem__thumb";
              img.src = thumb;
              img.alt = prod.alt || prod.title;
              img.loading = "lazy";
              img.decoding = "async";
              btn.appendChild(img);
            } else {
              // Fallback thumbnail (so the tile doesn't look "broken" without an image)
              const avatar = el("div", "producedItem__avatar", "▶");
              avatar.setAttribute("aria-hidden", "true");
              btn.appendChild(avatar);
            }

            const meta = el("div", "producedItem__meta");
            meta.appendChild(el("div", "producedItem__title", String(prod.title)));
            if (prod.kind) meta.appendChild(el("div", "producedItem__kind", String(prod.kind)));
            btn.appendChild(meta);

            grid.appendChild(btn);
          });

          section.appendChild(grid);
          more.appendChild(section);
        }

        tabPanel.appendChild(more);
      }

      list.appendChild(tabBtn);
      itemBtns[i] = { button: tabBtn, panel: tabPanel };
    }

    // Panels container
    const panelsContainer = el("div", "projectsTabPanels");
    panelsContainer.setAttribute("role", "tablist");
    for (let i = 0; i < itemBtns.length; i++) {
      panelsContainer.appendChild(itemBtns[i].panel);
    }
    panel.appendChild(panelsContainer);

    let activeIndex = 0;
    const setActive = (i) => {
      activeIndex = i;
      for (let idx = 0; idx < itemBtns.length; idx++) {
        const isActive = idx === i;
        const { button, panel } = itemBtns[idx];
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        panel.classList.toggle("is-active", isActive);
        panel.setAttribute("aria-hidden", String(!isActive));
        stageItems[idx]?.classList.toggle("is-active", isActive);

        // Pause non-active videos to reduce CPU
        const v = stageItems[idx]?.querySelector("video");
        if (v) {
          if (isActive) {
            try { v.play(); } catch {}
          } else {
            try { v.pause(); } catch {}
          }
        }
      }

      // Update background image for active item (if provided)
      const bgSrc = data[i]?.bg;
      if (bgSrc) setBgImage(String(bgSrc));
    };

    // Interactions (match NSC behavior: hover/focus selects)
    for (let i = 0; i < itemBtns.length; i++) {
      const { button } = itemBtns[i];
      button.addEventListener("pointerenter", () => setActive(i), { passive: true });
      button.addEventListener("click", () => setActive(i));
      button.addEventListener("focus", () => setActive(i));
    }

    setActive(0);
  };

  const ensureMounted = () => {
    if (document.querySelector("#ncnProjectsV2")) return;
    mount();
  };

  // 1) Mount at DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureMounted);
  } else {
    ensureMounted();
  }

  // 2) Mount again on first time the NCN screen becomes active (covers reveal-timing edge cases)
  //    We keep this lightweight and auto-disconnect after a successful mount.
  const section = document.querySelector(".ncnProjectsScreen");
  if (section && "MutationObserver" in window) {
    const obs = new MutationObserver(() => {
      if (section.classList.contains("is-active")) {
        ensureMounted();
        try { obs.disconnect(); } catch {}
      }
    });
    obs.observe(section, { attributes: true, attributeFilter: ["class"] });
  }
})();

