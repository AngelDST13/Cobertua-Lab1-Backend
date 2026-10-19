import { UMBRALES_CLIMA } from '../config/reglasNegocio.js';

/** Descripción en español de los códigos WMO que devuelve Open-Meteo. */
const DESCRIPCIONES_CLIMA = [
  [[0], 'Despejado'],
  [[1, 2, 3], 'Parcialmente nublado'],
  [[45, 48], 'Niebla'],
  [[51, 53, 55, 56, 57], 'Llovizna'],
  [[61, 63], 'Lluvia'],
  [[65, 66, 67], 'Lluvia intensa'],
  [[71, 73, 77], 'Nieve'],
  [[75], 'Nevada intensa'],
  [[80, 81], 'Chubascos'],
  [[82], 'Chubascos violentos'],
  [[85, 86], 'Chubascos de nieve'],
  [[95, 96, 99], 'Tormenta eléctrica'],
];

/**
 * Reto 2 · Interpreta la segunda fuente externa (Open-Meteo).
 *
 * El clima es información complementaria: si el servicio falla, el pedido
 * sigue su curso sin recargo (no se bloquea una venta por no saber el clima).
 */
export class AnalizadorClima {
  constructor(umbrales = UMBRALES_CLIMA) {
    this.umbrales = umbrales;
  }

  static describir(codigo) {
    const entrada = DESCRIPCIONES_CLIMA.find(([codigos]) => codigos.includes(codigo));
    return entrada ? entrada[1] : 'Condición desconocida';
  }

  /**
   * @param {object} respuesta Salida de api.open-meteo.com/v1/forecast?current=... (o el ítem combinado por el Merge).
   * @returns {{ disponible: boolean, severo: boolean, descripcion: string, motivos: string[],
   *            temperaturaC?: number, precipitacionMm?: number, vientoKmH?: number, codigo?: number, hora?: string }}
   */
  interpretar(respuesta) {
    const actual = respuesta?.current;
    if (!actual || typeof actual !== 'object' || !Number.isFinite(actual.weather_code)) {
      return { disponible: false, severo: false, descripcion: 'Clima no disponible', motivos: [] };
    }

    const motivos = [];
    if (this.umbrales.codigosSeveros.includes(actual.weather_code)) motivos.push(AnalizadorClima.describir(actual.weather_code));
    if (actual.wind_speed_10m >= this.umbrales.vientoMaximoKmH) motivos.push(`Viento de ${actual.wind_speed_10m} km/h`);
    if (actual.precipitation >= this.umbrales.precipitacionMaximaMm) motivos.push(`Precipitación de ${actual.precipitation} mm`);

    return {
      disponible: true,
      severo: motivos.length > 0,
      descripcion: AnalizadorClima.describir(actual.weather_code),
      motivos,
      temperaturaC: actual.temperature_2m ?? null,
      precipitacionMm: actual.precipitation ?? null,
      vientoKmH: actual.wind_speed_10m ?? null,
      codigo: actual.weather_code,
      hora: actual.time ?? null,
    };
  }
}
