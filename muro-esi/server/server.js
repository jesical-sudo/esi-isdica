require("dotenv").config();
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");
const QRCode = require("qrcode");
const googlePhotos = require("./google-photos");

const app = express();
// Render pone un proxy adelante: esto hace que req.ip sea la IP real de cada
// invitado (para el limitador de subidas) y que req.protocol sea "https".
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "0910";
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const FEED_FILE = path.join(DATA_DIR, "feed.json");
const MODERACION_FILE = path.join(DATA_DIR, "moderacion.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  if (!fssync.existsSync(dir)) fssync.mkdirSync(dir, { recursive: true });
}

const AGENDA_FILE = path.join(DATA_DIR, "agenda.json");
let AGENDA = [];
try {
  AGENDA = JSON.parse(fssync.readFileSync(AGENDA_FILE, "utf-8"));
} catch {
  AGENDA = [];
}

const EVENT_CONFIG = {
  nombre: process.env.EVENT_NAME || "III Jornadas de Educación Sexual Integral",
  lema: process.env.EVENT_TAGLINE || "Educar en afectividad es cuidar la salud mental",
  hashtag: process.env.EVENT_HASHTAG || "#ESIenISDICA",
  fecha: process.env.EVENT_DATE || "2026-10-09",
  lugar: process.env.EVENT_PLACE || "ISDICA · Lamadrid N° 945",
  // Momentos de la jornada (data/agenda.json): el muro muestra cuál está
  // ocurriendo "ahora" y cuál sigue.
  agenda: AGENDA,
};

// Las publicaciones que son solo un mensaje (sin foto ni video) no tienen
// archivo: no se copian a Google Photos.
const tieneArchivo = (p) => p && p.tipo !== "texto";

const FUENTES_VALIDAS = new Set(["invitados", "ejemplo", "instagram"]);
const DISPLAY_DEFAULT = { fuente: "invitados", hashtagsActivos: [] };
const MODERACION_DEFAULT = {
  requiereAprobacion: true,
  palabrasBloqueadas: [],
  nombresBloqueados: [],
};

// ----------------------------------------------------------------- utils

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fssync.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

async function updateJson(file, fallback, mutate) {
  const current = await readJson(file, fallback);
  const updated = mutate(current);
  await writeJson(file, updated);
  return updated;
}

function leerDisplayConfig() {
  return readJson(CONFIG_FILE, DISPLAY_DEFAULT);
}

function leerModeracion() {
  return readJson(MODERACION_FILE, MODERACION_DEFAULT);
}

function contieneTextoBloqueado(texto, lista) {
  if (!texto) return false;
  const t = texto.toLowerCase();
  return lista.some((palabra) => palabra && t.includes(palabra.toLowerCase()));
}

// ------------------------------------------------------- SSE (tiempo real)

const clientesSSE = new Set();

function broadcastChanged(tipo, payload = {}) {
  const data = JSON.stringify({ tipo, ...payload, ts: Date.now() });
  for (const res of clientesSSE) {
    res.write(`data: ${data}\n\n`);
  }
}

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ tipo: "conectado" })}\n\n`);
  clientesSSE.add(res);

  const keepAlive = setInterval(() => {
    res.write(`: keep-alive\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clientesSSE.delete(res);
  });
});

// ----------------------------------------------------------------- admin auth

function requireAdmin(req, res, next) {
  if (req.cookies?.admin_session === ADMIN_PIN) return next();
  return res.status(401).json({ error: "No autorizado" });
}

app.use(express.json());
app.use(cookieParser());

app.post("/api/admin/login", (req, res) => {
  const { pin } = req.body || {};
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "PIN incorrecto" });
  }
  res.cookie("admin_session", ADMIN_PIN, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 12, // 12 horas
  });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_session");
  res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// ----------------------------------------------------------------- config

app.get("/api/config", (req, res) => {
  res.json(EVENT_CONFIG);
});

// Fuente activa (invitados/ejemplo/instagram) y filtro de hashtags: lectura
// pública (la pantalla del salón la necesita sin estar logueada); solo el
// organizador (PIN) puede cambiarla, desde admin.html.
app.get("/api/config/display", async (req, res) => {
  res.json(await leerDisplayConfig());
});

app.post("/api/config/display", requireAdmin, async (req, res) => {
  const { fuente, hashtagsActivos } = req.body || {};
  if (fuente !== undefined && !FUENTES_VALIDAS.has(fuente)) {
    return res.status(400).json({ error: "Fuente inválida" });
  }
  const updated = await updateJson(CONFIG_FILE, DISPLAY_DEFAULT, (cfg) => ({
    ...DISPLAY_DEFAULT,
    ...cfg,
    ...(fuente !== undefined ? { fuente } : {}),
    ...(Array.isArray(hashtagsActivos)
      ? { hashtagsActivos: hashtagsActivos.filter(Boolean).slice(0, 50) }
      : {}),
  }));
  broadcastChanged("config", {
    fuente: updated.fuente,
    hashtagsActivos: updated.hashtagsActivos,
  });
  res.json(updated);
});

// -------------------------------------------------------------- moderación

app.get("/api/moderate/settings", requireAdmin, async (req, res) => {
  res.json(await leerModeracion());
});

app.post("/api/moderate/aprobacion", requireAdmin, async (req, res) => {
  const { requiereAprobacion } = req.body || {};
  const updated = await updateJson(MODERACION_FILE, MODERACION_DEFAULT, (m) => ({
    ...MODERACION_DEFAULT,
    ...m,
    requiereAprobacion: Boolean(requiereAprobacion),
  }));
  broadcastChanged("moderacion");
  res.json(updated);
});

app.post("/api/moderate/words", requireAdmin, async (req, res) => {
  const { palabrasBloqueadas, nombresBloqueados } = req.body || {};
  const updated = await updateJson(MODERACION_FILE, MODERACION_DEFAULT, (m) => ({
    ...MODERACION_DEFAULT,
    ...m,
    ...(Array.isArray(palabrasBloqueadas)
      ? { palabrasBloqueadas: palabrasBloqueadas.filter(Boolean).slice(0, 200) }
      : {}),
    ...(Array.isArray(nombresBloqueados)
      ? { nombresBloqueados: nombresBloqueados.filter(Boolean).slice(0, 200) }
      : {}),
  }));
  res.json(updated);
});

app.get("/api/moderate/pending", requireAdmin, async (req, res) => {
  const posts = await readJson(POSTS_FILE, []);
  res.json(posts.filter((p) => p.estado === "pendiente"));
});

app.get("/api/moderate/hidden", requireAdmin, async (req, res) => {
  const posts = await readJson(POSTS_FILE, []);
  res.json(posts.filter((p) => p.estado === "oculto"));
});

app.get("/api/moderate/published", requireAdmin, async (req, res) => {
  const posts = await readJson(POSTS_FILE, []);
  res.json(posts.filter((p) => p.estado === "publicado").reverse());
});

app.post("/api/moderate/approve", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  const posts = await updateJson(POSTS_FILE, [], (list) =>
    list.map((p) => (p.id === id ? { ...p, estado: "publicado" } : p))
  );
  broadcastChanged("posts");
  encolarGoogle(id);
  res.json({ ok: true });
});

app.post("/api/moderate/reject", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  let rechazado;
  await updateJson(POSTS_FILE, [], (list) => {
    rechazado = list.find((p) => p.id === id);
    return list.filter((p) => p.id !== id);
  });
  await borrarArchivosDe(rechazado);
  res.json({ ok: true });
});

// Borra del servidor los archivos de una publicación (foto o video,
// miniatura y original). Solo toca archivos dentro de uploads/.
async function borrarArchivosDe(post) {
  if (!post) return;
  const nombres = [post.url, post.miniaturaUrl, post.original]
    .filter((v) => typeof v === "string" && v)
    .filter((v) => v === post.original || v.startsWith("/uploads/"))
    .map((v) => path.basename(v));
  for (const nombre of new Set(nombres)) {
    await fs.unlink(path.join(UPLOADS_DIR, nombre)).catch(() => {});
  }
}

// Eliminar definitivamente una publicación (publicada u oculta): se quita
// del muro al instante y se borran sus archivos. No se puede deshacer.
app.post("/api/moderate/delete", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  let eliminado;
  await updateJson(POSTS_FILE, [], (list) => {
    eliminado = list.find((p) => p.id === id);
    return list.filter((p) => p.id !== id);
  });
  if (!eliminado) return res.status(404).json({ error: "Esa publicación ya no existe" });
  await borrarArchivosDe(eliminado);
  broadcastChanged("posts");
  res.json({ ok: true, yaCopiadoAGoogle: eliminado.googlePhotos === "subido" });
});

app.post("/api/moderate/hide", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  await updateJson(POSTS_FILE, [], (list) =>
    list.map((p) => (p.id === id ? { ...p, estado: "oculto" } : p))
  );
  broadcastChanged("posts");
  res.json({ ok: true });
});

app.post("/api/moderate/restore", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  await updateJson(POSTS_FILE, [], (list) =>
    list.map((p) => (p.id === id ? { ...p, estado: "publicado" } : p))
  );
  broadcastChanged("posts");
  encolarGoogle(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ /api/posts

app.get("/api/posts", async (req, res) => {
  const { source } = req.query;

  if (source === "ejemplo") {
    const feed = await readJson(FEED_FILE, []);
    return res.json(feed);
  }

  if (source === "instagram") {
    // Modo Instagram: preparado pero apagado por defecto (ver README).
    return res.json([]);
  }

  // invitados (default)
  const posts = await readJson(POSTS_FILE, []);
  res.json(posts.filter((p) => p.estado === "publicado"));
});

// -------------------------------------------------------------------- upload

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || (
      file.mimetype.startsWith("video/") ? ".mp4" : ".jpg"
    );
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB (cubre fotos y videos cortos)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de archivo no permitido"));
    }
  },
});

// Limitador simple de ráfaga por IP: 10 subidas seguidas, se recargan de a
// una cada 3s, para permitir la subida múltiple sin bloquear a nadie.
const BURST_MAX = 10;
const BURST_REFILL_MS = 3000;
const burstBuckets = new Map();

function tomarTurnoDeSubida(ip) {
  const now = Date.now();
  const bucket = burstBuckets.get(ip) || { tokens: BURST_MAX, last: now };
  const elapsed = now - bucket.last;
  const recargados = Math.floor(elapsed / BURST_REFILL_MS);
  if (recargados > 0) {
    bucket.tokens = Math.min(BURST_MAX, bucket.tokens + recargados);
    bucket.last = now;
  }
  if (bucket.tokens <= 0) {
    burstBuckets.set(ip, bucket);
    return false;
  }
  bucket.tokens -= 1;
  burstBuckets.set(ip, bucket);
  return true;
}

app.post(
  "/api/upload",
  (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || "anon";
    if (!tomarTurnoDeSubida(ip)) {
      return res.status(429).json({
        error: "Demasiadas subidas seguidas, esperá unos segundos e intentá de nuevo.",
      });
    }
    next();
  },
  upload.fields([
    { name: "foto", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "miniatura", maxCount: 1 }, // miniatura de video generada en el celular
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const fotoFile = files.foto?.[0];
      const videoFile = files.video?.[0];
      const miniaturaFile = files.miniatura?.[0];

      let { nombre, mensaje, hashtags } = req.body || {};
      nombre = (nombre || "").trim().slice(0, 60);
      mensaje = (mensaje || "").trim().slice(0, 300);

      // Se puede publicar un mensaje solo (sin foto ni video), pero no una
      // publicación completamente vacía.
      if (!fotoFile && !videoFile && !mensaje) {
        return res.status(400).json({ error: "Escribí un mensaje o elegí una foto o video" });
      }
      const hashtagsList = (hashtags || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, 10);

      const moderacion = await leerModeracion();
      const textoAFiltrar = `${nombre} ${mensaje}`;
      const contieneBloqueado =
        contieneTextoBloqueado(textoAFiltrar, moderacion.palabrasBloqueadas) ||
        contieneTextoBloqueado(nombre, moderacion.nombresBloqueados);

      let tipo = "foto";
      let archivoUrl;
      let miniaturaUrl;
      let original = null;
      let mimeOriginal = null;

      if (!fotoFile && !videoFile) {
        tipo = "texto";
        archivoUrl = null;
      } else if (videoFile) {
        tipo = "video";
        archivoUrl = `/uploads/${videoFile.filename}`;
        mimeOriginal = videoFile.mimetype;
        if (miniaturaFile) {
          miniaturaUrl = `/uploads/${miniaturaFile.filename}`;
        }
      } else {
        // Comprimir foto con sharp antes de guardarla (siempre a un archivo
        // nuevo, nunca al mismo path de entrada, para evitar pisarlo)
        const outputName = `${path.parse(fotoFile.filename).name}-c.jpg`;
        const outputPath = path.join(UPLOADS_DIR, outputName);
        await sharp(fotoFile.path)
          .rotate()
          .resize({ width: 1600, withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toFile(outputPath);
        if (googlePhotos.conectado()) {
          // Se guarda el original (calidad completa) para mandarlo a Google
          // Photos; se borra del servidor apenas termina de subirse.
          original = fotoFile.filename;
          mimeOriginal = fotoFile.mimetype;
        } else {
          await fs.unlink(fotoFile.path).catch(() => {});
        }
        archivoUrl = `/uploads/${outputName}`;
      }

      let estado = "publicado";
      if (contieneBloqueado) {
        estado = "oculto";
      } else if (moderacion.requiereAprobacion) {
        estado = "pendiente";
      }

      const post = {
        id: crypto.randomUUID(),
        tipo,
        url: archivoUrl,
        miniaturaUrl: miniaturaUrl || null,
        nombre: nombre || "Participante",
        mensaje,
        hashtags: hashtagsList,
        estado,
        creadoEn: new Date().toISOString(),
        original,
        mimeOriginal,
        googlePhotos: null, // null | "en-cola" | "subido" | "error"
      };

      await updateJson(POSTS_FILE, [], (list) => [...list, post]);

      if (estado === "publicado") {
        broadcastChanged("posts");
        if (tieneArchivo(post)) encolarGoogle(post.id);
      } else if (estado === "pendiente") {
        broadcastChanged("pendiente");
      }

      res.json({ ok: true, estado });
    } catch (err) {
      console.error("Error en /api/upload:", err);
      res.status(500).json({ error: "No se pudo procesar la subida" });
    }
  }
);

// ------------------------------------------------------------ Google Photos
// Cada foto o video que queda publicado en el muro se copia automáticamente
// a un álbum de Google Photos (en segundo plano, de a uno por vez). Así no se
// pierde nada aunque Render reinicie el servicio y borre el disco.

const colaGoogle = [];
let procesandoGoogle = false;
let ultimoErrorGoogle = null;
const MAX_INTENTOS_GOOGLE = 4;

function encolarGoogle(postId) {
  if (!googlePhotos.conectado()) return;
  if (colaGoogle.some((t) => t.id === postId)) return;
  const enDisco = readJsonSync(POSTS_FILE, []).find((p) => p.id === postId);
  if (enDisco && !tieneArchivo(enDisco)) return;
  colaGoogle.push({ id: postId, intentos: 0 });
  marcarGoogle(postId, "en-cola", { soloSiNoSubido: true }).catch(() => {});
  procesarColaGoogle();
}

async function marcarGoogle(postId, valor, { soloSiNoSubido = false } = {}) {
  await updateJson(POSTS_FILE, [], (list) =>
    list.map((p) =>
      p.id === postId && !(soloSiNoSubido && p.googlePhotos === "subido")
        ? { ...p, googlePhotos: valor }
        : p
    )
  );
}

async function procesarColaGoogle() {
  if (procesandoGoogle) return;
  procesandoGoogle = true;
  try {
    while (colaGoogle.length) {
      const tarea = colaGoogle[0];
      const posts = await readJson(POSTS_FILE, []);
      const post = posts.find((p) => p.id === tarea.id);

      // Si ya no existe, ya se subió o dejó de estar publicado, se descarta
      if (!post || !tieneArchivo(post) || post.googlePhotos === "subido" || post.estado !== "publicado") {
        colaGoogle.shift();
        continue;
      }

      const archivo = post.original || path.basename(post.url);
      const ruta = path.join(UPLOADS_DIR, archivo);
      if (!fssync.existsSync(ruta)) {
        colaGoogle.shift();
        await marcarGoogle(post.id, "error");
        ultimoErrorGoogle = "Un archivo ya no estaba en el servidor (se reinició antes de copiarlo).";
        continue;
      }

      try {
        const nombre = post.nombre || "Participante";
        await googlePhotos.subirArchivo({
          ruta,
          mime: post.mimeOriginal || (post.tipo === "video" ? "video/mp4" : "image/jpeg"),
          nombreArchivo: `JornadasESI-${post.creadoEn.replace(/[:.]/g, "-")}${path.extname(archivo)}`,
          descripcion: `${nombre}${post.mensaje ? ": " + post.mensaje : ""}`,
        });
        colaGoogle.shift();
        await marcarGoogle(post.id, "subido");
        if (post.original) {
          await fs.unlink(ruta).catch(() => {});
          await updateJson(POSTS_FILE, [], (list) =>
            list.map((p) => (p.id === post.id ? { ...p, original: null } : p))
          );
        }
      } catch (err) {
        tarea.intentos += 1;
        ultimoErrorGoogle = err.message;
        console.error("Google Photos:", err.message);
        if (tarea.intentos >= MAX_INTENTOS_GOOGLE) {
          colaGoogle.shift();
          await marcarGoogle(post.id, "error");
        } else {
          // Reintento con espera creciente (5 s, 20 s, 45 s)
          await new Promise((r) => setTimeout(r, 5000 * tarea.intentos * tarea.intentos));
        }
      }
    }
  } finally {
    procesandoGoogle = false;
  }
}

function urlDelSitio(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}
function redirectUriGoogle(req) {
  return `${urlDelSitio(req)}/api/google/callback`;
}

const statesGoogle = new Set();

app.get("/api/google/status", requireAdmin, async (req, res) => {
  const posts = await readJson(POSTS_FILE, []);
  const publicados = posts.filter((p) => p.estado === "publicado" && tieneArchivo(p));
  res.json({
    configurado: googlePhotos.configurado(),
    conectado: googlePhotos.conectado(),
    guardadoEnRender: googlePhotos.guardadoEnRender(),
    redirectUri: redirectUriGoogle(req),
    subidos: publicados.filter((p) => p.googlePhotos === "subido").length,
    enCola: colaGoogle.length,
    conError: publicados.filter((p) => p.googlePhotos === "error").length,
    sinCopiar: publicados.filter((p) => p.googlePhotos !== "subido").length,
    ultimoError: ultimoErrorGoogle,
  });
});

app.get("/api/google/connect", requireAdmin, (req, res) => {
  if (!googlePhotos.configurado()) {
    return res
      .status(400)
      .send("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las variables de entorno de Render.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  statesGoogle.add(state);
  setTimeout(() => statesGoogle.delete(state), 15 * 60 * 1000);
  res.redirect(googlePhotos.urlDeAutorizacion(redirectUriGoogle(req), state));
});

function paginaGoogle(titulo, cuerpo) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${titulo}</title><link rel="stylesheet" href="/css/style.css" />
<style>.valor{word-break:break-all;font-family:monospace;font-size:.85rem;background:rgba(11,45,107,.07);padding:10px;border-radius:10px;margin:6px 0 8px}</style>
</head><body><div class="admin-wrap"><div class="admin-card">${cuerpo}</div>
<a class="btn" href="/admin.html" style="display:inline-block;text-decoration:none">← Volver al panel</a></div>
<script>document.querySelectorAll("[data-copiar]").forEach(b=>b.onclick=()=>{navigator.clipboard.writeText(document.getElementById(b.dataset.copiar).textContent);b.textContent="¡Copiado!";setTimeout(()=>b.textContent="Copiar",1500)})</script>
</body></html>`;
}

app.get("/api/google/callback", requireAdmin, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.send(paginaGoogle("Google Photos", `<h2>No se conectó</h2><p>Google respondió: ${escapeHtml(error)}</p>`));
  }
  if (!code || !statesGoogle.has(state)) {
    return res.status(400).send(paginaGoogle("Google Photos", `<h2>Enlace vencido</h2><p>Volvé al panel y tocá “Conectar con Google Photos” otra vez.</p>`));
  }
  statesGoogle.delete(state);
  try {
    const refreshToken = await googlePhotos.canjearCodigo(code, redirectUriGoogle(req));
    let albumId = googlePhotos.estado.albumId;
    if (!albumId) {
      albumId = await googlePhotos.crearAlbum(`${EVENT_CONFIG.nombre} · ${EVENT_CONFIG.hashtag}`);
    }
    res.send(
      paginaGoogle(
        "Google Photos conectado",
        `<h2>¡Google Photos conectado! ✨</h2>
<p>Ya se creó el álbum <b>${escapeHtml(EVENT_CONFIG.nombre)}</b> y desde ahora cada foto y video publicado se copia ahí.</p>
<p><b>Último paso, muy importante:</b> copiá estos dos valores en Render → <i>Environment</i> para que la conexión no se pierda cuando el sitio se reinicie.</p>
<p style="margin-bottom:0"><b>GOOGLE_REFRESH_TOKEN</b></p>
<div class="valor" id="v1">${escapeHtml(refreshToken)}</div>
<button class="btn" data-copiar="v1">Copiar</button>
<p style="margin-bottom:0;margin-top:16px"><b>GOOGLE_PHOTOS_ALBUM_ID</b></p>
<div class="valor" id="v2">${escapeHtml(albumId)}</div>
<button class="btn" data-copiar="v2">Copiar</button>
<p style="font-size:.85rem;opacity:.75;margin-top:16px">No compartas estos valores con nadie: dan permiso para subir fotos a tu Google Photos.</p>`
      )
    );
  } catch (err) {
    console.error("Google Photos callback:", err);
    res.status(500).send(paginaGoogle("Google Photos", `<h2>No se pudo conectar</h2><p>${escapeHtml(err.message)}</p>`));
  }
});

// Vuelve a encolar todo lo publicado que todavía no está en Google Photos
app.post("/api/google/sync", requireAdmin, async (req, res) => {
  if (!googlePhotos.conectado()) return res.status(400).json({ error: "Google Photos no está conectado" });
  const posts = await readJson(POSTS_FILE, []);
  const faltantes = posts.filter((p) => p.estado === "publicado" && tieneArchivo(p) && p.googlePhotos !== "subido");
  for (const p of faltantes) encolarGoogle(p.id);
  res.json({ ok: true, encolados: faltantes.length });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Al arrancar: si hay publicaciones sin copiar (y sus archivos siguen), se encolan
setTimeout(async () => {
  if (!googlePhotos.conectado()) return;
  const posts = await readJson(POSTS_FILE, []);
  posts
    .filter((p) => p.estado === "publicado" && tieneArchivo(p) && p.googlePhotos !== "subido")
    .forEach((p) => encolarGoogle(p.id));
}, 3000);

// --------------------------------------------------------------------- QR

app.get("/api/qr", async (req, res) => {
  try {
    const base = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${base.replace(/\/$/, "")}/subir.html`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: "No se pudo generar el QR" });
  }
});

// ------------------------------------------------------------- archivos estáticos

app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "1h" }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Muro de las ${EVENT_CONFIG.nombre} corriendo en el puerto ${PORT}`);
});
