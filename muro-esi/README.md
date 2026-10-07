# Muro social en vivo — III Jornadas de ESI · ISDICA (#ESIenISDICA)

Muro para proyectar durante las **III Jornadas de Educación Sexual Integral**
(9 de octubre de 2026, Lamadrid N° 945). Quienes participan escanean un QR
y, desde el celular y sin crear cuenta, dejan **un mensaje, una foto o un
video corto**. Lo que el equipo aprueba aparece en la pantalla grande.

Es el mismo sistema que el muro de los 15 de Nahiara, con otro diseño
(azul, rojo y blanco, como los flyers) y cuatro diferencias:

- **Mensajes solos:** se puede publicar una reflexión sin foto; aparece
  como una tarjeta de texto celeste o rosa.
- **Aprobación previa activada por defecto:** nada sale en el muro hasta
  que alguien lo aprueba en el panel.
- **“Ahora / Después”:** el encabezado muestra qué momento de la jornada
  está ocurriendo, según el cronograma (`data/agenda.json`).
- **Ocultar o eliminar lo ya publicado:** el panel lista lo que está en
  el muro, con botones para ocultarlo o eliminarlo definitivamente.

## Las tres páginas

| Página | Para qué |
| --- | --- |
| `/` | El muro. Se abre en la computadora conectada al proyector. |
| `/subir.html` | La que abre el QR: formulario para participantes. |
| `/admin.html` | Panel de organización, con PIN. Se usa desde el celular de quien modera. |

## Cómo publicarlo (igual que el de Nahiara)

1. Creá un **repositorio nuevo** en GitHub (por ejemplo `muro-esi-isdica`).
   No reutilices el de Nahiara.
2. **Descomprimí** el zip en tu computadora. Abrí la carpeta `muro-esi` y
   **arrastrá todo su contenido** (las carpetas `server`, `public`, `data`
   y los archivos sueltos) a GitHub → *Add file → Upload files*.
   Arrastrando se conservan las subcarpetas; con “choose your files” se
   pierden y el sitio no arranca.
3. Verificá que en el repo se vean las **carpetas** `server`, `public` y
   `data`.
4. En Render: *New → Web Service* → conectá el repo nuevo.
   Build command: `npm install` · Start command: `npm start` · plan Free.
5. En *Environment* agregá `ADMIN_PIN` con un PIN propio (si no, queda
   `0910`).
6. Cuando termine el deploy, abrí la URL: ese es el muro. El QR se genera
   solo con esa dirección.

## El día del evento

1. Abrí el sitio unos **10 minutos antes** (el plan gratis “duerme” el
   servidor si nadie lo visita y tarda cerca de un minuto en despertar).
2. Proyectá `/` y elegí **Mosaico**, **Carrusel** o **Gigante**.
3. En tu celular abrí `/admin.html`, entrá con el PIN y activá “Avisarme
   cuando llega contenido nuevo”.
4. Cada publicación llega a **Pendientes de aprobación**: *Aprobar* la
   muestra en el muro, *Rechazar* la borra. Tocando la miniatura se ve
   ampliada.
5. Si algo ya publicado no debería estar, en **Publicado en el muro**
   tocá *Ocultar* (queda en “Oculto” y se puede restaurar) o *Eliminar*
   (la borra del todo, con su foto o video; pide un segundo toque para
   confirmar y no se puede deshacer). Si ya se había copiado a Google
   Photos, esa copia hay que borrarla a mano desde Google Photos.
6. Desde el panel podés **descargar el QR** para imprimirlo o sumarlo a
   una diapositiva.

Para probar el diseño antes del evento: en el panel, “Qué muestra el
muro” → **Ejemplo**. Acordate de volver a **Participantes**.

## Cambiar el cronograma

Editá `data/agenda.json`. Cada momento tiene `inicio`, `fin` (con fecha,
hora y `-03:00` al final) y `titulo`. Si dos momentos se superponen, el
muro muestra los dos.

## Importante: dónde quedan las fotos

En el plan gratis de Render el disco **no es permanente**: si el servicio
se reinicia o se vuelve a desplegar, se borran las publicaciones y la
configuración vuelve a la inicial (con aprobación previa activada).
Mientras el muro esté abierto en la pantalla no se duerme. Para conservar
las fotos, configurá la copia a Google Photos desde el panel (mismas
variables `GOOGLE_...` que en el muro de Nahiara) **antes** del evento.
Los mensajes de solo texto no se copian a Google Photos.

## Cuidado de las personas

Es un evento abierto a la comunidad y con espacios sensibles (por
ejemplo, los testeos). Por eso el muro viene con aprobación previa y la
página de subida pide permiso de las personas fotografiadas. La decisión
final sobre qué se muestra es de quien modera.

## Probarlo en tu computadora

Con [Node.js](https://nodejs.org) 18 o superior:

```
npm install
npm start
```

y abrí http://localhost:3000
