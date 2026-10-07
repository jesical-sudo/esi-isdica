// Copia automática de las fotos y videos del muro a un álbum de Google Photos.
//
// Usa la API de Google Photos con el permiso "appendonly": la app solo puede
// SUBIR fotos y crear su propio álbum; no puede ver ni borrar nada más de la
// cuenta de Google.
//
// Variables de entorno (Render → Environment):
//   GOOGLE_CLIENT_ID        ID de cliente OAuth (Google Cloud)
//   GOOGLE_CLIENT_SECRET    Secreto de cliente OAuth
//   GOOGLE_REFRESH_TOKEN    Se obtiene desde el panel (botón "Conectar")
//   GOOGLE_PHOTOS_ALBUM_ID  Se obtiene desde el panel (se crea el álbum solo)

const fs = require("fs/promises");

const SCOPE = "https://www.googleapis.com/auth/photoslibrary.appendonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://photoslibrary.googleapis.com/v1";

const estado = {
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
  albumId: process.env.GOOGLE_PHOTOS_ALBUM_ID || "",
  accessToken: "",
  venceEn: 0,
};

function clientId() {
  return (process.env.GOOGLE_CLIENT_ID || "").trim();
}
function clientSecret() {
  return (process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

/** Hay credenciales de Google Cloud cargadas en Render. */
function configurado() {
  return Boolean(clientId() && clientSecret());
}

/** Ya se autorizó la cuenta y hay un álbum de destino. */
function conectado() {
  return configurado() && Boolean(estado.refreshToken) && Boolean(estado.albumId);
}

/** Los datos de conexión están guardados en Render (sobreviven reinicios). */
function guardadoEnRender() {
  return (
    Boolean(process.env.GOOGLE_REFRESH_TOKEN) &&
    Boolean(process.env.GOOGLE_PHOTOS_ALBUM_ID) &&
    process.env.GOOGLE_REFRESH_TOKEN === estado.refreshToken &&
    process.env.GOOGLE_PHOTOS_ALBUM_ID === estado.albumId
  );
}

function urlDeAutorizacion(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function pedirToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      ...body,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Google rechazó la autorización: ${data.error_description || data.error || res.status}`
    );
  }
  return data;
}

/** Canjea el código que devuelve Google por un refresh token. */
async function canjearCodigo(code, redirectUri) {
  const data = await pedirToken({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!data.refresh_token) {
    throw new Error(
      "Google no devolvió un refresh token. Quitá el acceso de la app en " +
        "myaccount.google.com/permissions y volvé a conectar."
    );
  }
  estado.refreshToken = data.refresh_token;
  estado.accessToken = data.access_token;
  estado.venceEn = Date.now() + (data.expires_in - 60) * 1000;
  return data.refresh_token;
}

async function accessToken() {
  if (estado.accessToken && Date.now() < estado.venceEn) return estado.accessToken;
  if (!estado.refreshToken) throw new Error("Google Photos no está conectado");
  const data = await pedirToken({
    refresh_token: estado.refreshToken,
    grant_type: "refresh_token",
  });
  estado.accessToken = data.access_token;
  estado.venceEn = Date.now() + (data.expires_in - 60) * 1000;
  return estado.accessToken;
}

async function api(ruta, opciones = {}) {
  const token = await accessToken();
  const res = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) },
  });
  if (res.status === 401) estado.accessToken = ""; // forzar renovación
  return res;
}

async function crearAlbum(titulo) {
  const res = await api("/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ album: { title: titulo } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`No se pudo crear el álbum: ${data.error?.message || res.status}`);
  }
  estado.albumId = data.id;
  return data.id;
}

/** Sube un archivo local al álbum. Devuelve el id del ítem en Google Photos. */
async function subirArchivo({ ruta, mime, nombreArchivo, descripcion }) {
  if (!conectado()) throw new Error("Google Photos no está conectado");
  const contenido = await fs.readFile(ruta);

  // Paso 1: subir los bytes y obtener un "upload token"
  const subida = await api("/uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Goog-Upload-Content-Type": mime || "application/octet-stream",
      "X-Goog-Upload-Protocol": "raw",
    },
    body: contenido,
  });
  const uploadToken = await subida.text();
  if (!subida.ok || !uploadToken) {
    throw new Error(`Error subiendo el archivo (${subida.status}): ${uploadToken.slice(0, 200)}`);
  }

  // Paso 2: crear el ítem dentro del álbum
  const alta = await api("/mediaItems:batchCreate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      albumId: estado.albumId,
      newMediaItems: [
        {
          description: (descripcion || "").slice(0, 1000),
          simpleMediaItem: { uploadToken, fileName: nombreArchivo },
        },
      ],
    }),
  });
  const data = await alta.json().catch(() => ({}));
  const resultado = data.newMediaItemResults?.[0];
  const codigo = resultado?.status?.code || 0;
  if (!alta.ok || !resultado || codigo !== 0) {
    throw new Error(
      `Google Photos no aceptó el archivo: ${
        resultado?.status?.message || data.error?.message || alta.status
      }`
    );
  }
  return resultado.mediaItem?.id || "";
}

module.exports = {
  estado,
  configurado,
  conectado,
  guardadoEnRender,
  urlDeAutorizacion,
  canjearCodigo,
  crearAlbum,
  subirArchivo,
};
