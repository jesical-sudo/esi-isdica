(function () {
  const { FeedAdapter } = window;

  const loginWrap = document.getElementById("loginWrap");
  const panelWrap = document.getElementById("panelWrap");
  const pinInput = document.getElementById("pinInput");
  const loginBtn = document.getElementById("loginBtn");
  const loginError = document.getElementById("loginError");
  const logoutBtn = document.getElementById("logoutBtn");

  const fuenteBtns = document.querySelectorAll("[data-fuente]");
  const hashtagInput = document.getElementById("hashtagInput");
  const addHashtagBtn = document.getElementById("addHashtagBtn");
  const hashtagChips = document.getElementById("hashtagChips");

  const copyLinkBtn = document.getElementById("copyLinkBtn");
  const downloadQrBtn = document.getElementById("downloadQrBtn");
  const notifyToggle = document.getElementById("notifyToggle");
  const approvalToggle = document.getElementById("approvalToggle");
  const palabrasInput = document.getElementById("palabrasInput");
  const nombresInput = document.getElementById("nombresInput");
  const guardarPalabrasBtn = document.getElementById("guardarPalabrasBtn");

  const pendingList = document.getElementById("pendingList");
  const hiddenList = document.getElementById("hiddenList");
  const publishedList = document.getElementById("publishedList");

  const lightboxBackdrop = document.getElementById("lightboxBackdrop");
  const lightboxCard = document.getElementById("lightboxCard");

  let qrDataUrl = null;
  let guestLink = null;
  let displayConfig = { fuente: "invitados", hashtagsActivos: [] };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ------------------------------------------------------------ login

  async function intentarLogin() {
    loginError.textContent = "";
    try {
      await FeedAdapter.login(pinInput.value.trim());
      mostrarPanel();
    } catch (err) {
      loginError.textContent = "PIN incorrecto";
    }
  }
  loginBtn.addEventListener("click", intentarLogin);
  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") intentarLogin();
  });

  logoutBtn.addEventListener("click", async () => {
    await FeedAdapter.logout();
    location.reload();
  });

  async function mostrarPanel() {
    loginWrap.style.display = "none";
    panelWrap.style.display = "block";
    await Promise.all([cargarDisplayConfig(), cargarModeracion(), cargarQr(), cargarPendientes(), cargarPublicados(), cargarOcultos()]);

    FeedAdapter.connectLive((tipo) => {
      if (tipo === "posts" || tipo === "pendiente") {
        cargarPendientes();
        cargarPublicados();
        cargarOcultos();
        if (tipo === "pendiente") avisarNuevoContenido();
      }
    });
  }

  // -------------------------------------------------------- fuente / hashtags

  function marcarFuenteActiva() {
    fuenteBtns.forEach((b) => b.classList.toggle("active", b.dataset.fuente === displayConfig.fuente));
  }

  async function cargarDisplayConfig() {
    displayConfig = await FeedAdapter.getDisplayConfig();
    marcarFuenteActiva();
    renderHashtagChips();
  }

  fuenteBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      displayConfig = await FeedAdapter.setDisplayConfig({ fuente: btn.dataset.fuente });
      marcarFuenteActiva();
    });
  });

  function renderHashtagChips() {
    const activos = displayConfig.hashtagsActivos || [];
    hashtagChips.innerHTML = activos
      .map((h) => `<span class="chip">#${escapeHtml(h)} <button data-h="${escapeHtml(h)}">✕</button></span>`)
      .join("") || `<span class="eyebrow">Sin filtro — se muestran todos los hashtags</span>`;

    hashtagChips.querySelectorAll("button[data-h]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nuevos = activos.filter((h) => h !== btn.dataset.h);
        displayConfig = await FeedAdapter.setDisplayConfig({ hashtagsActivos: nuevos });
        renderHashtagChips();
      });
    });
  }

  addHashtagBtn.addEventListener("click", async () => {
    const valor = hashtagInput.value.trim().replace(/^#/, "");
    if (!valor) return;
    const nuevos = Array.from(new Set([...(displayConfig.hashtagsActivos || []), valor]));
    displayConfig = await FeedAdapter.setDisplayConfig({ hashtagsActivos: nuevos });
    hashtagInput.value = "";
    renderHashtagChips();
  });

  // --------------------------------------------------------------------- QR

  async function cargarQr() {
    const { url, dataUrl } = await FeedAdapter.getQr();
    guestLink = url;
    qrDataUrl = dataUrl;
  }

  copyLinkBtn.addEventListener("click", async () => {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink).catch(() => {});
    copyLinkBtn.textContent = "¡Copiado!";
    setTimeout(() => (copyLinkBtn.textContent = "Copiar link para participantes"), 1500);
  });

  downloadQrBtn.addEventListener("click", () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "qr-muro-esi-isdica.png";
    a.click();
  });

  // -------------------------------------------------------------- avisos

  notifyToggle.addEventListener("change", () => {
    if (notifyToggle.checked && "Notification" in window) {
      Notification.requestPermission();
    }
  });

  function avisarNuevoContenido() {
    document.querySelector(".gear-btn")?.classList.add("hay-pendientes");
    if (notifyToggle.checked && "Notification" in window && Notification.permission === "granted") {
      new Notification("Nuevo contenido esperando aprobación", {
        body: "Hay una publicación pendiente en el muro de las Jornadas de ESI.",
      });
    }
  }

  // ---------------------------------------------------------- moderación

  async function cargarModeracion() {
    const cfg = await FeedAdapter.getModerationSettings();
    approvalToggle.checked = Boolean(cfg.requiereAprobacion);
    palabrasInput.value = (cfg.palabrasBloqueadas || []).join(", ");
    nombresInput.value = (cfg.nombresBloqueados || []).join(", ");
  }

  approvalToggle.addEventListener("change", async () => {
    await FeedAdapter.setAprobacionPrevia(approvalToggle.checked);
  });

  guardarPalabrasBtn.addEventListener("click", async () => {
    const palabrasBloqueadas = palabrasInput.value.split(",").map((s) => s.trim()).filter(Boolean);
    const nombresBloqueados = nombresInput.value.split(",").map((s) => s.trim()).filter(Boolean);
    await FeedAdapter.setWords({ palabrasBloqueadas, nombresBloqueados });
    guardarPalabrasBtn.textContent = "¡Guardado!";
    setTimeout(() => (guardarPalabrasBtn.textContent = "Guardar lista"), 1500);
  });

  function itemHtml(post, tipo) {
    const thumb = post.tipo === "video" ? (post.miniaturaUrl || post.url) : post.url;
    const acciones =
      tipo === "pendiente"
        ? `<button class="btn primary" data-approve="${post.id}">Aprobar</button>
           <button class="btn danger" data-reject="${post.id}">Rechazar</button>`
        : tipo === "publicado"
          ? `<button class="btn" data-hide="${post.id}">Ocultar</button>
             <button class="btn danger" data-delete="${post.id}">Eliminar</button>`
          : `<button class="btn primary" data-restore="${post.id}">Restaurar</button>
             <button class="btn danger" data-delete="${post.id}">Eliminar</button>`;
    const miniatura =
      post.tipo === "texto"
        ? `<div class="thumb thumb-texto" aria-hidden="true">“</div>`
        : `<img class="thumb" src="${escapeHtml(thumb)}" data-open="${post.id}" data-tipo="${post.tipo}" data-url="${escapeHtml(post.url)}" alt="Ampliar" />`;
    return `
      <div class="${tipo === "pendiente" ? "pending-item" : "hidden-item"}">
        ${miniatura}
        <div class="info">
          <b>${escapeHtml(post.nombre || "Participante")}</b>
          <p>${escapeHtml(post.mensaje || "")}</p>
        </div>
        <div class="actions">${acciones}</div>
      </div>`;
  }

  async function cargarPendientes() {
    const pendientes = await FeedAdapter.getPending();
    pendingList.innerHTML =
      pendientes.map((p) => itemHtml(p, "pendiente")).join("") ||
      `<p class="eyebrow">No hay nada pendiente ahora.</p>`;
    if (pendientes.length === 0) {
      document.querySelector(".gear-btn")?.classList.remove("hay-pendientes");
    }
    ligarAcciones(pendingList);
  }

  async function cargarPublicados() {
    const publicados = await FeedAdapter.getPublished();
    publishedList.innerHTML =
      publicados.map((p) => itemHtml(p, "publicado")).join("") ||
      `<p class="eyebrow">Todavía no hay nada publicado.</p>`;
    ligarAcciones(publishedList);
  }

  async function cargarOcultos() {
    const ocultos = await FeedAdapter.getHidden();
    hiddenList.innerHTML =
      ocultos.map((p) => itemHtml(p, "oculto")).join("") ||
      `<p class="eyebrow">No hay nada oculto ahora.</p>`;
    ligarAcciones(hiddenList);
  }

  function ligarAcciones(container) {
    container.querySelectorAll("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await FeedAdapter.approve(btn.dataset.approve);
        cargarPendientes();
        cargarPublicados();
      })
    );
    container.querySelectorAll("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await FeedAdapter.reject(btn.dataset.reject);
        cargarPendientes();
      })
    );
    container.querySelectorAll("[data-restore]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await FeedAdapter.restore(btn.dataset.restore);
        cargarOcultos();
        cargarPublicados();
      })
    );
    // Eliminar pide un segundo toque para confirmar (no se puede deshacer).
    container.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!btn.classList.contains("confirmar")) {
          btn.classList.add("confirmar");
          btn.textContent = "¿Eliminar del todo?";
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.classList.remove("confirmar");
            btn.textContent = "Eliminar";
          }, 4000);
          return;
        }
        btn.disabled = true;
        await FeedAdapter.remove(btn.dataset.delete).catch(() => {});
        cargarPublicados();
        cargarOcultos();
      })
    );
    container.querySelectorAll("[data-hide]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await FeedAdapter.hide(btn.dataset.hide);
        cargarPublicados();
        cargarOcultos();
      })
    );
    container.querySelectorAll("[data-open]").forEach((img) =>
      img.addEventListener("click", () => openLightbox(img.dataset.tipo, img.dataset.url))
    );
  }

  // ------------------------------------------------------------ lightbox

  function openLightbox(tipo, url) {
    const media =
      tipo === "video"
        ? `<video src="${url}" controls autoplay playsinline></video>`
        : `<img src="${url}" alt="" />`;
    lightboxCard.innerHTML = `${media}<button class="lightbox-close" id="lightboxCloseBtn">✕</button>`;
    lightboxBackdrop.style.display = "flex";
    document.getElementById("lightboxCloseBtn").addEventListener("click", closeLightbox);
  }

  function closeLightbox() {
    lightboxBackdrop.style.display = "none";
    lightboxCard.innerHTML = "";
  }

  lightboxBackdrop.addEventListener("click", (e) => {
    if (e.target === lightboxBackdrop) closeLightbox();
  });

  // ------------------------------------------------------------- arranque

  (async function init() {
    try {
      await FeedAdapter.checkSession();
      mostrarPanel();
    } catch {
      // no hay sesión: se queda en la pantalla de login
    }
  })();
})();
