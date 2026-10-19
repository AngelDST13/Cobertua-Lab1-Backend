import { ALIAS_CANTONES, CANTONES_COSTA_RICA, CANTONES_GAM, PAIS_ORIGEN, ZONAS_COBERTURA } from '../config/reglasNegocio.js';
import { ErrorIntegracion, ErrorNegocio } from '../errores/errores.js';
import { recortarTexto } from '../utils/utilidades.js';

const REGEX_CODIGO_PAIS_GEO = /^[A-Z]{2}$/;
const REGEX_OCTETO_IPV4 = /^(0|[1-9]\d{0,2})$/;
const REGEX_GRUPO_IPV6 = /^[0-9a-f]{1,4}$/i;

/**
 * Rangos IPv4 que no identifican a un cliente en internet
 * (privados, loopback, enlace local, CGNAT, documentación, multicast, reservados).
 * Cada rango: [primer octeto, segundo octeto mínimo, segundo octeto máximo].
 */
const RANGOS_IPV4_RESERVADOS = [
  [0, 0, 255], // "esta red"
  [10, 0, 255], // privada
  [100, 64, 127], // CGNAT
  [127, 0, 255], // loopback
  [169, 254, 254], // enlace local
  [172, 16, 31], // privada
  [192, 168, 168], // privada
  [198, 18, 19], // pruebas de rendimiento
];

/**
 * Valida la IP del cliente, interpreta la respuesta de ip-api
 * y decide si la ubicación tiene cobertura (R1 · formato de IP, R2 · cobertura).
 */
export class ValidadorCobertura {
  /**
   * @param {ReadonlyArray<object>} zonas Zonas con cobertura; por defecto las de reglasNegocio.js.
   * @param {object} cantones Cantones del país por provincia.
   * @param {object} cantonesConEntrega Cantones con entrega por provincia (la GAM).
   */
  constructor(zonas = ZONAS_COBERTURA, cantones = CANTONES_COSTA_RICA, cantonesConEntrega = CANTONES_GAM) {
    this.zonas = zonas;
    this.cantonesConEntrega = cantonesConEntrega;
    this.indiceCantones = new Map();
    for (const [provincia, lista] of Object.entries(cantones)) {
      for (const canton of lista) this.indiceCantones.set(ValidadorCobertura.normalizar(canton), { canton, provincia });
    }
  }

  /** Minúsculas, sin tildes ni espacios repetidos: "  Vázquez  de Coronado" → "vazquez de coronado". */
  static normalizar(texto) {
    return String(texto ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Quita los prefijos y sufijos que agrega ip-api ("Provincia de San José", "San Jose Province"). */
  static normalizarProvincia(texto) {
    return ValidadorCobertura.normalizar(texto).replace(/^provincia de /, '').replace(/ province$/, '');
  }

  /** Reconoce un cantón de Costa Rica (acepta alias populares). @returns {{ canton, provincia } | null} */
  ubicarCanton(nombre) {
    const clave = ValidadorCobertura.normalizar(nombre);
    const oficial = ALIAS_CANTONES[clave];
    return this.indiceCantones.get(oficial ? ValidadorCobertura.normalizar(oficial) : clave) ?? null;
  }

  tieneEntrega({ canton, provincia }) {
    return (this.cantonesConEntrega[provincia] ?? []).includes(canton);
  }

  /**
   * R2 · ¿Se puede entregar en esta dirección? Solo Costa Rica y solo cantones de la GAM.
   * El cantón se toma de `direccionEnvio.canton` (o de `ciudad` en pedidos antiguos).
   * @returns {{ cubierto: true, zona: object, canton: string, provincia: string } | { cubierto: false, motivo: string }}
   */
  evaluarDestino(direccionEnvio = {}) {
    if (direccionEnvio.pais !== PAIS_ORIGEN) {
      return { cubierto: false, motivo: `Sin cobertura: solo hacemos entregas dentro de Costa Rica (el destino es ${recortarTexto(String(direccionEnvio.pais ?? '—'), 10)})` };
    }

    const textoCanton = direccionEnvio.canton ?? direccionEnvio.ciudad;
    const ubicacion = this.ubicarCanton(textoCanton);
    if (!ubicacion) {
      return { cubierto: false, motivo: `Sin cobertura: "${recortarTexto(String(textoCanton ?? ''), 40)}" no es un cantón de Costa Rica; indica el cantón de entrega` };
    }

    const provinciaIndicada = direccionEnvio.provincia;
    if (provinciaIndicada && ValidadorCobertura.normalizar(provinciaIndicada) !== ValidadorCobertura.normalizar(ubicacion.provincia)) {
      return { cubierto: false, motivo: `Sin cobertura: el cantón ${ubicacion.canton} pertenece a ${ubicacion.provincia}, no a ${recortarTexto(String(provinciaIndicada), 30)}; revisa la dirección` };
    }

    if (!this.tieneEntrega(ubicacion)) {
      return { cubierto: false, motivo: `Sin cobertura: ${ubicacion.canton} (${ubicacion.provincia}) está fuera de la Gran Área Metropolitana; solo entregamos en la GAM` };
    }

    return { cubierto: true, zona: this.determinarZona(PAIS_ORIGEN), ...ubicacion };
  }

  static esIPv4(ip) {
    const octetos = ip.split('.');
    return octetos.length === 4 && octetos.every((octeto) => REGEX_OCTETO_IPV4.test(octeto) && Number(octeto) <= 255);
  }

  /** IPv6 en notación hexadecimal (con o sin "::"). No acepta IPv4 embebida ni zona (%eth0). */
  static esIPv6(ip) {
    return ValidadorCobertura.expandirIPv6(ip) !== null;
  }

  /** Devuelve los 8 grupos de una IPv6 como números, o null si el formato no es válido. */
  static expandirIPv6(ip) {
    if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(':')) return null;

    const mitades = ip.split('::');
    if (mitades.length > 2) return null;

    const separarGrupos = (texto) => (texto === '' ? [] : texto.split(':'));
    const izquierda = separarGrupos(mitades[0]);
    const derecha = mitades.length === 2 ? separarGrupos(mitades[1]) : [];
    const grupos = [...izquierda, ...derecha];

    if (!grupos.every((grupo) => REGEX_GRUPO_IPV6.test(grupo))) return null;
    if (mitades.length === 1 && grupos.length !== 8) return null;
    if (mitades.length === 2 && grupos.length > 7) return null;

    const ceros = new Array(8 - grupos.length).fill('0');
    const completos = mitades.length === 2 ? [...izquierda, ...ceros, ...derecha] : grupos;
    return completos.map((grupo) => parseInt(grupo, 16));
  }

  static esIPv4Reservada(ip) {
    const [primero, segundo, tercero] = ip.split('.').map(Number);
    if (primero >= 224) return true; // multicast (224/4) y reservadas (240/4)
    if (primero === 192 && segundo === 0 && (tercero === 0 || tercero === 2)) return true; // IETF y TEST-NET-1
    if (primero === 198 && segundo === 51 && tercero === 100) return true; // TEST-NET-2
    if (primero === 203 && segundo === 0 && tercero === 113) return true; // TEST-NET-3
    return RANGOS_IPV4_RESERVADOS.some(([octeto, minimo, maximo]) => primero === octeto && segundo >= minimo && segundo <= maximo);
  }

  static esIPv6Reservada(ip) {
    const grupos = ValidadorCobertura.expandirIPv6(ip);
    const [primero, segundo] = grupos;
    const restoEnCero = grupos.slice(0, 7).every((grupo) => grupo === 0);
    if (restoEnCero && (grupos[7] === 0 || grupos[7] === 1)) return true; // :: y ::1
    if ((primero & 0xfe00) === 0xfc00) return true; // fc00::/7 local única
    if ((primero & 0xffc0) === 0xfe80) return true; // fe80::/10 enlace local
    if ((primero & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return primero === 0x2001 && segundo === 0x0db8; // 2001:db8::/32 documentación
  }

  /**
   * R1 · Valida formato estricto de la IP y descarta rangos privados/reservados.
   * @returns {{ valida: true, ip: string, version: 4|6 } | { valida: false, motivo: string }}
   */
  validarIP(ip) {
    if (typeof ip !== 'string' || ip.trim() === '') {
      return { valida: false, motivo: 'No se recibió la IP del cliente' };
    }

    const ipLimpia = ip.trim();
    const ipParaMensaje = recortarTexto(ipLimpia, 45);

    if (ValidadorCobertura.esIPv4(ipLimpia)) {
      if (ValidadorCobertura.esIPv4Reservada(ipLimpia)) {
        return { valida: false, motivo: `La IP ${ipParaMensaje} es privada o reservada; no permite ubicar al cliente` };
      }
      return { valida: true, ip: ipLimpia, version: 4 };
    }

    if (ValidadorCobertura.esIPv6(ipLimpia)) {
      if (ValidadorCobertura.esIPv6Reservada(ipLimpia)) {
        return { valida: false, motivo: `La IP ${ipParaMensaje} es privada o reservada; no permite ubicar al cliente` };
      }
      return { valida: true, ip: ipLimpia.toLowerCase(), version: 6 };
    }

    return { valida: false, motivo: `"${ipParaMensaje}" no tiene un formato de IP válido` };
  }

  /**
   * Normaliza la respuesta de ip-api.com/json/{ip}.
   * @throws {ErrorIntegracion} si el servicio no respondió o respondió algo inesperado.
   * @throws {ErrorNegocio} si ip-api respondió pero no pudo ubicar la IP (status "fail").
   */
  procesarGeolocalizacion(respuesta) {
    if (!respuesta || typeof respuesta !== 'object') {
      throw new ErrorIntegracion('ip-api', 'respuesta vacía');
    }
    // Se decide por "status" (campo propio de ip-api) y no por "error": en el ítem
    // combinado por el nodo Merge, "error" puede venir de Open-Meteo.
    if (respuesta.status === 'fail') {
      throw new ErrorNegocio('IP_NO_GEOLOCALIZABLE', `ip-api no pudo ubicar la IP (${recortarTexto(respuesta.message ?? 'sin detalle', 60)})`);
    }
    if (respuesta.status !== 'success') {
      throw new ErrorIntegracion('ip-api', respuesta.error ? 'servicio no disponible' : 'respuesta con formato inesperado');
    }
    if (!REGEX_CODIGO_PAIS_GEO.test(String(respuesta.countryCode ?? ''))) {
      throw new ErrorIntegracion('ip-api', 'respuesta con formato inesperado');
    }

    return {
      ip: respuesta.query ?? null,
      pais: respuesta.country ?? respuesta.countryCode,
      codigoPais: respuesta.countryCode,
      region: respuesta.regionName ?? null,
      ciudad: respuesta.city ?? null,
      latitud: Number.isFinite(respuesta.lat) ? respuesta.lat : null,
      longitud: Number.isFinite(respuesta.lon) ? respuesta.lon : null,
      proveedor: respuesta.isp ?? null,
      proxy: respuesta.proxy === true,
      hosting: respuesta.hosting === true,
    };
  }

  /** R2 · Zona desde la que se acepta comprar según el país de la IP, o null si no hay cobertura. */
  determinarZona(codigoPais) {
    return this.zonas.find((zona) => zona.paises.includes(codigoPais)) ?? null;
  }

  /**
   * Señales que no rechazan por sí solas, pero que la IA debe ponderar (R4).
   * @returns {string[]}
   */
  detectarSenalesRiesgo(geolocalizacion, paisEnvio) {
    const senales = [];
    if (geolocalizacion.proxy) senales.push('La IP pertenece a un proxy o VPN');
    if (geolocalizacion.hosting) senales.push('La IP pertenece a un centro de datos u hosting');
    if (geolocalizacion.codigoPais !== paisEnvio) {
      senales.push(`La IP está en ${geolocalizacion.codigoPais} pero el envío es a ${paisEnvio}`);
    }
    // La geolocalización por IP no es precisa a nivel de cantón: se informa, no se rechaza
    const provinciasGAM = Object.keys(this.cantonesConEntrega).map(ValidadorCobertura.normalizar);
    const provinciaIP = ValidadorCobertura.normalizarProvincia(geolocalizacion.region);
    if (geolocalizacion.codigoPais === PAIS_ORIGEN && provinciaIP && !provinciasGAM.includes(provinciaIP)) {
      senales.push(`La IP se ubica en ${recortarTexto(geolocalizacion.region, 40)}, fuera de las provincias de la GAM`);
    }
    return senales;
  }
}
