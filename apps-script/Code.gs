/*****************************************************************
 * ALARMAS DE GASES — CLÍNICA REINA CATALINA
 * Servidor de la PWA (Apps Script vinculado a la hoja
 * "Alarmas de gases - CRC", en la cuenta cilindrocrc@gmail.com).
 *
 * Pestañas (se crean solas con el menú Alarmas de gases →
 * Configurar hoja, o al ejecutar la función "configurar"):
 *   Alarmas           → una fila por alarma (un estar de enfermería)
 *   Pisos sin alarma  → pisos revisados que no llevan alarma
 *   Historial         → quién registró, editó o borró, y cuándo
 *   Config            → sedes, torres y pisos, técnicos, servicios,
 *                       reserva de cable y claves
 *   Miniaturas        → foto pequeña del lugar de cada alarma, para el PDF (oculta)
 *
 * Las fotos (del lugar donde va cada alarma) y los PDF quedan en dos
 * carpetas de Drive junto a la hoja:
 *   "Alarmas de gases - Fotos" y "Alarmas de gases - PDF".
 *
 * La PWA llama por POST con { accion, codigo, ... }.
 * Acciones: validar, datos, guardar, borrar, piso, miniaturas,
 *           pdf, guardarConfig.
 *****************************************************************/

const HOJA_AL = 'Alarmas';
const HOJA_PSA = 'Pisos sin alarma';
const HOJA_HIS = 'Historial';
const HOJA_CFG = 'Config';
const HOJA_MIN = 'Miniaturas';

const ENCABEZADOS = ['ID', 'Fecha de registro', 'Técnico', 'Sede', 'Torre', 'Piso', 'Servicio', 'Estar',
  'Oxígeno', 'Aire', 'Vacío', 'N.º de gases', 'Sensores', 'Accesorios para sensor',
  'Cable por gas (m)', 'Cable total (m)', 'Ubicación de la válvula', 'Observación', 'Estado',
  'Foto del lugar de la alarma', 'Última modificación', 'Modificado por'];

const COL = {
  ID: 0, FECHA: 1, TEC: 2, SEDE: 3, TORRE: 4, PISO: 5, SERV: 6, ESTAR: 7, O: 8, A: 9, V: 10,
  NG: 11, SEN: 12, ACC: 13, CAB: 14, CABT: 15, VAL: 16, OBS: 17, EST: 18, FOTO: 19, MOD: 20, MODP: 21
};
const NCOL = ENCABEZADOS.length;

/** Valores con que nace la pestaña Config. Después se cambian en la hoja o desde la app. */
const CONFIG_INICIAL = [
  ['Sedes', ['Barranquilla', 'Baranoa']],
  ['Torres Barranquilla', ['Torre A: 1-8', 'Torre B: 1-8', 'Torre C: S, 1-11']],
  ['Torres Baranoa', ['Edificio: 1-3']],
  ['Técnicos Barranquilla', ['Jorge Ortiz', 'Kensy Díaz']],
  ['Técnicos Baranoa', ['Kevin Gamero']],
  ['Servicios sugeridos', ['HOSPITALIZACIÓN', 'CIRUGÍA', 'UCI', 'URGENCIAS', 'HEMODINAMIA', 'RAYOS X']],
  ['Reserva de cable (%)', ['0']],
  ['Código de acceso', ['cilindrocrc']],
  ['Clave de administrador', ['']]   // se crea al azar al configurar la hoja
];


/***********************
 * MENÚ Y CONFIGURACIÓN INICIAL
 ***********************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Alarmas de gases')
    .addItem('Configurar hoja', 'configurar')
    .addToUi();
}

/** Ejecútala una vez: crea las pestañas, las carpetas de Drive y pide los permisos. */
function configurar() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  asegurarHojas(libro);
  const fotos = carpeta('FOTOS');
  const pdf = carpeta('PDF');
  const cfg = leerConfig(libro);
  const msg = 'Listo. Pestañas creadas y carpetas en Drive:\n• ' + fotos.getName() + '\n• ' + pdf.getName() +
    '\n\nCódigo de acceso: ' + cfg.codigo + '\nClave de administrador: ' + cfg.admin +
    '\n(las dos se cambian en la pestaña Config)' +
    '\n\nAhora publica: Implementar → Nueva implementación → Aplicación web.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* ejecutado desde el editor */ }
}

function asegurarHojas(libro) {
  libro = libro || SpreadsheetApp.getActiveSpreadsheet();
  if (!libro.getSheetByName(HOJA_AL)) {
    const hojas = libro.getSheets();
    const vacia = hojas.length === 1 && hojas[0].getLastRow() === 0 && hojas[0].getLastColumn() === 0;
    const al = vacia ? hojas[0].setName(HOJA_AL) : libro.insertSheet(HOJA_AL, 0);
    al.getRange(1, 1, 1, NCOL).setValues([ENCABEZADOS]);
    darFormatoAlarmas(al);
  }
  crearSiFalta(libro, HOJA_PSA, ['Sede', 'Torre', 'Piso', 'Técnico', 'Fecha']);
  crearSiFalta(libro, HOJA_HIS, ['Fecha', 'Técnico', 'Acción', 'ID', 'Detalle']);
  if (!libro.getSheetByName(HOJA_CFG)) crearConfig(libro);
  const min = crearSiFalta(libro, HOJA_MIN, ['ID', 'Miniatura']);
  if (min.nueva) min.hoja.hideSheet();
}

function crearSiFalta(libro, nombre, cab) {
  let h = libro.getSheetByName(nombre);
  if (h) return { hoja: h, nueva: false };
  h = libro.insertSheet(nombre);
  h.getRange(1, 1, 1, cab.length).setValues([cab])
    .setFontWeight('bold').setBackground('#79022C').setFontColor('#ffffff');
  h.setFrozenRows(1);
  if (nombre === HOJA_HIS) h.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
  if (nombre === HOJA_PSA) h.getRange('E:E').setNumberFormat('dd/MM/yyyy HH:mm');
  return { hoja: h, nueva: true };
}

function darFormatoAlarmas(h) {
  h.getRange(1, 1, 1, NCOL).setFontWeight('bold').setBackground('#79022C').setFontColor('#ffffff')
    .setWrap(true).setVerticalAlignment('middle');
  h.setFrozenRows(1);
  h.setRowHeight(1, 40);
  const anchos = [150, 120, 110, 100, 75, 60, 150, 55, 65, 50, 55, 60, 65, 85, 75, 75, 200, 220, 90, 120, 120, 110];
  anchos.forEach(function(w, i) { h.setColumnWidth(i + 1, w); });
  h.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
  h.getRange('U:U').setNumberFormat('dd/MM/yyyy HH:mm');
  // Columnas de texto: así la hoja no convierte "3-4" en fecha ni quita ceros
  ['A:A', 'C:E', 'G:G', 'Q:T', 'V:V'].forEach(function(r) { h.getRange(r).setNumberFormat('@'); });
  const estado = h.getRange('S2:S');
  const reglas = h.getConditionalFormatRules();
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Instalada')
    .setBackground('#E5F3EC').setFontColor('#17663F').setRanges([estado]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Pendiente')
    .setBackground('#FDF0DF').setFontColor('#8A4508').setRanges([estado]).build());
  h.setConditionalFormatRules(reglas);
  estado.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pendiente', 'Instalada'], true).setAllowInvalid(false).build());
}

function crearConfig(libro) {
  const h = libro.insertSheet(HOJA_CFG);
  const claveAdmin = Math.random().toString(36).slice(2, 8);
  const filas = Math.max.apply(null, CONFIG_INICIAL.map(function(c) { return c[1].length; })) + 1;
  const valores = [];
  for (let f = 0; f < filas; f++) {
    valores.push(CONFIG_INICIAL.map(function(c) {
      if (f === 0) return c[0];
      if (c[0] === 'Clave de administrador') return f === 1 ? claveAdmin : '';
      return c[1][f - 1] != null ? String(c[1][f - 1]) : '';
    }));
  }
  h.getRange(1, 1, filas, CONFIG_INICIAL.length).setNumberFormat('@').setValues(valores);
  h.getRange(1, 1, 1, CONFIG_INICIAL.length).setFontWeight('bold').setBackground('#79022C')
    .setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
  h.setFrozenRows(1);
  h.setRowHeight(1, 40);
  CONFIG_INICIAL.forEach(function(c, i) { h.setColumnWidth(i + 1, 160); });
  h.getRange(1, 2).setNote('Una torre por celda: nombre, dos puntos y los pisos.\n' +
    'Ejemplos: "Torre A: 1-8"  ·  "Torre C: S, 1-11"\nS = sótano, M = mezanine.');
}

/** Carpeta de Drive para fotos o PDF, junto a la hoja. */
function carpeta(tipo) {
  const props = PropertiesService.getScriptProperties();
  const clave = 'CARPETA_' + tipo;
  const id = props.getProperty(clave);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* se vuelve a crear */ }
  }
  const nombre = tipo === 'FOTOS' ? 'Alarmas de gases - Fotos' : 'Alarmas de gases - PDF';
  let padre;
  try {
    const padres = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  } catch (e) {
    padre = DriveApp.getRootFolder();
  }
  const existentes = padre.getFoldersByName(nombre);
  const f = existentes.hasNext() ? existentes.next() : padre.createFolder(nombre);
  props.setProperty(clave, f.getId());
  return f;
}


/***********************
 * ENTRADA DE LA PWA
 ***********************/

function doGet() {
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Servidor de Alarmas de gases activo. ' +
    'Usa la app instalada en el celular.</p>');
}

function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'Solicitud no válida.' });
  }
  try {
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    asegurarHojas(libro);
    const cfg = leerConfig(libro);
    if (!cfg.codigo || String(d.codigo || '').trim() !== cfg.codigo) {
      return responder({ ok: false, codigo: 'ACCESO', error: 'Código de acceso incorrecto.' });
    }
    switch (d.accion) {
      case 'validar':       return responder({ ok: true });
      case 'datos':         return responder({
        ok: true, config: configPublica(cfg), alarmas: leerAlarmas(libro),
        sinAlarma: leerPisosSinAlarma(libro), hora: new Date().toISOString()
      });
      case 'guardar':       return responder(guardar(libro, d));
      case 'borrar':        return responder(borrar(libro, d));
      case 'piso':          return responder(marcarPiso(libro, d));
      case 'miniaturas':    return responder({ ok: true, mini: leerMiniaturas(libro, d.ids || []) });
      case 'pdf':           return responder(guardarPdf(d));
      case 'guardarConfig': return responder(guardarConfig(libro, d, cfg));
      default:              return responder({ ok: false, error: 'Acción desconocida.' });
    }
  } catch (err) {
    return responder({ ok: false, error: 'Error en el servidor: ' + err.message });
  }
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/***********************
 * CONFIG
 ***********************/

/** Lee Config por nombre de encabezado: cada columna es una lista. */
function leerConfig(libro) {
  const hoja = libro.getSheetByName(HOJA_CFG);
  const v = hoja.getDataRange().getDisplayValues();
  const cab = v[0].map(function(t) { return String(t).trim(); });
  function lista(nombre) {
    const c = cab.indexOf(nombre);
    if (c < 0) return null;
    const out = [];
    for (let f = 1; f < v.length; f++) {
      const x = String(v[f][c]).trim();
      if (x) out.push(x);
    }
    return out;
  }
  const sedes = lista('Sedes') || ['Barranquilla', 'Baranoa'];
  const torres = {}, tecnicos = {};
  sedes.forEach(function(s) {
    torres[s] = (lista('Torres ' + s) || []).map(leerTorre).filter(Boolean);
    tecnicos[s] = lista('Técnicos ' + s) || [];
  });
  const reserva = parseFloat(String((lista('Reserva de cable (%)') || ['0'])[0]).replace(',', '.'));
  return {
    sedes: sedes,
    torres: torres,
    tecnicos: tecnicos,
    servicios: (lista('Servicios sugeridos') || []).map(function(s) { return s.toUpperCase(); }),
    reserva: isFinite(reserva) && reserva > 0 ? reserva : 0,
    codigo: (lista('Código de acceso') || [''])[0],
    admin: (lista('Clave de administrador') || [''])[0]
  };
}

/** "Torre C: S, 1-11" → { nombre: 'Torre C', niveles: 'S, 1-11' } */
function leerTorre(txt) {
  const m = String(txt || '').match(/^([^:]+):(.+)$/);
  if (!m) return null;
  const nombre = m[1].trim(), niveles = m[2].trim();
  if (!nombre || !niveles) return null;
  return { nombre: nombre, niveles: niveles };
}

function configPublica(cfg) {
  return {
    sedes: cfg.sedes, torres: cfg.torres, tecnicos: cfg.tecnicos,
    servicios: cfg.servicios, reserva: cfg.reserva
  };
}

function guardarConfig(libro, d, cfg) {
  if (!cfg.admin || String(d.clave || '').trim() !== cfg.admin) {
    return { ok: false, codigo: 'CLAVE', error: 'Clave de administrador incorrecta.' };
  }
  const h = libro.getSheetByName(HOJA_CFG);
  const cab = h.getRange(1, 1, 1, Math.max(h.getLastColumn(), 1)).getDisplayValues()[0]
    .map(function(t) { return String(t).trim(); });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // Primero se revisa todo; si algo está mal no se cambia nada
    const cambios = [];
    cfg.sedes.forEach(function(sede) {
      if (d.torres && Array.isArray(d.torres[sede])) {
        const lineas = d.torres[sede].map(function(t) { return String(t).trim(); }).filter(Boolean);
        const malas = lineas.filter(function(t) { return !leerTorre(t); });
        if (malas.length) throw new Error('Revisa "' + malas[0] + '": falta el nombre, los dos puntos o los pisos.');
        if (!lineas.length) throw new Error('La sede ' + sede + ' debe tener al menos una torre.');
        cambios.push(['Torres ' + sede, lineas]);
      }
      if (d.tecnicos && Array.isArray(d.tecnicos[sede])) {
        cambios.push(['Técnicos ' + sede, d.tecnicos[sede].map(function(t) { return String(t).trim(); }).filter(Boolean)]);
      }
    });
    if (d.reserva !== undefined && d.reserva !== null && String(d.reserva).trim() !== '') {
      const r = Number(String(d.reserva).replace(',', '.'));
      if (!(r >= 0 && r <= 100)) throw new Error('La reserva de cable debe estar entre 0 y 100 %.');
      cambios.push(['Reserva de cable (%)', [String(r)]]);
    }
    cambios.forEach(function(c) { escribirLista(h, cab, c[0], c[1]); });
    historial(libro, d.tecnico, 'Cambió ajustes', '', cambios.map(function(c) { return c[0]; }).join(', '));
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
  return { ok: true, config: configPublica(leerConfig(libro)) };
}

/** Reemplaza la lista de una columna de Config (la crea si no existe). */
function escribirLista(h, cab, nombre, valores) {
  let c = cab.indexOf(nombre);
  if (c < 0) {
    c = cab.length;
    cab.push(nombre);
    h.getRange(1, c + 1).setValue(nombre).setFontWeight('bold').setBackground('#79022C').setFontColor('#ffffff');
  }
  const filas = Math.max(h.getLastRow() - 1, valores.length, 1);
  h.getRange(2, c + 1, filas, 1).clearContent();
  if (valores.length) {
    h.getRange(2, c + 1, valores.length, 1).setNumberFormat('@')
      .setValues(valores.map(function(x) { return [x]; }));
  }
}


/***********************
 * ALARMAS
 ***********************/

function leerAlarmas(libro) {
  const h = libro.getSheetByName(HOJA_AL);
  if (h.getLastRow() < 2) return [];
  const filas = h.getRange(2, 1, h.getLastRow() - 1, NCOL).getValues();
  const conMini = idsConMiniatura(libro);
  return filas.filter(function(r) { return String(r[COL.ID]).trim(); }).map(function(r) {
    const id = String(r[COL.ID]).trim();
    return {
      id: id,
      fecha: iso(r[COL.FECHA]),
      tecnico: String(r[COL.TEC] || ''),
      sede: String(r[COL.SEDE] || ''),
      torre: String(r[COL.TORRE] || ''),
      piso: String(r[COL.PISO]).trim(),
      servicio: String(r[COL.SERV] || '').trim().toUpperCase(),
      estar: Number(r[COL.ESTAR]) || 0,
      gases: (esSi(r[COL.O]) ? 'O' : '') + (esSi(r[COL.A]) ? 'A' : '') + (esSi(r[COL.V]) ? 'V' : ''),
      cable: Number(r[COL.CAB]) || 0,
      valvula: String(r[COL.VAL] || ''),
      obs: String(r[COL.OBS] || ''),
      estado: String(r[COL.EST]) === 'Instalada' ? 'Instalada' : 'Pendiente',
      foto: String(r[COL.FOTO] || ''),
      mini: conMini[id] === true,
      mod: iso(r[COL.MOD]),
      modPor: String(r[COL.MODP] || '')
    };
  });
}

function guardar(libro, d) {
  const a = d.a || {};
  const id = String(a.id || '').trim();
  if (!id) return { ok: false, error: 'La alarma no tiene identificador.' };
  const gases = ['O', 'A', 'V'].filter(function(g) { return String(a.gases || '').indexOf(g) >= 0; });
  const servicio = String(a.servicio || '').trim().toUpperCase();
  const piso = String(a.piso == null ? '' : a.piso).trim();
  const estar = parseInt(a.estar, 10);
  const cable = Number(String(a.cable).replace(',', '.'));
  const faltan = [];
  if (!a.sede) faltan.push('sede');
  if (!a.torre) faltan.push('torre');
  if (!piso) faltan.push('piso');
  if (!servicio) faltan.push('servicio');
  if (!(estar > 0)) faltan.push('estar');
  if (!gases.length) faltan.push('gases');
  if (!(cable > 0)) faltan.push('metros de cable');
  if (faltan.length) return { ok: false, error: 'Falta: ' + faltan.join(', ') + '.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const h = libro.getSheetByName(HOJA_AL);
    const n = h.getLastRow() - 1;
    const datos = n > 0 ? h.getRange(2, 1, n, NCOL).getValues() : [];
    let i = -1;
    for (let k = 0; k < datos.length; k++) {
      if (String(datos[k][COL.ID]).trim() === id) { i = k; break; }
    }

    // El mismo estar no se registra dos veces
    for (let k = 0; k < datos.length; k++) {
      if (k === i) continue;
      const r = datos[k];
      if (String(r[COL.SEDE]) === a.sede && String(r[COL.TORRE]) === a.torre &&
          String(r[COL.PISO]).trim() === piso && String(r[COL.SERV]).trim().toUpperCase() === servicio &&
          Number(r[COL.ESTAR]) === estar) {
        return {
          ok: false, codigo: 'REPETIDO',
          error: a.torre + ', ' + nombrePiso(piso) + ', ' + servicio + ' ESTAR ' + estar +
            ' ya lo había registrado ' + (r[COL.TEC] || 'otro técnico') + '.'
        };
      }
    }

    const ahora = new Date();
    const mod = fechaValida(a.mod) || ahora;
    const previa = i >= 0 ? datos[i] : null;
    // Un cambio viejo que llegó tarde no pisa uno más nuevo
    if (previa && previa[COL.MOD] instanceof Date && previa[COL.MOD].getTime() > mod.getTime()) {
      return { ok: true, ignorado: true, foto: String(previa[COL.FOTO] || '') };
    }

    let foto = previa ? String(previa[COL.FOTO] || '') : '';
    if (d.foto || d.quitarFoto) {
      if (foto) borrarArchivo(foto);
      foto = '';
      if (!d.foto) borrarMiniatura(libro, id);
    }
    if (d.foto) foto = guardarFoto(a, piso, servicio, d.foto);
    if (d.mini) guardarMiniatura(libro, id, d.mini);

    const fila = [
      id,
      previa ? previa[COL.FECHA] : (fechaValida(a.fecha) || ahora),
      previa ? previa[COL.TEC] : String(a.tecnico || ''),
      String(a.sede), String(a.torre), valorPiso(piso), servicio, estar,
      gases.indexOf('O') >= 0 ? 'Sí' : 'No',
      gases.indexOf('A') >= 0 ? 'Sí' : 'No',
      gases.indexOf('V') >= 0 ? 'Sí' : 'No',
      gases.length, gases.length, gases.length,
      redondear(cable), redondear(cable * gases.length),
      String(a.valvula || '').trim().toUpperCase(),
      String(a.obs || '').trim(),
      a.estado === 'Instalada' ? 'Instalada' : 'Pendiente',
      foto, mod, String(a.modPor || a.tecnico || '')
    ];
    if (previa) h.getRange(i + 2, 1, 1, NCOL).setValues([fila]);
    else h.getRange(h.getLastRow() + 1, 1, 1, NCOL).setValues([fila]);

    const cambios = previa ? diferencias(previa, fila, !!(d.foto || d.quitarFoto)) : [];
    const accion = !previa ? 'Registró'
      : (cambios.length === 1 && cambios[0].indexOf('Estado') === 0 ? 'Cambió estado' : 'Editó');
    historial(libro, a.modPor || a.tecnico, accion, id,
      previa ? (cambios.join('; ') || 'Sin cambios') : describir(fila));
    return { ok: true, foto: foto };
  } finally {
    lock.releaseLock();
  }
}

function borrar(libro, d) {
  const id = String(d.id || '').trim();
  if (!id) return { ok: false, error: 'Falta el identificador.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const h = libro.getSheetByName(HOJA_AL);
    const r = buscarFila(h, id);
    if (r) {
      const fila = h.getRange(r, 1, 1, NCOL).getValues()[0];
      if (fila[COL.FOTO]) borrarArchivo(fila[COL.FOTO]);
      h.deleteRow(r);
      borrarMiniatura(libro, id);
      historial(libro, d.tecnico, 'Borró', id, describir(fila));
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}


/***********************
 * PISOS SIN ALARMA
 ***********************/

function leerPisosSinAlarma(libro) {
  const h = libro.getSheetByName(HOJA_PSA);
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, 3).getValues()
    .filter(function(r) { return String(r[0]).trim(); })
    .map(function(r) { return { sede: String(r[0]), torre: String(r[1]), piso: String(r[2]).trim() }; });
}

function marcarPiso(libro, d) {
  if (!d.sede || !d.torre || d.piso == null || String(d.piso) === '') return { ok: false, error: 'Falta el piso.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const h = libro.getSheetByName(HOJA_PSA);
    const v = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, 3).getValues() : [];
    let fila = 0;
    v.forEach(function(r, i) {
      if (String(r[0]) === d.sede && String(r[1]) === d.torre && String(r[2]).trim() === String(d.piso)) fila = i + 2;
    });
    const nombre = d.torre + ', ' + nombrePiso(String(d.piso));
    if (d.sinAlarma && !fila) {
      h.getRange(h.getLastRow() + 1, 1, 1, 5).setValues([[d.sede, d.torre, valorPiso(String(d.piso)), d.tecnico || '', new Date()]]);
      historial(libro, d.tecnico, 'Marcó piso sin alarma', '', d.sede + ', ' + nombre);
    }
    if (!d.sinAlarma && fila) {
      h.deleteRow(fila);
      historial(libro, d.tecnico, 'Desmarcó piso sin alarma', '', d.sede + ', ' + nombre);
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}


/***********************
 * FOTOS, MINIATURAS Y PDF
 ***********************/

function guardarFoto(a, piso, servicio, base64) {
  const nombre = limpiarNombre([a.sede, a.torre, nombrePiso(piso), servicio, 'ESTAR ' + a.estar].join(' - ')) +
    ' - ' + a.id + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', nombre);
  return carpeta('FOTOS').createFile(blob).getUrl();
}

function guardarPdf(d) {
  if (!d.base64) return { ok: false, error: 'El PDF llegó vacío.' };
  const nombre = limpiarNombre(String(d.nombre || 'Alarmas de gases').replace(/\.pdf$/i, '')) + '.pdf';
  const blob = Utilities.newBlob(Utilities.base64Decode(d.base64), 'application/pdf', nombre);
  const f = carpeta('PDF').createFile(blob);
  return { ok: true, url: f.getUrl() };
}

function borrarArchivo(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  if (!m) return;
  try { DriveApp.getFileById(m[0]).setTrashed(true); } catch (e) { /* ya no existe */ }
}

function guardarMiniatura(libro, id, dataUrl) {
  dataUrl = String(dataUrl || '');
  if (!/^data:image\//.test(dataUrl) || dataUrl.length > 49000) return;
  const h = libro.getSheetByName(HOJA_MIN);
  const r = buscarFila(h, id);
  if (r) h.getRange(r, 2).setValue(dataUrl);
  else h.getRange(h.getLastRow() + 1, 1, 1, 2).setValues([[id, dataUrl]]);
}

function borrarMiniatura(libro, id) {
  const h = libro.getSheetByName(HOJA_MIN);
  const r = buscarFila(h, id);
  if (r) h.deleteRow(r);
}

function idsConMiniatura(libro) {
  const h = libro.getSheetByName(HOJA_MIN);
  const out = {};
  if (h.getLastRow() < 2) return out;
  h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function(r) {
    if (String(r[0]).trim()) out[String(r[0]).trim()] = true;
  });
  return out;
}

function leerMiniaturas(libro, ids) {
  const quiero = {};
  ids.forEach(function(id) { quiero[String(id)] = true; });
  const h = libro.getSheetByName(HOJA_MIN);
  const out = {};
  if (h.getLastRow() < 2) return out;
  h.getRange(2, 1, h.getLastRow() - 1, 2).getValues().forEach(function(r) {
    const id = String(r[0]).trim();
    if (quiero[id] && r[1]) out[id] = String(r[1]);
  });
  return out;
}


/***********************
 * UTILIDADES
 ***********************/

function buscarFila(h, id) {
  if (!id || h.getLastRow() < 2) return 0;
  const celda = h.getRange(2, 1, h.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  return celda ? celda.getRow() : 0;
}

function historial(libro, tecnico, accion, id, detalle) {
  const h = libro.getSheetByName(HOJA_HIS);
  h.getRange(h.getLastRow() + 1, 1, 1, 5).setValues([[new Date(), String(tecnico || ''), accion, id || '', detalle || '']]);
}

function describir(f) {
  const gases = [f[COL.O] === 'Sí' ? 'O2' : '', f[COL.A] === 'Sí' ? 'Aire' : '', f[COL.V] === 'Sí' ? 'Vacío' : '']
    .filter(String).join(' + ');
  return [f[COL.SEDE], f[COL.TORRE], nombrePiso(String(f[COL.PISO])), f[COL.SERV], 'ESTAR ' + f[COL.ESTAR],
    gases, f[COL.CAB] + ' m por gas'].join(' · ');
}

function diferencias(antes, ahora, cambioFoto) {
  const campos = [COL.SEDE, COL.TORRE, COL.PISO, COL.SERV, COL.ESTAR, COL.O, COL.A, COL.V, COL.CAB, COL.VAL, COL.OBS, COL.EST];
  const out = [];
  campos.forEach(function(c) {
    const x = String(antes[c] == null ? '' : antes[c]).trim();
    const y = String(ahora[c] == null ? '' : ahora[c]).trim();
    if (x !== y) out.push(ENCABEZADOS[c] + ': ' + (x || '(vacío)') + ' → ' + (y || '(vacío)'));
  });
  if (cambioFoto) out.push('Foto cambiada');
  return out;
}

function esSi(v) { return String(v).trim().toLowerCase().replace('í', 'i') === 'si'; }

function iso(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return v ? String(v) : '';
}

function fechaValida(x) {
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d) ? null : d;
}

function valorPiso(p) { return /^\d+$/.test(String(p)) ? Number(p) : String(p); }

function nombrePiso(p) { return /^\d+$/.test(String(p)) ? 'piso ' + p : String(p); }

function redondear(x) { return Math.round(Number(x) * 10) / 10; }

function limpiarNombre(t) {
  return String(t).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}
