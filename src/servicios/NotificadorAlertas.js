import { NOTIFICACIONES } from '../config/reglasNegocio.js';
import { describirDestino, escaparHtml } from '../utils/utilidades.js';

/**
 * Reto 3 · Decide si una decisión merece un correo al equipo y arma su contenido.
 *
 * El nodo "Send Email" de n8n solo envía lo que esta clase produce, así el
 * criterio de alerta y el formato quedan en código probado y no en expresiones.
 */
export class NotificadorAlertas {
  constructor(reglas = NOTIFICACIONES) {
    this.reglas = reglas;
  }

  /**
   * @param {object} pedido Pedido ya decidido (toJSON() o registro guardado).
   * @param {object} tendencia Resultado de HistorialTendencia.analizar().
   * @returns {{ debeNotificar: boolean, nivel: string|null, asunto: string|null, html: string|null }}
   */
  evaluar(pedido, tendencia) {
    const nivel = this.reglas[pedido?.codigoMotivo] ?? null;
    if (!nivel) return { debeNotificar: false, nivel: null, asunto: null, html: null };

    const etiqueta = nivel === 'critico' ? 'CRÍTICO' : 'Advertencia';
    return {
      debeNotificar: true,
      nivel,
      asunto: `[${etiqueta}] Pedido ${pedido.id} ${pedido.estado} · ${pedido.codigoMotivo}`,
      html: this._construirHtml(pedido, tendencia, etiqueta),
    };
  }

  _construirHtml(pedido, tendencia, etiqueta) {
    const fila = (campo, valor) =>
      `<tr><td style="padding:6px 12px;color:#555;white-space:nowrap">${escaparHtml(campo)}</td><td style="padding:6px 12px"><strong>${escaparHtml(valor ?? '—')}</strong></td></tr>`;
    const geo = pedido.geolocalizacion ?? {};
    const clima = pedido.clima ?? {};
    const ia = pedido.analisisIA;

    const bloqueIA = ia
      ? `<h3 style="margin:20px 0 8px">Análisis de DeepSeek</h3><table style="border-collapse:collapse">` +
        fila('Viable', ia.viable ? 'Sí' : 'No') +
        fila('Riesgo', `${ia.riesgo} (puntaje ${ia.puntaje}/100)`) +
        fila('Motivos', ia.motivos.join(' · ')) +
        fila('Mensaje sugerido al cliente', ia.mensajeCliente) +
        `</table>`
      : `<p style="color:#555">DeepSeek no fue consultado: el pedido se resolvió antes por las reglas de negocio (no se gasta una consulta de IA en pedidos sin cobertura) o el servicio no respondió.</p>`;

    return (
      `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2328">` +
      `<h2 style="margin:0 0 4px">${escaparHtml(etiqueta)} · Pedido ${escaparHtml(pedido.id)}</h2>` +
      `<p style="margin:0 0 16px;color:#555">${escaparHtml(pedido.motivo)}</p>` +
      `<table style="border-collapse:collapse">` +
      fila('Estado', pedido.estado) +
      fila('Tipo', pedido.tipo) +
      fila('Cliente', pedido.cliente?.nombre) +
      fila('Destino', describirDestino(pedido.direccionEnvio)) +
      fila('Ubicación de la IP', geo.pais ? `${geo.ciudad ?? ''}, ${geo.pais} (${geo.codigoPais})${geo.proxy ? ' · proxy/VPN' : ''}${geo.hosting ? ' · hosting' : ''}` : pedido.ipCliente) +
      fila('Clima', clima.disponible ? `${clima.descripcion}, ${clima.temperaturaC} °C${clima.severo ? ' · SEVERO' : ''}` : 'No disponible') +
      fila('Envío / total', pedido.costoEnvio === null ? 'No calculado' : `$${pedido.costoEnvio} / $${pedido.total}`) +
      `</table>` +
      bloqueIA +
      `<h3 style="margin:20px 0 8px">Tendencia</h3><p>${escaparHtml(tendencia?.conclusion ?? 'Sin datos')}</p>` +
      `<p style="color:#888;font-size:12px">Generado automáticamente por el flujo n8n "[Laboratorio1] pedidos - verificar cobertura geográfica".</p>` +
      `</div>`
    );
  }
}
