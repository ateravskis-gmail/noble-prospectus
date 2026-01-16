/* Noble Pitch Deck — fixed stage + scroll-driven screens (no framework) */

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
let PITCH = null;
let BRAND_HUB = null;
let MILESTONES_UI = null;
let IMPACT_UI = null;
const INTERSTITIAL_BY_SCREEN = new Map();
let LAST_INTERSTITIAL_SCREEN = null;

// Boot-time globals (assigned in `boot()`). These are referenced by many handlers.
let SCREENS = [];
let PROGRESS = null;
let DOTS = [];
// Start “unset” so the first render triggers cinematic reveals on Screen 0.
let ACTIVE = -1;

// ---- "Video loading…" message (shows after 1s if not playing) ----
const VIDEO_LOADING = (() => {
  const state = new WeakMap(); // video -> { el, timer }

  const ensureEl = (wrap) => {
    if (!wrap) return null;
    let el = wrap.querySelector?.(".videoLoading");
    if (!el) {
      el = document.createElement("div");
      el.className = "videoLoading is-hidden";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.textContent = "Video loading…";
      wrap.appendChild(el);
    }
    return el;
  };

  const get = (video) => state.get(video) || null;

  const hide = (video) => {
    const s = get(video);
    if (!s?.el) return;
    s.el.classList.add("is-hidden");
    if (s.timer) window.clearTimeout(s.timer);
    s.timer = 0;
  };

  const schedule = (video, wrap) => {
    if (!video) return;
    const el = ensureEl(wrap);
    if (!el) return;
    let s = get(video);
    if (!s) {
      s = { el, timer: 0 };
      state.set(video, s);

      // Hide as soon as playback actually starts.
      video.addEventListener("playing", () => hide(video));
      // If the user leaves the screen or something interrupts, don’t leave a stale toast up forever.
      video.addEventListener("ended", () => hide(video));
      video.addEventListener("error", () => hide(video));
    } else {
      s.el = el; // keep in sync if DOM changed
    }

    if (s.timer) window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => {
      // Show only if we still haven't started playing.
      if (!video.paused && !video.ended) return;
      s.el.classList.remove("is-hidden");
    }, 1000);
  };

  return { schedule, hide };
})();

// ---- Smart video loading (sequential, in screen order) ----
// Goal: start network work from Screen 1 -> Screen N, instead of every <video> racing at once.
// Playback already starts before full download once `.play()` is called (streaming), so we just ensure
// sources are assigned and metadata/first frames are buffered ahead of time.
const SMART_VIDEO_LOADER = (() => {
  const loaded = new WeakSet(); // video elements we already kicked off
  let queue = [];
  let running = false;

  const getSourceEl = (video) => video?.querySelector?.("source") || null;

  const ensureSrcAssigned = (video) => {
    const source = getSourceEl(video);
    if (!video || !source) return false;
    const hasSrc = !!source.getAttribute("src");
    if (hasSrc) return true;
    const dataSrc = source.getAttribute("data-src");
    if (!dataSrc) return false;
    source.setAttribute("src", dataSrc);
    // Keep data-src so future tooling can still see the intended order.
    return true;
  };

  const waitForPlayableMetadata = (video, timeoutMs = 2500) =>
    new Promise((resolve) => {
      if (!video) return resolve();
      if (video.readyState >= 1) return resolve(); // HAVE_METADATA
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener("loadedmetadata", finish);
        video.removeEventListener("loadeddata", finish);
        video.removeEventListener("canplay", finish);
        resolve();
      };
      video.addEventListener("loadedmetadata", finish, { once: true });
      video.addEventListener("loadeddata", finish, { once: true });
      video.addEventListener("canplay", finish, { once: true });
      setTimeout(finish, timeoutMs);
    });

  const enqueue = (video) => {
    if (!video || loaded.has(video)) return;
    queue.push(video);
  };

  const scanInScreenOrder = (screens) => {
    queue = [];
    for (const s of screens) {
      // Only enqueue videos that have a <source data-src="..."> (i.e. deferred in HTML/JS)
      const vids = Array.from(s.querySelectorAll("video"));
      for (const v of vids) {
        const src = v.querySelector("source[data-src]");
        if (src) enqueue(v);
      }
    }
  };

  const run = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const v = queue.shift();
      if (!v || loaded.has(v)) continue;
      loaded.add(v);
      try {
        if (!ensureSrcAssigned(v)) continue;
        // Hint: preload metadata/first frames without forcing full download.
        if (!v.getAttribute("preload")) v.preload = "metadata";
        v.load();
        await waitForPlayableMetadata(v);
      } catch {
        // Best-effort; continue.
      }
    }
    running = false;
  };

  const init = (screens) => {
    scanInScreenOrder(screens);
    // Kick off after initial render/active-screen setup.
    setTimeout(run, 0);
  };

  return { init, ensureSrcAssigned, enqueue, run };
})();

function getViewportHeight() {
  // `visualViewport.height` is generally more stable on mobile (address bar show/hide).
  return window.visualViewport?.height || window.innerHeight;
}

let VIEWPORT_H = getViewportHeight();
function syncViewportUnits() {
  VIEWPORT_H = getViewportHeight();
  // Used by `.spacer { height: calc(var(--vh) * 100) }`
  document.documentElement.style.setProperty("--vh", `${(VIEWPORT_H * 0.01).toFixed(4)}px`);
}

function padTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function mountScrollRail(count) {
  const rail = document.getElementById("scrollRail");
  rail.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    spacer.dataset.index = String(i);
    rail.appendChild(spacer);
  }
}

function mountNavDots(screens) {
  const nav = document.getElementById("navDots");
  nav.innerHTML = "";
  const btns = screens.map((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "navDot";
    const label = s.getAttribute("aria-label") || `Screen ${i + 1}`;
    b.setAttribute("aria-label", label);
    b.dataset.label = label;
    b.innerHTML = `<span class="navDot__dot" aria-hidden="true"></span>`;
    b.addEventListener("click", () => goToIndex(i));
    nav.appendChild(b);
    return b;
  });
  return btns;
}

function bindNavDockMagnify(nav, dots) {
  if (!nav || !dots?.length || prefersReducedMotion()) return;

  const RADIUS = 120; // px influence radius
  const MAX = 0.75; // max extra scale (1 + MAX)

  const apply = (clientY) => {
    const navRect = nav.getBoundingClientRect();
    const y = clientY - navRect.top;
    for (const btn of dots) {
      const r = btn.getBoundingClientRect();
      const cy = (r.top + r.bottom) / 2 - navRect.top;
      const d = Math.abs(y - cy);
      const t = clamp(1 - d / RADIUS, 0, 1);
      const s = 1 + t * MAX;
      btn.style.setProperty("--dock-scale", s.toFixed(3));
    }
  };

  const onMove = (e) => apply(e.clientY);
  const onEnter = (e) => apply(e.clientY);
  const onLeave = () => {
    for (const btn of dots) btn.style.removeProperty("--dock-scale");
  };

  nav.addEventListener("pointermove", onMove, { passive: true });
  nav.addEventListener("pointerenter", onEnter, { passive: true });
  nav.addEventListener("pointerleave", onLeave, { passive: true });
}

function goToIndex(i) {
  const idx = clamp(i, 0, SCREENS.length - 1);
  const top = idx * VIEWPORT_H;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function setActiveIndex(next) {
  next = clamp(next, 0, SCREENS.length - 1);
  if (next === ACTIVE) return;
  ACTIVE = next;
  const active = SCREENS[ACTIVE];

  SCREENS.forEach((el, i) => {
    const isActive = i === ACTIVE;
    el.classList.toggle("is-active", isActive);

    // Make non-active screens truly non-interactive so they can't steal clicks/hover.
    // This prevents "ghost clicks" where a hidden screen's link/button triggers.
    el.setAttribute("aria-hidden", isActive ? "false" : "true");
    if ("inert" in el) {
      // eslint-disable-next-line no-param-reassign
      el.inert = !isActive;
    } else {
      // Fallback for older browsers: at least block pointer events.
      el.style.pointerEvents = isActive ? "" : "none";
    }
  });

  DOTS.forEach((d, i) => {
    d.setAttribute("aria-current", i === ACTIVE ? "true" : "false");
  });

  // Hide chrome (brand + nav) on select screens for maximum focus.
  const hideChrome = ACTIVE === 0 || active?.classList?.contains("screen--chromeHidden");
  document.body.classList.toggle("chrome-hidden", hideChrome);

  // Trigger reveals within the active screen
  const stagger = Number(active.dataset.revealStagger || "70");
  // Screen 0 has a custom timeline; avoid double-scheduling its reveals here.
  if (ACTIVE !== 0) active.querySelectorAll(".reveal").forEach((el, i) => {
    el.classList.remove("is-revealed");
    // Stagger a bit for cinematic timing
    setTimeout(
      () => el.classList.add("is-revealed"),
      prefersReducedMotion() ? 0 : 150 + i * stagger
    );
  });

  // Screen 0 special: verse -> hold -> fade out -> mission statement + button
  if (ACTIVE === 0) runOpeningSequence();
  else resetOpeningSequence();

  // Screen 1: attempt muted autoplay for full-screen video.
  if (ACTIVE === 1 && PITCH?.video) attemptVideoPlayWithSound();
  if (ACTIVE !== 1 && PITCH?.video) {
    // Don’t keep audio playing off-screen.
    try { PITCH.video.pause(); } catch {}
  }

  // Interstitial videos: always restart on enter + attempt autoplay with sound.
  const isInterstitial = !!active?.classList?.contains("screen--interstitial");
  if (LAST_INTERSTITIAL_SCREEN && LAST_INTERSTITIAL_SCREEN !== active) {
    const prev = INTERSTITIAL_BY_SCREEN.get(LAST_INTERSTITIAL_SCREEN);
    if (prev?.video) {
      try { prev.video.pause(); } catch {}
    }
  }
  if (isInterstitial) {
    attemptInterstitialPlayWithSound(active);
    LAST_INTERSTITIAL_SCREEN = active;
  } else {
    LAST_INTERSTITIAL_SCREEN = null;
  }

  // Screen 2: ensure brand background video is playing + default clip is loaded (best-effort).
  if (ACTIVE === 2 && BRAND_HUB?.ensureDefaultBg) BRAND_HUB.ensureDefaultBg();

  // Screen 5: milestones media/list scrollytelling
  if (ACTIVE === 5 && MILESTONES_UI?.onEnter) MILESTONES_UI.onEnter();
  if (ACTIVE !== 5 && MILESTONES_UI?.onExit) MILESTONES_UI.onExit();

  // Impact: ensure tooltip doesn't linger when leaving the screen
  const impactIdx = SCREENS.findIndex((s) => (s.getAttribute("aria-label") || "").toLowerCase() === "impact");
  if (impactIdx !== -1 && ACTIVE !== impactIdx && IMPACT_UI?.hideTooltip) IMPACT_UI.hideTooltip();

  // Revenue animation runs via CSS when screen is active; nothing else required.

  // Pause any videos not in the active screen (prevents offscreen autoplay burning CPU).
  try {
    for (const v of Array.from(document.querySelectorAll("video"))) {
      if (active && active.contains(v)) continue;
      // Don't fight the brand-hub crossfade load/play logic; it will resume when its screen activates.
      try { v.pause(); } catch {}
      VIDEO_LOADING.hide(v);
    }
  } catch {}
}

let openingTimers = [];
function clearOpeningTimers() {
  openingTimers.forEach((t) => clearTimeout(t));
  openingTimers = [];
}

function resetOpeningSequence() {
  clearOpeningTimers();
  const verse = document.getElementById("openingVerse");
  const mission = document.getElementById("openingMission");
  if (!verse || !mission) return;

  verse.classList.remove("is-out");
  mission.classList.remove("is-in");
  mission.setAttribute("aria-hidden", "true");

  // Reset verse reveals so re-entering Screen 0 replays the moment.
  verse.querySelectorAll(".reveal").forEach((el) => {
    el.classList.remove("is-revealed");
  });
}

function runOpeningSequence() {
  const screen = SCREENS[0];
  const verse = document.getElementById("openingVerse");
  const mission = document.getElementById("openingMission");
  if (!screen || !verse || !mission) return;

  clearOpeningTimers();
  verse.classList.remove("is-out");
  mission.classList.remove("is-in");
  mission.setAttribute("aria-hidden", "true");

  const lines = Array.from(verse.querySelectorAll(".reveal"));
  const stagger = Number(screen.dataset.revealStagger || "1500");
  const startDelay = prefersReducedMotion() ? 0 : 150;
  const holdMs = prefersReducedMotion() ? 0 : 2000;
  const fadeOutMs = prefersReducedMotion() ? 0 : 850;
  const missionInDelay = prefersReducedMotion() ? 0 : 250;

  // Ensure verse lines reveal (setActiveIndex schedules this too, but we want strict timing here)
  lines.forEach((el, i) => {
    openingTimers.push(
      setTimeout(() => el.classList.add("is-revealed"), startDelay + i * stagger)
    );
  });

  const totalRevealMs = startDelay + Math.max(0, lines.length - 1) * stagger;
  const fadeOutAt = totalRevealMs + holdMs;

  openingTimers.push(
    setTimeout(() => {
      verse.classList.add("is-out");
      // After verse fades, bring in the mission line + button.
      openingTimers.push(
        setTimeout(() => {
          mission.classList.add("is-in");
          mission.setAttribute("aria-hidden", "false");
        }, missionInDelay)
      );
    }, fadeOutAt)
  );

  // If user scrolls away mid-sequence, we reset on next setActiveIndex call.
  // Also guard against timing while inactive:
  openingTimers.push(
    setTimeout(() => {
      if (ACTIVE !== 0) resetOpeningSequence();
    }, fadeOutAt + fadeOutMs + missionInDelay + 50)
  );
}

function onScroll() {
  const y = window.scrollY || window.pageYOffset || 0;
  const raw = y / Math.max(1, VIEWPORT_H);
  const idx = clamp(Math.round(raw), 0, SCREENS.length - 1);
  setActiveIndex(idx);

  const p = clamp(raw / Math.max(1, SCREENS.length - 1), 0, 1);
  PROGRESS.style.width = `${(p * 100).toFixed(2)}%`;

  // More obvious background parallax (base gradient layer)
  scheduleBgParallax(y, p);
}

let bgRAF = 0;
let bgLastY = 0;
let bgLastP = 0;
let bgPrevY = 0;
let bgPrevT = 0;
let bgVel = 0;
function scheduleBgParallax(y, p) {
  if (prefersReducedMotion()) return;
  bgLastY = y;
  bgLastP = p;
  if (bgRAF) return;
  bgRAF = requestAnimationFrame(() => {
    bgRAF = 0;
    applyBgParallax(bgLastY, bgLastP);
  });
}

function applyBgParallax(y, p) {
  const root = document.documentElement;
  // Scroll velocity (adds “inertia” so motion is more obvious during scrolling)
  const now = performance.now() || 0;
  const dt = Math.max(16, now - (bgPrevT || now));
  const dy = y - (bgPrevY || y);
  const v = dy / dt; // px/ms
  bgVel = bgVel * 0.85 + v * 0.15; // smooth
  bgPrevY = y;
  bgPrevT = now;

  // Velocity influence (clamped)
  const vel = clamp(bgVel, -2.0, 2.0); // typical values stay much smaller; this is a hard cap
  const kickY = vel * 18; // percent kick (vertical)
  const kickPxY = vel * 120; // px kick (vertical)

  // Make it read as vertical scroll momentum (minimal horizontal movement).
  const driftX = (p - 0.5) * 10; // percent (subtle sideways drift only)
  const driftY = (0.5 - p) * 54 + kickY; // percent

  root.style.setProperty("--bg1x", `${30 + driftX}%`);
  root.style.setProperty("--bg1y", `${10 + driftY}%`);
  root.style.setProperty("--bg2x", `${70 - driftX * 0.9}%`);
  root.style.setProperty("--bg2y", `${80 - driftY * 0.8}%`);
  root.style.setProperty("--bg3x", `${52 + driftX * 0.6}%`);
  root.style.setProperty("--bg3y", `${48 + driftY * 0.7}%`);

  // Layer transform parallax for a stronger sense of depth.
  const pxX = (p - 0.5) * -40; // px
  const pxY = (p - 0.5) * -170 - kickPxY * 0.28; // px
  root.style.setProperty("--bg-tx", `${pxX.toFixed(1)}px`);
  root.style.setProperty("--bg-ty", `${pxY.toFixed(1)}px`);
  root.style.setProperty("--bg-scale", `${(1.04 + Math.abs(p - 0.5) * 0.04).toFixed(4)}`);
}

function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// (background is handled by each screen; no global scroll-fade layer)

function onResize() {
  // Preserve the user's relative scroll position (avoid "jumping" to the top of a screen).
  const prevH = Math.max(1, VIEWPORT_H);
  const y = window.scrollY || window.pageYOffset || 0;
  syncViewportUnits();
  const nextTop = (y / prevH) * VIEWPORT_H;
  window.scrollTo({ top: nextTop, behavior: "auto" });
  onScroll();
}

function shouldIgnoreKeys(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  if (!tag) return false;
  return tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || t.isContentEditable;
}

function onKeyDown(e) {
  if (shouldIgnoreKeys(e)) return;
  if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
    e.preventDefault();
    goToIndex(ACTIVE + 1);
  }
  if (e.key === "ArrowUp" || e.key === "PageUp") {
    e.preventDefault();
    goToIndex(ACTIVE - 1);
  }
  if (e.key === "Home") {
    e.preventDefault();
    goToIndex(0);
  }
  if (e.key === "End") {
    e.preventDefault();
    goToIndex(SCREENS.length - 1);
  }
}

function bindCTAButtons() {
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // Prevent any accidental default navigation or parent click handlers.
      e.preventDefault();
      e.stopPropagation();
      const n = Number(btn.getAttribute("data-go"));
      if (Number.isFinite(n)) goToIndex(n);
    });
  });

  document.querySelectorAll("[data-toggle-ui]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.body.classList.toggle("ui-hidden");
      btn.textContent = document.body.classList.contains("ui-hidden") ? "Show UI" : "Hide UI";
    });
  });
}

function bindSpotlight() {
  const spot = document.getElementById("spotlight");
  if (!spot || prefersReducedMotion()) return;

  window.addEventListener(
    "pointermove",
    (e) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      spot.style.setProperty("--mx", `${x.toFixed(2)}%`);
      spot.style.setProperty("--my", `${y.toFixed(2)}%`);
    },
    { passive: true }
  );
}

function bindParallax() {
  if (prefersReducedMotion()) return;

  const items = Array.from(document.querySelectorAll("[data-parallax]"));
  if (!items.length) return;

  window.addEventListener(
    "pointermove",
    (e) => {
      const cx = (e.clientX / window.innerWidth - 0.5) * 2;
      const cy = (e.clientY / window.innerHeight - 0.5) * 2;
      for (const el of items) {
        const amt = Number(el.getAttribute("data-parallax") || "8");
        const tx = (-cx * amt).toFixed(2);
        const ty = (-cy * amt).toFixed(2);
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }
    },
    { passive: true }
  );
}

function bindTilts() {
  if (prefersReducedMotion()) return;
  const cards = Array.from(document.querySelectorAll("[data-tilt]"));
  for (const card of cards) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      const rx = (-y * 6).toFixed(2);
      const ry = (x * 8).toFixed(2);
      card.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-1px)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  }
}

function bindTeamStripInfo() {
  const block = document.getElementById("teamBlock");
  if (!block) return;

  const inner = block.querySelector(".teamInfoCard__inner");
  if (!inner) return;

  const panels = Array.from(block.querySelectorAll("[data-team-panel]"));
  let closeT = 0;

  const getActivePanel = () => panels.find((p) => p.classList.contains("is-active")) || null;

  const setHeightToActive = () => {
    const active = getActivePanel();
    const h = active ? active.scrollHeight : 0;
    inner.style.height = `${h}px`;
  };

  const open = (side) => {
    if (closeT) window.clearTimeout(closeT);
    block.classList.remove("is-info-closing");
    block.classList.add("is-info-open");
    for (const p of panels) {
      const isOn = p.getAttribute("data-team-panel") === side;
      p.classList.toggle("is-active", isOn);
      p.setAttribute("aria-hidden", isOn ? "false" : "true");
    }
    requestAnimationFrame(() => setHeightToActive());
  };

  const close = () => {
    if (!block.classList.contains("is-info-open")) return;

    const current = inner.getBoundingClientRect().height;
    inner.style.height = `${current}px`;
    block.classList.add("is-info-closing");
    requestAnimationFrame(() => {
      inner.style.height = "0px";
    });

    const onEnd = (e) => {
      if (e.propertyName !== "height") return;
      inner.removeEventListener("transitionend", onEnd);
      block.classList.remove("is-info-open", "is-info-closing");
      for (const p of panels) {
        p.classList.remove("is-active");
        p.setAttribute("aria-hidden", "true");
      }
    };
    inner.addEventListener("transitionend", onEnd);
  };

  const scheduleClose = () => {
    if (closeT) window.clearTimeout(closeT);
    closeT = window.setTimeout(close, 120);
  };

  const sides = Array.from(block.querySelectorAll("[data-team-side]"));
  for (const sideEl of sides) {
    const side = sideEl.getAttribute("data-team-side");
    if (!side) continue;
    sideEl.addEventListener("pointerenter", () => open(side), { passive: true });
    sideEl.addEventListener("focusin", () => open(side));
    sideEl.addEventListener("click", () => open(side));
  }

  // Always open: initialize to founders, and keep height in sync.
  open("founders");
  window.addEventListener("resize", () => setHeightToActive(), { passive: true });
}

function bindTeamDockEffect() {
  if (prefersReducedMotion()) return;
  const block = document.getElementById("teamBlock");
  if (!block) return;

  const sides = Array.from(block.querySelectorAll("[data-team-side]"));
  if (!sides.length) return;

  const RADIUS = 260; // px influence radius
  const MAX = 0.38; // max extra scale (more “dock”)
  const LERP = 0.12; // trailing factor (more lag)

  const stateByEl = new Map();

  const ensureState = (sideEl) => {
    let s = stateByEl.get(sideEl);
    if (s) return s;
    const items = Array.from(sideEl.querySelectorAll(".teamPortrait"));
    s = {
      items,
      target: items.map(() => 1),
      current: items.map(() => 1),
      active: false,
      hotIdx: -1,
      raf: 0,
      lastX: 0,
      lastY: 0,
    };
    stateByEl.set(sideEl, s);
    return s;
  };

  const tick = (sideEl) => {
    const s = ensureState(sideEl);
    if (!s.items.length) return;

    let any = false;
    for (let i = 0; i < s.items.length; i++) {
      const a = s.current[i];
      const b = s.target[i];
      const n = a + (b - a) * LERP;
      s.current[i] = n;
      s.items[i].style.setProperty("--dock-scale", n.toFixed(4));
      if (Math.abs(b - n) > 0.002) any = true;
    }

    if (s.active || any) {
      s.raf = requestAnimationFrame(() => tick(sideEl));
    } else {
      s.raf = 0;
    }
  };

  const setHot = (s, idx) => {
    if (s.hotIdx === idx) return;
    s.hotIdx = idx;
    for (let i = 0; i < s.items.length; i++) {
      s.items[i].classList.toggle("is-hot", i === idx);
    }
  };

  const computeTargets = (sideEl, clientX, clientY) => {
    const s = ensureState(sideEl);
    const centers = s.items.map((el) => {
      const r = el.getBoundingClientRect();
      return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
    });

    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const dx = clientX - centers[i].cx;
      const dy = clientY - centers[i].cy;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
      const t = clamp(1 - d / RADIUS, 0, 1);
      const mag = 1 + (t * t) * MAX;
      s.target[i] = mag;
    }
    setHot(s, bestIdx);
  };

  const reset = (sideEl) => {
    const s = ensureState(sideEl);
    s.active = false;
    s.target = s.target.map(() => 1);
    setHot(s, -1);
    if (!s.raf) s.raf = requestAnimationFrame(() => tick(sideEl));
  };

  for (const sideEl of sides) {
    const s = ensureState(sideEl);

    sideEl.addEventListener(
      "pointerenter",
      (e) => {
        s.active = true;
        computeTargets(sideEl, e.clientX, e.clientY);
        if (!s.raf) s.raf = requestAnimationFrame(() => tick(sideEl));
      },
      { passive: true }
    );

    sideEl.addEventListener(
      "pointermove",
      (e) => {
        if (!s.active) return;
        computeTargets(sideEl, e.clientX, e.clientY);
      },
      { passive: true }
    );

    sideEl.addEventListener("pointerleave", () => reset(sideEl), { passive: true });

    // Keyboard: make focused portrait “hot” and slightly magnified.
    sideEl.addEventListener("focusin", (e) => {
      const idx = s.items.findIndex((x) => x === e.target || x.contains(e.target));
      if (idx < 0) return;
      s.active = true;
      for (let i = 0; i < s.target.length; i++) s.target[i] = i === idx ? 1.16 : 1;
      setHot(s, idx);
      if (!s.raf) s.raf = requestAnimationFrame(() => tick(sideEl));
    });
  }
}

function setupVideo() {
  const wrap = document.getElementById("videoWrap");
  const video = document.getElementById("pitchVideo");
  const overlay = document.getElementById("videoOverlay");
  const cursor = document.getElementById("cursorTime");
  const cursorText = document.getElementById("cursorTimeText");
  const skipBtn = document.getElementById("skipBtn");
  const soundBtn = document.getElementById("pitchSoundBtn");

  if (!wrap || !video || !overlay || !cursor || !cursorText || !skipBtn) return;

  // Expose for screen-change autoplay attempts.
  PITCH = { video, overlay, soundBtn };

  let duration = 0;
  const updateText = () => {
    cursorText.textContent = `${padTime(video.currentTime)} / ${padTime(duration)}`;
  };

  video.addEventListener("loadedmetadata", () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    updateText();
  });
  video.addEventListener("timeupdate", updateText);

  overlay.addEventListener("click", async () => {
    try {
      // User gesture: allow sound.
      video.muted = false;
      if (soundBtn) setSoundBtnState(soundBtn, video.muted);
      VIDEO_LOADING.schedule(video, wrap);
      await video.play();
      overlay.classList.add("is-hidden");
    } catch {
      // If playback fails, keep overlay visible.
    }
  });

  // If the browser allows muted autoplay, hide overlay once we’re playing.
  video.addEventListener("playing", () => overlay.classList.add("is-hidden"));
  video.addEventListener("pause", () => {
    // Keep overlay hidden if we've started; don't force it back.
  });

  // Cursor time follows pointer over the video wrap
  wrap.addEventListener(
    "pointermove",
    (e) => {
      const r = wrap.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      cursor.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
    },
    { passive: true }
  );
  wrap.addEventListener("pointerenter", () => cursor.classList.remove("is-hidden"));
  wrap.addEventListener("pointerleave", () => (cursor.style.transform = "translate3d(-999px,-999px,0)"));

  // Click to skip (cursor copy requirement)
  cursor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    goToIndex(2);
  });
  wrap.addEventListener("click", (e) => {
    // Allow overlay clicks to start playback; when playing, click anywhere skips.
    if (!video.paused && !video.ended) {
      e.preventDefault();
      goToIndex(2);
    }
  });
  skipBtn.addEventListener("click", () => {
    goToIndex(2);
  });

  // When video ends, auto-advance.
  video.addEventListener("ended", () => {
    goToIndex(2);
  });

  // Speaker button: force mute/unmute toggle.
  if (soundBtn) {
    setSoundBtnState(soundBtn, video.muted);
    soundBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const nextMuted = !video.muted;
        video.muted = nextMuted;
        if (!nextMuted) {
          video.volume = 1;
          await video.play();
          overlay.classList.add("is-hidden");
        }
      } catch {
        // If unmute play fails, keep overlay visible.
        overlay.classList.remove("is-hidden");
      } finally {
        setSoundBtnState(soundBtn, video.muted);
      }
    });
  }
}

async function attemptVideoPlayWithSound() {
  if (!PITCH?.video) return;
  try {
    // Always restart when the user scrolls to the video screen.
    try {
      PITCH.video.pause();
      PITCH.video.currentTime = 0;
    } catch {}

    // We *try* with sound; many browsers will block without a gesture.
    PITCH.video.muted = false;
    VIDEO_LOADING.schedule(PITCH.video, document.getElementById("videoWrap"));
    await PITCH.video.play();
    PITCH?.overlay?.classList.add("is-hidden");
    if (PITCH?.soundBtn) setSoundBtnState(PITCH.soundBtn, PITCH.video.muted);
  } catch {
    // Leave overlay up to prompt a click-to-play gesture.
    PITCH?.overlay?.classList.remove("is-hidden");
    if (PITCH?.soundBtn) setSoundBtnState(PITCH.soundBtn, PITCH.video.muted);
  }
}

function setSoundBtnState(btn, muted) {
  if (!btn) return;
  btn.classList.toggle("is-muted", !!muted);
  btn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
}

async function attemptInterstitialPlayWithSound(screenEl) {
  const rec = INTERSTITIAL_BY_SCREEN.get(screenEl);
  if (!rec?.video) return;

  const { video, overlay, soundBtn, wrap } = rec;
  try {
    // Always restart when entering the screen.
    try {
      video.pause();
      video.currentTime = 0;
    } catch {}

    video.muted = false;
    video.volume = 1;
    VIDEO_LOADING.schedule(video, wrap || screenEl.querySelector(".videoWrap"));
    await video.play();
    overlay?.classList.add("is-hidden");
    if (soundBtn) setSoundBtnState(soundBtn, video.muted);
  } catch {
    // If autoplay-with-sound fails, try muted autoplay (so motion still plays),
    // and show an overlay to allow a user gesture to enable sound.
    try {
      video.muted = true;
      VIDEO_LOADING.schedule(video, wrap || screenEl.querySelector(".videoWrap"));
      await video.play();
    } catch {}
    overlay?.classList.remove("is-hidden");
    if (soundBtn) setSoundBtnState(soundBtn, video.muted);
  }
}

function setupInterstitialVideos() {
  const screens = Array.from(document.querySelectorAll(".screen--interstitial"));
  for (const s of screens) {
    const wrap = s.querySelector(".videoWrap");
    const video = s.querySelector("video");
    const overlay = s.querySelector(".interstitialOverlay");
    const soundBtn = s.querySelector(".videoSoundBtn");
    const cursor = s.querySelector(".cursorTime");
    const cursorText = s.querySelector(".cursorTime__text");
    if (!video || !overlay) continue;

    INTERSTITIAL_BY_SCREEN.set(s, { video, overlay, soundBtn, wrap, cursor, cursorText });

    // Cursor time UI (match pitch video).
    if (wrap && cursor && cursorText) {
      let duration = 0;
      const updateText = () => {
        cursorText.textContent = `${padTime(video.currentTime)} / ${padTime(duration)}`;
      };
      video.addEventListener("loadedmetadata", () => {
        duration = Number.isFinite(video.duration) ? video.duration : 0;
        updateText();
      });
      video.addEventListener("timeupdate", updateText);

      wrap.addEventListener(
        "pointermove",
        (e) => {
          const r = wrap.getBoundingClientRect();
          const x = e.clientX - r.left;
          const y = e.clientY - r.top;
          cursor.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
        },
        { passive: true }
      );
      wrap.addEventListener("pointerleave", () => (cursor.style.transform = "translate3d(-999px,-999px,0)"));

      const skipToNext = () => {
        const idx = SCREENS.indexOf(s);
        if (idx >= 0) goToIndex(idx + 1);
      };
      cursor.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        skipToNext();
      });
      wrap.addEventListener("click", (e) => {
        // When playing, click anywhere skips (match pitch UX).
        if (!video.paused && !video.ended) {
          e.preventDefault();
          skipToNext();
        }
      });
    }

    overlay.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        // User gesture: allow sound.
        video.muted = false;
        video.volume = 1;
        // Restart so it always plays from the top once sound is enabled.
        try { video.currentTime = 0; } catch {}
        VIDEO_LOADING.schedule(video, wrap || s.querySelector(".videoWrap"));
        await video.play();
        overlay.classList.add("is-hidden");
        if (soundBtn) setSoundBtnState(soundBtn, video.muted);
      } catch {
        // Keep overlay visible if play fails.
      }
    });

    // If playback starts (muted or not), we can hide overlay unless sound was blocked.
    video.addEventListener("playing", () => {
      // If the video is muted, keep the overlay up to encourage enabling sound.
      if (!video.muted) overlay.classList.add("is-hidden");
    });

    // Speaker button: force mute/unmute toggle.
    if (soundBtn) {
      setSoundBtnState(soundBtn, video.muted);
      soundBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const nextMuted = !video.muted;
          video.muted = nextMuted;
          if (!nextMuted) {
            video.volume = 1;
            await video.play();
            overlay.classList.add("is-hidden");
          } else {
            overlay.classList.remove("is-hidden");
          }
        } catch {
          // If unmute play fails, keep overlay visible.
          overlay.classList.remove("is-hidden");
        } finally {
          setSoundBtnState(soundBtn, video.muted);
        }
      });
    }

    // Auto-advance to the next screen when the interstitial ends.
    video.addEventListener("ended", () => {
      const idx = SCREENS.indexOf(s);
      if (idx >= 0) goToIndex(idx + 1);
    });
  }
}

function mountTotalViews() {
  const ENDPOINT =
    "https://script.google.com/macros/s/AKfycbzH8CpFGFkvE8jmorgQtyXpdXQ_ByqGjQQBHjoAQRxdWHE5iJ_bE5nJWT10uIAq2tUM/exec";
  const h1 = document.getElementById("yt-total-views");
  if (!h1) return;

  const fmt = (n) => (n || 0).toLocaleString();

  async function fetchAndRender() {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const data = await res.json();
      const total = Number(data.total || 0);
      h1.textContent = `${fmt(total)} VIEWS`;
    } catch (e) {
      console.error(e);
      h1.textContent = "—";
    }
  }

  fetchAndRender();
  setInterval(fetchAndRender, 5 * 60 * 1000);
}

function mountInvestorWidget() {
  const mount = document.getElementById("investMount");
  if (!mount) return;

  mount.innerHTML = `
    <div class="nsc-invest-wrap" aria-live="polite">
      <div class="nsc-progress" role="progressbar" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1">
        <span class="nsc-progress-dot nsc-active"></span>
        <span class="nsc-progress-dot"></span>
        <span class="nsc-progress-dot"></span>
        <span class="nsc-progress-dot"></span>
        <span class="nsc-progress-dot"></span>
      </div>
      <div class="nsc-card" role="group" aria-label="Noble Investor Interest Form">
        <section class="nsc-step nsc-step--active" data-step="1">
          <div class="nsc-actions">
            <button type="button" class="btn btn--gold nsc-btn nsc-primary" data-next>I want to invest</button>
          </div>
          <div class="nsc-note">Filling out this form is an indication of your interest, not a commitment or offer.</div>
        </section>
        <section class="nsc-step" data-step="2">
          <h2 class="nsc-title">I'm investing as:</h2>
          <div class="nsc-grid-buttons">
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice" data-choice="investorType" data-value="Myself">Myself</button>
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice" data-choice="investorType" data-value="Entity or Trust">An Entity or Trust</button>
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice" data-choice="investorType" data-value="Donor Advised Fund">Donor Advised Fund</button>
          </div>
          <div class="nsc-nav"><button type="button" class="nsc-link" data-back>&larr; Back</button></div>
        </section>
        <section class="nsc-step" data-step="3">
          <h2 class="nsc-title">Select your investment amount</h2>
          <div class="nsc-grid-buttons">
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice nsc-quick" data-choice="amount" data-value="5000">$5,000</button>
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice nsc-quick" data-choice="amount" data-value="10000">$10,000</button>
            <button type="button" class="btn btn--ghost nsc-btn nsc-choice nsc-quick" data-choice="amount" data-value="25000">$25,000</button>
          </div>
          <div class="nsc-divider" role="separator" aria-hidden="true"></div>
          <label class="nsc-label" for="nsc-amount-select">Or choose another amount</label>
          <select id="nsc-amount-select" class="nsc-input nsc-select nsc-amount-select" aria-label="Select investment amount">
            <option value="">Select an amount…</option>
            <option value="2500">$2,500.00 — $3.14 / unit</option>
            <option value="7500">$7,500.00 — $2.66 / unit</option>
            <option value="12500">$12,500.00 — $2.19 / unit</option>
            <option value="15000">$15,000.00 — $1.95 / unit</option>
            <option value="17500">$17,500.00 — $1.71 / unit</option>
            <option value="20000">$20,000.00 — $1.48 / unit</option>
            <option value="22500">$22,500.00 — $1.24 / unit</option>
            <option value="25000plus">$25,000.00+ — $1.00 / unit</option>
          </select>
          <div class="nsc-field nsc-plus-wrap hidden">
            <label class="nsc-label" for="nsc-plus">Enter custom amount (min $25,000)</label>
            <input id="nsc-plus" class="nsc-input nsc-plus" type="number" inputmode="decimal" min="25000" step="100" placeholder="25,000+" />
          </div>
          <div class="nsc-field">
            <div class="nsc-pricehint hidden" aria-live="polite">
              <strong>Price per Unit:</strong> <span class="nsc-price">$—</span>
            </div>
          </div>
          <div class="nsc-nav"><button type="button" class="nsc-link" data-back>&larr; Back</button></div>
        </section>
        <section class="nsc-step" data-step="4">
          <h2 class="nsc-title">Your contact info</h2>
          <div class="nsc-field">
            <label class="nsc-label" for="nsc-name">Full name</label>
            <input id="nsc-name" class="nsc-input nsc-name" type="text" autocomplete="name" required />
          </div>
          <div class="nsc-field">
            <label class="nsc-label" for="nsc-email">Email</label>
            <input id="nsc-email" class="nsc-input nsc-email" type="email" autocomplete="email" required />
          </div>
          <div class="nsc-field">
            <label class="nsc-label" for="nsc-phone">Phone</label>
            <input id="nsc-phone" class="nsc-input nsc-phone" type="tel" autocomplete="tel" />
          </div>
          <div class="nsc-actions">
            <button type="button" class="btn btn--gold nsc-btn nsc-primary nsc-submit">
              <span class="nsc-btn-text">Submit</span>
              <span class="nsc-spinner" aria-hidden="true"></span>
            </button>
          </div>
          <div class="nsc-nav"><button type="button" class="nsc-link" data-back>&larr; Back</button></div>
          <div class="nsc-note">By tapping submit, you're simply sharing your interest—this is not an investment commitment or offer.</div>
        </section>
        <section class="nsc-step" data-step="5">
          <h2 class="nsc-title">Thank you!</h2>
          <p class="nsc-p">Andrew will be in touch with you soon to talk about next steps.</p>
        </section>
        <div class="nsc-toast hidden" role="status" aria-live="polite"></div>
      </div>
    </div>
  `;

  // Original behavior logic (adapted to be mount-safe)
  const UNIT_PRICES = [
    { min: 25000, price: 1.0 },
    { min: 22500, price: 1.24 },
    { min: 20000, price: 1.48 },
    { min: 17500, price: 1.71 },
    { min: 15000, price: 1.95 },
    { min: 12500, price: 2.19 },
    { min: 10000, price: 2.43 },
    { min: 7500, price: 2.66 },
    { min: 5000, price: 2.9 },
    { min: 2500, price: 3.14 },
  ];
  function getUnitPrice(amount) {
    if (!amount || isNaN(amount)) return null;
    if (amount >= 25000) return 1.0;
    for (const t of UNIT_PRICES) if (amount >= t.min) return t.price;
    return null;
  }

  const root = mount.querySelector(".nsc-invest-wrap");
  const el = (s, r = root) => r.querySelector(s);
  const els = (s, r = root) => Array.from(r.querySelectorAll(s));

  const steps = els(".nsc-step");
  const dots = els(".nsc-progress-dot");
  let current = 1;
  let submitting = false;
  const data = { investorType: null, amount: null, name: "", email: "", phone: "" };
  root.dataset.instanceId = root.dataset.instanceId || `nsc-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function go(step) {
    current = clamp(step, 1, 5);
    steps.forEach((s) => s.classList.toggle("nsc-step--active", Number(s.dataset.step) === current));
    dots.forEach((d, i) => {
      d.classList.remove("nsc-active", "nsc-done");
      if (i + 1 < current) d.classList.add("nsc-done");
      if (i + 1 === current) d.classList.add("nsc-active");
    });
    el(".nsc-progress").setAttribute("aria-valuenow", String(current));
  }
  function next() {
    go(current + 1);
  }
  function back() {
    if (current > 1) go(current - 1);
  }

  els("[data-next]").forEach((b) => b.addEventListener("click", next));
  els("[data-back]").forEach((b) => b.addEventListener("click", back));

  els('.nsc-btn.nsc-choice[data-choice="investorType"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      els('.nsc-btn.nsc-choice[data-choice="investorType"]').forEach((b) => b.classList.remove("nsc-selected"));
      btn.classList.add("nsc-selected");
      data.investorType = btn.dataset.value;
      next();
    });
  });

  function updatePrice(amount) {
    const p = getUnitPrice(amount);
    const wrap = el(".nsc-pricehint");
    const span = el(".nsc-price");
    if (p == null) {
      wrap.classList.add("hidden");
      return;
    }
    span.textContent = `$${p.toFixed(2)}`;
    wrap.classList.remove("hidden");
  }

  els(".nsc-quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      els(".nsc-quick").forEach((b) => b.classList.remove("nsc-selected"));
      btn.classList.add("nsc-selected");
      const amt = Number(btn.dataset.value);
      data.amount = amt;
      updatePrice(amt);
      next();
    });
  });

  const amountSelect = el(".nsc-amount-select");
  const plusWrap = el(".nsc-plus-wrap");
  const plusInput = el(".nsc-plus");
  amountSelect.addEventListener("change", () => {
    const val = amountSelect.value;
    els(".nsc-quick").forEach((b) => b.classList.remove("nsc-selected"));
    if (val === "25000plus") {
      plusWrap.classList.remove("hidden");
      plusInput.value = "25000";
      data.amount = 25000;
      updatePrice(25000);
      plusInput.focus({ preventScroll: true });
    } else if (val) {
      plusWrap.classList.add("hidden");
      data.amount = Number(val);
      updatePrice(data.amount);
      next();
    } else {
      plusWrap.classList.add("hidden");
      el(".nsc-pricehint").classList.add("hidden");
      data.amount = null;
    }
  });
  plusInput.addEventListener("input", () => {
    const n = Number(plusInput.value || 0);
    if (n >= 25000) {
      data.amount = n;
      updatePrice(n);
    } else {
      data.amount = null;
    }
  });
  plusInput.addEventListener("change", () => {
    const n = Number(plusInput.value || 0);
    if (n >= 25000) {
      data.amount = n;
      next();
    }
  });

  const submitBtn = el(".nsc-submit");
  const nameEl = el(".nsc-name");
  const emailEl = el(".nsc-email");
  const phoneEl = el(".nsc-phone");
  const toast = (msg, ms = 2400) => {
    const t = el(".nsc-toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), ms);
  };
  const valid = () => {
    const n = nameEl.value.trim();
    const e = emailEl.value.trim();
    if (!data.investorType) {
      go(2);
      toast("Select how you are investing");
      return false;
    }
    if (!data.amount) {
      go(3);
      toast("Choose an amount");
      return false;
    }
    if (!n) {
      go(4);
      toast("Please enter your name");
      return false;
    }
    if (!/.+@.+\..+/.test(e)) {
      go(4);
      toast("Please enter a valid email");
      return false;
    }
    return true;
  };

  submitBtn.addEventListener("click", async () => {
    if (submitting) return;
    data.name = nameEl.value.trim();
    data.email = emailEl.value.trim();
    data.phone = phoneEl.value.trim();
    if (!valid()) return;

    submitting = true;
    submitBtn.classList.add("submitting");
    submitBtn.disabled = true;

    const idem = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const payload = {
      source: "Noble Investor Interest",
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      instanceId: root.dataset.instanceId,
      idem,
      ...data,
    };

    const ENDPOINT =
      "https://script.google.com/macros/s/AKfycbzBR1UqjBpoT0mmPTx06_2O1ff-sT8QtgzATqL7P3zzG9PRzdKxtmv1rhP6ukl-99AO/exec";
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Non-2xx");
    } catch (e) {
      console.error("Submit failed:", e);
    }
    go(5);
  });

  go(1);
}

function bindBrandHub() {
  const hub = document.getElementById("brandHub");
  if (!hub) return;

  const bgVideo = document.getElementById("brandBgVideo");
  const DEFAULT_SRC = "./assets/Noble%20Story%20Co%20Logo%20Clips.mp4";
  const STORY_SRC = "./assets/NSCBG.mp4";
  const NCN_SRC = "./assets/B-Rush%20BTS.mp4";
  const defaultSrc = DEFAULT_SRC;

  const setBgSrc = async (src) => {
    if (!bgVideo) return;
    // If the markup deferred the initial source, make sure it gets assigned before swapping.
    SMART_VIDEO_LOADER.ensureSrcAssigned(bgVideo);
    const current = bgVideo.querySelector("source")?.getAttribute("src");
    if (current === src) return;
    const sourceEl = bgVideo.querySelector("source");
    if (sourceEl) {
      sourceEl.setAttribute("src", src);
      const lower = src.toLowerCase();
      const type =
        lower.endsWith(".mp4") ? "video/mp4" :
        lower.endsWith(".mov") ? "video/quicktime" :
        "";
      if (type) sourceEl.setAttribute("type", type);
      else sourceEl.removeAttribute("type");
    }
    // GSAP crossfade (fallback to instant swap if GSAP not present)
    const fadeOut = () => {
      if (window.gsap) {
        return new Promise((resolve) =>
          window.gsap.to(bgVideo, { opacity: 0, duration: 0.22, ease: "power2.out", onComplete: resolve })
        );
      }
      bgVideo.style.opacity = "0";
      return Promise.resolve();
    };
    const fadeIn = () => {
      if (window.gsap) {
        return new Promise((resolve) =>
          window.gsap.to(bgVideo, { opacity: 1, duration: 0.35, ease: "power2.out", onComplete: resolve })
        );
      }
      bgVideo.style.opacity = "1";
      return Promise.resolve();
    };

    await fadeOut();
    bgVideo.load();

    // Wait briefly for enough data to render a frame, then play (muted autoplay).
    await new Promise((resolve) => {
      const done = () => {
        bgVideo.removeEventListener("loadeddata", done);
        bgVideo.removeEventListener("canplay", done);
        resolve();
      };
      bgVideo.addEventListener("loadeddata", done, { once: true });
      bgVideo.addEventListener("canplay", done, { once: true });
      setTimeout(done, 400);
    });

    try {
      bgVideo.muted = true;
      await bgVideo.play();
    } catch {}
    await fadeIn();
  };

  const picks = Array.from(hub.querySelectorAll(".brandPick"));
  const clear = () => {
    delete document.body.dataset.brandFocus;
    picks.forEach((p) => p.classList.remove("is-active"));
    setBgSrc(defaultSrc);
  };

  for (const p of picks) {
    const brand = p.getAttribute("data-brand");
    const set = () => {
      document.body.dataset.brandFocus = brand;
      picks.forEach((x) => x.classList.toggle("is-active", x === p));
      if (brand === "story") setBgSrc(STORY_SRC);
      if (brand === "ncn") setBgSrc(NCN_SRC);
    };
    p.addEventListener("pointerenter", set, { passive: true });
    p.addEventListener("pointerleave", clear, { passive: true });
    p.addEventListener("focusin", set);
    p.addEventListener("focusout", clear);
    // Touch: tap to focus brand; tap again to clear.
    p.addEventListener("click", () => {
      if (document.body.dataset.brandFocus === brand) clear();
      else set();
    });
  }

  // Expose to the screen-change handler so the default always plays when Screen 2 becomes active.
  const ensureDefaultBg = () => setBgSrc(defaultSrc);
  BRAND_HUB = { ensureDefaultBg, setBgSrc };
}

function bindBrandHubScrollCue() {
  const btn = document.getElementById("brandHubScrollBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // Brand overview is Screen index 2; advance to the next screen.
    goToIndex(3);
  });
}

// ---- Screen 5: Milestones (media scrollytelling) ----
const MILESTONES = [
  {
    kicker: "Endurance",
    title: "World-Class Talent Attachments",
    tag: "ENDURANCE",
    body: "Two-time Academy Award nominee Leslie Odom Jr. is attached to star as “Cedric King” in Endurance. Attached to direct is Roxann Dawson.",
    media: {
      type: "video",
      src: "./assets/Leslie.mp4",
      poster: "./assets/milestones/endurance.svg",
    },
  },
  {
    kicker: "Studio partner",
    title: "$1M+ Producing Deal",
    tag: "ENDURANCE",
    body: "Thanks to the strong package on Endurance, Noble was able to secure a landmark producing deal with our studio partner worth over $1 million with hefty backend participation.",
    media: {
      type: "video",
      src: "./assets/ProducingDeal.mp4",
      poster: "./assets/milestones/deal-poster.svg",
    },
  },
  {
    kicker: "The Heart Mender",
    title: "$1.25M Equity Secured",
    tag: "THE HEART MENDER",
    body: "We’ve successfully raised $1.25M for our WWII feature film The Heart Mender, and we’ve attached our friend David Henrie to star.",
    media: {
      type: "video",
      src: "./assets/THMposter.mp4",
      poster: "./assets/milestones/heart-mender.svg",
    },
  },
  {
    kicker: "Noble Creator Network",
    title: "$200K revenue • 1M+ views",
    tag: "NOBLE CREATOR NETWORK",
    body: "We launched Noble Creator Network and have partnered with four YouTube channels representing $200,000 in revenue over the last 16 months, with a combined total of over 1 million video views.",
    media: {
      type: "video",
      src: "./assets/NCNclips.mp4",
      poster: "./assets/milestones/ncn-poster.svg",
    },
  },
];

function mountMilestones() {
  const list = document.getElementById("milestonesList");
  const stage = document.getElementById("milestonesMediaStage");
  const meta = document.getElementById("milestonesMediaMeta");
  if (!list || !stage || !meta) return;

  list.innerHTML = "";
  stage.innerHTML = "";
  meta.innerHTML = "";

  const itemBtns = [];
  const stageItems = [];
  const stageVideos = [];

  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];

    // Media stage item
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "milestonesMedia__item";
    mediaWrap.dataset.index = String(i);

    if (m.media?.type === "video") {
      const v = document.createElement("video");
      v.playsInline = true;
      v.muted = true;
      v.loop = true;
      v.preload = "metadata";
      if (m.media.poster) v.poster = m.media.poster;
      v.setAttribute("aria-hidden", "true");

      const src = document.createElement("source");
      // Defer src so the global video loader can sequence network work.
      src.setAttribute("data-src", m.media.src);
      src.type = "video/mp4";
      v.appendChild(src);
      mediaWrap.appendChild(v);
      stageVideos[i] = v;
    } else {
      const img = document.createElement("img");
      img.src = m.media?.src || "";
      img.alt = m.media?.alt || "";
      img.decoding = "async";
      img.loading = "lazy";
      mediaWrap.appendChild(img);
      stageVideos[i] = null;
    }

    stage.appendChild(mediaWrap);
    stageItems[i] = mediaWrap;

    // List item button (role=option)
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "milestonesItem";
    btn.dataset.index = String(i);
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", "false");

    const head = document.createElement("div");
    head.className = "milestonesItem__head";

    const title = document.createElement("div");
    title.className = "milestonesItem__title";
    title.textContent = m.title;

    head.appendChild(title);

    if (m.tag) {
      const tag = document.createElement("div");
      tag.className = "milestonesItem__tag";
      tag.textContent = m.tag;
      head.appendChild(tag);
    }

    const body = document.createElement("div");
    body.className = "milestonesItem__body";
    body.textContent = m.body;

    btn.appendChild(head);
    btn.appendChild(body);

    btn.addEventListener("pointerenter", () => setActive(i), { passive: true });
    btn.addEventListener("focus", () => setActive(i));
    btn.addEventListener("click", () => setActive(i));

    list.appendChild(btn);
    itemBtns[i] = btn;
  }

  let activeIndex = 0;

  const renderMeta = (i) => {
    const m = MILESTONES[i];
    meta.innerHTML = "";

    const k = document.createElement("div");
    k.className = "milestonesMedia__k";
    k.textContent = m.kicker || "Milestone";

    const t = document.createElement("div");
    t.className = "milestonesMedia__t";
    t.textContent = m.title;

    const sub = document.createElement("div");
    sub.className = "milestonesMedia__sub";
    sub.textContent = m.body;

    meta.appendChild(k);
    meta.appendChild(t);
    meta.appendChild(sub);
  };

  const pauseAll = () => {
    for (const v of stageVideos) {
      if (!v) continue;
      try { v.pause(); } catch {}
      // If the user prefers reduced motion, force back to the poster frame.
      if (prefersReducedMotion()) {
        try { v.currentTime = 0; } catch {}
        try { v.load(); } catch {}
      }
    }
  };

  const playActiveIfVideo = async (i) => {
    if (prefersReducedMotion()) return;
    for (let idx = 0; idx < stageVideos.length; idx++) {
      const v = stageVideos[idx];
      if (!v) continue;
      if (idx === i) {
        try {
          v.muted = true;
          await v.play();
        } catch {}
      } else {
        try { v.pause(); } catch {}
      }
    }
  };

  const setActive = (i, { force = false } = {}) => {
    const next = clamp(i, 0, MILESTONES.length - 1);
    if (!force && next === activeIndex) return;
    activeIndex = next;

    for (let j = 0; j < itemBtns.length; j++) {
      const is = j === activeIndex;
      itemBtns[j].classList.toggle("is-active", is);
      itemBtns[j].setAttribute("aria-selected", is ? "true" : "false");
      stageItems[j].classList.toggle("is-active", is);
    }

    renderMeta(activeIndex);
    playActiveIfVideo(activeIndex);
  };

  // Keyboard navigation (buttons prevent global ArrowDown changing screens)
  list.addEventListener("keydown", (e) => {
    const key = e.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    e.preventDefault();

    const focusedIdx = Number(e.target?.dataset?.index);
    const base = Number.isFinite(focusedIdx) ? focusedIdx : activeIndex;

    let next = base;
    if (key === "ArrowDown") next = base + 1;
    if (key === "ArrowUp") next = base - 1;
    if (key === "Home") next = 0;
    if (key === "End") next = MILESTONES.length - 1;
    next = clamp(next, 0, MILESTONES.length - 1);

    setActive(next);
    itemBtns[next]?.focus({ preventScroll: true });
    itemBtns[next]?.scrollIntoView({ block: "nearest" });
  });

  // Scroll-driven selection via IntersectionObserver
  let io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((x) => x.isIntersecting);
        if (!vis.length) return;
        vis.sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));
        const idx = Number(vis[0].target?.dataset?.index);
        if (Number.isFinite(idx)) setActive(idx);
      },
      { root: list, threshold: [0.55] }
    );
    itemBtns.forEach((b) => io.observe(b));
  }

  // Initial state
  setActive(0, { force: true });

  MILESTONES_UI = {
    onEnter: () => setActive(activeIndex, { force: true }),
    onExit: () => pauseAll(),
    pauseAll,
    setActive,
    destroy: () => {
      try { io?.disconnect(); } catch {}
      pauseAll();
    },
  };
}

// ---- Screen 9: Projects (nested layout similar to milestones) ----
function mountProjects() {
  const dataEl = document.getElementById("projectsData");
  const list = document.getElementById("projectsList");
  const stage = document.getElementById("projectsMediaStage");
  const bgImage = document.getElementById("projectsMediaBgImage");
  if (!dataEl || !list || !stage || !bgImage) return;

  const PROJECTS = JSON.parse(dataEl.textContent);
  list.innerHTML = "";
  stage.innerHTML = "";

  // Map project titles to background images
  const BG_IMAGES = {
    "Endurance": "./assets/endurance_bg.png",
    "The Heart Mender": "./assets/heartmender_bg.png",
    "It's a Christmas Miracle, Charlie Brown": "./assets/iacmcb_bg.png"
  };

  const itemBtns = [];
  const stageItems = [];

  for (let i = 0; i < PROJECTS.length; i++) {
    const p = PROJECTS[i];

    // Media stage item
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "projectsMedia__item";
    mediaWrap.dataset.index = String(i);

    const img = document.createElement("img");
    img.src = p.poster;
    img.alt = p.alt;
    img.decoding = "async";
    img.loading = "lazy";
    mediaWrap.appendChild(img);

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

    // Tab content panel
    const tabPanel = document.createElement("div");
    tabPanel.className = "projectsTabPanel";
    tabPanel.dataset.index = String(i);
    tabPanel.setAttribute("role", "tabpanel");
    tabPanel.setAttribute("aria-hidden", "true");

    const description = document.createElement("p");
    description.className = "projectsTabPanel__description";
    description.textContent = p.description;

    const detailsText = document.createElement("p");
    detailsText.className = "projectsTabPanel__details";
    detailsText.textContent = p.details;

    tabPanel.appendChild(description);
    tabPanel.appendChild(detailsText);

    if (p.links && p.links.length > 0) {
      const links = document.createElement("div");
      links.className = "projectsTabPanel__links";
      p.links.forEach(link => {
        if (link.type === "video") {
          // Create button for video modal
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn--ghost projectsTabPanel__link";
          btn.textContent = link.text;
          btn.addEventListener("click", () => openVideoModal(p.video));
          links.appendChild(btn);
        } else {
          // Regular link
          const a = document.createElement("a");
          a.href = link.href;
          a.className = "btn btn--ghost projectsTabPanel__link";
          a.textContent = link.text;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          links.appendChild(a);
        }
      });
      tabPanel.appendChild(links);
    }

    list.appendChild(tabBtn);
    itemBtns[i] = { button: tabBtn, panel: tabPanel };
  }
  
  // Add tab panels container
  const panelsContainer = document.createElement("div");
  panelsContainer.className = "projectsTabPanels";
  panelsContainer.setAttribute("role", "tablist");
  
  for (let i = 0; i < itemBtns.length; i++) {
    panelsContainer.appendChild(itemBtns[i].panel);
  }
  
  const projectsPanel = list.parentElement;
  projectsPanel.appendChild(panelsContainer);

  let activeIndex = 0;

  const showTab = (i, immediate = false) => {
    // Hide all panels and update buttons
    for (let idx = 0; idx < itemBtns.length; idx++) {
      const { button, panel } = itemBtns[idx];
      const isActive = idx === i;
      
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      panel.classList.toggle("is-active", isActive);
      panel.setAttribute("aria-hidden", String(!isActive));
    }
    
    // Also update active index for poster
    if (activeIndex !== i) {
      setActive(i);
    }

    // Hover-to-select should keep the selection "locked" so users can move
    // from the tab into the panel buttons without the UI reverting.
    const project = PROJECTS[i];
    const bgSrc = project ? BG_IMAGES[project.title] : null;
    if (bgSrc) {
      setBgImage(bgSrc).catch((err) => {
        console.warn("Failed to load background image:", bgSrc, err);
      });
    }
  };

  const setBgImage = async (src) => {
    if (!bgImage || !src) {
      console.warn('setBgImage: missing bgImage or src', { bgImage: !!bgImage, src });
      return;
    }
    
    const current = bgImage.getAttribute("src") || "";
    const currentOpacity = parseFloat(bgImage.style.opacity || getComputedStyle(bgImage).opacity || "0");
    if (current === src && currentOpacity > 0) {
      console.log('setBgImage: image already loaded and visible', src);
      return;
    }

    console.log('setBgImage: loading', src);

    // GSAP crossfade (fallback to instant swap if GSAP not present)
    const fadeOut = () => {
      if (window.gsap) {
        return new Promise((resolve) => {
          window.gsap.killTweensOf(bgImage);
          bgImage.style.removeProperty("opacity");
          window.gsap.to(bgImage, { 
            opacity: 0, 
            duration: 0.22, 
            ease: "power2.out", 
            onComplete: resolve 
          });
        });
      }
      bgImage.style.opacity = "0";
      return Promise.resolve();
    };
    const fadeIn = () => {
      const targetOpacity = 0.4; // Reduced opacity for better text readability
      if (window.gsap) {
        return new Promise((resolve) => {
          // Kill any existing animations
          window.gsap.killTweensOf(bgImage);
          // Remove any inline opacity to let GSAP control it
          bgImage.style.removeProperty("opacity");
          window.gsap.to(bgImage, { 
            opacity: targetOpacity, 
            duration: 0.35, 
            ease: "power2.out",
            onComplete: () => {
              // After animation, ensure it stays at target opacity
              window.gsap.set(bgImage, { opacity: targetOpacity });
              resolve();
            }
          });
        });
      }
      bgImage.style.opacity = String(targetOpacity);
      return Promise.resolve();
    };

    await fadeOut();
    
    // Preload the image
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = () => {
        console.log('setBgImage: preload success', src);
        resolve();
      };
      img.onerror = (err) => {
        console.error('setBgImage: preload error', src, err);
        resolve(); // Still resolve even on error to continue
      };
      img.src = src;
    });
    
    bgImage.src = src;
    console.log('setBgImage: set src to', src);
    
    // Wait for the actual image element to load
    if (!bgImage.complete) {
      await new Promise((resolve) => {
        const done = () => {
          bgImage.removeEventListener("load", done);
          bgImage.removeEventListener("error", done);
          console.log('setBgImage: bgImage load event', src);
          resolve();
        };
        bgImage.addEventListener("load", done, { once: true });
        bgImage.addEventListener("error", (err) => {
          console.error('setBgImage: bgImage error event', src, err);
          done();
        }, { once: true });
        setTimeout(() => {
          console.log('setBgImage: timeout waiting for load', src);
          done();
        }, 500);
      });
    } else {
      console.log('setBgImage: image already complete', src);
    }
    
    await fadeIn();
    console.log('setBgImage: fade in complete', src);
  };

  const setActive = (i, { force = false } = {}) => {
    if (!force && i === activeIndex) return;
    activeIndex = i;

    // Update media items
    for (let idx = 0; idx < stageItems.length; idx++) {
      stageItems[idx].classList.toggle("is-active", idx === i);
    }

    // Update tab buttons (visual highlight only, not tab switching)
    for (let idx = 0; idx < itemBtns.length; idx++) {
      const isActive = idx === i;
      itemBtns[idx].button.classList.toggle("is-active", isActive);
    }

    // Don't update background image here - only on hover
  };

  // Hover-to-select: hovering a tab selects and stays selected (no mouseleave revert).
  for (let i = 0; i < itemBtns.length; i++) {
    const { button } = itemBtns[i];
    
    // Hover selects
    button.addEventListener("pointerenter", () => {
      showTab(i);
    }, { passive: true });

    // Click selects (touch / explicit intent)
    button.addEventListener("click", () => {
      showTab(i, true);
    });

    // Focus selects (keyboard navigation)
    button.addEventListener("focus", () => {
      showTab(i);
    });
  }

  // Set initial active state (first item)
  setActive(0, { force: true });
  showTab(0, true);
}

// ---- Screen 10: NCN Projects (tabs with video hover) ----
function bindNcnPillars() {
  const tabsContainer = document.getElementById("ncnTabs");
  const bgVideo = document.getElementById("ncnProjectsBgVideo");
  if (!tabsContainer || !bgVideo) return;

  const DEFAULT_SRC = "./assets/Noble%20Story%20Co%20Logo%20Clips.mp4";
  
  // Map tab data attributes to video sources
  const TAB_VIDEOS = {
    "top-of-class": "./assets/TOTCbg.mp4",
    "history": "./assets/LoconteBG.mp4",
    "coffee": "./assets/StephenBG.mp4",
    "faith-tech": "./assets/FandT.mp4"
  };

  const setBgSrc = async (src) => {
    if (!bgVideo) return;
    const current = bgVideo.querySelector("source")?.getAttribute("src");
    if (current === src) return;
    const sourceEl = bgVideo.querySelector("source");
    if (sourceEl) {
      sourceEl.setAttribute("src", src);
      const lower = src.toLowerCase();
      const type =
        lower.endsWith(".mp4") ? "video/mp4" :
        lower.endsWith(".mov") ? "video/quicktime" :
        "";
      if (type) sourceEl.setAttribute("type", type);
      else sourceEl.removeAttribute("type");
    }
    // GSAP crossfade (fallback to instant swap if GSAP not present)
    const fadeOut = () => {
      if (window.gsap) {
        return new Promise((resolve) =>
          window.gsap.to(bgVideo, { opacity: 0, duration: 0.22, ease: "power2.out", onComplete: resolve })
        );
      }
      bgVideo.style.opacity = "0";
      return Promise.resolve();
    };
    const fadeIn = () => {
      if (window.gsap) {
        return new Promise((resolve) =>
          window.gsap.to(bgVideo, { opacity: 1, duration: 0.35, ease: "power2.out", onComplete: resolve })
        );
      }
      bgVideo.style.opacity = "1";
      return Promise.resolve();
    };

    await fadeOut();
    bgVideo.load();

    // Wait briefly for enough data to render a frame, then play (muted autoplay).
    await new Promise((resolve) => {
      const done = () => {
        bgVideo.removeEventListener("loadeddata", done);
        bgVideo.removeEventListener("canplay", done);
        resolve();
      };
      bgVideo.addEventListener("loadeddata", done, { once: true });
      bgVideo.addEventListener("canplay", done, { once: true });
      setTimeout(done, 400);
    });

    try {
      bgVideo.muted = true;
      await bgVideo.play();
    } catch {}
    await fadeIn();
  };

  // Initially hide the video - only show gradient
  if (window.gsap) {
    window.gsap.set(bgVideo, { opacity: 0 });
  } else {
    bgVideo.style.opacity = "0";
  }

  const tabs = Array.from(tabsContainer.querySelectorAll(".ncnTab"));
  const panels = Array.from(tabsContainer.querySelectorAll(".ncnTabPanel"));
  const panelsContainer = tabsContainer.querySelector(".ncnTabs__panels");
  const arrow = document.getElementById("ncnTabPanelArrow");
  let activeTabIndex = 0;
  let isInitialLoad = true;

  const updateArrowPosition = (tabIndex) => {
    if (!arrow || !tabs[tabIndex]) return;
    
    const activeTab = tabs[tabIndex];
    const tabRect = activeTab.getBoundingClientRect();
    const panelsContainer = tabsContainer.querySelector(".ncnTabs__panels");
    const panelsRect = panelsContainer.getBoundingClientRect();
    
    // Calculate position relative to the panels container
    const tabCenter = tabRect.left + tabRect.width / 2;
    const relativeLeft = tabCenter - panelsRect.left;
    
    // Position arrow at the center of the active tab
    arrow.style.left = `${relativeLeft}px`;
    
    // Show arrow
    if (window.gsap) {
      window.gsap.to(arrow, { opacity: 1, duration: 0.3, ease: "power2.out" });
    } else {
      arrow.style.opacity = "1";
    }
  };

  const updateActiveTabVideo = () => {
    if (isInitialLoad) {
      // On initial load, don't show video
      if (window.gsap) {
        window.gsap.to(bgVideo, { opacity: 0, duration: 0.35, ease: "power2.out" });
      } else {
        bgVideo.style.opacity = "0";
      }
      return;
    }

    // Show video for active tab
    const activeTab = tabs[activeTabIndex];
    const pillarId = activeTab.getAttribute("data-pillar");
    const videoSrc = TAB_VIDEOS[pillarId] || DEFAULT_SRC;
    setBgSrc(videoSrc);
  };

  const showTab = (index) => {
    // Update tab states
    tabs.forEach((tab, i) => {
      const isActive = i === index;
      tab.setAttribute("aria-selected", String(isActive));
      tab.classList.toggle("is-active", isActive);
    });

    // Update panel states
    panels.forEach((panel, i) => {
      const isActive = i === index;
      panel.setAttribute("aria-hidden", String(!isActive));
      panel.classList.toggle("is-active", isActive);
    });

    activeTabIndex = index;
    
    // Show arrow and update position
    if (panelsContainer) {
      panelsContainer.classList.add("has-active");
    }
    updateArrowPosition(index);
    
    // Update video for active tab (if not hovering)
    updateActiveTabVideo();
  };

  // Set up tab interactions
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const pillarId = tab.getAttribute("data-pillar");
    const videoSrc = TAB_VIDEOS[pillarId] || DEFAULT_SRC;

    // Click: switch tab
    tab.addEventListener("click", () => {
      isInitialLoad = false; // Mark that user has interacted
      showTab(i);
    });

    // Hover-to-select: hovering selects and stays selected (so users can move into panel CTAs)
    tab.addEventListener("pointerenter", () => {
      isInitialLoad = false; // Mark that user has interacted
      showTab(i);
    }, { passive: true });

    // Focus: select (for keyboard navigation)
    tab.addEventListener("focusin", () => {
      isInitialLoad = false; // Mark that user has interacted
      showTab(i);
    });
  }

  // Initialize: show first tab and position arrow
  showTab(0);
  
  // Small delay to ensure layout is complete before positioning arrow
  setTimeout(() => {
    updateArrowPosition(0);
    // On initial load, ensure video is hidden
    if (isInitialLoad) {
      if (window.gsap) {
        window.gsap.set(bgVideo, { opacity: 0 });
      } else {
        bgVideo.style.opacity = "0";
      }
    }
  }, 100);

  // Update arrow position on window resize
  const handleResize = () => {
    updateArrowPosition(activeTabIndex);
  };
  window.addEventListener("resize", handleResize, { passive: true });

  // Ensure default video plays when screen becomes active
  const ensureDefaultBg = () => setBgSrc(DEFAULT_SRC);
  NCN_PILLARS = { ensureDefaultBg, setBgSrc };
}

// Video Modal functionality
function openVideoModal(videoUrl) {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoModalPlayer");
  const closeBtn = modal.querySelector(".videoModal__close");
  
  if (!modal || !player) return;
  
  // Extract Vimeo video ID from URL
  // URLs like: https://vimeo.com/738787460/36eee01ba3?fl=ls&fe=ec
  // We need the video ID (738787460) and the hash (36eee01ba3)
  const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)(?:\/([a-f0-9]+))?/);
  if (!vimeoMatch) return;
  
  const videoId = vimeoMatch[1];
  const hash = vimeoMatch[2] || '';
  
  // Build Vimeo embed URL
  let embedUrl = `https://player.vimeo.com/video/${videoId}`;
  if (hash) {
    embedUrl += `?h=${hash}&autoplay=1`;
  } else {
    embedUrl += `?autoplay=1`;
  }
  
  // Create iframe
  player.innerHTML = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  
  // Show modal
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  
  // Close handlers
  const handleEscape = (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  };
  
  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    player.innerHTML = "";
    document.removeEventListener("keydown", handleEscape);
  };
  
  closeBtn.addEventListener("click", closeModal, { once: true });
  modal.querySelector(".videoModal__backdrop").addEventListener("click", closeModal, { once: true });
  document.addEventListener("keydown", handleEscape);
}

// ---- Screen 12: Impact Orbit ----
function mountImpactOrbit() {
  const dataEl = document.getElementById("impactQuotesData");
  const ring = document.getElementById("impactOrbitRing");
  const orbit = document.getElementById("impactOrbit");
  if (!dataEl || !ring || !orbit) return;

  const QUOTES = JSON.parse(dataEl.textContent);
  ring.innerHTML = "";

  const getPortraitSize = () => (window.innerWidth <= 720 ? 90 : 120);

  const getConstellationMetrics = () => {
    const bounds = getBounds();
    // Oval shape (wider than tall) so it reads more like an orbit, less like a box.
    const rx = bounds.rx * 1.02;
    const ry = bounds.ry * 0.92;
    const maxZ = bounds.depth * 0.32;
    const exclusion = getCenterExclusion();
    const portraitSize = getPortraitSize();
    // Keep portraits farther from center
    const inner = 0.965;
    const outer = 1.0;
    return { bounds, rx, ry, maxZ, exclusion, portraitSize, inner, outer };
  };

  // Responsive bounds for constellation (in px, centered at 0,0).
  // We keep a margin so portraits don't clip at the orbit edge.
  const getBounds = () => {
    const rect = orbit.getBoundingClientRect();
    const portraitSize = getPortraitSize();
    // Smaller padding -> larger ellipse -> portraits sit farther from the center card.
    const pad = Math.max(14, portraitSize * 0.45);
    const rx = Math.max(0, rect.width / 2 - pad);
    const ry = Math.max(0, rect.height / 2 - pad);
    return {
      rx,
      ry,
      width: rx * 2,
      height: ry * 2,
      depth: 420,
    };
  };

  // Exclusion zone around the center title/description so portraits don't overlap it.
  const getCenterExclusion = () => {
    const portraitSize = getPortraitSize();
    const center = orbit.querySelector(".impactOrbit__center");
    if (!center) {
      return { halfW: portraitSize * 1.6, halfH: portraitSize * 1.25 };
    }
    const r = center.getBoundingClientRect();
    // Extra padding accounts for portrait radius + glow.
    return {
      halfW: r.width / 2 + portraitSize * 1.55,
      halfH: r.height / 2 + portraitSize * 1.25,
    };
  };
  
  const count = QUOTES.length;
  const portraits = [];
  let activePortrait = null;
  let rafId = null;
  let time = 0;

  // ---- Floating tooltip (fixed in viewport, clamped to a safe zone) ----
  const ensureTooltip = () => {
    let tip = document.getElementById("impactQuoteFloat");
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "impactQuoteFloat";
    tip.className = "impactQuoteFloat";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");

    const nameEl = document.createElement("div");
    nameEl.className = "impactQuoteFloat__name";
    const titleEl = document.createElement("div");
    titleEl.className = "impactQuoteFloat__title";
    const textEl = document.createElement("p");
    textEl.className = "impactQuoteFloat__text";

    tip.appendChild(nameEl);
    tip.appendChild(titleEl);
    tip.appendChild(textEl);

    document.body.appendChild(tip);
    return tip;
  };

  const tooltip = ensureTooltip();
  const tooltipName = tooltip.querySelector(".impactQuoteFloat__name");
  const tooltipTitle = tooltip.querySelector(".impactQuoteFloat__title");
  const tooltipText = tooltip.querySelector(".impactQuoteFloat__text");

  const hideTooltip = () => {
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.classList.remove("is-open");
    tooltip.style.left = "-9999px";
    tooltip.style.top = "-9999px";
  };

  const getSafeZone = () => {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const base = vw <= 720 ? 14 : 22;

    let left = base;
    let right = vw - base;
    let top = base;
    let bottom = vh - base;

    const chrome = document.getElementById("chrome");
    if (chrome && !document.body.classList.contains("chrome-hidden")) {
      const r = chrome.getBoundingClientRect();
      top = Math.max(top, r.bottom + 10);
    }

    const nav = document.getElementById("navDots");
    if (nav) {
      const r = nav.getBoundingClientRect();
      // Bottom dock (mobile): reserve space above it.
      if (r.width > r.height) bottom = Math.min(bottom, r.top - 10);
      // Side dock (desktop): reserve space to the left of it.
      else right = Math.min(right, r.left - 10);
    }

    // Keep zone sane even if UI overlaps.
    left = clamp(left, 0, vw);
    right = clamp(right, left + 20, vw);
    top = clamp(top, 0, vh);
    bottom = clamp(bottom, top + 20, vh);

    return { left, right, top, bottom };
  };

  const positionTooltipFor = (portraitEl) => {
    if (!portraitEl) return;
    const pr = portraitEl.getBoundingClientRect();
    const zone = getSafeZone();
    const gap = 12;
    const zoneWidth = Math.max(160, zone.right - zone.left);

    // Ensure the tooltip can never be wider than the safe zone.
    const wTarget = Math.min(320, zoneWidth);
    tooltip.style.width = `${wTarget}px`;
    tooltip.style.maxWidth = `${zoneWidth}px`;

    // Measure tooltip with current content.
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.classList.add("is-open");
    tooltip.setAttribute("aria-hidden", "false");
    // Keep invisible while measuring/positioning.
    tooltip.style.visibility = "hidden";

    // Force layout.
    void tooltip.offsetHeight;
    const tr = tooltip.getBoundingClientRect();
    const w = tr.width || 280;
    const h = tr.height || 120;

    const clampIntoZone = (x, y) => ({
      x: clamp(x, zone.left, zone.right - w),
      y: clamp(y, zone.top, zone.bottom - h),
    });

    const rectFor = (x, y) => ({ left: x, top: y, right: x + w, bottom: y + h });
    const intersects = (a, b) =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

    const cx = pr.left + pr.width / 2;
    const cy = pr.top + pr.height / 2;

    // Candidate placements: above/below centered, then left/right centered.
    const candidates = [
      { name: "above", x: cx - w / 2, y: pr.top - gap - h },
      { name: "below", x: cx - w / 2, y: pr.bottom + gap },
      { name: "right", x: pr.right + gap, y: cy - h / 2 },
      { name: "left", x: pr.left - gap - w, y: cy - h / 2 },
    ].map((c) => ({ ...c, ...clampIntoZone(c.x, c.y) }));

    // Prefer options that don't overlap the portrait, and keep close to it.
    let chosen = null;
    for (const c of candidates) {
      const rr = rectFor(c.x, c.y);
      if (intersects(rr, pr)) continue;
      chosen = c;
      break;
    }

    // If everything overlaps (tight space), force it above or below without intersection.
    if (!chosen) {
      const above = clampIntoZone(cx - w / 2, pr.top - gap - h);
      const below = clampIntoZone(cx - w / 2, pr.bottom + gap);
      const ra = rectFor(above.x, above.y);
      const rb = rectFor(below.x, below.y);
      if (!intersects(ra, pr)) chosen = { x: above.x, y: above.y };
      else if (!intersects(rb, pr)) chosen = { x: below.x, y: below.y };
      else {
        // As a last resort, nudge vertically away from the portrait.
        const tryUp = clampIntoZone(above.x, pr.top - gap - h - 8);
        const tryDown = clampIntoZone(below.x, pr.bottom + gap + 8);
        chosen = intersects(rectFor(tryUp.x, tryUp.y), pr) ? tryDown : tryUp;
      }
    }

    const x = chosen.x;
    const y = chosen.y;

    tooltip.style.left = `${x.toFixed(1)}px`;
    tooltip.style.top = `${y.toFixed(1)}px`;
    tooltip.style.visibility = "visible";
  };

  const showTooltipFor = (portraitEl, q) => {
    if (!tooltipName || !tooltipTitle || !tooltipText) return;
    tooltipName.textContent = q?.name || "";
    tooltipTitle.textContent = q?.title || "";
    tooltipTitle.style.display = q?.title ? "" : "none";
    tooltipText.textContent = q?.quote || "";

    positionTooltipFor(portraitEl);
  };

  const repositionActiveTooltip = () => {
    if (tooltip.getAttribute("aria-hidden") === "true") return;
    if (!activePortrait) return;
    positionTooltipFor(activePortrait);
  };

  // Expose to global screen-change handler.
  IMPACT_UI = { hideTooltip, repositionActiveTooltip };

  // Assign fixed "slots" so portraits never cluster or drift into the center.
  // We still animate a gentle float around each slot.
  const generateSlotPositions = (count) => {
    const { rx, ry, maxZ, exclusion, portraitSize, outer } = getConstellationMetrics();
    const TAU = Math.PI * 2;

    // Tuned for this layout: avoids the center card and reads as a clean oval around it.
    // (Top arc -> bottom arc; symmetric, but not so uniform that it looks like a straight row.)
    const SLOT_ANGLES_8 = [
      (-150 * Math.PI) / 180,
      (-110 * Math.PI) / 180,
      (-70 * Math.PI) / 180,
      (-30 * Math.PI) / 180,
      (30 * Math.PI) / 180,
      (70 * Math.PI) / 180,
      (110 * Math.PI) / 180,
      (150 * Math.PI) / 180,
    ];

    const angles = Array.from({ length: count }, (_, i) => {
      if (count === 8) return SLOT_ANGLES_8[i];
      // Evenly spaced if we ever add more portraits.
      return -Math.PI / 2 + (i / count) * TAU;
    });

    const positions = angles.map((theta, i) => {
      const th = theta;
      const absCos = Math.abs(Math.cos(th));
      const absSin = Math.abs(Math.sin(th));
      // Compute a radius (t) that clears the center exclusion card *without changing angle*.
      // This keeps the oval looking symmetric and prevents clustering.
      const tX = absCos > 0.0001 ? (exclusion.halfW / (absCos * rx)) : 0;
      const tY = absSin > 0.0001 ? (exclusion.halfH / (absSin * ry)) : 0;
      const tReq = Math.max(tX, tY);
      // Small extra margin (in normalized ellipse space) so portraits don't graze the card.
      const margin = Math.max(0.02, portraitSize / Math.max(1, Math.min(rx, ry)) * 0.25);
      const t = clamp(Math.max(0.96, tReq + margin), 0, outer);

      const x = Math.cos(th) * rx * t;
      const y = Math.sin(th) * ry * t;

      // Deterministic depth pattern (alternating forward/back slightly).
      const z = clamp(((i % 2 === 0 ? -1 : 1) * (0.28 + (i % 3) * 0.09)) * maxZ, -maxZ, maxZ);

      return {
        theta: th,
        t,
        x,
        y,
        z,
      };
    });

    return positions;
  };

  const slotPositions = generateSlotPositions(count);

  // Animate floating effect (no orbit rotation)
  const animate = () => {
    if (!prefersReducedMotion()) {
      time += 0.016; // ~60fps
      
      // Update portraits with floating animation + enforce non-overlap during motion.
      const { bounds, rx, ry, exclusion, portraitSize, inner, outer } = getConstellationMetrics();

      const maxX = bounds.width * 0.5;
      const maxY = bounds.height * 0.5;

      const projectToAnnulus = (p) => {
        const ux = p.x / rx;
        const uy = p.y / ry;
        const mag = Math.hypot(ux, uy) || 1;
        let t = mag;
        if (t < inner) t = inner;
        if (t > outer) t = outer;
        const k = t / mag;
        p.x = ux * k * rx;
        p.y = uy * k * ry;
        p.x = clamp(p.x, -bounds.rx, bounds.rx);
        p.y = clamp(p.y, -bounds.ry, bounds.ry);
      };

      const desired = portraits.map((p, i) => {
        const basePos = p.basePosition;
        // Grabbed portraits are locked - no floating, just forward in Z
        if (p.isGrabbed) {
          const constrainedX = Math.max(-maxX, Math.min(maxX, p.originalX));
          const constrainedY = Math.max(-maxY, Math.min(maxY, p.originalY));
          return { i, el: p.el, grabbed: true, x: constrainedX, y: constrainedY, z: GRABBED_Z_DEPTH };
        }

        const floatSpeed = 0.2 + (i % 3) * 0.08;
        // Float around the portrait's assigned slot angle (radial + tangential),
        // so motion reads as "gentle drift" rather than random repositioning.
        const theta = portraits[i]?.seed?.theta;
        const urx = Number.isFinite(theta) ? Math.cos(theta) : (basePos.x === 0 ? 1 : Math.sign(basePos.x));
        const ury = Number.isFinite(theta) ? Math.sin(theta) : (basePos.y === 0 ? 0 : Math.sign(basePos.y));
        const utx = -ury;
        const uty = urx;

        // More noticeable float (still slot-centered, deterministic).
        const aR = 6.5; // radial amplitude (px)
        const aT = 4.8; // tangential amplitude (px)
        const radial = Math.sin(time * (floatSpeed * 1.15) + i * 0.9) * aR;
        const tang = Math.cos(time * (floatSpeed * 0.95) + i * 0.7) * aT;
        const floatZ = Math.cos(time * (floatSpeed * 0.6) + i * 1.2) * 1.15;

        const x = Math.max(-maxX, Math.min(maxX, basePos.x + urx * radial + utx * tang));
        const y = Math.max(-maxY, Math.min(maxY, basePos.y + ury * radial + uty * tang));
        const z = basePos.z + floatZ;
        // Keep an "anchor" so repulsion can't cause portraits to drift into other slots.
        return { i, el: p.el, grabbed: false, x, y, z };
      });

      // IMPORTANT: No per-frame repulsion.
      // Runtime evidence showed the repulsion solver was "slot swapping" portraits over time,
      // producing the perceived random repositioning. We only apply mild constraints.
      for (const p of desired) {
        if (p.grabbed) continue;
        p.x = clamp(p.x, -bounds.rx, bounds.rx);
        p.y = clamp(p.y, -bounds.ry, bounds.ry);
        // Hard guarantee: if float ever reaches into the center exclusion area (should be rare),
        // snap back to the base slot (no jittery "solver" behavior).
        if (Math.abs(p.x) < exclusion.halfW && Math.abs(p.y) < exclusion.halfH) {
          const base = portraits[p.i]?.basePosition;
          if (base) {
            p.x = base.x;
            p.y = base.y;
          }
        }
      }

      for (const p of desired) {
        p.el.style.setProperty("--portrait-x", `${p.x}px`);
        p.el.style.setProperty("--portrait-y", `${p.y}px`);
        p.el.style.setProperty("--portrait-z", `${p.z}px`);

        const zIndex = Math.max(1, Math.min(50, Math.round(10 + (p.z / 10))));
        p.el.style.zIndex = p.el.classList.contains("is-active") ? "900" : zIndex.toString();
        p.el.style.pointerEvents = "auto";
      }
    }
    
    // Update blur based on z-depth (depth of field)
    portraits.forEach((portrait) => {
      const zStr = portrait.el.style.getPropertyValue("--portrait-z") || "0px";
      const z = parseFloat(zStr) || 0;
      
      // Calculate blur based on z-depth
      const maxZ = getBounds().depth * 0.5;
      const zDistance = Math.abs(z);
      const blurAmount = Math.min((zDistance / maxZ) * 6, 6);
      
      // Active portrait has no blur
      if (portrait.el.classList.contains("is-active")) {
        portrait.el.style.setProperty("--portrait-blur", "0px");
      } else {
        portrait.el.style.setProperty("--portrait-blur", `${blurAmount}px`);
      }
    });
    
    rafId = requestAnimationFrame(animate);
  };

  // Fixed Z-depth for "grabbed" portraits (above everything)
  const GRABBED_Z_DEPTH = 400; // Fixed forward position
  
  // Grab portrait - move directly forward to fixed Z-depth and lock position
  const grabPortrait = (portrait, portraitData) => {
    if (prefersReducedMotion()) return;
    
    // Get current position (with floating animation)
    const currentXStr = portrait.style.getPropertyValue("--portrait-x");
    const currentYStr = portrait.style.getPropertyValue("--portrait-y");
    const currentZStr = portrait.style.getPropertyValue("--portrait-z");
    
    let currentX = currentXStr ? parseFloat(currentXStr) : portraitData.basePosition.x;
    let currentY = currentYStr ? parseFloat(currentYStr) : portraitData.basePosition.y;
    const currentZ = currentZStr ? parseFloat(currentZStr) : portraitData.basePosition.z;
    
    // Constrain grabbed position to viewport bounds
    const bounds = getBounds();
    const maxX = bounds.width * 0.5;
    const maxY = bounds.height * 0.5;
    currentX = Math.max(-maxX, Math.min(maxX, currentX));
    currentY = Math.max(-maxY, Math.min(maxY, currentY));
    
    // Store original position for restoration
    portraitData.originalX = currentX;
    portraitData.originalY = currentY;
    portraitData.originalZ = currentZ;
    portraitData.isGrabbed = true;
    
    // Move directly forward to fixed Z-depth (toward camera)
    // Keep X and Y at constrained position
    portrait.style.setProperty("--portrait-x", `${currentX}px`);
    portrait.style.setProperty("--portrait-y", `${currentY}px`);
    portrait.style.setProperty("--portrait-z", `${GRABBED_Z_DEPTH}px`);
  };

  // Release portrait - return to orbit position
  const releasePortrait = (portraitData) => {
    if (prefersReducedMotion()) return;
    
    portraitData.isGrabbed = false;
    
    // Restore original position (will be updated by animation loop with orbit + floating)
    // The animation loop will take over and restore the orbit position
    portraitData.originalX = undefined;
    portraitData.originalY = undefined;
    portraitData.originalZ = undefined;
    portraitData.grabbedAtRotation = undefined;
  };

  QUOTES.forEach((q, i) => {
    const pos = slotPositions[i];
    
    const portrait = document.createElement("div");
    portrait.className = "impactPortrait";
    portrait.style.left = "50%";
    portrait.style.top = "50%";
    portrait.setAttribute("aria-label", `Quote from ${q.name}`);
    portrait.tabIndex = 0;
    portrait.dataset.index = String(i);
    
    // Set initial position using CSS custom properties (CSS will handle the transform)
    portrait.style.setProperty("--portrait-x", `${pos.x}px`);
    portrait.style.setProperty("--portrait-y", `${pos.y}px`);
    portrait.style.setProperty("--portrait-z", `${pos.z}px`);

    // Create portraitData with base position
    const { rx: initRx, ry: initRy, maxZ: initMaxZ } = getConstellationMetrics();
    const portraitData = {
      el: portrait,
      index: i,
      basePosition: { x: pos.x, y: pos.y, z: pos.z },
      // Keep layout stable across resizes by storing slot angle + normalized radius.
      seed: {
        theta: pos.theta,
        t: pos.t,
        // Back-compat fields (in case other code expects them)
        ux: initRx ? pos.x / initRx : 0,
        uy: initRy ? pos.y / initRy : 0,
        z: initMaxZ ? clamp(pos.z / initMaxZ, -1, 1) : 0,
      },
      isGrabbed: false,
      originalX: undefined,
      originalY: undefined,
      originalZ: undefined
    };
    
    portraits.push(portraitData);

    const img = document.createElement("img");
    img.className = "impactPortrait__img";
    img.src = q.image;
    img.alt = q.name;
    img.loading = "lazy";
    img.decoding = "async";

    // Clip wrapper: keeps image circular while allowing the quote to overflow outside the portrait.
    const clip = document.createElement("div");
    clip.className = "impactPortrait__clip";
    clip.appendChild(img);
    portrait.appendChild(clip);
    
    // Ensure portrait can receive pointer events
    portrait.style.pointerEvents = "auto";
    portrait.style.zIndex = "1";

    // Hover/focus interactions with debouncing to prevent glitching
    let activateTimeout = null;
    let deactivateTimeout = null;
    
    const activate = () => {
      // Clear any pending deactivation
      if (deactivateTimeout) {
        clearTimeout(deactivateTimeout);
        deactivateTimeout = null;
      }
      
      // Clear any pending activation and start fresh
      if (activateTimeout) {
        clearTimeout(activateTimeout);
        activateTimeout = null;
      }
      
      // If already active, don't do anything
      if (activePortrait === portrait) return;
      
      if (activePortrait) {
        activePortrait.classList.remove("is-active");
      }
      
      // Activate this one
      activePortrait = portrait;
      portrait.classList.add("is-active");
      showTooltipFor(portrait, q);
    };

    const deactivate = () => {
      // Only deactivate if this is the active portrait
      if (activePortrait !== portrait) {
        return;
      }
      
      // Clear any pending activation
      if (activateTimeout) {
        clearTimeout(activateTimeout);
        activateTimeout = null;
      }
      
      // Clear any pending deactivation and start fresh
      if (deactivateTimeout) {
        clearTimeout(deactivateTimeout);
        deactivateTimeout = null;
      }
      
      // Debounce deactivation slightly to prevent flicker
      deactivateTimeout = setTimeout(() => {
        deactivateTimeout = null;
        
        // Double-check it's still the active portrait
        if (activePortrait === portrait) {
          // Remove class first to allow CSS transitions
          portrait.classList.remove("is-active");
          activePortrait = null;
          hideTooltip();
        }
      }, 150); // 150ms debounce to prevent flicker
    };

    // Use a single event handler approach to avoid conflicts
    // Use pointer events as primary, with mouse events as fallback
    const handleEnter = (e) => {
      // Only activate if not already active to prevent duplicate calls
      if (activePortrait !== portrait) {
        activate();
      }
    };
    
    const handleLeave = (e) => {
      // Only deactivate if this is the active portrait
      if (activePortrait === portrait) {
        deactivate();
      }
    };
    
    portrait.addEventListener("pointerenter", handleEnter, { passive: true });
    portrait.addEventListener("pointerleave", handleLeave, { passive: true });
    portrait.addEventListener("focus", handleEnter);
    portrait.addEventListener("blur", handleLeave);
    
    // Also handle mouseenter/mouseleave for better compatibility
    portrait.addEventListener("mouseenter", handleEnter, { passive: true });
    portrait.addEventListener("mouseleave", handleLeave, { passive: true });

    ring.appendChild(portrait);
  });

  // Start animation loop
  animate();

  // Store cleanup function
  const cleanup = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  // Handle resize - regenerate constellation positions
  const handleResize = () => {
    const { bounds, rx, ry, maxZ, exclusion, portraitSize, inner, outer } = getConstellationMetrics();
    if (!bounds.rx || !bounds.ry) return;

    const projectToAnnulus = (p) => {
      const ux = p.x / rx;
      const uy = p.y / ry;
      const mag = Math.hypot(ux, uy) || 1;
      let t = mag;
      if (t < inner) t = inner;
      if (t > outer) t = outer;
      const k = t / mag;
      p.x = ux * k * rx;
      p.y = uy * k * ry;
      p.x = clamp(p.x, -bounds.rx, bounds.rx);
      p.y = clamp(p.y, -bounds.ry, bounds.ry);
    };

    portraits.forEach((portraitData) => {
      const seed = portraitData.seed || { ux: 0, uy: 0, z: 0 };
      const hasTheta = Number.isFinite(seed.theta);
      let next = hasTheta ? (() => {
        const th = seed.theta;
        const absCos = Math.abs(Math.cos(th));
        const absSin = Math.abs(Math.sin(th));
        const tX = absCos > 0.0001 ? (exclusion.halfW / (absCos * rx)) : 0;
        const tY = absSin > 0.0001 ? (exclusion.halfH / (absSin * ry)) : 0;
        const tReq = Math.max(tX, tY);
        const margin = Math.max(0.02, portraitSize / Math.max(1, Math.min(rx, ry)) * 0.25);
        const t = clamp(Math.max(0.96, tReq + margin), 0, outer);
        return {
          x: Math.cos(th) * rx * t,
          y: Math.sin(th) * ry * t,
          z: clamp(seed.z * maxZ, -maxZ, maxZ),
        };
      })() : {
        x: seed.ux * rx,
        y: seed.uy * ry,
        z: clamp(seed.z * maxZ, -maxZ, maxZ),
      };
      // Keep it within bounds; we don't project every time (prevents subtle "snapping" motion).
      next.x = clamp(next.x, -bounds.rx, bounds.rx);
      next.y = clamp(next.y, -bounds.ry, bounds.ry);

      portraitData.basePosition = { x: next.x, y: next.y, z: next.z };
      portraitData.el.style.setProperty("--portrait-x", `${next.x}px`);
      portraitData.el.style.setProperty("--portrait-y", `${next.y}px`);
      portraitData.el.style.setProperty("--portrait-z", `${next.z}px`);
    });
    repositionActiveTooltip();
  };
  window.addEventListener("resize", handleResize, { passive: true });

  // Cleanup on window unload
  window.addEventListener("beforeunload", cleanup);
  
  return { destroy: cleanup };
}

// ---- Boot ----
function boot() {
  SCREENS = Array.from(document.querySelectorAll(".screen"));
  PROGRESS = document.getElementById("progressBar");
  DOTS = mountNavDots(SCREENS);
  ACTIVE = -1;

  syncViewportUnits();
  mountScrollRail(SCREENS.length);
  bindCTAButtons();
  bindNavDockMagnify(document.getElementById("navDots"), DOTS);
  bindBrandHub();
  bindBrandHubScrollCue();
  bindSpotlight();
  bindParallax();
  bindTilts();
  bindTeamStripInfo();
  bindTeamDockEffect();
  setupVideo();
  setupInterstitialVideos();
  mountMilestones();
  mountProjects();
  bindNcnPillars();
  mountTotalViews();
  mountInvestorWidget();
  mountImpactOrbit();

  window.addEventListener("scroll", onScroll, { passive: true });
  let RESIZE_T = 0;
  let RESIZE_CLEAR_T = 0;
  const scheduleResize = () => {
    document.body.classList.add("is-resizing");
    if (RESIZE_T) window.clearTimeout(RESIZE_T);
    RESIZE_T = window.setTimeout(() => {
      onResize();
      // After resize settles, snap cleanly to the nearest screen (no in-between).
      const idx = clamp(
        Math.round((window.scrollY || window.pageYOffset || 0) / Math.max(1, VIEWPORT_H)),
        0,
        SCREENS.length - 1
      );
      window.scrollTo({ top: idx * VIEWPORT_H, behavior: "auto" });
      onScroll();

      if (RESIZE_CLEAR_T) window.clearTimeout(RESIZE_CLEAR_T);
      RESIZE_CLEAR_T = window.setTimeout(() => document.body.classList.remove("is-resizing"), 60);
    }, 90);
  };
  window.addEventListener("resize", scheduleResize, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("keydown", onKeyDown);

  // Initial render
  onScroll();

  // Start sequential video preloading after first render.
  SMART_VIDEO_LOADER.init(SCREENS);
}

// Delay initialization until the gate is unlocked (if present).
if (window.__NS_GATE_LOCKED__) {
  window.addEventListener(
    "ns:unlocked",
    () => {
      boot();
    },
    { once: true }
  );
} else {
  boot();
}