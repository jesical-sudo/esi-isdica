(function () {
  const { FeedAdapter } = window;

  const cameraBtn = document.getElementById("cameraBtn");
  const galleryBtn = document.getElementById("galleryBtn");
  const cameraInput = document.getElementById("cameraInput");
  const galleryInput = document.getElementById("galleryInput");
  const previewGrid = document.getElementById("previewGrid");
  const nombreInput = document.getElementById("nombreInput");
  const mensajeInput = document.getElementById("mensajeInput");
  const subirBtn = document.getElementById("subirBtn");
  const statusMsg = document.getElementById("statusMsg");

  const MAX_VIDEO_SEGUNDOS = 30;
  let seleccionados = []; // { file, tipo, previewUrl, miniaturaBlob? }

  cameraBtn.addEventListener("click", () => cameraInput.click());
  galleryBtn.addEventListener("click", () => galleryInput.click());

  cameraInput.addEventListener("change", (e) => handleFiles(e.target.files));
  galleryInput.addEventListener("change", (e) => handleFiles(e.target.files));

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList)) {
      const esVideo = file.type.startsWith("video/");
      if (esVideo) {
        const duracion = await obtenerDuracionVideo(file).catch(() => null);
        if (duracion !== null && duracion > MAX_VIDEO_SEGUNDOS) {
          mostrarStatus(
            `El video "${file.name}" dura más de ${MAX_VIDEO_SEGUNDOS} segundos — elegí uno más corto.`,
            "error"
          );
          continue;
        }
      }
      const previewUrl = URL.createObjectURL(file);
      const item = { file, tipo: esVideo ? "video" : "foto", previewUrl };
      if (esVideo) {
        item.miniaturaBlob = await generarMiniaturaVideo(file).catch(() => null);
      }
      seleccionados.push(item);
    }
    // permitir elegir el mismo archivo de nuevo más adelante
    cameraInput.value = "";
    galleryInput.value = "";
    renderPreview();
  }

  function obtenerDuracionVideo(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error("No se pudo leer el video"));
      video.src = URL.createObjectURL(file);
    });
  }

  function generarMiniaturaVideo(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);
      video.onloadeddata = () => {
        video.currentTime = Math.min(0.3, (video.duration || 1) / 2);
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 320;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(video.src);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
      };
      video.onerror = () => reject(new Error("No se pudo generar la miniatura"));
    });
  }

  function comprimirFoto(file, maxAncho = 1600, calidad = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxAncho) {
          height = Math.round((height * maxAncho) / width);
          width = maxAncho;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => resolve(blob || file),
          "image/jpeg",
          calidad
        );
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.src = URL.createObjectURL(file);
    });
  }

  function renderPreview() {
    previewGrid.innerHTML = seleccionados
      .map((item, i) => {
        const media =
          item.tipo === "video"
            ? `<video src="${item.previewUrl}" muted></video>`
            : `<img src="${item.previewUrl}" alt="" />`;
        return `<div class="preview-item">${media}<button data-i="${i}" aria-label="Quitar">✕</button></div>`;
      })
      .join("");
    previewGrid.querySelectorAll("button[data-i]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        URL.revokeObjectURL(seleccionados[i].previewUrl);
        seleccionados.splice(i, 1);
        renderPreview();
      });
    });
  }

  const contador = document.getElementById("contador");
  function actualizarContador() {
    if (contador) contador.textContent = mensajeInput.value.length;
  }
  mensajeInput.addEventListener("input", actualizarContador);

  function mostrarStatus(texto, tipo) {
    statusMsg.textContent = texto;
    statusMsg.className = `status-msg ${tipo || ""}`;
  }

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  subirBtn.addEventListener("click", async () => {
    const nombre = nombreInput.value.trim();
    const mensaje = mensajeInput.value.trim();
    if (seleccionados.length === 0 && !mensaje) {
      mostrarStatus("Escribí un mensaje o elegí una foto o video primero.", "error");
      return;
    }
    subirBtn.disabled = true;
    let subidas = 0;
    let pendientes = false;

    // Mensaje solo, sin foto ni video
    if (seleccionados.length === 0) {
      mostrarStatus("Enviando tu mensaje...", "");
      try {
        const form = new FormData();
        form.append("nombre", nombre);
        form.append("mensaje", mensaje);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "No se pudo enviar");
        subirBtn.disabled = false;
        mensajeInput.value = "";
        actualizarContador();
        mostrarStatus(
          data.estado === "publicado"
            ? "¡Listo! Tu mensaje ya está en el muro."
            : "¡Gracias! Tu mensaje se envió y aparecerá en el muro cuando el equipo lo apruebe.",
          "ok"
        );
      } catch (err) {
        subirBtn.disabled = false;
        mostrarStatus(err.message || "No se pudo enviar, probá de nuevo.", "error");
      }
      return;
    }

    for (let i = 0; i < seleccionados.length; i++) {
      const item = seleccionados[i];
      mostrarStatus(`Subiendo ${i + 1} de ${seleccionados.length}...`, "");
      try {
        const form = new FormData();
        form.append("nombre", nombre);
        form.append("mensaje", mensaje);

        if (item.tipo === "video") {
          form.append("video", item.file);
          if (item.miniaturaBlob) {
            form.append("miniatura", item.miniaturaBlob, "miniatura.jpg");
          }
        } else {
          const comprimida = await comprimirFoto(item.file).catch(() => item.file);
          form.append("foto", comprimida, "foto.jpg");
        }

        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (res.status === 429) {
          // límite de ráfaga: esperar un momento y reintentar una vez
          await esperar(3200);
          const reintento = await fetch("/api/upload", { method: "POST", body: form });
          if (!reintento.ok) throw new Error("No se pudo subir");
          const d = await reintento.json().catch(() => ({}));
          if (d.estado !== "publicado") pendientes = true;
        } else if (!res.ok) {
          throw new Error("No se pudo subir");
        } else {
          const d = await res.json().catch(() => ({}));
          if (d.estado !== "publicado") pendientes = true;
        }
        subidas++;
      } catch (err) {
        mostrarStatus(`Hubo un problema subiendo el archivo ${i + 1}. Seguimos con el resto...`, "error");
        await esperar(800);
      }
    }

    seleccionados.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    seleccionados = [];
    renderPreview();
    subirBtn.disabled = false;

    if (subidas > 0) {
      mensajeInput.value = "";
      actualizarContador();
      const cuantos = `${subidas} archivo${subidas === 1 ? "" : "s"}`;
      mostrarStatus(
        pendientes
          ? `¡Gracias! Se ${subidas === 1 ? "envió" : "enviaron"} ${cuantos} y ${subidas === 1 ? "aparecerá" : "aparecerán"} en el muro cuando el equipo ${subidas === 1 ? "lo" : "los"} apruebe.`
          : `¡Listo! Ya ${subidas === 1 ? "está" : "están"} en el muro (${cuantos}).`,
        "ok"
      );
    } else {
      mostrarStatus("No se pudo subir nada, probá de nuevo.", "error");
    }
  });
})();
