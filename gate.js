/* NDA + email + password gate (client-side)
   NOTE: This is NOT a substitute for server-side authentication. Anyone with the URL can still download the HTML.
   This gate reduces casual access and lets you log NDA acceptance; add Basic Auth / password protection at the host for real security.
*/

(function () {
  const STORAGE_KEY = "ns_gate_unlocked_v1";

  // Logging endpoint (optional). Uses no-cors so the request is best-effort.
  const LOG_URI =
    "https://script.google.com/macros/s/AKfycbx_qxQZuHMMylNdY4C-EaqGVth7fC0sZhawQlTP3bJLE30Rql28RqJQPpj4QtSlKAlVXg/exec";

  const isUnlocked = () => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  };

  const setUnlocked = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  const dispatchUnlocked = () => {
    try {
      window.__NS_GATE_LOCKED__ = false;
      window.dispatchEvent(new CustomEvent("ns:unlocked"));
    } catch {}
  };

  // Mark locked state early so other scripts can defer work.
  window.__NS_GATE_LOCKED__ = !isUnlocked();

  const gateEl = document.getElementById("nsGate");
  if (!gateEl) {
    // No gate markup present; treat as unlocked.
    window.__NS_GATE_LOCKED__ = false;
    return;
  }

  const unlockUi = () => {
    document.body.classList.remove("ns-locked");
    document.body.classList.add("ns-unlocked");
    gateEl.remove();
    try {
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {}
    // Dispatch on next frame so scroll position is settled before boot runs.
    requestAnimationFrame(() => dispatchUnlocked());
  };

  if (isUnlocked()) {
    unlockUi();
    return;
  }

  document.body.classList.add("ns-locked");

  const form = document.getElementById("nsGateForm");
  const errEl = document.getElementById("nsErr");
  const submitEl = document.getElementById("nsSubmit");
  const ndaTextEl = document.getElementById("nsNdaText");

  if (!form || !errEl || !submitEl) return;

  const ndaText = (ndaTextEl?.textContent || "").trim();

  const whisper = (s) => {
    // Small stable fingerprint for NDA text (not a secret).
    let x = 0;
    for (let i = 0; i < s.length; i++) {
      x = (x << 5) - x + s.charCodeAt(i);
      x |= 0;
    }
    return (x >>> 0).toString(36);
  };

  const setErr = (msg) => {
    errEl.textContent = msg || "";
  };

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setErr("");

    // Log acceptance (best-effort)
    try {
      const payload = {
        ndaAccepted: "yes",
        ndaKey: whisper(ndaText),
        ndaLen: ndaText.length,
        page: location.pathname + location.search,
        ua: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        ts_iso: new Date().toISOString(),
      };
      fetch(LOG_URI, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}

    setUnlocked();
    unlockUi();
  });
})();

