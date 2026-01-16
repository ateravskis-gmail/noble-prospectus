/* Adds YouTube + playlist support to the existing #videoModal used for Vimeo concept videos.
   Usage: window.openNobleEmbedModal(url)
*/

const __nsVideoModalEmbedsMount = () => (function () {
  const getYouTubeIds = (inputUrl) => {
    try {
      const url = new URL(String(inputUrl));
      const host = url.hostname.replace(/^www\./, "");

      let videoId = "";
      let listId = "";

      if (host === "youtu.be") {
        videoId = url.pathname.replace("/", "");
      } else if (host.endsWith("youtube.com")) {
        if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
        if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/")[2] || "";
        if (url.pathname === "/playlist") listId = url.searchParams.get("list") || "";
      }

      // list can also be present on /watch (video in playlist)
      if (!listId) listId = url.searchParams.get("list") || "";

      // Validate-ish (YouTube IDs are generally 11 chars, but we allow some flexibility)
      videoId = /^[a-zA-Z0-9_-]{6,}$/.test(videoId) ? videoId : "";
      listId = /^[a-zA-Z0-9_-]{6,}$/.test(listId) ? listId : "";

      return { isYouTube: host === "youtu.be" || host.endsWith("youtube.com"), videoId, listId };
    } catch {
      return { isYouTube: false, videoId: "", listId: "" };
    }
  };

  const buildEmbedUrl = (inputUrl) => {
    const s = String(inputUrl || "");

    // Vimeo: use existing handler if present
    if (/vimeo\.com\/\d+/.test(s) && typeof window.openVideoModal === "function") {
      return { type: "vimeo", url: s };
    }

    const yt = getYouTubeIds(s);
    if (yt.isYouTube) {
      const base = "https://www.youtube-nocookie.com";

      // Playlist-only
      if (yt.listId && !yt.videoId) {
        return { type: "embed", url: `${base}/embed/videoseries?list=${encodeURIComponent(yt.listId)}&autoplay=1` };
      }

      // Video (optionally in playlist)
      if (yt.videoId) {
        const listPart = yt.listId ? `&list=${encodeURIComponent(yt.listId)}` : "";
        return { type: "embed", url: `${base}/embed/${encodeURIComponent(yt.videoId)}?autoplay=1&rel=0${listPart}` };
      }
    }

    return { type: "external", url: s };
  };

  const openEmbedInModal = (embedUrl) => {
    const modal = document.getElementById("videoModal");
    const player = document.getElementById("videoModalPlayer");
    const closeBtn = modal?.querySelector?.(".videoModal__close");
    if (!modal || !player || !closeBtn) return;

    // Create iframe
    player.innerHTML = `<iframe src="${embedUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen></iframe>`;

    // Show modal
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const handleEscape = (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    };

    const closeModal = () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      player.innerHTML = "";
      document.removeEventListener("keydown", handleEscape);
    };

    closeBtn.addEventListener("click", closeModal, { once: true });
    modal.querySelector(".videoModal__backdrop")?.addEventListener("click", closeModal, { once: true });
    document.addEventListener("keydown", handleEscape);
  };

  window.openNobleEmbedModal = (url) => {
    const res = buildEmbedUrl(url);
    if (res.type === "vimeo") {
      window.openVideoModal(res.url);
      return;
    }
    if (res.type === "embed") {
      openEmbedInModal(res.url);
      return;
    }
    if (res.type === "external" && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  };
})();

// Delay until unlocked if the NDA/password gate is active.
if (window.__NS_GATE_LOCKED__) {
  window.addEventListener("ns:unlocked", __nsVideoModalEmbedsMount, { once: true });
} else {
  __nsVideoModalEmbedsMount();
}

