import { CARGOS_ENVIO, RESTRICCIONES_INTERNACIONALES, TIPOS_PEDIDO } from '../config/reglasNegocio.js';
import { redondearMoneda } from '../utils/utilidades.js';
import { Pedido } from './Pedido.js';

/**
 * Pedido con destino fuera de Costa Rica (Reto 1 · herencia).
 *
 * Polimorfismo:
 *  - calcularCostoEnvio(): tarifa base + seguro obligatorio sobre el valor
 *    declarado + recargo PORCENTUAL si el clima es severo (vuelo/aduana demorados).
 *  - validarRestricciones(): límites de unidades por SKU y de valor declarado,
 *    típicos de aduana y para frenar la reventa.
 */
export class PedidoInternacional extends Pedido {
  get tipo() {
    return TIPOS_PEDIDO.INTERNACIONAL;
  }

  /** Seguro de transporte internacional: % del valor declarado con un mínimo. */
  get seguroInternacional() {
    const porcentaje = this.subtotal * CARGOS_ENVIO.seguroInternacionalPorcentaje;
    return redondearMoneda(Math.max(CARGOS_ENVIO.seguroInternacionalMinimo, porcentaje));
  }

  calcularCostoEnvio(zona, clima = null) {
    const costoBase = super.calcularCostoEnvio(zona);
    const recargoClima = clima?.severo === true ? costoBase * CARGOS_ENVIO.recargoClimaInternacionalPorcentaje : 0;
    const costo = redondearMoneda(costoBase + recargoClima + this.seguroInternacional);

    this.costoEnvio = costo;
    return costo;
  }

  validarRestricciones() {
    const incumplimientos = [];
    const { maxUnidadesPorSku, maxValorDeclarado } = RESTRICCIONES_INTERNACIONALES;

    const unidadesPorSku = new Map();
    for (const item of this.items) {
      unidadesPorSku.set(item.sku, (unidadesPorSku.get(item.sku) ?? 0) + item.cantidad);
    }
    for (const [sku, unidades] of unidadesPorSku) {
      if (unidades > maxUnidadesPorSku) {
        incumplimientos.push(`${unidades} unidades de ${sku} superan el máximo internacional de ${maxUnidadesPorSku} por artículo`);
      }
    }

    if (this.subtotal > maxValorDeclarado) {
      incumplimientos.push(`El valor declarado ($${this.subtotal}) supera el máximo internacional de $${maxValorDeclarado}`);
    }
    return incumplimientos;
  }
}
