// Capa de datos: habla con el servidor. La usan tanto app.js (el muro)
// como admin.js (el panel del organizador).
(function () {
  async function req(url, options) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  window.FeedAdapter = {
    async getConfig() {
      return req("/api/config");
    },

    /** Qué fuente y qué hashtags se muestran en el muro ahora (server-side,
     * así el panel de organizador en admin.html puede cambiarlo desde otro
     * dispositivo y la pantalla proyectada se entera sola). */
    async getDisplayConfig() {
      return req("/api/config/display");
    },
    async setDisplayConfig(payload) {
      return req("/api/config/display", { method: "POST", body: JSON.stringify(payload) });
    },

    async getPosts(source) {
      const qs = source ? `?source=${encodeURIComponent(source)}` : "";
      return req(`/api/posts${qs}`);
    },

    async getQr() {
      return req("/api/qr");
    },

    async login(pin) {
      return req("/api/admin/login", { method: "POST", body: JSON.stringify({ pin }) });
    },
    async logout() {
      return req("/api/admin/logout", { method: "POST" });
    },
    async checkSession() {
      return req("/api/admin/session");
    },

    async getModerationSettings() {
      return req("/api/moderate/settings");
    },
    async setAprobacionPrevia(requiereAprobacion) {
      return req("/api/moderate/aprobacion", {
        method: "POST",
        body: JSON.stringify({ requiereAprobacion }),
      });
    },
    async setWords(payload) {
      return req("/api/moderate/words", { method: "POST", body: JSON.stringify(payload) });
    },
    async getPending() {
      return req("/api/moderate/pending");
    },
    async getPublished() {
      return req("/api/moderate/published");
    },
    async getHidden() {
      return req("/api/moderate/hidden");
    },
    async approve(id) {
      return req("/api/moderate/approve", { method: "POST", body: JSON.stringify({ id }) });
    },
    async reject(id) {
      return req("/api/moderate/reject", { method: "POST", body: JSON.stringify({ id }) });
    },
    async remove(id) {
      return req("/api/moderate/delete", { method: "POST", body: JSON.stringify({ id }) });
    },
    async hide(id) {
      return req("/api/moderate/hide", { method: "POST", body: JSON.stringify({ id }) });
    },
    async restore(id) {
      return req("/api/moderate/restore", { method: "POST", body: JSON.stringify({ id }) });
    },

    /** Conexión en vivo (SSE). onChange(tipo) se llama con "posts",
     * "config", "moderacion" o "pendiente" cada vez que algo cambia. */
    connectLive(onChange) {
      const es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.tipo && data.tipo !== "conectado") onChange(data.tipo, data);
        } catch {}
      };
      return es;
    },
  };
})();
