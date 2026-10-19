import { CODIGOS_MOTIVO, CONFIG_TENDENCIA, ESTADOS } from '../config/reglasNegocio.js';
import { redondearMoneda } from '../utils/utilidades.js';

/**
 * Reto 4 · Historial de ejecuciones y análisis de tendencia.
 *
 * Cada decisión se guarda en la colección "ejecuciones" de JSON Server.
 * analizar() compara el bloque más reciente con el anterior y concluye si la
 * tasa de rechazo y la de pedidos sin cobertura mejoran o empeoran.
 */
export class HistorialTendencia {
  constructor(config = CONFIG_TENDENCIA) {
    this.config = config;
  }

  /** Registro compacto (sin datos personales) para la colección "ejecuciones". */
  static crearRegistro(pedido, fecha) {
    return {
      pedidoId: pedido.id,
      tipoPedido: pedido.tipo ?? null,
      estado: pedido.estado,
      codigoMotivo: pedido.codigoMotivo ?? null,
      zonaEnvio: pedido.zonaEnvio ?? null,
      paisIP: pedido.geolocalizacion?.codigoPais ?? null,
      riesgoIA: pedido.analisisIA?.riesgo ?? null,
      total: pedido.total ?? null,
      fecha,
    };
  }

  static calcularTasas(registros) {
    const total = registros.length;
    if (total === 0) return { total: 0, rechazo: 0, sinCobertura: 0, aprobacion: 0 };
    const contar = (condicion) => registros.filter(condicion).length;
    return {
      total,
      rechazo: redondearMoneda(contar((r) => r.estado === ESTADOS.RECHAZADO) / total),
      sinCobertura: redondearMoneda(contar((r) => r.codigoMotivo === CODIGOS_MOTIVO.SIN_COBERTURA) / total),
      aprobacion: redondearMoneda(contar((r) => r.estado === ESTADOS.APROBADO) / total),
    };
  }

  /** "mejorando" si la tasa bajó más que el umbral, "empeorando" si subió, "estable" si no. */
  _clasificar(reciente, anterior) {
    const cambio = reciente - anterior;
    if (cambio > this.config.umbralCambio) return 'empeorando';
    if (cambio < -this.config.umbralCambio) return 'mejorando';
    return 'estable';
  }

  /**
   * @param {object[]} registros Ejecuciones de JSON Server (cualquier orden).
   * @returns {object} Tendencias, tasas por bloque y una conclusión legible.
   */
  analizar(registros) {
    const validos = (Array.isArray(registros) ? registros : [])
      .filter((registro) => registro && typeof registro.estado === 'string' && typeof registro.fecha === 'string')
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, this.config.ventana * 2);

    const mitad = Math.ceil(validos.length / 2);
    const recientes = validos.slice(0, mitad);
    const anteriores = validos.slice(mitad);
    const tasasRecientes = HistorialTendencia.calcularTasas(recientes);
    const tasasAnteriores = HistorialTendencia.calcularTasas(anteriores);
    const porcentaje = (valor) => `${Math.round(valor * 100)} %`;

    if (recientes.length < this.config.minimoPorBloque || anteriores.length < this.config.minimoPorBloque) {
      return {
        tendenciaRechazo: 'datos_insuficientes',
        tendenciaCobertura: 'datos_insuficientes',
        recientes: tasasRecientes,
        anteriores: tasasAnteriores,
        conclusion: `Hay ${validos.length} ejecuciones; se necesitan al menos ${this.config.minimoPorBloque * 2} para evaluar la tendencia.`,
      };
    }

    const tendenciaRechazo = this._clasificar(tasasRecientes.rechazo, tasasAnteriores.rechazo);
    const tendenciaCobertura = this._clasificar(tasasRecientes.sinCobertura, tasasAnteriores.sinCobertura);
    const frase = { mejorando: 'está mejorando', empeorando: 'está empeorando', estable: 'se mantiene estable' };

    return {
      tendenciaRechazo,
      tendenciaCobertura,
      recientes: tasasRecientes,
      anteriores: tasasAnteriores,
      conclusion:
        `La tasa de rechazo ${frase[tendenciaRechazo]} (${porcentaje(tasasAnteriores.rechazo)} → ${porcentaje(tasasRecientes.rechazo)}) ` +
        `y la de pedidos sin cobertura ${frase[tendenciaCobertura]} (${porcentaje(tasasAnteriores.sinCobertura)} → ${porcentaje(tasasRecientes.sinCobertura)}), ` +
        `comparando las últimas ${recientes.length} ejecuciones con las ${anteriores.length} anteriores.`,
    };
  }
}
