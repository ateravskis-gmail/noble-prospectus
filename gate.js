/* NDA + email + password gate (client-side)
   NOTE: This is NOT a substitute for server-side authentication. Anyone with the URL can still download the HTML.
   This gate reduces casual access and lets you log NDA acceptance; add Basic Auth / password protection at the host for real security.
*/

(function () {
  const STORAGE_KEY = "ns_gate_unlocked_v1";

  // Logging endpoint (optional). Uses no-cors so the request is best-effort.
  const LOG_URI =
    "https://script.google.com/macros/s/AKfycbx_qxQZuHMMylNdY4C-EaqGVth7fC0sZhawQlTP3bJLE30Rql28RqJQPpj4QtSlKAlVXg/exec";

  // Password check: compare SHA-256(password) to this hex digest.
  // The current value comes from your provided widget; replace as needed.
  const PASSWORD_SHA256 =
    "89baf7fb5b2f49e6a135c2a1a742cf44f99cc39c4d058ef8b1fb72a7a20d8860";

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
    dispatchUnlocked();
    try {
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {}
  };

  if (isUnlocked()) {
    unlockUi();
    return;
  }

  document.body.classList.add("ns-locked");

  const form = document.getElementById("nsGateForm");
  const errEl = document.getElementById("nsErr");
  const agreeEl = document.getElementById("nsAgree");
  const nameEl = document.getElementById("nsFullName");
  const emailEl = document.getElementById("nsEmail");
  const passEl = document.getElementById("nsPass");
  const submitEl = document.getElementById("nsSubmit");
  const ndaTextEl = document.getElementById("nsNdaText");

  if (!form || !errEl || !agreeEl || !nameEl || !emailEl || !passEl || !submitEl) return;

  const ndaText = (ndaTextEl?.textContent || "").trim();

  const sha256Hex = async (input) => {
    const t = new TextEncoder().encode(String(input));
    const d = await crypto.subtle.digest("SHA-256", t);
    const a = Array.from(new Uint8Array(d));
    return a.map((x) => x.toString(16).padStart(2, "0")).join("");
  };

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

  const canSubmit = () => {
    const nameOk = String(nameEl.value || "").trim().length >= 2;
    const emailOk = emailEl.validity?.valid && String(emailEl.value || "").trim().length > 3;
    const passOk = String(passEl.value || "").trim().length > 0;
    const agreeOk = !!agreeEl.checked;
    return nameOk && emailOk && passOk && agreeOk;
  };

  const sync = () => {
    submitEl.disabled = !canSubmit();
  };

  agreeEl.addEventListener("change", sync);
  nameEl.addEventListener("input", sync);
  emailEl.addEventListener("input", sync);
  passEl.addEventListener("input", sync);
  sync();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setErr("");

    const fullName = String(nameEl.value || "").trim();
    const email = String(emailEl.value || "").trim();
    const pass = String(passEl.value || "").trim();
    const agreed = !!agreeEl.checked;

    if (!agreed) {
      setErr('Please check “I Agree” to proceed.');
      agreeEl.focus();
      return;
    }
    if (!fullName) {
      setErr("Please type your full name to proceed.");
      nameEl.focus();
      return;
    }
    if (!emailEl.validity?.valid) {
      setErr("Please enter a valid email address.");
      emailEl.focus();
      return;
    }
    if (!pass) {
      setErr("Please enter the password.");
      passEl.focus();
      return;
    }

    let ok = false;
    try {
      ok = (await sha256Hex(pass)) === PASSWORD_SHA256;
    } catch {
      ok = false;
    }

    if (!ok) {
      setErr("Incorrect password. Please try again.");
      passEl.focus();
      return;
    }

    // Log acceptance (best-effort)
    try {
      const payload = {
        email,
        fullName,
        ndaAccepted: agreed ? "yes" : "no",
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

