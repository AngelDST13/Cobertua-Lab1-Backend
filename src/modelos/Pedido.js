import { ESTADOS, ESTADOS_PROCESABLES, LIMITES_PEDIDO, TRANSICIONES_PERMITIDAS } from '../config/reglasNegocio.js';
import { ErrorNegocio } from '../errores/errores.js';
import { esTextoNoVacio, redondearMoneda } from '../utils/utilidades.js';

const REGEX_EMAIL_PEDIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_CODIGO_PAIS_PEDIDO = /^[A-Z]{2}$/;

/**
 * Pedido de la tienda en línea (clase base de la jerarquía, Reto 1).
 *
 * Encapsula los datos del registro de JSON Server y las reglas que dependen
 * solo del pedido: estructura (R1), costo de envío (R3) y estados (R5).
 * PedidoNacional y PedidoInternacional sobrescriben calcularCostoEnvio() y
 * validarRestricciones(); el resto del sistema los usa sin saber cuál es cuál.
 */
export class Pedido {
  constructor({
    id,
    cliente = {},
    direccionEnvio = {},
    items = [],
    estado = ESTADOS.PENDIENTE,
    ipCliente = null,
    geolocalizacion = null,
    zonaEnvio = null,
    costoEnvio = null,
    motivo = null,
    codigoMotivo = null,
    clima = null,
    analisisIA = null,
    fechaEvaluacion = null,
    historial = [],
    creadoEn = null,
  } = {}) {
    this.id = id === undefined || id === null ? null : String(id);
    this.cliente = { ...cliente };
    this.direccionEnvio = { ...direccionEnvio };
    this.items = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
    this.estado = estado;
    this.ipCliente = ipCliente;
    this.geolocalizacion = geolocalizacion;
    this.zonaEnvio = zonaEnvio;
    this.costoEnvio = costoEnvio;
    this.motivo = motivo;
    this.codigoMotivo = codigoMotivo;
    this.clima = clima;
    this.analisisIA = analisisIA;
    this.fechaEvaluacion = fechaEvaluacion;
    this.historial = Array.isArray(historial) ? [...historial] : [];
    this.creadoEn = creadoEn;
  }

  /** Crea un Pedido a partir del registro devuelto por JSON Server (o de toJSON()). */
  static desdeRegistro(registro) {
    if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
      throw new ErrorNegocio('REGISTRO_INVALIDO', 'El registro del pedido no es un objeto válido');
    }
    return new Pedido(registro);
  }

  /** Tipo de pedido; las subclases lo redefinen. */
  get tipo() {
    return 'generico';
  }

  /** Suma de precio × cantidad de todos los artículos. */
  get subtotal() {
    const suma = this.items.reduce((acumulado, item) => acumulado + Number(item.precioUnitario) * Number(item.cantidad), 0);
    return redondearMoneda(suma);
  }

  /** Peso total del envío en kg. */
  get pesoTotalKg() {
    const suma = this.items.reduce((acumulado, item) => acumulado + Number(item.pesoKg) * Number(item.cantidad), 0);
    return redondearMoneda(suma);
  }

  /** Subtotal + envío; null mientras no se haya calculado el envío. */
  get total() {
    return this.costoEnvio === null ? null : redondearMoneda(this.subtotal + this.costoEnvio);
  }

  /**
   * R1 · Verifica que el pedido tenga todos los datos necesarios para despacharlo.
   * No lanza excepción: devuelve todos los errores juntos para registrarlos de una vez.
   * @returns {{ valido: boolean, errores: string[] }}
   */
  validarEstructura() {
    const errores = [];

    if (!this.id) errores.push('El pedido no tiene identificador');
    if (!esTextoNoVacio(this.cliente.nombre)) errores.push('Falta el nombre del cliente');
    if (!REGEX_EMAIL_PEDIDO.test(String(this.cliente.email ?? ''))) errores.push('El correo del cliente no es válido');
    if (!REGEX_CODIGO_PAIS_PEDIDO.test(String(this.direccionEnvio.pais ?? ''))) {
      errores.push('El país de envío debe ser un código ISO de 2 letras en mayúscula');
    }
    if (!esTextoNoVacio(this.direccionEnvio.ciudad)) errores.push('Falta la ciudad de envío');
    if (!esTextoNoVacio(this.direccionEnvio.detalle)) errores.push('Falta el detalle de la dirección de envío');

    if (this.items.length === 0) errores.push('El pedido no tiene artículos');
    if (this.items.length > LIMITES_PEDIDO.maxItems) {
      errores.push(`El pedido supera el máximo de ${LIMITES_PEDIDO.maxItems} artículos distintos`);
    }

    this.items.forEach((item, indice) => {
      const etiqueta = `Artículo ${indice + 1}`;
      if (!esTextoNoVacio(item.sku)) errores.push(`${etiqueta}: falta el SKU`);
      if (!Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > LIMITES_PEDIDO.maxCantidadPorItem) {
        errores.push(`${etiqueta}: la cantidad debe ser un entero entre 1 y ${LIMITES_PEDIDO.maxCantidadPorItem}`);
      }
      if (!Number.isFinite(item.precioUnitario) || item.precioUnitario <= 0) {
        errores.push(`${etiqueta}: el precio unitario debe ser mayor que 0`);
      }
      if (!Number.isFinite(item.pesoKg) || item.pesoKg < 0) {
        errores.push(`${etiqueta}: el peso debe ser un número mayor o igual a 0`);
      }
    });

    return { valido: errores.length === 0, errores };
  }

  /**
   * R3 · Tarifa base común a todos los pedidos; las subclases la amplían.
   * Fórmula: tarifaBase + kg facturables (redondeados hacia arriba) × tarifaPorKg,
   * o 0 si el subtotal alcanza el umbral de envío gratis de la zona.
   * @param {object} zona Una de ZONAS_COBERTURA.
   * @param {object|null} [clima] Resultado de AnalizadorClima (la base lo ignora).
   * @returns {number} Costo de envío en USD.
   * @throws {ErrorNegocio} PESO_EXCEDIDO si el pedido supera el peso máximo de la zona.
   */
  calcularCostoEnvio(zona, clima = null) {
    if (!zona || !Number.isFinite(zona.tarifaBase) || !Number.isFinite(zona.tarifaPorKg)) {
      throw new ErrorNegocio('ZONA_INVALIDA', 'La zona de envío no tiene tarifas configuradas');
    }

    const peso = this.pesoTotalKg;
    if (peso > zona.pesoMaximoKg) {
      throw new ErrorNegocio(
        'PESO_EXCEDIDO',
        `El peso del pedido (${peso} kg) supera el máximo de ${zona.pesoMaximoKg} kg para envíos a ${zona.nombre}`,
      );
    }

    const aplicaEnvioGratis = zona.envioGratisDesde !== null && this.subtotal >= zona.envioGratisDesde;
    const kgFacturables = Math.ceil(peso);
    const costo = aplicaEnvioGratis ? 0 : redondearMoneda(zona.tarifaBase + kgFacturables * zona.tarifaPorKg);

    this.costoEnvio = costo;
    this.zonaEnvio = zona.codigo;
    return costo;
  }

  /**
   * Reto 1 · Restricciones propias del tipo de pedido (polimórfico).
   * La base no tiene restricciones adicionales.
   * @returns {string[]} Lista de incumplimientos (vacía si cumple).
   */
  validarRestricciones() {
    return [];
  }

  /** R5 · Solo los pedidos pendientes o en revisión entran al flujo. */
  puedeProcesarse() {
    return ESTADOS_PROCESABLES.includes(this.estado);
  }

  aprobar(motivo, fecha, codigoMotivo = null) {
    if (this.costoEnvio === null) {
      throw new ErrorNegocio('SIN_COSTO_ENVIO', 'No se puede aprobar un pedido sin costo de envío calculado');
    }
    this._cambiarEstado(ESTADOS.APROBADO, motivo, fecha, codigoMotivo);
  }

  rechazar(motivo, fecha, codigoMotivo = null) {
    this._cambiarEstado(ESTADOS.RECHAZADO, motivo, fecha, codigoMotivo);
  }

  marcarEnRevision(motivo, fecha, codigoMotivo = null) {
    this._cambiarEstado(ESTADOS.EN_REVISION, motivo, fecha, codigoMotivo);
  }

  /** R5 · Aplica una transición permitida y la deja en el historial. */
  _cambiarEstado(nuevoEstado, motivo, fecha, codigoMotivo) {
    const permitidos = TRANSICIONES_PERMITIDAS[this.estado] ?? [];
    if (!permitidos.includes(nuevoEstado)) {
      throw new ErrorNegocio('TRANSICION_INVALIDA', `No se puede pasar de "${this.estado}" a "${nuevoEstado}"`);
    }
    this.historial = [...this.historial, { de: this.estado, a: nuevoEstado, motivo, fecha }];
    this.estado = nuevoEstado;
    this.motivo = motivo;
    this.codigoMotivo = codigoMotivo;
    this.fechaEvaluacion = fecha;
  }

  /** Campos que el flujo actualiza en JSON Server (cuerpo del PATCH). */
  aActualizacion() {
    return {
      tipo: this.tipo,
      estado: this.estado,
      motivo: this.motivo,
      codigoMotivo: this.codigoMotivo,
      ipCliente: this.ipCliente,
      geolocalizacion: this.geolocalizacion,
      clima: this.clima,
      zonaEnvio: this.zonaEnvio,
      costoEnvio: this.costoEnvio,
      subtotal: this.subtotal,
      total: this.total,
      analisisIA: this.analisisIA,
      fechaEvaluacion: this.fechaEvaluacion,
      historial: this.historial,
    };
  }

  /** Representación completa, apta para pasar entre nodos de n8n y reconstruir con desdeRegistro(). */
  toJSON() {
    return {
      id: this.id,
      cliente: this.cliente,
      direccionEnvio: this.direccionEnvio,
      items: this.items,
      creadoEn: this.creadoEn,
      ...this.aActualizacion(),
    };
  }
}
