/**
 * Invitación Iván Joaquín — frontend sin dependencias.
 * Almacenamiento: POST simple a Apps Script (sin CORS), y confirmación de
 * escritura mediante consulta JSONP de SOLO el estado de un código aleatorio.
 * Nunca declara éxito por el mero hecho de haber enviado una solicitud opaca.
 */
(() => {
  "use strict";
  const EVENT_AT = new Date("2026-11-14T11:00:00-05:00").getTime();
  const DEADLINE = new Date("2026-11-12T13:00:00-05:00").getTime();
  const ENDPOINT = (window.IVANJO_CONFIG?.scriptUrl || "").trim();
  const CONFIGURED = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(ENDPOINT);
  const $ = id => document.getElementById(id);
  const form = $("rsvpForm");
  const submitButton = $("submitButton");
  const submitText = $("submitButtonText");
  const successPanel = $("successPanel");
  const closedNotice = $("closedNotice");
  let busy = false;
  let currentId = null;

  function countdown() {
    let seconds = Math.max(0, Math.floor((EVENT_AT - Date.now()) / 1000));
    const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
    ["days", "hours", "minutes", "seconds"].forEach((id, index) => { $(id).textContent = String(values[index]).padStart(2, "0"); });
  }
  countdown();
  window.setInterval(countdown, 1000);

  function isClosed() { return Date.now() > DEADLINE; }
  function refreshFormState() {
    const closed = isClosed();
    closedNotice.hidden = !closed;
    if (closed) {
      form.hidden = true;
      successPanel.hidden = true;
    } else if (!successPanel.hidden) {
      form.hidden = true;
    } else {
      form.hidden = false;
      submitButton.disabled = busy || !CONFIGURED;
    }
    if (!CONFIGURED && !closed) {
      status("El formulario todavía no está conectado a Google Sheets. El organizador debe configurar config.js.", "error");
    }
  }
  function status(message, kind = "info") {
    const area = $("formStatus");
    area.textContent = message;
    area.className = `form-status ${kind}`;
  }
  function selectedAttendance() { return form.querySelector('input[name="asistencia"]:checked')?.value || ""; }
  function syncPeople() {
    const attending = selectedAttendance() === "Sí";
    $("peopleFields").hidden = !attending;
    if (!attending) { $("adultos").value = "0"; $("ninos").value = "0"; }
    const number = Number($("adultos").value) + Number($("ninos").value);
    $("totalPeople").textContent = `Total: ${number} ${number === 1 ? "persona" : "personas"}`;
  }
  form.querySelectorAll('input[name="asistencia"]').forEach(r => r.addEventListener("change", syncPeople));
  ["adultos", "ninos"].forEach(id => $(id).addEventListener("change", syncPeople));
  syncPeople();
  refreshFormState();
  window.setInterval(refreshFormState, 30000);

  // JSONP: la única información devuelta es si un código aleatorio está registrado.
  // Google ContentService redirige a googleusercontent.com; fetch(...).json() no
  // es fiable desde GitHub Pages por CORS. Esta lectura sí funciona sin CORS.
  function verifyCode(code, waitMs = 10000) {
    return new Promise((resolve, reject) => {
      const callbackName = `__ijcb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const script = document.createElement("script");
      const u = new URL(ENDPOINT);
      u.searchParams.set("mode", "estado");
      u.searchParams.set("id", code);
      u.searchParams.set("callback", callbackName);
      u.searchParams.set("t", String(Date.now()));
      let timer;
      let settled = false;
      const cleanup = () => { clearTimeout(timer); delete window[callbackName]; script.remove(); };
      const fail = err => { if (settled) return; settled = true; cleanup(); reject(err); };
      window[callbackName] = payload => { if (settled) return; settled = true; cleanup(); resolve(payload); };
      script.onerror = () => fail(new Error("No se pudo consultar el registro."));
      timer = window.setTimeout(() => fail(new Error("Tiempo agotado al verificar.")), waitMs);
      script.src = u.toString();
      document.head.appendChild(script);
    });
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function awaitReceipt(code) {
    // Es frecuente que la escritura tarde 1–4 segundos. No duplicar el POST.
    for (const delay of [1000, 1800, 2600, 3700]) {
      await sleep(delay);
      try {
        const response = await verifyCode(code);
        if (response?.registrado === true) return "ok";
        if (response?.abierto === false && response?.registrado !== true) return "closed";
      } catch (err) {
        // Un error transitorio del servicio no demuestra que el registro falló.
        console.warn("Verificación pendiente:", err.message);
      }
    }
    return "unknown";
  }
  function newCode() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((n, i) => `${[4, 6, 8, 10].includes(i) ? "-" : ""}${n.toString(16).padStart(2, "0")}`).join("");
  }
  function setBusy(flag) {
    busy = flag;
    submitButton.disabled = flag || !CONFIGURED;
    submitText.textContent = flag ? "Registrando y verificando..." : "Enviar mi confirmación";
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    if (!CONFIGURED) { status("Falta configurar la URL del servicio en config.js.", "error"); return; }
    if (isClosed()) { refreshFormState(); return; }
    const nombre = $("nombre").value.trim().replace(/\s+/g, " ");
    const asistencia = selectedAttendance();
    const adultos = asistencia === "Sí" ? Number($("adultos").value) : 0;
    const ninos = asistencia === "Sí" ? Number($("ninos").value) : 0;
    if (nombre.length < 2) { status("Escribe tu nombre y apellido (al menos 2 caracteres).", "error"); $("nombre").focus(); return; }
    if (!asistencia) { status("Selecciona si asistirás o no.", "error"); return; }
    if (asistencia === "Sí" && adultos + ninos < 1) { status("Indica al menos un adulto o un niño.", "error"); $("adultos").focus(); return; }
    if (adultos + ninos > 20) { status("Para más de 20 invitados, contacta directamente con el organizador.", "error"); return; }
    if ($("sitio_web").value) { status("No se pudo procesar este formulario.", "error"); return; }
    currentId = currentId || newCode();
    const payload = {
      id: currentId, nombre, asistencia,
      adultos: String(adultos), ninos: String(ninos),
      familia: $("familia").value.trim(), mensaje: $("mensaje").value.trim(),
      sitio_web: ""
    };
    setBusy(true);
    status("Enviando tu respuesta y comprobando que se guarde en Google Sheets...", "info");
    try {
      // Solicitud simple sin preflight. Su respuesta es opaca: NO implica éxito.
      await fetch(ENDPOINT, {method:"POST",mode:"no-cors",credentials:"omit",redirect:"follow",body:new URLSearchParams(payload)});
      const result = await awaitReceipt(currentId);
      if (result === "ok") {
        successPanel.hidden = false;
        form.hidden = true;
        $("successTitle").textContent = asistencia === "Sí" ? "¡Ya estás en el equipo! 🎉" : "¡Gracias por avisarnos! 💚";
        $("successText").textContent = asistencia === "Sí" ? `Tu asistencia quedó registrada: ${adultos} ${adultos === 1 ? "adulto" : "adultos"} y ${ninos} ${ninos === 1 ? "niño" : "niños"}. ¡Nos vemos el 14 de noviembre!` : "Registramos que no podrás acompañarnos. ¡Gracias por confirmar!";
        form.reset(); syncPeople(); currentId = null;
        successPanel.scrollIntoView({behavior:"smooth",block:"center"});
      } else if (result === "closed") {
        status("El plazo venció antes de registrar tu respuesta. No se guardó una nueva confirmación.", "error");
        refreshFormState();
      } else {
        status("No logramos verificar el guardado. No vuelvas a enviar repetidamente: revisa con el organizador o intenta una vez más. Se conservarán tus datos y el mismo código para evitar duplicados.", "error");
      }
    } catch (error) {
      console.error("Error al enviar:", error);
      status("No se pudo completar el envío. Revisa tu conexión y vuelve a intentarlo; usaremos el mismo código para evitar duplicados.", "error");
    } finally {
      setBusy(false);
      if (isClosed()) refreshFormState();
    }
  });
  $("anotherResponse").addEventListener("click", () => {
    successPanel.hidden = true;
    form.hidden = false;
    currentId = null;
    form.reset(); syncPeople(); status("");
    refreshFormState();
    $("nombre").focus();
  });
  $("shareButton").addEventListener("click", async () => {
    const url = window.location.href.split("#")[0];
    const text = "⚽ ¡Estás invitado al cumple de Iván Joaquín! 🎂 5 años | Sábado 14 de noviembre de 2026 | 11:00 a. m. | Country Club San Antonio, km 72 Panamericana Sur. ¡Fútbol, piscina y full day! Confirma hasta el 12/11 a la 1:00 p. m.";
    if (navigator.share) {
      try { await navigator.share({title:"Cumpleaños de Iván Joaquín",text,url}); return; } catch (error) { if (error.name === "AbortError") return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + "\n" + url)}`, "_blank", "noopener,noreferrer");
  });
})();
