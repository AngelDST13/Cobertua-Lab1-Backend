import { ACCIONES, CODIGOS_MOTIVO, ESTADOS } from '../config/reglasNegocio.js';
import { ErrorIntegracion, ErrorNegocio } from '../errores/errores.js';
import { crearPedido } from '../modelos/fabricaPedidos.js';
import { AnalizadorClima } from './AnalizadorClima.js';
import { AnalizadorRiesgoIA } from './AnalizadorRiesgoIA.js';
import { HistorialTendencia } from './HistorialTendencia.js';
import { NotificadorAlertas } from './NotificadorAlertas.js';
import { ValidadorCobertura } from './ValidadorCobertura.js';

const REGEX_ID_PEDIDO = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Orquesta las tres fases del flujo. Cada fase corresponde a un nodo Code de n8n:
 *
 *   Fase 1 · evaluarCobertura()   → nodo "Evaluar cobertura (POO)"
 *   Fase 2 · consolidarDecision() → nodo "Consolidar decisión (POO)"
 *   Fase 3 · cerrarEjecucion()    → nodo "Analizar tendencia (POO)"
 *
 * Recibe las respuestas crudas de JSON Server, ip-api, Open-Meteo y DeepSeek tal
 * como las entrega n8n, de modo que main.js, las pruebas y el workflow ejecutan
 * exactamente la misma lógica.
 */
export class GestorPedidos {
  constructor({
    validador = new ValidadorCobertura(),
    analizadorClima = new AnalizadorClima(),
    analizador = new AnalizadorRiesgoIA(),
    historial = new HistorialTendencia(),
    notificador = new NotificadorAlertas(),
    ahora = () => new Date().toISOString(),
  } = {}) {
    this.validador = validador;
    this.analizadorClima = analizadorClima;
    this.analizador = analizador;
    this.historial = historial;
    this.notificador = notificador;
    this.ahora = ahora;
  }

  /**
   * Fase 1: R5 (estado) → R1 (estructura e IP) → geolocalización → R2 (cobertura)
   * → clima → restricciones por tipo de pedido → R3 (envío polimórfico).
   *
   * @param {object} datos
   * @param {object} datos.entrada         Cuerpo del webhook: { pedidoId, ipCliente }.
   * @param {object} datos.respuestaPedido Respuesta completa de GET /pedidos/:id ({ statusCode, body } o { error }).
   * @param {object} datos.respuestaGeo    Respuesta de ip-api (o el ítem combinado por el Merge).
   * @param {object} [datos.respuestaClima] Respuesta de Open-Meteo (o el ítem combinado por el Merge).
   * @returns {object} Resultado con `accion` = evaluar_ia | actualizar | omitir.
   */
  evaluarCobertura({ entrada = {}, respuestaPedido, respuestaGeo, respuestaClima = null }) {
    const pedidoId = typeof entrada.pedidoId === 'string' || typeof entrada.pedidoId === 'number' ? String(entrada.pedidoId).trim() : '';
    if (!REGEX_ID_PEDIDO.test(pedidoId)) {
      return this._omitir(400, 'La solicitud debe incluir un "pedidoId" válido', null);
    }

    const consulta = this._interpretarConsultaPedido(respuestaPedido, pedidoId);
    if (consulta.error) {
      return this._omitir(consulta.error.httpStatus, consulta.error.mensaje, pedidoId);
    }

    // Reto 1 · La fábrica devuelve PedidoNacional o PedidoInternacional
    const pedido = crearPedido(consulta.registro);
    if (!pedido.puedeProcesarse()) {
      return this._omitir(409, `El pedido ${pedido.id} ya fue procesado (estado "${pedido.estado}")`, pedido.id);
    }

    // R1 · Estructura del pedido
    const estructura = pedido.validarEstructura();
    if (!estructura.valido) {
      return this._finalizar(pedido, ESTADOS.RECHAZADO, `Estructura inválida: ${estructura.errores.join('; ')}`, CODIGOS_MOTIVO.ESTRUCTURA_INVALIDA);
    }

    // R1 · Formato estricto de IP pública
    const validacionIP = this.validador.validarIP(entrada.ipCliente);
    if (!validacionIP.valida) {
      return this._finalizar(pedido, ESTADOS.RECHAZADO, validacionIP.motivo, CODIGOS_MOTIVO.IP_INVALIDA);
    }
    pedido.ipCliente = validacionIP.ip;

    // Geolocalización: falla del servicio → revisión manual; IP no ubicable → rechazo
    let geolocalizacion;
    try {
      geolocalizacion = this.validador.procesarGeolocalizacion(respuestaGeo);
    } catch (error) {
      if (error instanceof ErrorIntegracion) {
        return this._finalizar(
          pedido,
          ESTADOS.EN_REVISION,
          `No se pudo verificar la ubicación (${error.message}); requiere revisión manual`,
          CODIGOS_MOTIVO.SERVICIO_NO_DISPONIBLE,
        );
      }
      if (error instanceof ErrorNegocio) {
        return this._finalizar(pedido, ESTADOS.RECHAZADO, error.message, CODIGOS_MOTIVO.IP_NO_GEOLOCALIZABLE);
      }
      throw error;
    }
    pedido.geolocalizacion = geolocalizacion;

    // R2 · Cobertura: la compra debe hacerse desde Costa Rica y la entrega ser en un cantón de la GAM
    const zonaIP = this.validador.determinarZona(geolocalizacion.codigoPais);
    if (!zonaIP) {
      return this._finalizar(
        pedido,
        ESTADOS.RECHAZADO,
        `Sin cobertura: la IP del cliente está en ${geolocalizacion.pais} (${geolocalizacion.codigoPais}); solo atendemos compras desde Costa Rica`,
        CODIGOS_MOTIVO.SIN_COBERTURA,
      );
    }
    const destino = this.validador.evaluarDestino(pedido.direccionEnvio);
    if (!destino.cubierto) {
      return this._finalizar(pedido, ESTADOS.RECHAZADO, destino.motivo, CODIGOS_MOTIVO.SIN_COBERTURA);
    }
    const zonaEnvio = destino.zona;

    // Reto 2 · Clima (segunda fuente externa): solo ajusta tarifas, nunca bloquea
    const clima = this.analizadorClima.interpretar(respuestaClima);
    pedido.clima = clima;

    // Reto 1 · Restricciones propias del tipo de pedido — polimórfico
    const restricciones = pedido.validarRestricciones();
    if (restricciones.length > 0) {
      return this._finalizar(
        pedido,
        ESTADOS.RECHAZADO,
        `Restricción de envío ${pedido.tipo}: ${restricciones.join('; ')}`,
        CODIGOS_MOTIVO.RESTRICCION_INTERNACIONAL,
      );
    }

    // R3 · Costo de envío dinámico — polimórfico según el tipo de pedido
    try {
      pedido.calcularCostoEnvio(zonaEnvio, clima);
    } catch (error) {
      if (error instanceof ErrorNegocio) {
        return this._finalizar(pedido, ESTADOS.RECHAZADO, error.message, CODIGOS_MOTIVO.PESO_EXCEDIDO);
      }
      throw error;
    }

    const senalesRiesgo = this.validador.detectarSenalesRiesgo(geolocalizacion, pedido.direccionEnvio.pais);

    return {
      accion: ACCIONES.EVALUAR_IA,
      httpStatus: 200,
      mensaje: 'Cobertura verificada; pendiente de análisis de riesgo',
      pedidoId: pedido.id,
      pedido: pedido.toJSON(),
      evaluacion: {
        tipoPedido: pedido.tipo,
        zonaIP: zonaIP.codigo,
        zonaEnvio: zonaEnvio.codigo,
        cantonEntrega: `${destino.canton}, ${destino.provincia}`,
        diasEntrega: zonaEnvio.diasEntrega,
        costoEnvio: pedido.costoEnvio,
        clima,
        senalesRiesgo,
      },
      solicitudIA: this.analizador.construirSolicitud(pedido, { zonaEnvio, geolocalizacion, senalesRiesgo, clima }),
      actualizacion: null,
      registroHistorial: null,
    };
  }

  /**
   * Fase 2: R4 (análisis de DeepSeek) → decisión final.
   *
   * @param {object} datos
   * @param {object} datos.resultadoCobertura Salida de evaluarCobertura() con accion = evaluar_ia.
   * @param {object} datos.respuestaIA        Respuesta de DeepSeek ({ choices } o { error }).
   */
  consolidarDecision({ resultadoCobertura, respuestaIA }) {
    if (resultadoCobertura?.accion !== ACCIONES.EVALUAR_IA) {
      throw new ErrorNegocio('FASE_INVALIDA', 'consolidarDecision solo aplica a pedidos con cobertura verificada');
    }

    const pedido = crearPedido(resultadoCobertura.pedido);

    let analisis;
    try {
      analisis = this.analizador.interpretarRespuesta(respuestaIA);
    } catch (error) {
      if (error instanceof ErrorIntegracion) {
        return this._finalizar(
          pedido,
          ESTADOS.EN_REVISION,
          `Análisis de riesgo no disponible (${error.message}); requiere revisión manual`,
          CODIGOS_MOTIVO.SERVICIO_NO_DISPONIBLE,
        );
      }
      throw error;
    }

    pedido.analisisIA = analisis;
    const decision = this.analizador.decidir(analisis);
    return decision.aprobar
      ? this._finalizar(pedido, ESTADOS.APROBADO, decision.motivo, CODIGOS_MOTIVO.APROBADO)
      : this._finalizar(pedido, ESTADOS.RECHAZADO, decision.motivo, CODIGOS_MOTIVO.RIESGO_IA);
  }

  /**
   * Fase 3 (Retos 3 y 4): con el pedido ya guardado y el historial de ejecuciones,
   * analiza la tendencia, decide si notificar y arma la respuesta del webhook.
   *
   * @param {object} datos
   * @param {object} datos.decision          Salida de la fase 1 o 2 con accion = actualizar.
   * @param {object} datos.respuestaGuardado Respuesta del PATCH a JSON Server (pedido o { error }).
   * @param {object[]} datos.historial       Ítems del GET /ejecuciones.
   */
  cerrarEjecucion({ decision, respuestaGuardado, historial = [] }) {
    if (decision?.accion !== ACCIONES.ACTUALIZAR) {
      throw new ErrorNegocio('FASE_INVALIDA', 'cerrarEjecucion solo aplica a pedidos con decisión tomada');
    }

    const guardado = Boolean(respuestaGuardado && !respuestaGuardado.error && respuestaGuardado.id === decision.pedidoId);
    const pedido = guardado ? respuestaGuardado : decision.pedido;
    const tendencia = this.historial.analizar(historial);
    const notificacion = this.notificador.evaluar(pedido, tendencia);

    return {
      httpStatus: guardado ? 200 : 502,
      respuesta: {
        ok: guardado,
        mensaje: guardado ? pedido.motivo : 'El pedido fue evaluado pero no se pudo guardar en JSON Server',
        pedidoId: pedido.id,
        tipoPedido: pedido.tipo,
        estado: pedido.estado,
        codigoMotivo: pedido.codigoMotivo,
        motivo: pedido.motivo,
        zonaEnvio: pedido.zonaEnvio,
        subtotal: pedido.subtotal,
        costoEnvio: pedido.costoEnvio,
        total: pedido.total,
        geolocalizacion: pedido.geolocalizacion,
        clima: pedido.clima,
        analisisIA: pedido.analisisIA,
        mensajeCliente: pedido.analisisIA?.mensajeCliente ?? null,
        tendencia,
        notificacion: { programada: notificacion.debeNotificar, nivel: notificacion.nivel, asunto: notificacion.asunto },
      },
      notificacion,
    };
  }

  /** Interpreta la respuesta completa (fullResponse) del GET a JSON Server. */
  _interpretarConsultaPedido(respuesta, pedidoId) {
    if (!respuesta || respuesta.error) {
      return { error: { httpStatus: 503, mensaje: 'JSON Server no está disponible; inténtalo más tarde' } };
    }
    if (respuesta.statusCode === 404) {
      return { error: { httpStatus: 404, mensaje: `El pedido ${pedidoId} no existe` } };
    }
    if (respuesta.statusCode < 200 || respuesta.statusCode >= 300) {
      return { error: { httpStatus: 502, mensaje: `JSON Server respondió con estado ${respuesta.statusCode}` } };
    }
    if (String(respuesta.body?.id) !== pedidoId) {
      return { error: { httpStatus: 502, mensaje: 'JSON Server devolvió un registro que no corresponde al pedido solicitado' } };
    }
    return { registro: respuesta.body };
  }

  /** Aplica el estado final y arma el resultado que n8n enviará en el PATCH y al historial. */
  _finalizar(pedido, estado, motivo, codigoMotivo) {
    const fecha = this.ahora();
    if (estado === ESTADOS.APROBADO) pedido.aprobar(motivo, fecha, codigoMotivo);
    else if (estado === ESTADOS.RECHAZADO) pedido.rechazar(motivo, fecha, codigoMotivo);
    else pedido.marcarEnRevision(motivo, fecha, codigoMotivo);

    const pedidoJSON = pedido.toJSON();
    return {
      accion: ACCIONES.ACTUALIZAR,
      httpStatus: 200,
      mensaje: motivo,
      pedidoId: pedido.id,
      pedido: pedidoJSON,
      evaluacion: null,
      solicitudIA: null,
      actualizacion: pedido.aActualizacion(),
      registroHistorial: HistorialTendencia.crearRegistro(pedidoJSON, fecha),
    };
  }

  /** El pedido no se modifica; n8n solo responde al webhook. */
  _omitir(httpStatus, mensaje, pedidoId) {
    return {
      accion: ACCIONES.OMITIR,
      httpStatus,
      mensaje,
      pedidoId,
      pedido: null,
      evaluacion: null,
      solicitudIA: null,
      actualizacion: null,
      registroHistorial: null,
    };
  }
}
