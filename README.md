# Alarmas de gases — Clínica Reina Catalina

PWA para el levantamiento de alarmas de gases medicinales por estar de enfermería, en las sedes Barranquilla y Baranoa.

Cada estar es una alarma. Por cada gas que llega (oxígeno, aire, vacío) se cuentan 1 sensor, 1 accesorio para sensor y 1 cable del largo medido. La app no necesita señal: los registros se guardan en el celular y se suben a la hoja cuando vuelve la conexión.

## Archivos

- `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `config.js`, la carpeta `lib` (generador de PDF), el logo, los íconos y la letra van al repositorio de GitHub.
- `apps-script/Code.gs` y `apps-script/appsscript.json` van al Apps Script de la hoja.

## Paso 1: hoja y Apps Script (desde el PC, con la cuenta cilindrocrc@gmail.com)

1. En Drive crea una hoja de cálculo nueva y llámala **Alarmas de gases - CRC**.
2. Abre el menú **Extensiones → Apps Script**.
3. Borra lo que haya en `Código.gs`, pega todo el contenido de `apps-script/Code.gs` y guarda.
4. Arriba, en la lista de funciones, elige **configurar** y toca **Ejecutar**. Autoriza los permisos (la hoja y Drive).
   Esto crea las pestañas y dos carpetas junto a la hoja: **Alarmas de gases - Fotos** y **Alarmas de gases - PDF**.
5. Toca **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Copia la URL que termina en `/exec`.

## Paso 2: pegar la URL en la app

En GitHub abre `config.js`, toca el lápiz, reemplaza `PEGA_AQUI_LA_URL_DE_APPS_SCRIPT/exec` por la URL que copiaste y toca **Commit changes**.

## Paso 3: activar GitHub Pages (una sola vez)

1. En el repositorio `Alarmas-de-gases` ve a **Settings → Pages**.
2. En **Branch** elige **main** y **/ (root)**, y toca **Save**.
3. En un par de minutos la app queda en https://geol21.github.io/Alarmas-de-gases/
4. Ábrela en el celular, entra con el código de acceso, elige tu nombre y toca **Instalar**.

## En el PC

Con la ventana ancha (desde 1024 px) la app se acomoda en columnas: menú a la izquierda, formulario en tres columnas, lista de alarmas en tabla, las torres lado a lado en el panel y la vista previa del PDF junto a las opciones. En el celular se ve igual que siempre.

## Claves

Están en la pestaña **Config** de la hoja y se pueden cambiar ahí:

- **Código de acceso**: para entrar a la app. Nace como `CAMBIAR-ESTE-CODIGO`; cámbialo en la pestaña Config apenas configures la hoja.
- **Clave de administrador**: se crea al azar cuando ejecutas `configurar` (sale en el mensaje y en la pestaña Config). Sirve para cambiar torres, pisos, técnicos y reserva de cable desde **Ajustes** en la app. Dásela solo a quien deba cambiar esos datos.

## Torres y pisos

Una torre por celda (o por línea en Ajustes): nombre, dos puntos y los pisos.

- `Torre A: 1-8`
- `Torre C: S, 1-11` (S = sótano, M = mezanine)

Baranoa queda como `Edificio: 1-3` hasta que se defina; se cambia en Ajustes o en la pestaña Config.

## Qué hay en la hoja

- **Alarmas**: una fila por estar, con técnico, sede, torre, piso, servicio, gases, sensores, accesorios, cable, ubicación de la válvula de cierre, observación, estado y link a la foto del lugar donde va la alarma.
- **Pisos sin alarma**: pisos revisados que no llevan alarma.
- **Historial**: quién registró, editó, cambió el estado o borró, y cuándo.
- **Config**: sedes, torres, técnicos, servicios sugeridos, reserva de cable y claves.
- **Miniaturas** (oculta): foto pequeña del lugar de cada alarma, para el PDF.

## Si cambias archivos de la app

Sube el número de `VERSION` en `sw.js` (por ejemplo `alarmas-gases-v2`) para que los celulares descarguen la versión nueva.
