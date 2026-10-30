/*****************************************************************
 * ALARMAS DE GASES — CLÍNICA REINA CATALINA
 *
 * Levantamiento de los estares de enfermería que necesitan alarma
 * de gases medicinales (oxígeno, aire y vacío): por cada alarma se
 * cuentan 1 sensor, 1 accesorio para sensor y 1 cable por gas.
 *
 * Cada cambio se guarda primero en el celular (cola) y se sube a
 * Apps Script cuando hay conexión. Así la app sirve sin señal.
 *****************************************************************/

'use strict';

const VERSION_APP = '1.0';

/***********************
 * VALORES POR DEFECTO
 * (se usan hasta que llega la configuración de la hoja)
 ***********************/

const CFG_INICIAL = {
  sedes: ['Barranquilla', 'Baranoa'],
  torres: {
    'Barranquilla': [
      { nombre: 'Torre A', niveles: '1-8' },
      { nombre: 'Torre B', niveles: '1-8' },
      { nombre: 'Torre C', niveles: 'S, 1-11' }
    ],
    'Baranoa': [{ nombre: 'Edificio', niveles: '1-3' }]
  },
  tecnicos: { 'Barranquilla': ['Jorge Ortiz', 'Kensy Díaz'], 'Baranoa': ['Kevin Gamero'] },
  servicios: ['HOSPITALIZACIÓN', 'CIRUGÍA', 'UCI', 'URGENCIAS', 'HEMODINAMIA', 'RAYOS X'],
  reserva: 0
};

const GASES = [
  { k: 'O', nombre: 'Oxígeno', corto: 'O₂', pdf: 'O2' },
  { k: 'A', nombre: 'Aire', corto: 'Aire', pdf: 'Aire' },
  { k: 'V', nombre: 'Vacío', corto: 'Vacío', pdf: 'Vacío' }
];
const GAS = {};
GASES.forEach(function(g) { GAS[g.k] = g; });

const ALCANCES = [
  { k: 'total', nombre: 'Total clínica', ico: 'hospital' },
  { k: 'sede', nombre: 'Por sede', ico: 'sede' },
  { k: 'torre', nombre: 'Por torre', ico: 'edificio' },
  { k: 'piso', nombre: 'Por piso', ico: 'escalera' },
  { k: 'servicio', nombre: 'Por servicio', ico: 'servicio' },
  { k: 'estares', nombre: 'Elegir estares', ico: 'checklist' }
];


/***********************
 * UTILIDADES
 ***********************/

const $ = function(id) { return document.getElementById(id); };

function ico(nombre, tam) {
  return '<svg class="i' + (tam ? ' ' + tam : '') + '" aria-hidden="true"><use href="#i-' + nombre + '"/></svg>';
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function dos(n) { return (n < 10 ? '0' : '') + n; }

function nuevoId(prefijo) {
  const d = new Date();
  return prefijo + '-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' +
    dos(d.getHours()) + dos(d.getMinutes()) + dos(d.getSeconds()) + '-' +
    Math.random().toString(36).slice(2, 6);
}

function normal(t) {
  return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const FORMATO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
function num(n) { return FORMATO.format(Math.round((Number(n) || 0) * 10) / 10); }
function plural(n, uno, varios) { return num(n) + ' ' + (n === 1 ? uno : varios); }

/** "12,5" o "12.5" → 12.5 */
function leerNumero(txt) {
  const v = parseFloat(String(txt == null ? '' : txt).replace(/\s/g, '').replace(',', '.'));
  return isFinite(v) ? v : NaN;
}
function textoNumero(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }

function fechaHora(x) {
  const d = x instanceof Date ? x : new Date(x);
  if (isNaN(d)) return '';
  return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
    dos(d.getHours()) + ':' + dos(d.getMinutes());
}

function tamano(bytes) {
  return bytes < 1024 * 1024 ? num(bytes / 1024) + ' KB' : num(bytes / 1048576) + ' MB';
}

/** Solo se muestran como imagen las miniaturas JPEG/PNG en base64. */
function imgSegura(src) {
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(src || '')) ? src : '';
}

function sinTildes(t) { return String(t).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

let relojToast = null;
function toast(html, accion) {
  const caja = $('toast');
  caja.innerHTML = '<div' + (accion ? ' class="con-accion"' : '') + '><span>' + html + '</span>' +
    (accion ? '<button type="button" id="toastAccion">' + ico('deshacer', 's') + esc(accion.texto) + '</button>' : '') +
    '</div>';
  if (accion) {
    $('toastAccion').onclick = function() {
      caja.innerHTML = '';
      clearTimeout(relojToast);
      accion.fn();
    };
  }
  clearTimeout(relojToast);
  relojToast = setTimeout(function() { caja.innerHTML = ''; }, accion ? 6000 : 2800);
}

/** En PC (pantalla ancha) la app se ve en columnas. */
const MQ_PC = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
function esPC() { return !!(MQ_PC && MQ_PC.matches); }

/** Alto del encabezado fijo, para que el menú lateral y la vista previa queden debajo. */
function medirArriba() {
  const el = $('arriba');
  if (el && el.offsetHeight) document.documentElement.style.setProperty('--alto-arriba', el.offsetHeight + 'px');
}

/** Lleva un elemento a la vista sin que quede bajo el encabezado fijo. */
function verElemento(el) {
  if (!el) return;
  const arriba = $('arriba') ? $('arriba').offsetHeight : 80;
  const y = el.getBoundingClientRect().top + window.scrollY - arriba - 12;
  window.scrollTo({ top: Math.max(y, 0), behavior: 'smooth' });
}


/***********************
 * ALMACENAMIENTO EN EL CELULAR
 ***********************/

let bd = null;
const MEMORIA = new Map();   // respaldo si el navegador no deja usar IndexedDB

function abrirBD() {
  return new Promise(function(resolve, reject) {
    const p = indexedDB.open('alarmas-gases', 1);
    p.onupgradeneeded = function() { p.result.createObjectStore('datos'); };
    p.onsuccess = function() { bd = p.result; resolve(); };
    p.onerror = function() { reject(p.error); };
  });
}

function leerDato(clave) {
  if (!bd) return Promise.resolve(MEMORIA.get(clave));
  return new Promise(function(resolve) {
    try {
      const r = bd.transaction('datos').objectStore('datos').get(clave);
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { resolve(undefined); };
    } catch (e) { resolve(undefined); }
  });
}

function guardarDato(clave, valor) {
  if (!bd) { MEMORIA.set(clave, valor); return Promise.resolve(); }
  return new Promise(function(resolve) {
    try {
      const t = bd.transaction('datos', 'readwrite');
      t.objectStore('datos').put(valor, clave);
      t.oncomplete = function() { resolve(); };
      t.onerror = function() { resolve(); };
    } catch (e) { resolve(); }
  });
}

function borrarDato(clave) {
  if (!clave) return Promise.resolve();
  if (!bd) { MEMORIA.delete(clave); return Promise.resolve(); }
  return new Promise(function(resolve) {
    try {
      const t = bd.transaction('datos', 'readwrite');
      t.objectStore('datos').delete(clave);
      t.oncomplete = function() { resolve(); };
      t.onerror = function() { resolve(); };
    } catch (e) { resolve(); }
  });
}

/** Lee todas las claves que empiezan con un prefijo: { resto: valor } */
function leerPrefijo(prefijo) {
  const out = {};
  if (!bd) {
    MEMORIA.forEach(function(v, k) { if (String(k).indexOf(prefijo) === 0) out[k.slice(prefijo.length)] = v; });
    return Promise.resolve(out);
  }
  return new Promise(function(resolve) {
    try {
      const rango = IDBKeyRange.bound(prefijo, prefijo + '￿');
      const c = bd.transaction('datos').objectStore('datos').openCursor(rango);
      c.onsuccess = function() {
        const cur = c.result;
        if (cur) { out[String(cur.key).slice(prefijo.length)] = cur.value; cur.continue(); }
        else resolve(out);
      };
      c.onerror = function() { resolve(out); };
    } catch (e) { resolve(out); }
  });
}

function ls(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) { return null; }
}

function blobADataUrl(blob) {
  return new Promise(function(resolve, reject) {
    const r = new FileReader();
    r.onload = function() { resolve(String(r.result)); };
    r.onerror = function() { reject(r.error); };
    r.readAsDataURL(blob);
  });
}

async function blobABase64(blob) {
  const url = await blobADataUrl(blob);
  return url.slice(url.indexOf(',') + 1);
}


/***********************
 * COMUNICACIÓN CON APPS SCRIPT
 ***********************/

const CLAVE_CODIGO = 'ag_codigo';

function codigoAcceso() { return ls(CLAVE_CODIGO) || ''; }

function urlConfigurada() {
  return typeof URL_APPS_SCRIPT === 'string' && /^https?:\/\/.+\/exec$/.test(URL_APPS_SCRIPT.trim());
}

/** Envía una acción. Si no hay red, el error lleva sinRed = true. */
async function llamar(accion, extra, esperaMs, codigo) {
  if (!urlConfigurada()) {
    throw new Error('Falta configurar la app: pega la URL de Apps Script en config.js.');
  }
  const control = new AbortController();
  const espera = setTimeout(function() { control.abort(); }, esperaMs || 60000);
  let respuesta;
  try {
    // Sin cabeceras: se envía como texto y el navegador no hace consulta previa
    respuesta = await fetch(URL_APPS_SCRIPT.trim(), {
      method: 'POST',
      body: JSON.stringify(Object.assign(
        { accion: accion, codigo: codigo === undefined ? codigoAcceso() : codigo }, extra || {})),
      redirect: 'follow',
      signal: control.signal
    });
  } catch (e) {
    const error = new Error('Sin conexión con el servidor.');
    error.sinRed = true;
    throw error;
  } finally {
    clearTimeout(espera);
  }
  let json;
  try {
    json = await respuesta.json();
  } catch (e) {
    throw new Error('El servidor no respondió como se esperaba. Revisa que la implementación ' +
      'de Apps Script esté publicada con acceso para "Cualquier usuario".');
  }
  if (!json.ok) {
    const error = new Error(json.error || 'El servidor rechazó el cambio.');
    error.codigo = json.codigo || '';
    throw error;
  }
  return json;
}


/***********************
 * TORRES Y PISOS
 ***********************/

/** "S" → Sótano, "3" → Piso 3, "M" → Mezanine */
function nivelInfo(tok) {
  const t = String(tok == null ? '' : tok).trim();
  if (/^\d+$/.test(t)) {
    const n = String(parseInt(t, 10));
    return { k: n, nombre: 'Piso ' + n, corto: n };
  }
  const n = normal(t);
  if (n === 's' || n === 'sotano') return { k: 'Sótano', nombre: 'Sótano', corto: 'Sót' };
  if (n === 'ss' || n === 'semisotano') return { k: 'Semisótano', nombre: 'Semisótano', corto: 'Semi' };
  if (n === 'm' || n === 'mezanine' || n === 'mezzanine') return { k: 'Mezanine', nombre: 'Mezanine', corto: 'Mez' };
  if (n === 'a' || n === 'azotea') return { k: 'Azotea', nombre: 'Azotea', corto: 'Azot' };
  const k = t.charAt(0).toUpperCase() + t.slice(1);
  return { k: k, nombre: k, corto: k.slice(0, 4) };
}

const cacheNiveles = {};
/** "S, 1-11" → [Sótano, Piso 1 … Piso 11] */
function leerNiveles(txt) {
  const clave = String(txt || '');
  if (cacheNiveles[clave]) return cacheNiveles[clave];
  const out = [], vistos = {};
  function poner(t) {
    const n = nivelInfo(t);
    if (n.k && !vistos[n.k]) { vistos[n.k] = true; out.push(n); }
  }
  clave.split(/[,;]+/).forEach(function(pedazo) {
    const p = pedazo.trim();
    if (!p) return;
    const m = p.match(/^(\d+)\s*(?:-|a|al|hasta)\s*(\d+)$/i);
    if (m) {
      const a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (Math.abs(b - a) > 80) b = a + (b > a ? 80 : -80);
      const paso = a <= b ? 1 : -1;
      for (let i = a; paso > 0 ? i <= b : i >= b; i += paso) poner(String(i));
      return;
    }
    poner(p);
  });
  cacheNiveles[clave] = out;
  return out;
}

/** "Torre C: S, 1-11" → { nombre, niveles } */
function leerTorreTxt(linea) {
  const m = String(linea || '').match(/^([^:]+):(.+)$/);
  if (!m) return null;
  const nombre = m[1].trim(), niveles = m[2].trim();
  if (!nombre || !niveles) return null;
  return { nombre: nombre, niveles: niveles };
}

function torresDe(sede) { return (S.cfg.torres && S.cfg.torres[sede]) || []; }

function nivelesDe(sede, torre) {
  const t = torresDe(sede).find(function(x) { return x.nombre === torre; });
  return t ? leerNiveles(t.niveles) : [];
}

function nombrePiso(k) { return nivelInfo(k).nombre; }

function claseRejilla(n) { return n > 10 ? 'pisos seis' : (n > 8 ? 'pisos cinco' : 'pisos'); }

function normalizarCfg(c) {
  c = c || {};
  const sedes = Array.isArray(c.sedes) && c.sedes.length ? c.sedes : CFG_INICIAL.sedes;
  const torres = {}, tecnicos = {};
  sedes.forEach(function(s) {
    torres[s] = c.torres && Array.isArray(c.torres[s])
      ? c.torres[s].filter(function(t) { return t && t.nombre && t.niveles; })
      : (CFG_INICIAL.torres[s] || []);
    tecnicos[s] = c.tecnicos && Array.isArray(c.tecnicos[s]) ? c.tecnicos[s] : (CFG_INICIAL.tecnicos[s] || []);
  });
  return {
    sedes: sedes,
    torres: torres,
    tecnicos: tecnicos,
    servicios: Array.isArray(c.servicios) ? c.servicios : CFG_INICIAL.servicios,
    reserva: Number(c.reserva) > 0 ? Number(c.reserva) : 0
  };
}


/***********************
 * ESTADO
 ***********************/

const S = {
  cfg: normalizarCfg(CFG_INICIAL),
  servidor: [],        // última copia de la hoja
  servidorSin: [],     // pisos marcados sin alarma en la hoja
  alarmas: [],         // lo que se ve: hoja + cambios propios sin subir
  sinAlarma: [],
  cola: [],            // cambios sin subir
  minis: {},           // miniaturas de fotos guardadas en el celular
  tecnico: '',
  sedeTec: '',
  vista: 'registrar',
  pantalla: '',
  f: {
    sede: '', torre: '', piso: '', servicio: '', otro: false, estar: 1,
    gases: ['O', 'A', 'V'], estado: 'Pendiente', foto: null, fotoMini: '', quitarFoto: false
  },
  editando: null,      // copia de la alarma que se está editando
  antesEdicion: null,  // contexto del formulario antes de editar
  ultimo: null,        // último registro, para Deshacer
  filtro: { q: '', sede: '', estado: 'todas' },
  panel: { sede: '', torre: '', abierto: '' },
  pdf: { modo: 'piso', sede: '', torre: '', piso: '', servicio: '', elegidos: [], verTodos: false, fotos: false, firmas: true },
  pdfActual: null,
  ajSucio: false,
  sincronizando: false,
  otraVez: false,
  avisos: [],
  sync: { estado: '', msg: '' }
};

function clavePiso(x) { return x.sede + '|' + x.torre + '|' + x.piso; }

function gasesDe(a) {
  return ['O', 'A', 'V'].filter(function(k) { return String(a.gases || '').indexOf(k) >= 0; });
}

function alarmasDelPiso(sede, torre, piso) {
  return S.alarmas.filter(function(a) { return a.sede === sede && a.torre === torre && a.piso === piso; });
}

function contar(sede, torre, piso) { return alarmasDelPiso(sede, torre, piso).length; }

function esSinAlarma(sede, torre, piso) {
  return S.sinAlarma.some(function(p) { return p.sede === sede && p.torre === torre && p.piso === piso; });
}

function resumir(lista) {
  const r = {
    total: lista.length, instaladas: 0, sensores: 0, cable: 0,
    porGas: { O: 0, A: 0, V: 0 }, cablePorGas: { O: 0, A: 0, V: 0 }, tipos: {}
  };
  lista.forEach(function(a) {
    const g = gasesDe(a);
    const cable = Number(a.cable) || 0;
    if (a.estado === 'Instalada') r.instaladas++;
    r.sensores += g.length;
    r.cable += g.length * cable;
    g.forEach(function(k) { r.porGas[k]++; r.cablePorGas[k] += cable; });
    const t = g.join('');
    if (t) r.tipos[t] = (r.tipos[t] || 0) + 1;
  });
  return r;
}

function nombreTipo(t) {
  return t.split('').map(function(k) { return GAS[k].nombre; }).join(' + ');
}

function ordenTipos(tipos) {
  const orden = ['OAV', 'OV', 'OA', 'AV', 'O', 'A', 'V'];
  return Object.keys(tipos).sort(function(a, b) { return orden.indexOf(a) - orden.indexOf(b); });
}

function puntos(gases) {
  return '<span class="pts">' + String(gases).split('').map(function(k) {
    return '<span class="pt ' + k + '"></span>';
  }).join('') + '</span>';
}

function claveOrden(a) {
  const si = S.cfg.sedes.indexOf(a.sede);
  const torres = torresDe(a.sede);
  const ti = torres.findIndex(function(t) { return t.nombre === a.torre; });
  const niveles = ti >= 0 ? leerNiveles(torres[ti].niveles) : [];
  const ni = niveles.findIndex(function(n) { return n.k === a.piso; });
  return [si < 0 ? 99 : si, ti < 0 ? 99 : ti, ni < 0 ? 999 : ni, a.servicio, Number(a.estar) || 0];
}

function comparar(a, b) {
  const x = claveOrden(a), y = claveOrden(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

function limpiarAlarma(a) {
  return {
    id: a.id, fecha: a.fecha, tecnico: a.tecnico, sede: a.sede, torre: a.torre, piso: a.piso,
    servicio: a.servicio, estar: a.estar, gases: a.gases, cable: a.cable, valvula: a.valvula || '',
    obs: a.obs || '', estado: a.estado, foto: a.foto || '', mini: !!a.mini, mod: a.mod, modPor: a.modPor || ''
  };
}

/** Vista local = copia de la hoja + cambios propios que aún están en la cola. */
function recalcular() {
  const mapa = new Map();
  S.servidor.forEach(function(a) { mapa.set(a.id, a); });
  S.cola.forEach(function(op) {
    if (op.accion === 'guardar') {
      mapa.set(op.a.id, Object.assign({}, mapa.get(op.a.id) || {}, op.a, { pendiente: true }));
    } else if (op.accion === 'borrar') {
      mapa.delete(op.id);
    }
  });
  S.alarmas = Array.from(mapa.values());

  const pisos = new Map();
  S.servidorSin.forEach(function(p) { pisos.set(clavePiso(p), p); });
  S.cola.forEach(function(op) {
    if (op.accion !== 'piso') return;
    if (op.sinAlarma) pisos.set(clavePiso(op), { sede: op.sede, torre: op.torre, piso: op.piso });
    else pisos.delete(clavePiso(op));
  });
  S.sinAlarma = Array.from(pisos.values());
}


/***********************
 * REGISTRAR
 ***********************/

function servicioActual() {
  if (S.f.otro) return $('fServicioOtro').value.trim().toUpperCase().replace(/\s+/g, ' ');
  return S.f.servicio;
}

/** Primer número de estar libre en ese piso y servicio. */
function siguienteEstar() {
  const f = S.f;
  const sv = servicioActual();
  const usados = S.alarmas.filter(function(a) {
    return a.sede === f.sede && a.torre === f.torre && a.piso === f.piso && a.servicio === sv &&
      (!S.editando || a.id !== S.editando.id);
  }).map(function(a) { return Number(a.estar); });
  let n = 1;
  while (usados.indexOf(n) >= 0) n++;
  return n;
}

function validarContexto() {
  const f = S.f;
  if (S.cfg.sedes.indexOf(f.sede) < 0) {
    f.sede = S.cfg.sedes.indexOf(S.sedeTec) >= 0 ? S.sedeTec : S.cfg.sedes[0];
  }
  if (S.editando) return;
  const torres = torresDe(f.sede);
  if (!torres.some(function(t) { return t.nombre === f.torre; })) f.torre = torres.length ? torres[0].nombre : '';
  const niveles = nivelesDe(f.sede, f.torre);
  if (!niveles.some(function(n) { return n.k === f.piso; })) {
    const uno = niveles.find(function(n) { return n.k === '1'; });
    f.piso = uno ? uno.k : (niveles[0] ? niveles[0].k : '');
  }
}

function guardarContexto() {
  if (S.editando) return;
  ls('ag_ctx', {
    sede: S.f.sede, torre: S.f.torre, piso: S.f.piso, servicio: S.f.servicio,
    gases: S.f.gases, cable: $('fCable').value
  });
}

function cambiarContexto(cambios) {
  Object.assign(S.f, cambios);
  validarContexto();
  if (!S.editando) S.f.estar = siguienteEstar();
  mostrarError('piso', '');
  mostrarError('estar', '');
  guardarContexto();
  pintarRegistrar();
}

function serviciosSugeridos() {
  const f = S.f;
  const delPiso = alarmasDelPiso(f.sede, f.torre, f.piso).map(function(a) { return a.servicio; });
  const recientes = S.alarmas.filter(function(a) { return a.sede === f.sede; })
    .sort(function(x, y) { return String(y.fecha || '').localeCompare(String(x.fecha || '')); })
    .map(function(a) { return a.servicio; });
  const lista = [];
  [delPiso, recientes, S.cfg.servicios || []].forEach(function(arr) {
    arr.forEach(function(s) {
      s = String(s || '').trim().toUpperCase();
      if (s && lista.indexOf(s) < 0) lista.push(s);
    });
  });
  const out = lista.slice(0, 6);
  if (f.servicio && out.indexOf(f.servicio) < 0) out.push(f.servicio);
  return out;
}

function pintarRegistrar() {
  validarContexto();
  const f = S.f;

  $('fSede').innerHTML = S.cfg.sedes.map(function(s) {
    return '<button type="button" data-sede="' + esc(s) + '" aria-pressed="' + (s === f.sede) + '">' + esc(s) + '</button>';
  }).join('');

  const torres = torresDe(f.sede);
  $('fTorre').innerHTML = torres.length ? torres.map(function(t) {
    return '<button type="button" data-torre="' + esc(t.nombre) + '" aria-pressed="' + (t.nombre === f.torre) + '">' +
      esc(t.nombre) + '</button>';
  }).join('') : '<p class="ayuda" style="padding:10px">Esta sede aún no tiene torres. Agrégalas en Ajustes.</p>';

  const niveles = nivelesDe(f.sede, f.torre);
  $('fPiso').className = claseRejilla(niveles.length);
  $('fPiso').innerHTML = niveles.map(function(n) {
    const c = contar(f.sede, f.torre, n.k);
    const sin = !c && esSinAlarma(f.sede, f.torre, n.k);
    return '<button type="button" class="piso" data-piso="' + esc(n.k) + '" aria-pressed="' + (n.k === f.piso) + '" ' +
      'aria-label="' + esc(n.nombre) + (c ? ', ' + plural(c, 'alarma', 'alarmas') : (sin ? ', no lleva alarma' : '')) + '">' +
      esc(n.corto) + (c ? '<span class="n">' + c + '</span>' : (sin ? '<span class="n gris">0</span>' : '')) + '</button>';
  }).join('');

  pintarSinAlarma();
  pintarServicios();
  pintarEstar();
  pintarGases();
  pintarFoto();
  pintarValvulas();
  $('fEstado').querySelectorAll('button').forEach(function(b) {
    b.setAttribute('aria-pressed', b.dataset.estado === f.estado);
  });
  pintarResumen();
  pintarModoEdicion();
}

function pintarSinAlarma() {
  const f = S.f;
  const caja = $('fSinAlarma');
  const aplica = f.piso && !S.editando && !contar(f.sede, f.torre, f.piso);
  const sin = aplica && esSinAlarma(f.sede, f.torre, f.piso);
  // Si el piso no lleva alarma, se esconde el formulario de la alarma: no hay nada que llenar
  $('vRegistrar').classList.toggle('piso-sin', !!sin);
  if (!aplica) { caja.innerHTML = ''; return; }
  if (!sin) {
    caja.innerHTML = '<button type="button" class="btn-sin" data-sin="1">' + ico('check', 's') + 'Este piso no lleva alarma</button>';
    return;
  }
  const sig = pisoSiguiente();
  caja.innerHTML = '<div class="piso-sin-ok" role="status">' +
      '<p>' + ico('circulo-check', 's') + '<span>' + esc(nombrePiso(f.piso)) + ' revisado: no lleva alarma.' +
        '<small>Queda guardado así. No hay que llenar nada más en este piso.</small></span></p>' +
      '<div class="acciones">' +
        '<button type="button" data-sin="0">Desmarcar</button>' +
        (sig ? '<button type="button" class="lleno" data-ir-piso="' + esc(sig.k) + '">Ir a ' + esc(sig.nombre) + ico('flecha', 's') + '</button>' : '') +
      '</div></div>';
}

/** Piso que sigue al actual en la torre (o null si es el último). */
function pisoSiguiente() {
  const niveles = nivelesDe(S.f.sede, S.f.torre);
  const i = niveles.findIndex(function(n) { return n.k === S.f.piso; });
  return i >= 0 && i < niveles.length - 1 ? niveles[i + 1] : null;
}

function pintarServicios() {
  const f = S.f;
  $('fServicio').innerHTML = serviciosSugeridos().map(function(s) {
    return '<button type="button" class="chip" data-servicio="' + esc(s) + '" aria-pressed="' + (!f.otro && s === f.servicio) + '">' +
      esc(s) + '</button>';
  }).join('') + '<button type="button" class="chip mas" data-otro="1" aria-pressed="' + f.otro + '">' + ico('mas', 's') + 'Otro</button>';
  $('fServicioOtro').classList.toggle('oculto', !f.otro);
}

function pintarEstar() { $('fEstar').textContent = 'ESTAR ' + S.f.estar; }

function pintarGases() {
  $('fGases').querySelectorAll('[data-gas]').forEach(function(b) {
    const on = S.f.gases.indexOf(b.dataset.gas) >= 0;
    b.setAttribute('aria-pressed', on);
    b.querySelector('small').innerHTML = on ? ico('check', 's') + 'Llega' : 'No llega';
  });
}

function pintarFoto() {
  const f = S.f;
  const caja = $('fFoto');
  const ed = S.editando;
  let tiene = !!f.foto, src = imgSegura(f.fotoMini), titulo = 'Foto del lugar lista', sub = 'Se sube con la alarma.';
  if (!tiene && ed && !f.quitarFoto && (ed.mini || ed.foto)) {
    tiene = true;
    src = imgSegura(S.minis[ed.id]);
    titulo = 'Foto del lugar guardada';
    sub = ed.foto ? 'Está en la carpeta de fotos de Drive.' : 'Se sube con la alarma.';
  }
  if (!tiene) {
    caja.innerHTML = '<button type="button" class="foto-btn" data-foto="tomar">' + ico('camara') + 'Foto de dónde va la alarma</button>';
    return;
  }
  caja.innerHTML = '<div class="foto-ok">' +
    (src ? '<img src="' + src + '" alt="Foto del lugar de la alarma">' : '<span class="sin-img">' + ico('foto') + '</span>') +
    '<div class="txt"><b>' + titulo + '</b><small>' + sub + '</small><div class="acciones">' +
    '<button type="button" class="btn mini" data-foto="tomar">' + ico('camara', 's') + 'Repetir</button>' +
    '<button type="button" class="btn mini" data-foto="quitar">' + ico('x', 's') + 'Quitar</button>' +
    (!f.foto && ed && ed.foto && !f.quitarFoto
      ? '<a class="btn mini" href="' + esc(ed.foto) + '" target="_blank" rel="noopener">' + ico('abrir', 's') + 'Ver</a>' : '') +
    '</div></div></div>';
}

function pintarValvulas() {
  const f = S.f;
  const usadas = [];
  alarmasDelPiso(f.sede, f.torre, f.piso).forEach(function(a) {
    const v = String(a.valvula || '').trim().toUpperCase();
    if (v && usadas.indexOf(v) < 0) usadas.push(v);
  });
  $('fValvulaUsadas').innerHTML = usadas.slice(0, 4).map(function(v) {
    return '<button type="button" class="chip mini" data-valvula="' + esc(v) + '">' + esc(v) + '</button>';
  }).join('');
}

function pintarResumen() {
  const n = S.f.gases.length;
  const c = leerNumero($('fCable').value);
  const m = c > 0 ? c : 0;
  $('resumenAlarma').innerHTML = !n ? 'Marca al menos un gas.' :
    '<b>Esta alarma: ' + plural(n, 'gas', 'gases') + '</b><br>' +
    plural(n, 'sensor', 'sensores') + ' · ' + plural(n, 'accesorio para sensor', 'accesorios para sensor') + '<br>' +
    plural(n, 'cable', 'cables') + ' × ' + num(m) + ' m = <b>' + num(n * m) + ' m</b>';
}

function pintarModoEdicion() {
  const ed = S.editando;
  $('tiraEdicion').classList.toggle('oculto', !ed);
  if (ed) $('tiraEdicionTxt').textContent = ed.torre + ' · ' + nombrePiso(ed.piso) + ' · ' + ed.servicio + ' · ESTAR ' + ed.estar;
  $('zonaBorrar').classList.toggle('oculto', !ed);
  if (!ed) $('confirmarBorrar').classList.add('oculto');
  $('btnCancelarEd').classList.toggle('oculto', !ed);
  $('barraDentro').classList.toggle('dos', !!ed);
  $('btnGuardarTxt').textContent = ed ? 'Guardar cambios' : 'Guardar y seguir';
  if (ed) $('bannerInstalar').classList.add('oculto');
}

function mostrarError(campo, msg) {
  const p = document.querySelector('[data-error="' + campo + '"]');
  if (!p) return;
  p.innerHTML = msg ? ico('alerta', 's') + esc(msg) : '';
  p.classList.toggle('oculto', !msg);
}

function limpiarErrores() {
  document.querySelectorAll('[data-error]').forEach(function(p) { p.innerHTML = ''; p.classList.add('oculto'); });
  $('fCable').classList.remove('mal');
  $('fServicioOtro').classList.remove('mal');
}

function setCable(v) {
  $('fCable').value = textoNumero(Math.max(0, Math.round(v * 10) / 10));
  $('fCable').classList.remove('mal');
  mostrarError('cable', '');
  pintarResumen();
  guardarContexto();
}

/** Foto: se achica en el celular (1280 px para Drive y 240 px para el PDF). */
async function procesarFoto(archivo) {
  let img;
  try {
    img = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch (e) {
    img = await new Promise(function(resolve, reject) {
      const url = URL.createObjectURL(archivo);
      const im = new Image();
      im.onload = function() { resolve(im); };
      im.onerror = function() { reject(new Error('No se pudo leer la foto.')); };
      im.src = url;
    });
  }
  function lienzo(max) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  const grande = await new Promise(function(resolve) { lienzo(1280).toBlob(resolve, 'image/jpeg', 0.72); });
  const mini = lienzo(240).toDataURL('image/jpeg', 0.6);
  if (!grande) throw new Error('No se pudo preparar la foto.');
  return { blob: grande, mini: mini };
}

let guardando = false, bloqueoHasta = 0;

/** Evita guardar dos veces por un doble toque. */
async function guardar() {
  if (guardando || Date.now() < bloqueoHasta) return;
  guardando = true;
  try {
    await guardarAhora();
  } finally {
    guardando = false;
  }
}

async function guardarAhora() {
  const f = S.f;
  limpiarErrores();
  const servicio = servicioActual();
  const cable = leerNumero($('fCable').value);
  const previo = S.editando;
  const errores = [];

  if (!f.torre || !f.piso) { mostrarError('piso', 'Elige la torre y el piso.'); errores.push($('fPiso')); }
  if (!servicio) {
    mostrarError('servicio', f.otro ? 'Escribe el nombre del servicio.' : 'Elige o escribe el servicio.');
    if (f.otro) $('fServicioOtro').classList.add('mal');
    errores.push($('fServicio'));
  }
  if (!(f.estar >= 1)) { mostrarError('estar', 'Elige el número de estar.'); errores.push($('fEstar')); }
  if (!f.gases.length) { mostrarError('gases', 'Marca al menos un gas.'); errores.push($('fGases')); }
  if (!(cable > 0)) {
    mostrarError('cable', 'Escribe los metros de cable.');
    $('fCable').classList.add('mal');
    errores.push($('fCable'));
  }
  const id = previo ? previo.id : nuevoId('AL');
  if (servicio && f.estar >= 1) {
    const repetido = S.alarmas.some(function(x) {
      return x.id !== id && x.sede === f.sede && x.torre === f.torre && x.piso === f.piso &&
        x.servicio === servicio && Number(x.estar) === f.estar;
    });
    if (repetido) {
      mostrarError('estar', 'ESTAR ' + f.estar + ' de ' + servicio + ' ya está registrado en este piso. Usa otro número.');
      errores.push($('fEstar'));
    }
  }
  if (errores.length) {
    verElemento(errores[0].closest('.tarjeta') || errores[0]);
    toast(ico('alerta', 's') + 'Revisa lo marcado en rojo');
    return;
  }

  const ahora = new Date().toISOString();
  const a = {
    id: id,
    fecha: previo ? previo.fecha : ahora,
    tecnico: previo ? previo.tecnico : S.tecnico,
    sede: f.sede, torre: f.torre, piso: f.piso, servicio: servicio, estar: f.estar,
    gases: GASES.filter(function(g) { return f.gases.indexOf(g.k) >= 0; }).map(function(g) { return g.k; }).join(''),
    cable: Math.round(cable * 10) / 10,
    valvula: $('fValvula').value.trim().toUpperCase().replace(/\s+/g, ' '),
    obs: $('fObs').value.trim(),
    estado: f.estado,
    foto: previo && !f.quitarFoto && !f.foto ? (previo.foto || '') : '',
    mini: f.foto ? true : !!(previo && !f.quitarFoto && previo.mini),
    mod: ahora,
    modPor: S.tecnico
  };

  const op = { accion: 'guardar', a: a, quitarFoto: !!(f.quitarFoto && !f.foto) };
  if (f.foto) {
    op.fotoClave = 'foto:' + nuevoId('F');
    await guardarDato(op.fotoClave, f.foto);
    S.minis[id] = f.fotoMini;
    await guardarDato('mini:' + id, f.fotoMini);
  } else if (op.quitarFoto) {
    delete S.minis[id];
    await borrarDato('mini:' + id);
  }
  const fotoDeshacer = f.foto ? { blob: f.foto, mini: f.fotoMini } : null;
  await encolar(op);

  if (previo) {
    terminarEdicion();
    toast(ico('check', 's') + 'Cambios guardados');
    irA('alarmas');
  } else {
    S.ultimo = { uid: op.uid, id: id, foto: fotoDeshacer };
    bloqueoHasta = Date.now() + 900;
    // Queda listo para el siguiente estar: se mantienen sede, torre, piso, servicio, gases y metros
    S.f.servicio = servicio;
    S.f.otro = false;
    $('fServicioOtro').value = '';
    S.f.foto = null;
    S.f.fotoMini = '';
    S.f.quitarFoto = false;
    S.f.estado = 'Pendiente';
    $('fValvula').value = '';
    $('fObs').value = '';
    $('fMas').open = false;
    S.f.estar = siguienteEstar();
    guardarContexto();
    pintarRegistrar();
    toast(ico('check', 's') + esc(servicio) + ' · ESTAR ' + a.estar + ' guardado', { texto: 'Deshacer', fn: deshacer });
    if (!esPC()) verElemento($('tarjetaEstar'));
  }
  sincronizar();
}

async function deshacer() {
  const u = S.ultimo;
  if (!u) return;
  S.ultimo = null;
  const a = S.alarmas.find(function(x) { return x.id === u.id; });
  const i = S.cola.findIndex(function(op, j) { return op.uid === u.uid && !(S.sincronizando && j === 0); });
  if (i >= 0) {
    await borrarDato(S.cola[i].fotoClave);
    S.cola.splice(i, 1);
    await guardarDato('cola', S.cola);
    recalcular();
  } else {
    await encolar({ accion: 'borrar', id: u.id, tecnico: S.tecnico });
  }
  delete S.minis[u.id];
  await borrarDato('mini:' + u.id);
  if (a) {
    // El formulario vuelve a quedar con esa alarma para corregirla
    Object.assign(S.f, {
      sede: a.sede, torre: a.torre, piso: a.piso, servicio: a.servicio, otro: false, estar: Number(a.estar),
      gases: gasesDe(a), estado: a.estado, quitarFoto: false,
      foto: u.foto ? u.foto.blob : null, fotoMini: u.foto ? u.foto.mini : ''
    });
    $('fCable').value = textoNumero(a.cable);
    $('fValvula').value = a.valvula || '';
    $('fObs').value = a.obs || '';
  }
  pintarRegistrar();
  pintarFranja();
  toast(ico('deshacer', 's') + 'Registro deshecho');
  sincronizar();
}

function abrirEdicion(id) {
  const a = S.alarmas.find(function(x) { return x.id === id; });
  if (!a) return;
  if (!S.editando) {
    S.antesEdicion = {
      sede: S.f.sede, torre: S.f.torre, piso: S.f.piso, servicio: S.f.servicio, gases: S.f.gases.slice(),
      cable: $('fCable').value, otro: S.f.otro, otroTxt: $('fServicioOtro').value,
      foto: S.f.foto, fotoMini: S.f.fotoMini, valvula: $('fValvula').value, obs: $('fObs').value
    };
  }
  S.editando = limpiarAlarma(a);
  Object.assign(S.f, {
    sede: a.sede, torre: a.torre, piso: a.piso, servicio: a.servicio, otro: false, estar: Number(a.estar),
    gases: gasesDe(a), estado: a.estado, foto: null, fotoMini: '', quitarFoto: false
  });
  $('fServicioOtro').value = '';
  $('fCable').value = textoNumero(a.cable);
  $('fValvula').value = a.valvula || '';
  $('fObs').value = a.obs || '';
  $('fMas').open = !!a.obs || a.estado === 'Instalada';
  limpiarErrores();
  irA('registrar');
  if (!S.minis[a.id] && a.mini && navigator.onLine && codigoAcceso()) {
    traerMiniaturas([a.id]).then(function() { if (S.editando && S.editando.id === a.id) pintarFoto(); }).catch(function() {});
  }
}

function terminarEdicion() {
  const antes = S.antesEdicion;
  S.editando = null;
  S.antesEdicion = null;
  if (antes) {
    Object.assign(S.f, {
      sede: antes.sede, torre: antes.torre, piso: antes.piso, servicio: antes.servicio, gases: antes.gases,
      otro: antes.otro, foto: antes.foto, fotoMini: antes.fotoMini
    });
    $('fCable').value = antes.cable;
    $('fServicioOtro').value = antes.otroTxt;
    $('fValvula').value = antes.valvula;
    $('fObs').value = antes.obs;
  }
  S.f.estado = 'Pendiente';
  S.f.quitarFoto = false;
  $('fMas').open = false;
  validarContexto();
  S.f.estar = siguienteEstar();
  limpiarErrores();
}

function cancelarEdicion() {
  terminarEdicion();
  irA('alarmas');
}

async function borrarAlarma() {
  const ed = S.editando;
  if (!ed) return;
  await encolar({ accion: 'borrar', id: ed.id, tecnico: S.tecnico });
  delete S.minis[ed.id];
  await borrarDato('mini:' + ed.id);
  terminarEdicion();
  toast(ico('basura', 's') + 'Alarma eliminada');
  irA('alarmas');
  sincronizar();
}

async function cambiarEstado(id) {
  const a = S.alarmas.find(function(x) { return x.id === id; });
  if (!a) return;
  const nuevo = limpiarAlarma(a);
  nuevo.estado = a.estado === 'Instalada' ? 'Pendiente' : 'Instalada';
  nuevo.mod = new Date().toISOString();
  nuevo.modPor = S.tecnico;
  await encolar({ accion: 'guardar', a: nuevo });
  repintar();
  toast(ico(nuevo.estado === 'Instalada' ? 'circulo-check' : 'reloj', 's') + esc(a.servicio) + ' · ESTAR ' + a.estar +
    ': ' + nuevo.estado.toLowerCase());
  sincronizar();
}

async function marcarSinAlarma(sede, torre, piso, valor) {
  S.cola = S.cola.filter(function(op, j) {
    return !(op.accion === 'piso' && op.sede === sede && op.torre === torre && op.piso === piso &&
      !(S.sincronizando && j === 0));
  });
  await encolar({ accion: 'piso', sede: sede, torre: torre, piso: piso, sinAlarma: valor, tecnico: S.tecnico });
  repintar();
  toast(ico('check', 's') + (valor ? 'Marcado: ' + nombrePiso(piso) + ' no lleva alarma' : 'Marca quitada'));
  sincronizar();
}


/***********************
 * COLA Y SINCRONIZACIÓN
 ***********************/

async function encolar(op) {
  op.uid = op.uid || nuevoId('O');
  op.creado = new Date().toISOString();
  const libre = function(j) { return !(S.sincronizando && j === 0); };

  if (op.accion === 'guardar') {
    // Se une con un guardado pendiente de la misma alarma
    const i = S.cola.findIndex(function(x, j) { return x.accion === 'guardar' && x.a.id === op.a.id && libre(j); });
    if (i >= 0) {
      const previo = S.cola[i];
      if (op.fotoClave || op.quitarFoto) {
        if (previo.fotoClave && previo.fotoClave !== op.fotoClave) await borrarDato(previo.fotoClave);
      } else {
        op.fotoClave = previo.fotoClave;
        op.quitarFoto = previo.quitarFoto;
      }
      S.cola[i] = op;
    } else {
      S.cola.push(op);
    }
  } else if (op.accion === 'borrar') {
    // Si la alarma nunca se subió, basta con sacarla de la cola
    const quitar = S.cola.filter(function(x, j) { return x.accion === 'guardar' && x.a.id === op.id && libre(j); });
    for (const x of quitar) await borrarDato(x.fotoClave);
    S.cola = S.cola.filter(function(x, j) { return !(x.accion === 'guardar' && x.a.id === op.id && libre(j)); });
    const enCamino = S.sincronizando && S.cola[0] && S.cola[0].accion === 'guardar' && S.cola[0].a.id === op.id;
    if (enCamino || S.servidor.some(function(a) { return a.id === op.id; })) S.cola.push(op);
  } else {
    S.cola.push(op);
  }
  await guardarDato('cola', S.cola);
  recalcular();
  pintarFranja();
}

async function enviar(op) {
  if (op.accion === 'guardar') {
    const extra = { a: op.a, quitarFoto: !!op.quitarFoto };
    if (op.fotoClave) {
      const blob = await leerDato(op.fotoClave);
      if (blob) {
        extra.foto = await blobABase64(blob);
        extra.mini = S.minis[op.a.id] || '';
      }
    }
    return llamar('guardar', extra, 90000);
  }
  if (op.accion === 'borrar') return llamar('borrar', { id: op.id, tecnico: op.tecnico }, 45000);
  if (op.accion === 'piso') {
    return llamar('piso', { sede: op.sede, torre: op.torre, piso: op.piso, sinAlarma: op.sinAlarma, tecnico: op.tecnico }, 45000);
  }
  if (op.accion === 'pdf') {
    const blob = await leerDato('pdf:' + op.uid);
    if (!blob) return { ok: true, url: '' };
    return llamar('pdf', { nombre: op.nombre, base64: await blobABase64(blob) }, 120000);
  }
  return { ok: true };
}

async function sincronizar() {
  if (S.sincronizando) { S.otraVez = true; return; }
  if (!codigoAcceso() || !urlConfigurada()) { pintarFranja(); return; }
  if (!navigator.onLine) { S.sync = { estado: '', msg: '' }; pintarFranja(); return; }
  S.sincronizando = true;
  S.otraVez = false;
  S.sync = { estado: 'sube', msg: '' };
  pintarFranja();
  let todoBien = false;
  try {
    while (S.cola.length) {
      const op = S.cola[0];
      let res = null;
      try {
        res = await enviar(op);
      } catch (e) {
        // Otro técnico ya registró ese estar: este no se sube
        if (e.codigo !== 'REPETIDO' || op.accion !== 'guardar') throw e;
        S.avisos.push(e.message);
        ls('ag_avisos', S.avisos);
        delete S.minis[op.a.id];
        await borrarDato('mini:' + op.a.id);
      }
      S.cola.shift();
      if (op.fotoClave) await borrarDato(op.fotoClave);
      if (res && op.accion === 'guardar' && !res.ignorado) {
        const subida = limpiarAlarma(op.a);
        if (res.foto !== undefined) subida.foto = res.foto;
        const i = S.servidor.findIndex(function(a) { return a.id === subida.id; });
        if (i >= 0) S.servidor[i] = subida; else S.servidor.push(subida);
      }
      if (res && op.accion === 'borrar') S.servidor = S.servidor.filter(function(a) { return a.id !== op.id; });
      if (res && op.accion === 'pdf') {
        await borrarDato('pdf:' + op.uid);
        if (S.pdfActual && S.pdfActual.uid === op.uid) S.pdfActual.drive = res.url || 'listo';
        if (S.vista === 'pdf') pintarResultadoPdf();
        toast(ico('circulo-check', 's') + 'PDF guardado en Drive');
      }
      await guardarDato('cola', S.cola);
      await guardarDato('servidor', S.servidor);
      recalcular();
      pintarFranja();
    }
    const datos = await llamar('datos', {}, 45000);
    S.cfg = normalizarCfg(datos.config);
    S.servidor = datos.alarmas || [];
    S.servidorSin = datos.sinAlarma || [];
    await guardarDato('cfg', S.cfg);
    await guardarDato('servidor', S.servidor);
    await guardarDato('servidorSin', S.servidorSin);
    ls('ag_ultima', new Date().toISOString());
    recalcular();
    // Si otro técnico ya usó el número de estar que estaba listo, se pasa al siguiente libre
    const f = S.f;
    if (!S.editando && S.alarmas.some(function(a) {
      return a.sede === f.sede && a.torre === f.torre && a.piso === f.piso && a.servicio === servicioActual() &&
        Number(a.estar) === f.estar;
    })) f.estar = siguienteEstar();
    S.sync = { estado: 'ok', msg: '' };
    todoBien = true;
    repintar();
  } catch (e) {
    if (e.sinRed) S.sync = { estado: '', msg: '' };
    else if (e.codigo === 'ACCESO') {
      S.sync = { estado: '', msg: '' };
      ls(CLAVE_CODIGO, null);
      mostrarAcceso(e.message);
    } else S.sync = { estado: 'error', msg: e.message };
  } finally {
    S.sincronizando = false;
    pintarFranja();
    if (S.otraVez && todoBien) setTimeout(sincronizar, 300);
  }
}

function pintarFranja() {
  const f = $('franja');
  const n = S.cola.length;
  let clase = '', html = '';
  if (S.avisos.length) {
    clase = 'error';
    html = ico('alerta', 's') + '<span>No se subió: ' + S.avisos.map(esc).join(' ') + '</span>' +
      '<button id="fEntendido">Entendido</button>';
  } else if (S.sync.estado === 'error') {
    clase = 'error';
    html = ico('alerta', 's') + '<span>' + esc(S.sync.msg) + '</span>' +
      '<button id="fReintentar">Reintentar</button>' + (n ? '<button id="fDescartar">Descartar</button>' : '');
  } else if (S.sync.estado === 'sube' && n) {
    clase = 'sube';
    html = ico('refrescar', 's') + '<span>Subiendo ' + plural(n, 'cambio', 'cambios') + '…</span>';
  } else if (n) {
    clase = 'espera';
    html = ico('sinred', 's') + '<span>' + plural(n, 'cambio guardado', 'cambios guardados') +
      ' en el celular. Se suben al volver la señal.</span><button id="fReintentar">Subir</button>';
  } else if (S.sync.estado === 'ok') {
    clase = 'ok';
    html = ico('nube', 's') + '<span>Todo subido a la hoja.</span>';
  }
  f.className = 'franja ' + clase + (clase ? '' : ' oculto');
  f.innerHTML = html;
  if ($('fReintentar')) $('fReintentar').onclick = function() { S.sync = { estado: '', msg: '' }; sincronizar(); };
  if ($('fDescartar')) $('fDescartar').onclick = descartarPrimero;
  if ($('fEntendido')) {
    $('fEntendido').onclick = function() {
      S.avisos = [];
      ls('ag_avisos', null);
      pintarFranja();
    };
  }
  if (S.sync.estado === 'ok') {
    clearTimeout(pintarFranja.t);
    pintarFranja.t = setTimeout(function() {
      if (S.sync.estado === 'ok') { S.sync = { estado: '', msg: '' }; pintarFranja(); }
    }, 3000);
  }
  pintarPuntoNav();
  medirArriba();
  if (S.vista === 'ajustes' && $('ajCola')) pintarColaAjustes();
  if (S.vista === 'pdf' && S.pdfActual) pintarResultadoPdf();
}

function pintarPuntoNav() {
  const n = S.cola.filter(function(op) { return op.accion === 'guardar'; }).length;
  $('navPunto').textContent = n;
  $('navPunto').classList.toggle('oculto', !n);
}

function describirOp(op) {
  if (op.accion === 'guardar') return op.a.servicio + ' ESTAR ' + op.a.estar + ' (' + op.a.torre + ', ' + nombrePiso(op.a.piso) + ')';
  if (op.accion === 'borrar') return 'el borrado de una alarma';
  if (op.accion === 'piso') return 'la marca de ' + op.torre + ', ' + nombrePiso(op.piso);
  if (op.accion === 'pdf') return 'el PDF ' + op.nombre;
  return 'un cambio';
}

async function descartarPrimero() {
  const op = S.cola[0];
  if (!op) return;
  if (!confirm('¿Descartar ' + describirOp(op) + '? No se subirá a la hoja.')) return;
  S.cola.shift();
  await borrarDato(op.fotoClave);
  if (op.accion === 'pdf') await borrarDato('pdf:' + op.uid);
  await guardarDato('cola', S.cola);
  recalcular();
  S.sync = { estado: '', msg: '' };
  repintar();
  pintarFranja();
  sincronizar();
}

async function traerMiniaturas(ids) {
  for (let i = 0; i < ids.length; i += 40) {
    const r = await llamar('miniaturas', { ids: ids.slice(i, i + 40) }, 60000);
    const m = r.mini || {};
    for (const id of Object.keys(m)) {
      S.minis[id] = m[id];
      await guardarDato('mini:' + id, m[id]);
    }
  }
}


/***********************
 * LISTA DE ALARMAS
 ***********************/

function botonEstado(a) {
  const ok = a.estado === 'Instalada';
  return '<button type="button" class="est-btn ' + (ok ? 'ok' : 'pend') + '" data-estado-id="' + esc(a.id) + '" ' +
    'aria-label="' + (ok ? 'Instalada' : 'Pendiente') + '. Tocar para cambiar">' +
    ico(ok ? 'circulo-check' : 'reloj', 's') + (ok ? 'Instalada' : 'Pendiente') + '</button>';
}

function filaAlarma(a) {
  const mini = imgSegura(S.minis[a.id]);
  const foto = mini ? '<img class="mini-foto" src="' + mini + '" alt="">'
    : '<span class="mini-foto">' + ico(a.mini || a.foto ? 'foto' : 'camara') + '</span>';
  const g = gasesDe(a);
  const sub = puntos(g.join('')) + g.map(function(k) { return GAS[k].corto; }).join(' · ') + ' · ' +
    g.length + ' × ' + num(a.cable) + ' m' +
    (a.valvula ? '<br>' + esc(a.valvula) : '') +
    (a.pendiente ? '<br><span class="sin-subir">' + ico('sinred', 's') + 'Sin subir</span>' : '');
  return '<div class="fila-al"><button type="button" class="abrir" data-editar="' + esc(a.id) + '" ' +
    'aria-label="Editar ' + esc(a.servicio) + ' estar ' + a.estar + '">' + foto +
    '<span class="txt"><b>' + esc(a.servicio) + ' · ESTAR ' + a.estar + '</b><small>' + sub + '</small></span></button>' +
    botonEstado(a) + '</div>';
}

function cumpleEstado(a, estado) {
  if (estado === 'todas') return true;
  if (estado === 'subir') return !!a.pendiente;
  return a.estado === estado;
}

function pintarAlarmas() {
  const fl = S.filtro;
  if (fl.sede && S.cfg.sedes.indexOf(fl.sede) < 0) fl.sede = '';
  $('filtroSede').innerHTML = [''].concat(S.cfg.sedes).map(function(s) {
    const n = S.alarmas.filter(function(a) { return !s || a.sede === s; }).length;
    return '<button type="button" class="chip mini" data-f-sede="' + esc(s) + '" aria-pressed="' + (fl.sede === s) + '">' +
      (s ? esc(s) : 'Todas') + ' <span class="n">' + n + '</span></button>';
  }).join('');

  const base = S.alarmas.filter(function(a) { return !fl.sede || a.sede === fl.sede; });
  const estados = [['todas', 'Todas'], ['Pendiente', 'Pendientes'], ['Instalada', 'Instaladas'], ['subir', 'Sin subir']];
  if (fl.estado === 'subir' && !base.some(function(a) { return a.pendiente; })) fl.estado = 'todas';
  $('filtroEstado').innerHTML = estados.map(function(e) {
    const n = base.filter(function(a) { return cumpleEstado(a, e[0]); }).length;
    if (e[0] === 'subir' && !n) return '';
    return '<button type="button" class="chip mini" data-f-estado="' + e[0] + '" aria-pressed="' + (fl.estado === e[0]) + '">' +
      e[1] + ' <span class="n">' + n + '</span></button>';
  }).join('');
  $('limpiarBuscar').classList.toggle('oculto', !fl.q);

  const q = normal(fl.q);
  const lista = base.filter(function(a) { return cumpleEstado(a, fl.estado); }).filter(function(a) {
    if (!q) return true;
    return normal([a.servicio, a.valvula, a.obs, a.torre, nombrePiso(a.piso), 'estar ' + a.estar, a.tecnico, a.sede].join(' '))
      .indexOf(q) >= 0;
  }).sort(comparar);

  if (!lista.length) {
    $('listaAlarmas').innerHTML = '<div class="vacio">' + ico('lista', 'l') + '<b>' +
      (S.alarmas.length ? 'Nada con ese filtro' : 'Aún no hay alarmas') + '</b><span>' +
      (S.alarmas.length ? 'Cambia la búsqueda o el filtro.' : 'Registra el primer estar en la pestaña Registrar.') +
      '</span></div>';
    return;
  }
  const grupos = [];
  lista.forEach(function(a) {
    const k = clavePiso(a);
    if (!grupos.length || grupos[grupos.length - 1].k !== k) grupos.push({ k: k, a: a, items: [] });
    grupos[grupos.length - 1].items.push(a);
  });
  if (esPC()) { $('listaAlarmas').innerHTML = tablaAlarmas(grupos, !fl.sede); return; }
  $('listaAlarmas').innerHTML = grupos.map(function(g) {
    return '<div class="grupo"><h3><span>' + esc((fl.sede ? '' : g.a.sede + ' · ') + g.a.torre + ' · ' + nombrePiso(g.a.piso)) +
      '</span><span>' + plural(g.items.length, 'alarma', 'alarmas') + '</span></h3><div class="lista">' +
      g.items.map(filaAlarma).join('') + '</div></div>';
  }).join('');
}

/** En PC la lista se ve como tabla, agrupada por torre y piso. */
function tablaAlarmas(grupos, conSede) {
  const cab = '<thead><tr><th class="c-foto"><span class="sr">Foto</span></th><th>Servicio</th><th class="c-num">Estar</th>' +
    '<th>Gases</th><th class="c-num">Cable</th><th>Válvula de cierre</th><th class="col-obs">Observación</th>' +
    '<th class="col-tec">Registró</th><th>Estado</th></tr></thead>';
  return '<table class="tabla-al">' + cab + grupos.map(function(g) {
    return '<tbody><tr class="t-grupo"><th colspan="9">' + esc((conSede ? g.a.sede + ' · ' : '') + g.a.torre + ' · ' + nombrePiso(g.a.piso)) +
      '<span>' + plural(g.items.length, 'alarma', 'alarmas') + '</span></th></tr>' + g.items.map(function(a) {
        const mini = imgSegura(S.minis[a.id]);
        const g2 = gasesDe(a);
        return '<tr data-editar="' + esc(a.id) + '" tabindex="0" title="Editar">' +
          '<td class="c-foto">' + (mini ? '<img class="mini-foto" src="' + mini + '" alt="">'
            : '<span class="mini-foto">' + ico(a.mini || a.foto ? 'foto' : 'camara', 's') + '</span>') + '</td>' +
          '<td><b>' + esc(a.servicio) + '</b>' +
            (a.pendiente ? '<small class="sin-subir">' + ico('sinred', 's') + 'Sin subir</small>' : '') + '</td>' +
          '<td class="c-num">' + a.estar + '</td>' +
          '<td>' + puntos(g2.join('')) + g2.map(function(k) { return GAS[k].corto; }).join(' · ') + '</td>' +
          '<td class="c-num">' + g2.length + ' × ' + num(a.cable) + ' m<small>' + num(g2.length * a.cable) + ' m</small></td>' +
          '<td>' + (a.valvula ? esc(a.valvula) : '<span class="tenue">-</span>') + '</td>' +
          '<td class="col-obs">' + (a.obs ? esc(a.obs) : '<span class="tenue">-</span>') + '</td>' +
          '<td class="col-tec">' + esc(a.tecnico) + '</td>' +
          '<td>' + botonEstado(a) + '</td></tr>';
      }).join('') + '</tbody>';
  }).join('') + '</table>';
}


/***********************
 * PANEL
 ***********************/

function cifra(etiqueta, valor, nota) {
  return '<div class="cifra"><span>' + esc(etiqueta) + '</span><b>' + valor + '</b>' + (nota ? '<small>' + nota + '</small>' : '') + '</div>';
}

function avance(etiqueta, n, total, color) {
  const pct = total ? Math.round(n / total * 100) : 0;
  return '<div class="avance"><div class="etq"><span>' + esc(etiqueta) + '</span><b>' + num(n) + ' de ' + num(total) +
    (total ? ' · ' + pct + ' %' : '') + '</b></div><div class="barra-av" role="img" aria-label="' + esc(etiqueta) + ': ' + pct +
    ' %"><i style="width:' + pct + '%;background:' + color + '"></i></div></div>';
}

function pintarPanel() {
  const p = S.panel;
  const opciones = S.cfg.sedes.concat(['Total']);
  if (opciones.indexOf(p.sede) < 0) p.sede = S.cfg.sedes.indexOf(S.f.sede) >= 0 ? S.f.sede : S.cfg.sedes[0];
  $('pSede').innerHTML = opciones.map(function(s) {
    return '<button type="button" data-p-sede="' + esc(s) + '" aria-pressed="' + (s === p.sede) + '">' + esc(s) + '</button>';
  }).join('');

  const sedes = p.sede === 'Total' ? S.cfg.sedes : [p.sede];
  const lista = S.alarmas.filter(function(a) { return sedes.indexOf(a.sede) >= 0; });
  const r = resumir(lista);
  const res = S.cfg.reserva;
  $('pCifras').innerHTML =
    cifra('Alarmas', num(r.total)) +
    cifra('Sensores', num(r.sensores)) +
    cifra('Accesorios para sensor', num(r.sensores)) +
    cifra('Cable', num(r.cable) + ' m', res ? 'Con reserva del ' + num(res) + ' %: ' + num(r.cable * (1 + res / 100)) + ' m' : '');

  let total = 0, levantados = 0;
  const claves = [];
  sedes.forEach(function(s) {
    torresDe(s).forEach(function(t) {
      claves.push(s + '|' + t.nombre);
      leerNiveles(t.niveles).forEach(function(n) {
        total++;
        if (contar(s, t.nombre, n.k) || esSinAlarma(s, t.nombre, n.k)) levantados++;
      });
    });
  });
  $('pAvance').innerHTML = avance('Instaladas', r.instaladas, r.total, 'var(--ok)') +
    avance('Pisos levantados', levantados, total, 'var(--vino)');

  if (esPC()) {
    pintarMapaPC(sedes);
  } else {
  if (claves.indexOf(p.torre) < 0) { p.torre = claves[0] || ''; p.abierto = ''; }
  $('pTorre').innerHTML = claves.map(function(k) {
    const sede = k.slice(0, k.indexOf('|')), torre = k.slice(k.indexOf('|') + 1);
    const n = S.alarmas.filter(function(a) { return a.sede === sede && a.torre === torre; }).length;
    let nombre = torre;
    if (sedes.length > 1 && sede !== sedes[0]) nombre = torresDe(sede).length === 1 ? sede : sede.slice(0, 4) + '. ' + torre;
    return '<button type="button" data-p-torre="' + esc(k) + '" aria-pressed="' + (k === p.torre) + '">' + esc(nombre) +
      '<small>' + plural(n, 'alarma', 'alarmas') + '</small></button>';
  }).join('');
  $('pTorre').classList.toggle('oculto', !claves.length);

  const sede = p.torre.slice(0, p.torre.indexOf('|')), torre = p.torre.slice(p.torre.indexOf('|') + 1);
  const niveles = nivelesDe(sede, torre).slice().reverse();
  $('pPisos').innerHTML = niveles.map(function(n) {
    const L = alarmasDelPiso(sede, torre, n.k).sort(comparar);
    const k = L.length;
    const sin = !k && esSinAlarma(sede, torre, n.k);
    const abierto = p.abierto === n.k;
    const rr = resumir(L);
    let h = '<button type="button" class="fila-piso' + (k ? '' : (sin ? ' sin' : ' vacio-p')) + '" data-fila-piso="' + esc(n.k) +
      '" aria-expanded="' + abierto + '"><span>' + esc(n.nombre) + '</span><span class="fn">' +
      (k ? plural(k, 'alarma', 'alarmas') + ' · ' + num(rr.cable) + ' m' : (sin ? 'No lleva alarma' : 'Sin levantar')) +
      '</span>' + ico(abierto ? 'arriba' : 'abajo', 's') + '</button>';
    if (abierto) {
      h += '<div class="det-piso">';
      if (k) {
        h += '<div class="lista">' + L.map(filaAlarma).join('') + '</div><div class="acciones">' +
          '<button type="button" class="btn mini" data-pdf-piso="' + esc(n.k) + '">' + ico('pdf', 's') + 'PDF de este piso</button>' +
          '<button type="button" class="btn mini" data-registrar-piso="' + esc(n.k) + '">' + ico('mas', 's') + 'Registrar aquí</button></div>';
      } else {
        h += '<p class="ayuda">' + (sin ? 'Revisado: este piso no lleva alarma.' : 'Aún no hay estares registrados en este piso.') +
          '</p><div class="acciones">' +
          '<button type="button" class="btn mini" data-registrar-piso="' + esc(n.k) + '">' + ico('mas', 's') + 'Registrar aquí</button>' +
          '<button type="button" class="btn mini" data-sin-piso="' + (sin ? '0' : '1') + '" data-piso="' + esc(n.k) + '">' +
          (sin ? 'Desmarcar' : 'No lleva alarma') + '</button></div>';
      }
      h += '</div>';
    }
    return h;
  }).join('') || '<p class="ayuda">Esta torre no tiene pisos configurados.</p>';
  }

  const mx = Math.max(1, r.porGas.O, r.porGas.A, r.porGas.V);
  $('pGases').innerHTML = GASES.map(function(g) {
    return '<div class="gas-fila"><span class="nom"><span class="pt ' + g.k + '"></span>' + g.nombre + '</span>' +
      '<span class="bar" role="img" aria-label="' + g.nombre + ': ' + r.porGas[g.k] + '"><i style="width:' +
      (r.porGas[g.k] / mx * 100) + '%"></i></span><b>' + r.porGas[g.k] + '</b></div>';
  }).join('') + '<p class="ayuda" style="margin-top:6px">Un sensor y un accesorio para sensor por cada gas que llega.</p>';

  const tipos = ordenTipos(r.tipos);
  $('pTipos').innerHTML = tipos.length ? tipos.map(function(t) {
    return '<div class="tipo"><span>' + puntos(t) + esc(nombreTipo(t)) + '</span><b>' + r.tipos[t] + '</b></div>';
  }).join('') : '<p class="ayuda">Aún no hay alarmas registradas.</p>';
}


/** PC: todas las torres lado a lado (como edificios) y el detalle del piso elegido al lado. */
function pintarMapaPC(sedes) {
  const p = S.panel;
  const cols = [];
  sedes.forEach(function(s) {
    torresDe(s).forEach(function(t) {
      const niveles = leerNiveles(t.niveles);
      const uno = niveles.findIndex(function(n) { return n.k === '1'; });
      cols.push({ sede: s, torre: t.nombre, niveles: niveles, bajo: uno > 0 ? uno : 0 });
    });
  });
  const clave = function(c) { return c.sede + '|' + c.torre; };
  // Si no hay piso elegido, se muestra el primero con alarmas
  const valido = cols.some(function(c) {
    return clave(c) === p.torre && c.niveles.some(function(n) { return n.k === p.abierto; });
  });
  if (!valido) {
    p.torre = cols[0] ? clave(cols[0]) : '';
    p.abierto = '';
    cols.some(function(c) {
      const n = c.niveles.slice().reverse().find(function(x) { return contar(c.sede, c.torre, x.k); });
      if (n) { p.torre = clave(c); p.abierto = n.k; return true; }
      return false;
    });
  }
  const maxBajo = Math.max.apply(null, [0].concat(cols.map(function(c) { return c.bajo; })));
  const mapa = cols.map(function(c) {
    const n = S.alarmas.filter(function(a) { return a.sede === c.sede && a.torre === c.torre; }).length;
    const celdas = c.niveles.slice().reverse().map(function(nv) {
      const k = contar(c.sede, c.torre, nv.k);
      const sin = !k && esSinAlarma(c.sede, c.torre, nv.k);
      const tipo = k >= 3 ? 'n3' : (k === 2 ? 'n2' : (k === 1 ? 'n1' : (sin ? 'sin' : 'vacio')));
      const elegido = clave(c) === p.torre && nv.k === p.abierto;
      return '<button type="button" class="celda ' + tipo + '" data-celda-torre="' + esc(clave(c)) + '" data-celda-piso="' +
        esc(nv.k) + '" aria-pressed="' + elegido + '" aria-label="' + esc(c.torre + ', ' + nv.nombre + ': ' +
        (k ? plural(k, 'alarma', 'alarmas') : (sin ? 'no lleva alarma' : 'sin levantar'))) + '"><span>' + esc(nv.nombre) +
        '</span><b>' + (k ? k : (sin ? '—' : '')) + '</b></button>';
    });
    for (let i = c.bajo; i < maxBajo; i++) celdas.push('<div class="celda-espacio"></div>');
    return '<div class="torre-col"><div class="torre-tit"><b>' + esc(c.torre) + '</b><small>' +
      (sedes.length > 1 ? esc(c.sede) + ' · ' : '') + plural(n, 'alarma', 'alarmas') + '</small></div>' + celdas.join('') + '</div>';
  }).join('');
  const leyenda = '<div class="leyenda"><span><i class="n1" style="background:var(--vino-suave)"></i>1 alarma</span>' +
    '<span><i style="background:#E8C4D2"></i>2</span><span><i style="background:#A8436A;border-color:#A8436A"></i>3 o más</span>' +
    '<span><i style="background:#F1F2F4"></i>No lleva alarma</span><span><i style="border-style:dashed"></i>Sin levantar</span></div>';
  $('pPisos').innerHTML = cols.length
    ? '<div class="mapa-pc"><div><div class="torres">' + mapa + '</div>' + leyenda + '</div><div class="detalle-piso">' +
      detallePisoPC() + '</div></div>'
    : '<p class="ayuda">Esta sede no tiene torres configuradas.</p>';
}

function detallePisoPC() {
  const p = S.panel;
  if (!p.torre || !p.abierto) return '<p class="ayuda">Toca un piso para ver sus estares.</p>';
  const sede = p.torre.slice(0, p.torre.indexOf('|')), torre = p.torre.slice(p.torre.indexOf('|') + 1);
  const nv = nivelInfo(p.abierto);
  const L = alarmasDelPiso(sede, torre, p.abierto).sort(comparar);
  const k = L.length;
  const sin = !k && esSinAlarma(sede, torre, p.abierto);
  const rr = resumir(L);
  return '<h3>' + esc(torre + ' · ' + nv.nombre) + '</h3><p class="sub">' + esc(sede) + ' · ' + (k
      ? plural(k, 'alarma', 'alarmas') + ' · ' + plural(rr.sensores, 'sensor', 'sensores') + ' · ' + num(rr.cable) + ' m de cable'
      : (sin ? 'Revisado: no lleva alarma' : 'Sin levantar')) + '</p>' +
    (k ? '<div class="lista">' + L.map(filaAlarma).join('') + '</div>' : '') +
    '<div class="acciones">' +
    (k ? '<button type="button" class="btn mini" data-pdf-piso="' + esc(p.abierto) + '">' + ico('pdf', 's') + 'PDF de este piso</button>' : '') +
    '<button type="button" class="btn mini" data-registrar-piso="' + esc(p.abierto) + '">' + ico('mas', 's') + 'Registrar aquí</button>' +
    (!k ? '<button type="button" class="btn mini" data-sin-piso="' + (sin ? '0' : '1') + '" data-piso="' + esc(p.abierto) + '">' +
      (sin ? 'Desmarcar' : 'No lleva alarma') + '</button>' : '') + '</div>';
}


/***********************
 * PDF
 ***********************/

function serviciosDeSede(sede) {
  const out = [];
  S.alarmas.filter(function(a) { return a.sede === sede; }).sort(comparar).forEach(function(a) {
    if (out.indexOf(a.servicio) < 0) out.push(a.servicio);
  });
  return out;
}

function asegurarSeleccionPdf() {
  const q = S.pdf;
  if (S.cfg.sedes.indexOf(q.sede) < 0) q.sede = S.cfg.sedes.indexOf(S.f.sede) >= 0 ? S.f.sede : S.cfg.sedes[0];
  const torres = torresDe(q.sede);
  if (!torres.some(function(t) { return t.nombre === q.torre; })) q.torre = torres[0] ? torres[0].nombre : '';
  const nv = nivelesDe(q.sede, q.torre);
  if (!nv.some(function(n) { return n.k === q.piso; })) {
    const conDatos = nv.find(function(n) { return contar(q.sede, q.torre, n.k); });
    q.piso = conDatos ? conDatos.k : (nv[0] ? nv[0].k : '');
  }
  const sv = serviciosDeSede(q.sede);
  if (sv.indexOf(q.servicio) < 0) q.servicio = sv[0] || '';
  q.elegidos = q.elegidos.filter(function(id) { return S.alarmas.some(function(a) { return a.id === id; }); });
}

function alarmasPdf() {
  const q = S.pdf;
  return S.alarmas.filter(function(a) {
    if (q.modo === 'total') return true;
    if (q.modo === 'estares') return q.elegidos.indexOf(a.id) >= 0;
    if (a.sede !== q.sede) return false;
    if (q.modo === 'sede') return true;
    if (q.modo === 'servicio') return a.servicio === q.servicio;
    if (a.torre !== q.torre) return false;
    if (q.modo === 'torre') return true;
    return a.piso === q.piso;
  }).sort(comparar);
}

function tituloPdf() {
  const q = S.pdf;
  switch (q.modo) {
    case 'total': return 'Total clínica (' + S.cfg.sedes.join(' y ') + ')';
    case 'sede': return 'Sede ' + q.sede;
    case 'torre': return 'Sede ' + q.sede + ' · ' + q.torre;
    case 'piso': return 'Sede ' + q.sede + ' · ' + q.torre + ' · ' + nombrePiso(q.piso);
    case 'servicio': return 'Sede ' + q.sede + ' · Servicio ' + (q.servicio || '-');
    default: return 'Selección de ' + plural(alarmasPdf().length, 'estar', 'estares');
  }
}

function nombreArchivoPdf() {
  const q = S.pdf;
  const partes = { total: ['Total'], sede: [q.sede], torre: [q.sede, q.torre], piso: [q.sede, q.torre, nombrePiso(q.piso)],
    servicio: [q.sede, q.servicio], estares: ['Seleccion'] }[q.modo] || ['Alarmas'];
  const d = new Date();
  return 'Alarmas_' + sinTildes(partes.join('_')).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' +
    d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + '.pdf';
}

function htmlElegirPdf() {
  const q = S.pdf;
  if (q.modo === 'total') return '<p class="ayuda">Incluye todas las alarmas de ' + esc(S.cfg.sedes.join(' y ')) + '.</p>';
  let h = '<div class="seg" role="group" aria-label="Sede">' + S.cfg.sedes.map(function(s) {
    return '<button type="button" data-q-sede="' + esc(s) + '" aria-pressed="' + (s === q.sede) + '">' + esc(s) + '</button>';
  }).join('') + '</div>';
  if (q.modo === 'torre' || q.modo === 'piso') {
    h += '<div class="seg" role="group" aria-label="Torre">' + torresDe(q.sede).map(function(t) {
      return '<button type="button" data-q-torre="' + esc(t.nombre) + '" aria-pressed="' + (t.nombre === q.torre) + '">' +
        esc(t.nombre) + '</button>';
    }).join('') + '</div>';
  }
  if (q.modo === 'piso') {
    const nv = nivelesDe(q.sede, q.torre);
    h += '<div class="' + claseRejilla(nv.length) + '" style="margin-top:10px" role="group" aria-label="Piso">' + nv.map(function(n) {
      const c = contar(q.sede, q.torre, n.k);
      return '<button type="button" class="piso" data-q-piso="' + esc(n.k) + '" aria-pressed="' + (n.k === q.piso) + '" ' +
        'aria-label="' + esc(n.nombre) + '">' + esc(n.corto) + (c ? '<span class="n">' + c + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  if (q.modo === 'servicio') {
    const sv = serviciosDeSede(q.sede);
    h += sv.length ? '<div class="chips" style="margin-top:10px" role="group" aria-label="Servicio">' + sv.map(function(s) {
      return '<button type="button" class="chip" data-q-servicio="' + esc(s) + '" aria-pressed="' + (s === q.servicio) + '">' +
        esc(s) + '</button>';
    }).join('') + '</div>' : '<p class="ayuda" style="margin-top:10px">Aún no hay servicios registrados en esta sede.</p>';
  }
  if (q.modo === 'estares') {
    const L = S.alarmas.filter(function(a) { return a.sede === q.sede; }).sort(comparar);
    const vis = q.verTodos ? L : L.slice(0, 8);
    if (!L.length) return h + '<p class="ayuda" style="margin-top:10px">No hay alarmas en esta sede.</p>';
    h += '<div class="acciones" style="margin:10px 0 4px"><button type="button" class="btn mini" data-q-todas="1">Marcar todas</button>' +
      '<button type="button" class="btn mini" data-q-todas="0">Ninguna</button></div>';
    h += vis.map(function(a) {
      const on = q.elegidos.indexOf(a.id) >= 0;
      return '<button type="button" class="ck" role="checkbox" aria-checked="' + on + '" data-q-est="' + esc(a.id) + '">' +
        ico(on ? 'cuadro-check' : 'cuadro') + '<span>' + esc(a.servicio + ' · ESTAR ' + a.estar) +
        '<small>' + esc(a.torre + ' · ' + nombrePiso(a.piso)) + '</small></span></button>';
    }).join('');
    if (L.length > 8) {
      h += '<button type="button" class="link" data-q-ver="1">' + (q.verTodos ? 'Ver menos' : 'Ver las ' + L.length) + '</button>';
    }
  }
  return h;
}

function pintarPdf() {
  const q = S.pdf;
  asegurarSeleccionPdf();
  $('qAlcance').innerHTML = ALCANCES.map(function(a) {
    return '<button type="button" data-modo="' + a.k + '" aria-pressed="' + (q.modo === a.k) + '">' + ico(a.ico) + a.nombre + '</button>';
  }).join('');
  $('qElegir').innerHTML = htmlElegirPdf();
  $('qFotos').setAttribute('aria-checked', q.fotos);
  $('qFirmas').setAttribute('aria-checked', q.firmas);
  const lista = alarmasPdf();
  const r = resumir(lista);
  $('qResumen').innerHTML = '<b>' + esc(tituloPdf()) + '</b><br>' + (lista.length
    ? plural(r.total, 'alarma', 'alarmas') + ' · ' + plural(r.sensores, 'sensor', 'sensores') + ' · ' +
      plural(r.sensores, 'accesorio', 'accesorios') + ' · ' + num(r.cable) + ' m de cable'
    : 'Sin alarmas en esta selección.');
  pintarResultadoPdf();
  pintarVistaPdf();
}

/** PC: el PDF generado se ve a la derecha. */
function pintarVistaPdf() {
  const caja = $('qVista');
  const r = S.pdfActual;
  caja.classList.toggle('oculto', !esPC());
  if (!esPC()) return;
  if (!r) {
    if (caja.dataset.url || !caja.firstChild) {
      delete caja.dataset.url;
      caja.innerHTML = '<div class="vacio">' + ico('pdf', 'l') + '<b>Vista previa</b><span>Elige qué va en el PDF y toca Generar PDF para verlo aquí.</span></div>';
    }
    return;
  }
  if (!r.url) r.url = URL.createObjectURL(r.blob);
  if (caja.dataset.url === r.url) return;
  caja.dataset.url = r.url;
  caja.innerHTML = '<iframe src="' + r.url + '#view=FitH" title="Vista previa del PDF"></iframe>';
}

function soltarPdf() {
  if (S.pdfActual && S.pdfActual.url) URL.revokeObjectURL(S.pdfActual.url);
  S.pdfActual = null;
}

function cambioPdf(cambios) {
  Object.assign(S.pdf, cambios);
  soltarPdf();
  avisoPdf('');
  ls('ag_pdf_op', { fotos: S.pdf.fotos, firmas: S.pdf.firmas });
  pintarPdf();
}

function avisoPdf(msg) {
  $('qAviso').innerHTML = msg ? ico('alerta', 's') + esc(msg) : '';
  $('qAviso').classList.toggle('oculto', !msg);
}

function pintarResultadoPdf() {
  const r = S.pdfActual;
  const caja = $('qResultado');
  if (!r) { caja.classList.add('oculto'); caja.innerHTML = ''; return; }
  caja.classList.remove('oculto');
  let drive = '';
  if (r.drive === 'cola') {
    drive = ico('reloj', 's') + (S.sincronizando && navigator.onLine ? 'Subiendo a Drive…' : 'Se guardará en Drive cuando haya señal.');
  } else if (r.drive) {
    drive = ico('circulo-check', 's') + 'Guardado en la carpeta "Alarmas de gases - PDF"' +
      (/^https?:/.test(r.drive) ? ' · <a href="' + esc(r.drive) + '" target="_blank" rel="noopener">Abrir</a>' : '');
  }
  caja.innerHTML = '<div class="archivo">' + ico('pdf', 'l') + '<div><b>' + esc(r.nombre) + '</b><small>' +
    plural(r.paginas, 'página', 'páginas') + ' · ' + tamano(r.blob.size) + ' · ' + plural(r.alarmas, 'alarma', 'alarmas') +
    '</small></div></div><div class="tres-btn">' +
    '<button type="button" class="btn" data-pdf="descargar">' + ico('instalar') + 'Descargar</button>' +
    '<button type="button" class="btn" data-pdf="compartir">' + ico('compartir') + 'Compartir</button>' +
    '<button type="button" class="btn" data-pdf="drive">' + ico('subir') + 'Guardar en Drive</button></div>' +
    (drive ? '<p class="estado-drive">' + drive + '</p>' : '');
}

function cargarScript(src) {
  return new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('No se pudo cargar el generador de PDF. Abre la app una vez con señal.')); };
    document.head.appendChild(s);
  });
}

async function cargarLibreriasPdf() {
  if (!(window.jspdf && window.jspdf.jsPDF)) await cargarScript('lib/jspdf.umd.min.js');
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error('No se pudo cargar el generador de PDF.');
  if (!J.API.autoTable) {
    await cargarScript('lib/jspdf.plugin.autotable.min.js');
    if (!J.API.autoTable && typeof window.applyPlugin === 'function') window.applyPlugin(J);
  }
  if (!J.API.autoTable) throw new Error('No se pudo cargar el generador de tablas del PDF.');
}

let logoCache = null;
async function logoPdf() {
  if (logoCache) return logoCache;
  try {
    const r = await fetch('logo.jpg');
    logoCache = await blobADataUrl(await r.blob());
  } catch (e) {
    logoCache = null;
  }
  return logoCache;
}

async function minisPara(lista) {
  const faltan = lista.filter(function(a) { return !S.minis[a.id] && a.mini; }).map(function(a) { return a.id; });
  if (faltan.length && navigator.onLine) {
    try { await traerMiniaturas(faltan); } catch (e) { /* se arma con las que hay */ }
  }
  const out = {};
  lista.forEach(function(a) { if (imgSegura(S.minis[a.id])) out[a.id] = S.minis[a.id]; });
  return out;
}

async function construirPdf(lista, op) {
  await cargarLibreriasPdf();
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const VINO = [121, 2, 44], TINTA = [31, 41, 55], SUAVE = [75, 85, 99], LINEA = [224, 205, 211], CLARO = [250, 245, 247];
  const color = function(metodo, c) { doc[metodo](c[0], c[1], c[2]); };
  const ahora = new Date();
  const r = resumir(lista);
  const reserva = S.cfg.reserva || 0;
  const variasSedes = lista.some(function(a) { return a.sede !== lista[0].sede; });

  // Encabezado de la primera hoja
  const logo = await logoPdf();
  if (logo) { try { doc.addImage(logo, 'JPEG', M, 9, 17, 17); } catch (e) { /* sin logo */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); color('setTextColor', VINO);
  doc.text('Clínica Reina Catalina', M + 21, 15.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color('setTextColor', SUAVE);
  doc.text('Departamento de Gases Medicinales', M + 21, 21);
  color('setDrawColor', VINO); doc.setLineWidth(0.7); doc.line(M, 29, W - M, 29);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); color('setTextColor', TINTA);
  doc.text('Levantamiento de alarmas de gases medicinales', M, 37.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color('setTextColor', SUAVE);
  const datos = doc.splitTextToSize(op.titulo + '   |   ' + fechaHora(ahora) + '   |   Generado por: ' + (S.tecnico || '-'), W - 2 * M);
  doc.text(datos, M, 43.5);
  let y = 43.5 + datos.length * 4.6 + 4;

  const base = {
    theme: 'grid',
    margin: { left: M, right: M, top: 20, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: TINTA, lineColor: LINEA, lineWidth: 0.15, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: VINO, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: CLARO }
  };
  function tabla(o) {
    const opciones = Object.assign({}, base, o, {
      styles: Object.assign({}, base.styles, o.styles || {}),
      headStyles: Object.assign({}, base.headStyles, o.headStyles || {})
    });
    doc.autoTable(opciones);
    return doc.lastAutoTable.finalY;
  }
  function titulo(t) {
    if (y > H - 45) { doc.addPage(); y = 24; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); color('setTextColor', VINO);
    doc.text(t, M, y);
    y += 2.5;
  }

  // 1. Material
  titulo('Resumen de material');
  const material = [
    ['Sensores', r.porGas.O, r.porGas.A, r.porGas.V, r.sensores],
    ['Accesorios para sensor', r.porGas.O, r.porGas.A, r.porGas.V, r.sensores],
    ['Cable (m)', num(r.cablePorGas.O), num(r.cablePorGas.A), num(r.cablePorGas.V), num(r.cable)]
  ];
  if (reserva > 0) {
    const k = 1 + reserva / 100;
    material.push(['Cable con reserva del ' + num(reserva) + ' % (m)', num(r.cablePorGas.O * k), num(r.cablePorGas.A * k),
      num(r.cablePorGas.V * k), num(r.cable * k)]);
  }
  y = tabla({
    startY: y,
    head: [['Material', 'Oxígeno', 'Aire', 'Vacío', 'Total']],
    body: material.map(function(f) { return f.map(String); }),
    columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } }
  }) + 8;

  // 2. Alarmas por tipo
  titulo('Alarmas');
  const tipos = ordenTipos(r.tipos).map(function(t) {
    return ['Alarma de ' + plural(t.length, 'gas', 'gases') + ': ' + t.split('').map(function(k) { return GAS[k].pdf; }).join(' + '), String(r.tipos[t])];
  });
  const filaTotal = tipos.length;
  tipos.push(['Total de alarmas', String(r.total)]);
  tipos.push(['Instaladas', String(r.instaladas)]);
  tipos.push(['Pendientes', String(r.total - r.instaladas)]);
  y = tabla({
    startY: y,
    head: [['Tipo de alarma', 'Cantidad']],
    body: tipos,
    columnStyles: { 0: { cellWidth: 140 }, 1: { halign: 'right' } },
    didParseCell: function(d) {
      if (d.section === 'body' && d.row.index === filaTotal) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [246, 233, 238]; }
    }
  }) + 8;

  // 3. Resumen por torre y piso
  const pisos = [];
  lista.forEach(function(a) {
    const k = clavePiso(a);
    if (!pisos.length || pisos[pisos.length - 1].k !== k) pisos.push({ k: k, a: a, lista: [] });
    pisos[pisos.length - 1].lista.push(a);
  });
  if (pisos.length > 1) {
    titulo('Resumen por torre y piso');
    const cab = (variasSedes ? ['Sede'] : []).concat(['Torre', 'Piso', 'Alarmas', 'Sensores', 'Cable (m)', 'Instaladas']);
    const cuerpo = pisos.map(function(p) {
      const rr = resumir(p.lista);
      return (variasSedes ? [p.a.sede] : []).concat([p.a.torre, nombrePiso(p.a.piso), String(rr.total), String(rr.sensores), num(rr.cable), String(rr.instaladas)]);
    });
    cuerpo.push((variasSedes ? ['Total'] : []).concat([variasSedes ? '' : 'Total', '', String(r.total), String(r.sensores), num(r.cable), String(r.instaladas)]));
    const n0 = variasSedes ? 3 : 2;
    const cols = {};
    for (let c = n0; c < n0 + 4; c++) cols[c] = { halign: 'right' };
    y = tabla({
      startY: y, head: [cab], body: cuerpo, columnStyles: cols,
      didParseCell: function(d) {
        if (d.section === 'body' && d.row.index === cuerpo.length - 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [246, 233, 238]; }
      }
    }) + 8;
  }

  // 4. Detalle por estar
  titulo('Detalle por estar');
  const conFotos = !!op.fotos;
  const cab = ['#', 'Torre', 'Piso', 'Servicio', 'Estar', 'Gases', 'Cable (m)', 'Válvula / observación', 'Estado'];
  if (conFotos) cab.push('Lugar de la alarma');
  // Con dos sedes, cada sede lleva su propia fila de título
  const filasDetalle = [];
  let sedeActual = null;
  lista.forEach(function(a, i) {
    if (variasSedes && a.sede !== sedeActual) { sedeActual = a.sede; filasDetalle.push({ sede: a.sede }); }
    filasDetalle.push({ a: a, n: i + 1 });
  });
  const cuerpo = filasDetalle.map(function(fd) {
    if (fd.sede) {
      return [{ content: 'Sede ' + fd.sede, colSpan: cab.length,
        styles: { fillColor: [246, 233, 238], textColor: VINO, fontStyle: 'bold', halign: 'left', minCellHeight: 7 } }];
    }
    const a = fd.a;
    const g = gasesDe(a);
    const fila = [
      String(fd.n),
      a.torre,
      nivelInfo(a.piso).nombre.replace('Piso ', ''),
      a.servicio,
      String(a.estar),
      g.map(function(k) { return GAS[k].pdf; }).join(', '),
      g.length + ' × ' + num(a.cable) + ' = ' + num(g.length * a.cable),
      [a.valvula, a.obs].filter(Boolean).join(' / ') || '-',
      a.estado
    ];
    if (conFotos) fila.push('');
    return fila;
  });
  const anchos = conFotos ? [6, 16, 12, 30, 11, 22, 22, 32, 17, 18] : [6, 17, 12, 34, 11, 24, 24, 39, 19];
  const columnas = {};
  anchos.forEach(function(w, i) { columnas[i] = { cellWidth: w }; });
  columnas[0].halign = 'right';
  columnas[4].halign = 'center';
  tabla({
    startY: y,
    head: [cab],
    body: cuerpo,
    styles: { fontSize: 7.8, cellPadding: 1.4 },
    rowPageBreak: 'avoid',
    columnStyles: columnas,
    bodyStyles: conFotos ? { minCellHeight: 17 } : {},
    didParseCell: function(d) {
      if (d.section === 'body' && d.column.index === 8) {
        d.cell.styles.textColor = d.cell.raw === 'Instalada' ? [23, 102, 63] : [138, 69, 8];
        d.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawCell: function(d) {
      if (!conFotos || d.section !== 'body' || d.column.index !== 9) return;
      const fd = filasDetalle[d.row.index];
      if (!fd || !fd.a) return;
      const a = fd.a;
      const img = op.minis[a.id];
      if (img) {
        try {
          const p = doc.getImageProperties(img);
          const k = Math.min((d.cell.width - 2) / p.width, (d.cell.height - 2) / p.height);
          const w = p.width * k, h = p.height * k;
          doc.addImage(img, 'JPEG', d.cell.x + (d.cell.width - w) / 2, d.cell.y + (d.cell.height - h) / 2, w, h);
        } catch (e) { /* foto dañada */ }
      } else {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); color('setTextColor', SUAVE);
        doc.text('Sin foto', d.cell.x + d.cell.width / 2, d.cell.y + d.cell.height / 2 + 1, { align: 'center' });
      }
    }
  });
  y = doc.lastAutoTable.finalY;

  // 5. Firmas
  if (op.firmas) {
    let yy = y + 24;
    if (yy > H - 28) { doc.addPage(); yy = 46; }
    const ancho = (W - 2 * M - 20) / 2;
    color('setDrawColor', SUAVE); doc.setLineWidth(0.3);
    doc.line(M, yy, M + ancho, yy);
    doc.line(W - M - ancho, yy, W - M, yy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color('setTextColor', TINTA);
    doc.text('Elaboró', M, yy + 5);
    doc.text('Revisó', W - M - ancho, yy + 5);
    doc.setFont('helvetica', 'normal'); color('setTextColor', SUAVE);
    doc.text(S.tecnico || 'Nombre', M, yy + 9.5);
    doc.text('Nombre y cargo', W - M - ancho, yy + 9.5);
  }

  // Encabezado corto y pie en todas las hojas
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); color('setTextColor', VINO);
      doc.text(doc.splitTextToSize('Alarmas de gases medicinales  |  ' + op.titulo, W - 2 * M)[0], M, 11.5);
      color('setDrawColor', LINEA); doc.setLineWidth(0.3); doc.line(M, 14, W - M, 14);
    }
    color('setDrawColor', LINEA); doc.setLineWidth(0.3); doc.line(M, H - 11, W - M, H - 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color('setTextColor', SUAVE);
    doc.text('Clínica Reina Catalina  |  Departamento de Gases Medicinales  |  ' + fechaHora(ahora), M, H - 7);
    doc.text('Página ' + p + ' de ' + paginas, W - M, H - 7, { align: 'right' });
  }
  return { blob: doc.output('blob'), paginas: paginas };
}

async function generarPdf() {
  const lista = alarmasPdf();
  avisoPdf('');
  if (!lista.length) { avisoPdf('No hay alarmas en esta selección.'); return; }
  const btn = $('btnGenerar');
  btn.disabled = true;
  btn.innerHTML = ico('refrescar') + 'Generando…';
  try {
    const minis = S.pdf.fotos ? await minisPara(lista) : {};
    const hecho = await construirPdf(lista, { titulo: tituloPdf(), fotos: S.pdf.fotos, firmas: S.pdf.firmas, minis: minis });
    soltarPdf();
    S.pdfActual = { blob: hecho.blob, paginas: hecho.paginas, nombre: nombreArchivoPdf(), alarmas: lista.length, drive: '', uid: '' };
    pintarResultadoPdf();
    pintarVistaPdf();
    const sinFoto = S.pdf.fotos ? lista.filter(function(a) { return !minis[a.id]; }).length : 0;
    toast(ico('check', 's') + 'PDF listo' + (sinFoto ? ' · ' + plural(sinFoto, 'alarma', 'alarmas') + ' sin foto' : ''));
    if (!esPC()) verElemento($('qResultado'));
  } catch (e) {
    avisoPdf(e.message || 'No se pudo generar el PDF.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = ico('pdf') + 'Generar PDF';
  }
}

function descargarPdf() {
  const r = S.pdfActual;
  if (!r) return;
  const url = URL.createObjectURL(r.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
  toast(ico('check', 's') + 'PDF descargado');
}

async function compartirPdf() {
  const r = S.pdfActual;
  if (!r) return;
  const archivo = new File([r.blob], r.nombre, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: r.nombre, text: 'Levantamiento de alarmas de gases medicinales' });
    } catch (e) {
      if (e.name !== 'AbortError') toast(ico('alerta', 's') + 'No se pudo compartir.');
    }
  } else {
    toast(ico('alerta', 's') + 'Este navegador no deja compartir archivos. Descárgalo y compártelo desde Archivos.');
  }
}

async function pdfADrive() {
  const r = S.pdfActual;
  if (!r) return;
  if (r.drive) {
    toast(ico('check', 's') + (r.drive === 'cola' ? 'Ya está en camino a Drive' : 'Ya está guardado en Drive'));
    return;
  }
  r.uid = nuevoId('P');
  r.drive = 'cola';
  pintarResultadoPdf();
  await guardarDato('pdf:' + r.uid, r.blob);
  await encolar({ accion: 'pdf', uid: r.uid, nombre: r.nombre });
  sincronizar();
}


/***********************
 * AJUSTES
 ***********************/

function idSeguro(t) { return sinTildes(t).replace(/[^A-Za-z0-9]/g, ''); }

function pintarColaAjustes() {
  const n = S.cola.length;
  $('ajCola').textContent = n ? plural(n, 'cambio guardado en el celular', 'cambios guardados en el celular') : 'Todo está subido a la hoja.';
}

function pintarAjustes() {
  $('ajTecnico').textContent = S.tecnico || 'Sin técnico';
  $('ajTecnicoSede').textContent = S.sedeTec ? 'Sede ' + S.sedeTec : '';
  pintarColaAjustes();
  if (!S.ajSucio) {
    $('ajTorres').innerHTML = S.cfg.sedes.map(function(s) {
      const t = torresDe(s);
      return '<div class="campo"><label class="etq" for="ajT' + idSeguro(s) + '">' + esc(s) + '</label>' +
        '<textarea id="ajT' + idSeguro(s) + '" class="entrada" data-aj-torres="' + esc(s) + '" rows="' + Math.max(2, t.length + 1) +
        '" spellcheck="false">' + esc(t.map(function(x) { return x.nombre + ': ' + x.niveles; }).join('\n')) + '</textarea>' +
        '<div class="vista-previa" data-previa="' + esc(s) + '"></div></div>';
    }).join('');
    $('ajTecnicos').innerHTML = S.cfg.sedes.map(function(s) {
      const t = S.cfg.tecnicos[s] || [];
      return '<div class="campo"><label class="etq" for="ajP' + idSeguro(s) + '">' + esc(s) + '</label>' +
        '<textarea id="ajP' + idSeguro(s) + '" class="entrada" data-aj-tec="' + esc(s) + '" rows="' + Math.max(2, t.length + 1) +
        '" spellcheck="false" autocapitalize="words">' + esc(t.join('\n')) + '</textarea></div>';
    }).join('');
    $('ajReserva').value = textoNumero(S.cfg.reserva || 0);
  }
  S.cfg.sedes.forEach(pintarPrevia);
  const ultima = ls('ag_ultima');
  $('ajVersion').textContent = 'Alarmas de gases · versión ' + VERSION_APP + (ultima ? ' · datos del ' + fechaHora(ultima) : '');
}

function campoAjuste(tipo, sede) {
  return Array.prototype.find.call(document.querySelectorAll('[data-aj-' + tipo + ']'), function(el) {
    return el.getAttribute('data-aj-' + tipo) === sede;
  });
}

function pintarPrevia(sede) {
  const ta = campoAjuste('torres', sede);
  const caja = Array.prototype.find.call(document.querySelectorAll('[data-previa]'), function(el) { return el.dataset.previa === sede; });
  if (!ta || !caja) return;
  caja.innerHTML = ta.value.split('\n').map(function(l) { return l.trim(); }).filter(Boolean).map(function(l) {
    const t = leerTorreTxt(l);
    const nv = t ? leerNiveles(t.niveles) : [];
    if (!t || !nv.length) return '<span class="mal">' + ico('alerta', 's') + ' "' + esc(l) + '": falta el nombre, los dos puntos o los pisos</span>';
    return '<span class="bien">' + ico('check', 's') + ' ' + esc(t.nombre) + ': ' + plural(nv.length, 'nivel', 'niveles') +
      ' (' + esc(nv.map(function(n) { return n.corto; }).join(', ')) + ')</span>';
  }).join('');
}

function avisoAjustes(msg) {
  $('ajAviso').innerHTML = msg ? ico('alerta', 's') + esc(msg) : '';
  $('ajAviso').classList.toggle('oculto', !msg);
}

async function guardarAjustes() {
  avisoAjustes('');
  const clave = $('ajClave').value.trim();
  const torres = {}, tecnicos = {};
  for (const s of S.cfg.sedes) {
    const lineas = (campoAjuste('torres', s).value || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    const mala = lineas.find(function(l) { const t = leerTorreTxt(l); return !t || !leerNiveles(t.niveles).length; });
    if (mala) { avisoAjustes('Revisa la torre "' + mala + '" de ' + s + '.'); return; }
    if (!lineas.length) { avisoAjustes(s + ' debe tener al menos una torre.'); return; }
    torres[s] = lineas;
    tecnicos[s] = (campoAjuste('tec', s).value || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  }
  const reserva = leerNumero($('ajReserva').value || '0');
  if (!(reserva >= 0 && reserva <= 100)) { avisoAjustes('La reserva debe estar entre 0 y 100 %.'); return; }
  if (!clave) { avisoAjustes('Escribe la clave de administrador.'); $('ajClave').focus(); return; }
  if (!navigator.onLine) { avisoAjustes('Se necesita señal para guardar los ajustes.'); return; }
  const btn = $('ajGuardar');
  btn.disabled = true;
  btn.innerHTML = ico('refrescar') + 'Guardando…';
  try {
    const r = await llamar('guardarConfig', { clave: clave, torres: torres, tecnicos: tecnicos, reserva: reserva, tecnico: S.tecnico }, 45000);
    S.cfg = normalizarCfg(r.config);
    await guardarDato('cfg', S.cfg);
    S.ajSucio = false;
    $('ajClave').value = '';
    pintarAjustes();
    toast(ico('check', 's') + 'Ajustes guardados en la hoja');
  } catch (e) {
    avisoAjustes(e.sinRed ? 'Sin conexión. Intenta de nuevo con señal.' : e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = ico('guardar') + 'Guardar ajustes';
  }
}


/***********************
 * NAVEGACIÓN Y PANTALLAS
 ***********************/

function pintarCabecera() {
  $('cabSub').textContent = S.tecnico ? S.tecnico + ' · ' + S.sedeTec : '';
}

function irA(vista) {
  S.vista = vista;
  $('vRegistrar').classList.toggle('oculto', vista !== 'registrar');
  $('vAlarmas').classList.toggle('oculto', vista !== 'alarmas');
  $('vPanel').classList.toggle('oculto', vista !== 'panel');
  $('vPdf').classList.toggle('oculto', vista !== 'pdf');
  $('vAjustes').classList.toggle('oculto', vista !== 'ajustes');
  $('barraGuardar').classList.toggle('oculto', vista !== 'registrar');
  [['navRegistrar', 'registrar'], ['navAlarmas', 'alarmas'], ['navPanel', 'panel'], ['navPdf', 'pdf']].forEach(function(p) {
    $(p[0]).setAttribute('aria-current', vista === p[1] ? 'page' : 'false');
  });
  repintar();
  window.scrollTo(0, 0);
}

function repintar() {
  pintarCabecera();
  if (S.pantalla === 'turno') pintarTurno();
  if (S.vista === 'registrar') pintarRegistrar();
  else if (S.vista === 'alarmas') pintarAlarmas();
  else if (S.vista === 'panel') pintarPanel();
  else if (S.vista === 'pdf') pintarPdf();
  else if (S.vista === 'ajustes') pintarAjustes();
  pintarPuntoNav();
}

function mostrarPantalla(cual) {
  S.pantalla = cual;
  $('vAcceso').classList.toggle('oculto', cual !== 'acceso');
  $('vTurno').classList.toggle('oculto', cual !== 'turno');
  $('vPrincipal').classList.toggle('oculto', cual !== 'principal');
}

function mostrarAcceso(msg) {
  mostrarPantalla('acceso');
  $('avisoAcceso').innerHTML = msg ? ico('alerta', 's') + esc(msg) : (urlConfigurada() ? '' :
    ico('alerta', 's') + 'Falta configurar la app: pega la URL de Apps Script en config.js.');
  $('codigoAcceso').value = '';
  setTimeout(function() { $('codigoAcceso').focus(); }, 50);
}

async function entrar() {
  const codigo = $('codigoAcceso').value.trim();
  const aviso = $('avisoAcceso');
  if (!codigo) { aviso.innerHTML = ico('alerta', 's') + 'Escribe el código.'; return; }
  aviso.innerHTML = '';
  $('btnEntrar').textContent = 'Revisando…';
  try {
    await llamar('validar', {}, 30000, codigo);
    ls(CLAVE_CODIGO, codigo);
    seguir();
    sincronizar();
  } catch (e) {
    aviso.innerHTML = ico('alerta', 's') + esc(e.sinRed
      ? 'Sin señal. Para entrar la primera vez se necesita conexión.'
      : e.message);
  } finally {
    $('btnEntrar').innerHTML = ico('candado') + 'Entrar';
  }
}

let turnoSede = '', turnoTecnico = '';

function mostrarTurno() {
  turnoSede = S.sedeTec;
  turnoTecnico = S.tecnico;
  mostrarPantalla('turno');
  pintarTurno();
}

function pintarTurno() {
  $('turnoSedes').innerHTML = S.cfg.sedes.map(function(s) {
    return '<button type="button" class="chip" data-turno-sede="' + esc(s) + '" aria-pressed="' + (s === turnoSede) + '">' +
      ico('sede', 's') + esc(s) + '</button>';
  }).join('');
  const lista = (S.cfg.tecnicos && S.cfg.tecnicos[turnoSede]) || [];
  $('turnoTecnicos').innerHTML = lista.map(function(t) {
    return '<button type="button" class="chip" data-turno-tecnico="' + esc(t) + '" aria-pressed="' + (t === turnoTecnico) + '">' +
      esc(t) + '</button>';
  }).join('');
  $('turnoAyuda').textContent = !turnoSede ? 'Elige primero la sede.' : (lista.length ? '' : 'Esta sede no tiene técnicos en la hoja (pestaña Config).');
  $('turnoAyuda').classList.toggle('oculto', !!turnoSede && !!lista.length);
}

function confirmarTurno() {
  if (!turnoSede || !turnoTecnico) {
    $('turnoAyuda').textContent = !turnoSede ? 'Elige la sede.' : 'Elige el técnico.';
    $('turnoAyuda').classList.remove('oculto');
    return;
  }
  const cambioSede = S.sedeTec !== turnoSede;
  S.sedeTec = turnoSede;
  S.tecnico = turnoTecnico;
  ls('ag_tecnico', { sede: S.sedeTec, tecnico: S.tecnico });
  if (cambioSede && !S.editando) cambiarContexto({ sede: turnoSede, torre: '', piso: '' });
  seguir();
}

/** Decide qué pantalla mostrar según lo que falte. */
function seguir() {
  if (!codigoAcceso()) { mostrarAcceso(''); return; }
  if (!S.tecnico) { mostrarTurno(); return; }
  mostrarPantalla('principal');
  medirArriba();
  irA(S.vista === 'ajustes' ? 'registrar' : S.vista);
  pintarFranja();
  pintarInstalar();
}


/***********************
 * EVENTOS
 ***********************/

function eventos() {
  $('btnEntrar').onclick = entrar;
  $('codigoAcceso').addEventListener('keydown', function(e) { if (e.key === 'Enter') entrar(); });

  $('vTurno').addEventListener('click', function(e) {
    const s = e.target.closest('[data-turno-sede]');
    const t = e.target.closest('[data-turno-tecnico]');
    if (s) {
      if (turnoSede !== s.dataset.turnoSede) turnoTecnico = '';
      turnoSede = s.dataset.turnoSede;
      const lista = S.cfg.tecnicos[turnoSede] || [];
      if (lista.length === 1) turnoTecnico = lista[0];
      pintarTurno();
    }
    if (t) { turnoTecnico = t.dataset.turnoTecnico; pintarTurno(); }
  });
  $('btnTurno').onclick = confirmarTurno;

  // --- Registrar ---
  // Cualquier cambio en el formulario deja guardar de una vez (el bloqueo es solo contra el doble toque)
  const quitarBloqueo = function(e) { if (!e.target.closest('#barraGuardar')) bloqueoHasta = 0; };
  $('vRegistrar').addEventListener('click', quitarBloqueo, true);
  $('vRegistrar').addEventListener('input', quitarBloqueo, true);
  $('fSede').addEventListener('click', function(e) {
    const b = e.target.closest('[data-sede]');
    if (b && b.dataset.sede !== S.f.sede) {
      const r = S.alarmas.filter(function(a) { return a.sede === b.dataset.sede; })
        .sort(function(x, y) { return String(y.fecha).localeCompare(String(x.fecha)); })[0];
      cambiarContexto({ sede: b.dataset.sede, torre: r ? r.torre : '', piso: r ? r.piso : '', servicio: r ? r.servicio : '', otro: false });
    }
  });
  $('fTorre').addEventListener('click', function(e) {
    const b = e.target.closest('[data-torre]');
    if (b) cambiarContexto({ torre: b.dataset.torre });
  });
  $('fPiso').addEventListener('click', function(e) {
    const b = e.target.closest('[data-piso]');
    if (b) cambiarContexto({ piso: b.dataset.piso });
  });
  $('fSinAlarma').addEventListener('click', function(e) {
    const ir = e.target.closest('[data-ir-piso]');
    if (ir) { cambiarContexto({ piso: ir.dataset.irPiso }); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const b = e.target.closest('[data-sin]');
    if (b) marcarSinAlarma(S.f.sede, S.f.torre, S.f.piso, b.dataset.sin === '1');
  });
  $('fServicio').addEventListener('click', function(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.otro) {
      S.f.otro = true;
      pintarServicios();
      $('fServicioOtro').focus();
    } else {
      S.f.otro = false;
      S.f.servicio = b.dataset.servicio;
      $('fServicioOtro').value = '';
      $('fServicioOtro').classList.remove('mal');
      pintarServicios();
      guardarContexto();
    }
    if (!S.editando) { S.f.estar = siguienteEstar(); pintarEstar(); }
    mostrarError('servicio', '');
    mostrarError('estar', '');
  });
  $('fServicioOtro').addEventListener('input', function() {
    this.classList.remove('mal');
    mostrarError('servicio', '');
    mostrarError('estar', '');
    if (!S.editando) { S.f.estar = siguienteEstar(); pintarEstar(); }
  });
  $('fServicioOtro').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });
  $('estarMenos').onclick = function() { S.f.estar = Math.max(1, S.f.estar - 1); mostrarError('estar', ''); pintarEstar(); };
  $('estarMas').onclick = function() { S.f.estar++; mostrarError('estar', ''); pintarEstar(); };

  $('fGases').addEventListener('click', function(e) {
    const b = e.target.closest('[data-gas]');
    if (!b) return;
    const k = b.dataset.gas;
    const i = S.f.gases.indexOf(k);
    if (i >= 0) S.f.gases.splice(i, 1); else S.f.gases.push(k);
    S.f.gases = ['O', 'A', 'V'].filter(function(x) { return S.f.gases.indexOf(x) >= 0; });
    mostrarError('gases', '');
    pintarGases();
    pintarResumen();
    guardarContexto();
  });

  $('fFoto').addEventListener('click', function(e) {
    const b = e.target.closest('[data-foto]');
    if (!b) return;
    if (b.dataset.foto === 'tomar') $('fFotoArchivo').click();
    if (b.dataset.foto === 'quitar') {
      S.f.foto = null;
      S.f.fotoMini = '';
      if (S.editando && (S.editando.mini || S.editando.foto)) S.f.quitarFoto = true;
      pintarFoto();
    }
  });
  $('fFotoArchivo').addEventListener('change', async function() {
    const archivo = this.files && this.files[0];
    this.value = '';
    if (!archivo) return;
    $('fFoto').innerHTML = '<p class="ayuda">' + ico('refrescar', 's') + ' Preparando la foto…</p>';
    try {
      const r = await procesarFoto(archivo);
      S.f.foto = r.blob;
      S.f.fotoMini = r.mini;
      S.f.quitarFoto = false;
    } catch (err) {
      toast(ico('alerta', 's') + 'No se pudo leer la foto. Intenta de nuevo.');
    }
    pintarFoto();
  });
  $('fValvulaUsadas').addEventListener('click', function(e) {
    const b = e.target.closest('[data-valvula]');
    if (b) $('fValvula').value = b.dataset.valvula;
  });
  $('fValvula').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });

  $('cableMenos').onclick = function() { setCable((leerNumero($('fCable').value) || 0) - 1); };
  $('cableMas').onclick = function() { setCable((leerNumero($('fCable').value) || 0) + 1); };
  $('fCableRapido').addEventListener('click', function(e) {
    const b = e.target.closest('[data-metros]');
    if (b) setCable(Number(b.dataset.metros));
  });
  $('fCable').addEventListener('input', function() {
    this.value = this.value.replace(/[^\d.,]/g, '');
    this.classList.remove('mal');
    mostrarError('cable', '');
    pintarResumen();
    guardarContexto();
  });
  $('fCable').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } });

  $('fEstado').addEventListener('click', function(e) {
    const b = e.target.closest('[data-estado]');
    if (!b) return;
    S.f.estado = b.dataset.estado;
    $('fEstado').querySelectorAll('button').forEach(function(x) { x.setAttribute('aria-pressed', x.dataset.estado === S.f.estado); });
  });

  $('btnGuardar').onclick = guardar;
  $('btnCancelarEd').onclick = cancelarEdicion;
  $('btnCancelarTira').onclick = cancelarEdicion;
  $('btnBorrar').onclick = function() {
    const ed = S.editando;
    if (!ed) return;
    $('confirmarTxt').textContent = '¿Eliminar ' + ed.servicio + ' · ESTAR ' + ed.estar + ' (' + ed.torre + ', ' + nombrePiso(ed.piso) +
      ')? Se borra de la hoja y su foto de Drive.';
    $('confirmarBorrar').classList.remove('oculto');
    $('btnBorrar').classList.add('oculto');
    verElemento($('zonaBorrar'));
  };
  $('btnNoBorrar').onclick = function() {
    $('confirmarBorrar').classList.add('oculto');
    $('btnBorrar').classList.remove('oculto');
  };
  $('btnSiBorrar').onclick = function() {
    $('confirmarBorrar').classList.add('oculto');
    $('btnBorrar').classList.remove('oculto');
    borrarAlarma();
  };

  // --- Navegación ---
  $('navRegistrar').onclick = function() { irA('registrar'); };
  $('navAlarmas').onclick = function() { irA('alarmas'); };
  $('navPanel').onclick = function() { irA('panel'); };
  $('navPdf').onclick = function() { irA('pdf'); };
  $('btnAjustes').onclick = function() { S.ajSucio = false; irA('ajustes'); };

  // --- Alarmas ---
  $('buscar').addEventListener('input', function() { S.filtro.q = this.value; pintarAlarmas(); });
  $('limpiarBuscar').onclick = function() { $('buscar').value = ''; S.filtro.q = ''; pintarAlarmas(); $('buscar').focus(); };
  $('listaAlarmas').addEventListener('keydown', function(e) {
    const fila = e.target.closest && e.target.closest('tr[data-editar]');
    if (fila && e.target === fila && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirEdicion(fila.dataset.editar); }
  });
  $('vAlarmas').addEventListener('click', function(e) {
    const s = e.target.closest('[data-f-sede]');
    const est = e.target.closest('[data-f-estado]');
    const ed = e.target.closest('[data-editar]');
    const cambio = e.target.closest('[data-estado-id]');
    if (s) { S.filtro.sede = s.dataset.fSede; pintarAlarmas(); }
    else if (est) { S.filtro.estado = est.dataset.fEstado; pintarAlarmas(); }
    else if (cambio) cambiarEstado(cambio.dataset.estadoId);
    else if (ed) abrirEdicion(ed.dataset.editar);
  });

  // --- Panel ---
  $('vPanel').addEventListener('click', function(e) {
    const s = e.target.closest('[data-p-sede]');
    const t = e.target.closest('[data-p-torre]');
    const cambio = e.target.closest('[data-estado-id]');
    const ed = e.target.closest('[data-editar]');
    const pdf = e.target.closest('[data-pdf-piso]');
    const reg = e.target.closest('[data-registrar-piso]');
    const sin = e.target.closest('[data-sin-piso]');
    const fila = e.target.closest('[data-fila-piso]');
    const celda = e.target.closest('[data-celda-piso]');
    if (celda) {
      S.panel.torre = celda.dataset.celdaTorre;
      S.panel.abierto = celda.dataset.celdaPiso;
      pintarPanel();
      return;
    }
    const torre = S.panel.torre;
    const sede = torre.slice(0, torre.indexOf('|')), nombreTorre = torre.slice(torre.indexOf('|') + 1);
    if (s) { S.panel.sede = s.dataset.pSede; S.panel.abierto = ''; pintarPanel(); }
    else if (t) { S.panel.torre = t.dataset.pTorre; S.panel.abierto = ''; pintarPanel(); }
    else if (cambio) cambiarEstado(cambio.dataset.estadoId);
    else if (ed) abrirEdicion(ed.dataset.editar);
    else if (pdf) {
      Object.assign(S.pdf, { modo: 'piso', sede: sede, torre: nombreTorre, piso: pdf.dataset.pdfPiso });
      soltarPdf();
      irA('pdf');
    } else if (reg) {
      if (S.editando) terminarEdicion();
      irA('registrar');
      cambiarContexto({ sede: sede, torre: nombreTorre, piso: reg.dataset.registrarPiso });
    } else if (sin) marcarSinAlarma(sede, nombreTorre, sin.dataset.piso, sin.dataset.sinPiso === '1');
    else if (fila) {
      S.panel.abierto = S.panel.abierto === fila.dataset.filaPiso ? '' : fila.dataset.filaPiso;
      pintarPanel();
    }
  });

  // --- PDF ---
  $('qAlcance').addEventListener('click', function(e) {
    const b = e.target.closest('[data-modo]');
    if (b) cambioPdf({ modo: b.dataset.modo });
  });
  $('qElegir').addEventListener('click', function(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const q = S.pdf;
    if (b.dataset.qSede) {
      if (b.dataset.qSede !== q.sede) {
        cambioPdf({ sede: b.dataset.qSede, torre: '', piso: '', servicio: '',
          elegidos: q.elegidos.filter(function(id) { return S.alarmas.some(function(a) { return a.id === id && a.sede === b.dataset.qSede; }); }) });
      }
    } else if (b.dataset.qTorre) cambioPdf({ torre: b.dataset.qTorre, piso: '' });
    else if (b.dataset.qPiso) cambioPdf({ piso: b.dataset.qPiso });
    else if (b.dataset.qServicio) cambioPdf({ servicio: b.dataset.qServicio });
    else if (b.dataset.qEst) {
      const id = b.dataset.qEst;
      const el = q.elegidos.slice();
      const i = el.indexOf(id);
      if (i >= 0) el.splice(i, 1); else el.push(id);
      cambioPdf({ elegidos: el });
    } else if (b.dataset.qTodas) {
      cambioPdf({ elegidos: b.dataset.qTodas === '1'
        ? S.alarmas.filter(function(a) { return a.sede === q.sede; }).map(function(a) { return a.id; }) : [] });
    } else if (b.dataset.qVer) {
      q.verTodos = !q.verTodos;
      pintarPdf();
    }
  });
  $('qFotos').onclick = function() { cambioPdf({ fotos: !S.pdf.fotos }); };
  $('qFirmas').onclick = function() { cambioPdf({ firmas: !S.pdf.firmas }); };
  $('btnGenerar').onclick = generarPdf;
  $('qResultado').addEventListener('click', function(e) {
    const b = e.target.closest('[data-pdf]');
    if (!b) return;
    if (b.dataset.pdf === 'descargar') descargarPdf();
    if (b.dataset.pdf === 'compartir') compartirPdf();
    if (b.dataset.pdf === 'drive') pdfADrive();
  });

  // --- Ajustes ---
  $('ajVolver').onclick = function() { irA('registrar'); };
  $('ajCambiarTec').onclick = mostrarTurno;
  $('ajSubir').onclick = function() {
    if (!S.cola.length) { toast(ico('check', 's') + 'No hay cambios por subir'); return; }
    S.sync = { estado: '', msg: '' };
    sincronizar();
  };
  $('ajSalir').onclick = function() {
    const n = S.cola.length;
    if (n && !confirm('Hay ' + plural(n, 'cambio', 'cambios') + ' sin subir. Quedan guardados en el celular y se suben al volver a entrar. ¿Cerrar sesión?')) return;
    ls(CLAVE_CODIGO, null);
    mostrarAcceso('');
  };
  $('vAjustes').addEventListener('input', function(e) {
    if (e.target.matches('[data-aj-torres], [data-aj-tec], #ajReserva')) S.ajSucio = true;
    if (e.target.matches('[data-aj-torres]')) pintarPrevia(e.target.dataset.ajTorres);
    if (e.target.id === 'ajClave') avisoAjustes('');
  });
  $('ajGuardar').onclick = guardarAjustes;

  // --- PC o celular: al cambiar el ancho se reacomoda la vista ---
  if (MQ_PC) {
    const alCambiar = function() { medirArriba(); repintar(); };
    if (MQ_PC.addEventListener) MQ_PC.addEventListener('change', alCambiar); else if (MQ_PC.addListener) MQ_PC.addListener(alCambiar);
  }
  window.addEventListener('resize', medirArriba);

  // --- Conexión ---
  window.addEventListener('online', function() { sincronizar(); if (S.vista === 'pdf') pintarResultadoPdf(); });
  window.addEventListener('offline', function() { pintarFranja(); if (S.vista === 'pdf') pintarResultadoPdf(); });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') sincronizar();
  });

  // --- Instalar la app ---
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    S.avisoInstalar = e;
    pintarInstalar();
  });
  window.addEventListener('appinstalled', function() {
    S.avisoInstalar = null;
    S.instalada = true;
    pintarInstalar();
    toast(ico('check', 's') + 'App instalada');
  });
  $('btnInstalar').onclick = instalar;
  $('btnInstalarBanner').onclick = instalar;
  $('cerrarInstalar').onclick = function() {
    ls('ag_instalar_cerrado', Date.now());
    pintarInstalar();
  };
  // Si el navegador no ofrece el botón, igual se muestran las instrucciones
  setTimeout(function() { S.esperoInstalar = true; pintarInstalar(); }, 2500);
}

function estaInstalada() {
  return S.instalada || window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function pintarInstalar() {
  const cerrado = ls('ag_instalar_cerrado');
  const oculto = estaInstalada() || S.editando || (cerrado && Date.now() - cerrado < 3 * 86400000) ||
    (!S.avisoInstalar && !S.esperoInstalar);
  $('bannerInstalar').classList.toggle('oculto', !!oculto);
  $('btnInstalar').classList.toggle('oculto', estaInstalada() || !S.avisoInstalar);
  $('instPasos').classList.add('oculto');
  $('btnInstalarBanner').innerHTML = S.avisoInstalar ? ico('instalar', 's') + 'Instalar' : 'Cómo instalar';
}

async function instalar() {
  if (S.avisoInstalar) {
    const e = S.avisoInstalar;
    e.prompt();
    const r = await e.userChoice;
    if (r && r.outcome === 'accepted') S.instalada = true;
    S.avisoInstalar = null;
    pintarInstalar();
    return;
  }
  // Sin aviso del navegador: explicar cómo hacerlo a mano
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('instPasos').innerHTML = ios
    ? 'En Safari toca <b>Compartir</b> y luego <b>Agregar a inicio</b>.'
    : 'Toca el menú <b>⋮</b> de Chrome (arriba a la derecha) y luego <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.';
  $('instPasos').classList.remove('oculto');
}


/***********************
 * ARRANQUE
 ***********************/

async function iniciar() {
  try { await abrirBD(); } catch (e) { /* sin IndexedDB: funciona solo en memoria */ }
  const cfg = await leerDato('cfg');
  if (cfg) S.cfg = normalizarCfg(cfg);
  S.servidor = (await leerDato('servidor')) || [];
  S.servidorSin = (await leerDato('servidorSin')) || [];
  S.cola = (await leerDato('cola')) || [];
  S.minis = await leerPrefijo('mini:');
  S.avisos = ls('ag_avisos') || [];
  const tec = ls('ag_tecnico');
  if (tec) { S.tecnico = tec.tecnico || ''; S.sedeTec = tec.sede || ''; }
  const ctx = ls('ag_ctx') || {};
  Object.assign(S.f, {
    sede: ctx.sede || S.sedeTec || S.cfg.sedes[0], torre: ctx.torre || '', piso: ctx.piso || '',
    servicio: ctx.servicio || '', gases: Array.isArray(ctx.gases) ? ctx.gases : ['O', 'A', 'V']
  });
  $('fCable').value = ctx.cable || '';
  const pdfOp = ls('ag_pdf_op');
  if (pdfOp) { S.pdf.fotos = !!pdfOp.fotos; S.pdf.firmas = pdfOp.firmas !== false; }
  recalcular();
  validarContexto();
  S.f.estar = siguienteEstar();

  eventos();
  seguir();
  if (codigoAcceso()) sincronizar();

  if ('serviceWorker' in navigator) {
    const yaHabia = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function(reg) {
      // Revisa si hay versión nueva cada vez que se vuelve a la app
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') reg.update().catch(function() {});
      });
    }).catch(function() { /* nada */ });
    // Llegó una versión nueva: recarga sola si no hay un registro a medias
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (!yaHabia) return;
      S.versionNueva = true;
      recargarSiSePuede();
    });
  }
}

/** Recarga la app para usar la versión nueva, sin perder lo que se está escribiendo. */
function recargarSiSePuede() {
  if (!S.versionNueva) return;
  const aMedias = S.editando || S.f.foto || $('fValvula').value.trim() || $('fObs').value.trim() ||
    $('fServicioOtro').value.trim() || S.ajSucio;
  if (aMedias) { setTimeout(recargarSiSePuede, 15000); return; }
  S.versionNueva = false;
  location.reload();
}

iniciar();
