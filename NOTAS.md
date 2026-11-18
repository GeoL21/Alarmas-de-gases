# Alarmas de gases — Notas para Claude

## Qué es
PWA para el levantamiento de estares de enfermería donde se van a instalar alarmas de gases
medicinales (oxígeno, aire, vacío) en Clínica Reina Catalina, sedes Barranquilla y Baranoa.
Cada estar es una alarma. Genera PDF parcial o total.
El `README.md` explica la instalación paso a paso.

## Dónde vive cada parte
- Código de la PWA: este repo, publicado en GitHub Pages.
- Servidor: `apps-script/Code.gs` de este repo, pegado en el Apps Script de la hoja.
  La URL del servidor está en `config.js`.
- Datos: hoja "Alarmas de gases - CRC" en la cuenta cilindrocrc@gmail.com, con pestañas
  `Alarmas`, `Pisos sin alarma`, `Historial`, `Config` y `Miniaturas`.
  Junto a la hoja hay carpetas para fotos y PDF.

## Datos del lugar
- Barranquilla: torres A y B con 8 pisos; la torre C es la única con 11 pisos.
- Las tres torres tienen sótano, pero solo el de la torre C tiene tomas de gases (son de Rayos X).
- Torres y pisos se cambian en la pestaña `Config` o en Ajustes de la app.

## Reglas que no se cambian
- Funciona sin señal y sube los registros al volver la conexión.
- Todo en español, con el logo de la clínica.
- Estándar visual (17 nov 2026, aprobado por Jorge): estándar "Pixel" (Material 3) (skill nueva-pwa, paso 5):
  encabezado con volver al portal + Ajustes, logo a la derecha, título grande, "técnico · sede" y reloj;
  títulos de sección en vino con chip "Listo" (Dónde estás, Estar, Cable; no en Gases porque siempre trae opciones);
  foto y válvula marcadas "opcional"; barra de abajo con pastilla rosada (riel lateral en PC).
  Letra Google Sans Flex (Plus Jakarta Sans queda de respaldo). Mismos campos, pasos, hoja y PDF.
- Sonidos (17 nov 2026), los mismos de Control de cilindros, con vibración: "listo" al guardar una alarma o marcar
  un piso sin alarma; "falta" al guardar con algo sin llenar; "error" si no se puede guardar o el servidor rechaza un estar repetido.

## Cómo trabajar aquí
- Preguntar antes de cambiar algo y mostrar un bosquejo para aprobar.
- No romper la hoja ni los registros existentes.
- Al cambiar archivos, subir el número de `VERSION` en `sw.js`.
- Si se cambia `Code.gs`, hay que pegarlo en el Apps Script y crear una nueva versión de la implementación.
- Este repo es público: no escribir aquí códigos de acceso ni claves.
