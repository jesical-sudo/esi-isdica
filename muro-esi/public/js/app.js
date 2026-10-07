(function () {
  const { FeedAdapter } = window;

  let posts = [];
  let modo = "mosaico"; // mosaico | carrusel | gigante
  let indiceCarrusel = 0;
  let pausado = false;
  let rotacionTimer = null;
  let displayConfig = { fuente: "invitados", hashtagsActivos: [] };
  let hashtag = "#ESIenISDICA";

  const wallContainer = document.getElementById("wallContainer");
  const modeButtons = document.querySelectorAll("[data-mode]");
  const pausarBtn = document.getElementById("pausarBtn");
  const tickerText = document.getElementById("tickerText");
  const qrImg = document.getElementById("qrImg");
  const qrHashtag = document.getElementById("qrHashtag");

  function marcarModoActivo() {
    modeButtons.forEach((b) => b.classList.toggle("active", b.dataset.mode === modo));
  }

  function filtrarPorHashtag(lista) {
    if (!displayConfig.hashtagsActivos || displayConfig.hashtagsActivos.length === 0) {
      return lista;
    }
    const activos = displayConfig.hashtagsActivos.map((h) => h.toLowerCase());
    return lista.filter((p) =>
      (p.hashtags || []).some((h) => activos.includes(String(h).toLowerCase()))
    );
  }

  function tarjetaHtml(post, i) {
    if (post.tipo === "texto") {
      return `
      <div class="card texto${i % 2 ? " alt" : ""}">
        <div class="mensaje">${escapeHtml(post.mensaje || "")}</div>
        <div class="nombre">${escapeHtml(post.nombre || "Participante")}</div>
      </div>`;
    }
    const media =
      post.tipo === "video"
        ? `<video src="${escapeHtml(post.url)}" ${post.miniaturaUrl ? `poster="${escapeHtml(post.miniaturaUrl)}"` : ""} muted playsinline controls></video><div class="play-badge">▶</div>`
        : `<img src="${escapeHtml(post.url)}" alt="Foto de ${escapeHtml(post.nombre || "Participante")}" loading="lazy" />`;
    return `
      <div class="card">
        ${media}
        <div class="meta">
          <div class="nombre">${escapeHtml(post.nombre || "Participante")}</div>
          ${post.mensaje ? `<div class="mensaje">${escapeHtml(post.mensaje)}</div>` : ""}
        </div>
      </div>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function render() {
    const filtrados = filtrarPorHashtag(posts);
    wallContainer.className = modo === "mosaico" ? "grid" : modo;

    if (filtrados.length === 0) {
      wallContainer.className = "grid";
      wallContainer.innerHTML = `<div class="vacio"><b>¡El muro te está esperando!</b>
        Escaneá el QR y dejá la primera foto o mensaje de la jornada.</div>`;
      return;
    }

    if (modo === "mosaico") {
      let nTexto = 0; // para alternar celeste / rosa entre los mensajes
      wallContainer.innerHTML = filtrados
        .slice()
        .reverse()
        .map((p) => tarjetaHtml(p, p.tipo === "texto" ? nTexto++ : 0))
        .join("");
    } else {
      if (indiceCarrusel >= filtrados.length) indiceCarrusel = 0;
      wallContainer.innerHTML = tarjetaHtml(filtrados[indiceCarrusel], indiceCarrusel);
    }

    // Ticker con los últimos nombres/mensajes
    const ultimos = filtrados.slice(-8).reverse();
    tickerText.textContent = ultimos
      .map((p) => `${p.nombre || "Participante"}${p.mensaje ? ": " + p.mensaje : ""}`)
      .join("   ·   ") || `${hashtag} · Escaneá el QR y sumá tu foto o mensaje`;
  }

  function avanzarCarrusel() {
    const filtrados = filtrarPorHashtag(posts);
    if (filtrados.length === 0) return;
    indiceCarrusel = (indiceCarrusel + 1) % filtrados.length;
    render();
  }

  function iniciarRotacion() {
    clearInterval(rotacionTimer);
    if (modo === "mosaico" || pausado) return;
    rotacionTimer = setInterval(avanzarCarrusel, 7000);
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modo = btn.dataset.mode;
      indiceCarrusel = 0;
      marcarModoActivo();
      render();
      iniciarRotacion();
    });
  });

  pausarBtn.addEventListener("click", () => {
    pausado = !pausado;
    pausarBtn.textContent = pausado ? "Seguir" : "Pausar";
    iniciarRotacion();
  });

  async function cargarPosts() {
    try {
      posts = await FeedAdapter.getPosts(displayConfig.fuente);
      render();
    } catch (err) {
      console.error("No se pudieron cargar las publicaciones:", err);
    }
  }

  async function cargarConfigEvento() {
    try {
      const cfg = await FeedAdapter.getConfig();
      hashtag = cfg.hashtag || hashtag;
      document.getElementById("eventoNombre").textContent = cfg.nombre;
      document.getElementById("eventoLema").textContent = cfg.lema;
      document.getElementById("eventoLugar").textContent = cfg.lugar || "";
      document.getElementById("qrHashtag").textContent = hashtag;
      iniciarAhora(cfg.agenda || []);
    } catch (err) {
      console.error("No se pudo cargar la config del evento:", err);
    }
  }

  // "Ahora / Después": muestra qué momento de la jornada está ocurriendo,
  // según el cronograma de data/agenda.json. Se revisa cada 30 segundos.
  function iniciarAhora(agenda) {
    const items = agenda
      .map((a) => ({ ...a, ini: new Date(a.inicio), fin: new Date(a.fin) }))
      .filter((a) => !isNaN(a.ini) && !isNaN(a.fin))
      .sort((x, y) => x.ini - y.ini);
    if (items.length === 0) return;

    const etiqueta = document.getElementById("ahoraEtiqueta");
    const titulo = document.getElementById("ahoraTitulo");
    const sigue = document.getElementById("ahoraSigue");
    const hora = (d) =>
      d.toLocaleTimeString("es-AR", {
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
      });

    function actualizar() {
      const ahora = new Date();
      const enCurso = items.filter((a) => a.ini <= ahora && ahora < a.fin);
      const proximo = items.find((a) => a.ini > ahora);
      const ultimoFin = Math.max(...items.map((a) => a.fin.getTime()));

      if (enCurso.length > 0) {
        etiqueta.textContent = "Ahora";
        titulo.textContent = enCurso.map((a) => a.titulo).join(" · ");
        sigue.textContent = proximo ? `Después, ${hora(proximo.ini)} h: ${proximo.titulo}` : "";
      } else if (proximo) {
        const diffMs = proximo.ini - ahora;
        const dias = Math.floor(diffMs / 86400000);
        const horas = Math.floor((diffMs % 86400000) / 3600000);
        const min = Math.max(1, Math.ceil((diffMs % 3600000) / 60000));
        etiqueta.textContent = proximo === items[0] ? "Falta poco" : "A continuación";
        titulo.textContent =
          proximo === items[0]
            ? dias > 0
              ? `Empezamos en ${dias} día${dias === 1 ? "" : "s"} y ${horas} h`
              : horas > 0
                ? `Empezamos en ${horas} h ${min} min`
                : `Empezamos en ${min} min`
            : proximo.titulo;
        sigue.textContent = `${hora(proximo.ini)} h: ${proximo.titulo}`;
        if (proximo !== items[0]) sigue.textContent = `Comienza ${hora(proximo.ini)} h`;
      } else if (ahora.getTime() >= ultimoFin) {
        etiqueta.textContent = "Jornada finalizada";
        titulo.textContent = "¡Gracias por participar!";
        sigue.textContent = "";
      }
    }
    actualizar();
    setInterval(actualizar, 30000);
  }

  async function cargarQr() {
    try {
      const { dataUrl } = await FeedAdapter.getQr();
      qrImg.src = dataUrl;
    } catch (err) {
      console.error("No se pudo generar el QR:", err);
    }
  }

  async function cargarDisplayConfig() {
    try {
      displayConfig = await FeedAdapter.getDisplayConfig();
    } catch (err) {
      console.error("No se pudo leer la configuración de fuente:", err);
    }
  }

  async function init() {
    marcarModoActivo();
    await Promise.all([cargarConfigEvento(), cargarQr(), cargarDisplayConfig()]);
    await cargarPosts();
    iniciarRotacion();

    FeedAdapter.connectLive(async (tipo) => {
      if (tipo === "posts") {
        await cargarPosts();
      } else if (tipo === "config") {
        await cargarDisplayConfig();
        await cargarPosts();
      }
    });
  }

  init();
})();
