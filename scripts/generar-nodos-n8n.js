/**
 * Genera el código de los nodos Code de n8n a partir de las clases de src/
 * y escribe el workflow importable (un solo flujo).
 *
 *   npm run build:n8n
 *
 * Por qué: n8n no puede importar módulos locales en un nodo Code. En lugar de
 * copiar las clases a mano (y que se desincronicen), este script concatena los
 * archivos de src/ en orden de dependencias, quita import/export y añade el
 * adaptador de cada nodo. La prueba tests/nodosN8n.test.js falla si el JSON
 * versionado no coincide con lo que este script produce.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ADAPTADOR_ANALIZAR_TENDENCIA, ADAPTADOR_CONSOLIDAR_DECISION, ADAPTADOR_EVALUAR_COBERTURA } from '../n8n/adaptadores.js';
import { construirWorkflowPrincipal } from '../n8n/definicionWorkflow.js';
import { ALIAS_CANTONES, CANTONES_COSTA_RICA, CANTONES_GAM, ZONAS_COBERTURA } from '../src/config/reglasNegocio.js';

const RAIZ = new URL('../', import.meta.url);

/** Orden de dependencias: cada archivo solo usa lo declarado en los anteriores. */
export const ARCHIVOS_LIBRERIA = [
  'src/config/reglasNegocio.js',
  'src/utils/utilidades.js',
  'src/errores/errores.js',
  'src/modelos/Pedido.js',
  'src/modelos/PedidoNacional.js',
  'src/modelos/PedidoInternacional.js',
  'src/modelos/fabricaPedidos.js',
  'src/servicios/ValidadorCobertura.js',
  'src/servicios/AnalizadorClima.js',
  'src/servicios/AnalizadorRiesgoIA.js',
  'src/servicios/HistorialTendencia.js',
  'src/servicios/NotificadorAlertas.js',
  'src/servicios/GestorPedidos.js',
];

export const SALIDAS = {
  codigoEvaluar: 'n8n/codigo-generado/evaluar-cobertura.js',
  codigoConsolidar: 'n8n/codigo-generado/consolidar-decision.js',
  codigoTendencia: 'n8n/codigo-generado/analizar-tendencia.js',
  workflowPrincipal: 'n8n/workflow-pedidos-cobertura.json',
  coberturaPanel: 'public/cobertura.js',
};

const leer = (rutaRelativa) => readFileSync(new URL(rutaRelativa, RAIZ), 'utf8').replace(/\r\n/g, '\n');

/** Convierte un módulo ES en código plano apto para el sandbox de n8n. */
const aCodigoPlano = (codigo, archivo) => {
  const plano = codigo
    .split('\n')
    .filter((linea) => !/^import\s/.test(linea))
    .map((linea) => linea.replace(/^export\s+(?=(class|const|function)\b)/, ''))
    .join('\n')
    .trim();

  if (/^\s*(import|export)\b/m.test(plano)) {
    throw new Error(`${archivo}: quedan import/export que el generador no sabe transformar (usa imports de una sola línea y "export class|const|function").`);
  }
  return `// ── ${archivo} ──\n${plano}`;
};

const ENCABEZADO = (nodo) => `// ╔════════════════════════════════════════════════════════════════════╗
// ║ Nodo Code n8n: "${nodo}"
// ║ ARCHIVO GENERADO por scripts/generar-nodos-n8n.js — NO EDITAR AQUÍ.
// ║ Fuente: src/ (mismas clases que main.js y las pruebas).
// ╚════════════════════════════════════════════════════════════════════╝`;

/** Construye el código completo de un nodo Code: librería + adaptador. */
export const construirCodigoNodo = (nombreNodo, adaptador) => {
  const libreria = ARCHIVOS_LIBRERIA.map((archivo) => aCodigoPlano(leer(archivo), archivo)).join('\n\n');
  return `${ENCABEZADO(nombreNodo)}\n\n${libreria}\n\n// ── Adaptador n8n ──\n${adaptador}\n`;
};

/** El panel web (public/) no puede importar src/: recibe una copia generada de las reglas de cobertura. */
export const construirCoberturaPanel = () => {
  const datos = { zona: ZONAS_COBERTURA[0], cantones: CANTONES_COSTA_RICA, cantonesGAM: CANTONES_GAM, alias: ALIAS_CANTONES };
  return `// ARCHIVO GENERADO por scripts/generar-nodos-n8n.js desde src/config/reglasNegocio.js — NO EDITAR AQUÍ.
export const COBERTURA = ${JSON.stringify(datos, null, 2)};
`;
};

/** Genera todos los artefactos en memoria (usado también por las pruebas). */
export const generarArtefactos = () => {
  const codigoEvaluarCobertura = construirCodigoNodo('Evaluar cobertura (POO)', ADAPTADOR_EVALUAR_COBERTURA);
  const codigoConsolidarDecision = construirCodigoNodo('Consolidar decisión (POO)', ADAPTADOR_CONSOLIDAR_DECISION);
  const codigoAnalizarTendencia = construirCodigoNodo('Analizar tendencia (POO)', ADAPTADOR_ANALIZAR_TENDENCIA);
  const comoJSON = (objeto) => `${JSON.stringify(objeto, null, 2)}\n`;

  return {
    [SALIDAS.codigoEvaluar]: codigoEvaluarCobertura,
    [SALIDAS.codigoConsolidar]: codigoConsolidarDecision,
    [SALIDAS.codigoTendencia]: codigoAnalizarTendencia,
    [SALIDAS.coberturaPanel]: construirCoberturaPanel(),
    [SALIDAS.workflowPrincipal]: comoJSON(construirWorkflowPrincipal({ codigoEvaluarCobertura, codigoConsolidarDecision, codigoAnalizarTendencia })),
  };
};

const esEjecucionDirecta = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (esEjecucionDirecta) {
  mkdirSync(new URL('n8n/codigo-generado/', RAIZ), { recursive: true });
  for (const [ruta, contenido] of Object.entries(generarArtefactos())) {
    writeFileSync(new URL(ruta, RAIZ), contenido);
    console.log(`✔ ${ruta}`);
  }
}
