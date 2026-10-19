# Documento de lógica de negocio

**Laboratorio #1 · Soluciones de Negocio (POO + n8n)**
**Escenario 2 · Pedidos con verificación geográfica de cobertura**
Integrantes: _[completar]_ · Curso: _[completar]_ · Fecha: _[completar]_

> Borrador listo para pasar a Word/PDF. Extensión objetivo: 2–4 páginas. Los textos entre corchetes se completan; las tablas y párrafos ya están redactados.

---

## 1. Problema y beneficios

**Contexto.** Una tienda en línea con sede en Costa Rica vende a Costa Rica, Centroamérica y Norteamérica. Los pedidos llegan a una base de datos (JSON Server) con estado `pendiente` y una persona los revisa uno por uno: confirma desde dónde compra el cliente, verifica que el destino esté dentro de la zona de reparto, calcula el envío según peso y decide si el pedido parece confiable.

**Problema.** La revisión manual es lenta (el pedido espera horas), inconsistente (dos personas cobran envíos distintos para el mismo caso) y no deja registro de por qué se aprobó o rechazó un pedido. Además, los pedidos fraudulentos suelen venir de fuera de la zona de cobertura o a través de VPN, algo que a simple vista no se detecta.

**Solución.** Un flujo en n8n que, al recibir un pedido por webhook, geolocaliza la IP del cliente, aplica las reglas de cobertura y tarifas, consulta a DeepSeek para un análisis de riesgo y actualiza el pedido con su estado, costo de envío, motivo e historial.

**Beneficios.**

| Beneficio | Cómo se logra |
|---|---|
| Respuesta en segundos en lugar de horas | Flujo automático disparado por webhook |
| Tarifas de envío consistentes | Fórmula única por zona (R3) en una sola clase |
| Menos fraude y contracargos | Cobertura por IP (R2) + señales de proxy/VPN + análisis de IA (R4) |
| Trazabilidad | Motivo e historial de estados en cada pedido (R5) |
| Sin rechazos injustos por fallas técnicas | Si un servicio externo cae, el pedido pasa a revisión manual en vez de rechazarse |

---

## 2. Diseño del workflow

_[Insertar captura del workflow en n8n]_

Todo está en un **único workflow** de n8n, organizado en cuatro secciones (la cuarta es la rama de errores inesperados):

1. **Entrada y consultas.** *Webhook* protegido con Header Auth recibe `{ pedidoId, ipCliente }`. Un nodo *Set* centraliza la URL de JSON Server. Dos *HTTP Request* consultan el pedido en JSON Server y la ubicación de la IP en ip-api.com.
2. **Lógica POO.** El nodo *Code* "Evaluar cobertura" aplica R5, R1, R2 y R3. Un *IF* separa los pedidos con cobertura (van a DeepSeek) de los que ya tienen decisión. Un *HTTP Request* consulta a DeepSeek y un segundo nodo *Code* "Consolidar decisión" aplica R4.
3. **Salida.** Un segundo *IF* decide si hay que actualizar el pedido. Un *HTTP Request PATCH* guarda el resultado en JSON Server y un *Respond to Webhook* devuelve el estado a la tienda.
4. **Errores inesperados.** Si un nodo *Code* lanza una excepción no prevista, su salida de error la registra en JSON Server (`/erroresFlujo`) y responde 500, sin salir del flujo.

Los nodos se comunican con un campo `accion` (`evaluar_ia`, `actualizar`, `omitir`), lo que hace que las bifurcaciones IF sean simples y que toda la decisión quede en las clases.

---

## 3. Mapeo de reglas de negocio

| # | Regla | Dónde se aplica (clase · método) | Nodo n8n | Resultado si no se cumple |
|---|---|---|---|---|
| R1 | Estructura completa del pedido e IP pública con formato válido | `Pedido.validarEstructura()` · `ValidadorCobertura.validarIP()` | Evaluar cobertura (POO) | Rechazado con lista de errores |
| R2 | IP y destino dentro de una zona con cobertura | `ValidadorCobertura.determinarZona()` | Evaluar cobertura (POO) → ¿Tiene cobertura? | Rechazado: sin cobertura |
| R3 | Envío = tarifa base + kg × tarifa; gratis sobre umbral; peso máximo por zona | `Pedido.calcularCostoEnvio(zona)` | Evaluar cobertura (POO) | Rechazado: peso excedido |
| R4 | Rechazo si la IA indica no viable, riesgo alto o puntaje ≥ 70 | `AnalizadorRiesgoIA.interpretarRespuesta()` · `decidir()` | Analizar riesgo con DeepSeek → Consolidar decisión (POO) | Rechazado con motivos de la IA |
| R5 | Solo se procesan pedidos pendientes o en revisión; transiciones controladas con historial | `Pedido.puedeProcesarse()` · `aprobar/rechazar/marcarEnRevision()` | Evaluar cobertura (POO) → ¿Requiere actualizar? | Sin cambios (HTTP 409) |

**Tarifas vigentes (USD).**

| Zona | Países | Base | Por kg | Peso máx. | Envío gratis desde |
|---|---|---|---|---|---|
| NACIONAL | CR | 3.50 | 0.75 | 30 kg | $75 |
| CENTROAMERICA | PA, NI, SV, GT, HN, BZ | 12.00 | 2.50 | 20 kg | — |
| NORTEAMERICA | US, MX, CA | 20.00 | 4.00 | 15 kg | $250 |

**Manejo de errores (situaciones inesperadas).**

1. **API externa caída (ip-api o DeepSeek).** Los nodos HTTP tienen reintento y "continuar ante error"; la clase detecta la respuesta `{ error }` con `try/catch`, la clasifica como `ErrorIntegracion` y deja el pedido en `en_revision`. Si DeepSeek responde con texto que no es el JSON esperado, se trata igual.
2. **IP privada, reservada o inexistente.** `validarIP()` rechaza el pedido antes de confiar en la geolocalización (ej. `192.168.1.15`); si ip-api no logra ubicar una IP pública, también se rechaza con el motivo.
3. Otros casos cubiertos: JSON Server caído (503), pedido inexistente (404), pedido ya procesado (409) y fallas no previstas. Estas últimas salen por la salida de error de los nodos Code, se registran en JSON Server y se responden con un 500, sin salir del flujo.

---

## 4. Conexión entre POO y el nodo Code

Las reglas se programaron primero como clases de JavaScript puro y se probaron de forma independiente con `main.js` y 80 pruebas automatizadas, sin necesidad de n8n:

- **`Pedido`**: datos del pedido, validación de estructura, cálculo de envío y estados.
- **`ValidadorCobertura`**: validación de IP, interpretación de ip-api y zonas.
- **`AnalizadorRiesgoIA`**: arma la consulta a DeepSeek, valida su respuesta y decide.
- **`GestorPedidos`**: orquesta; sus métodos `evaluarCobertura()` y `consolidarDecision()` corresponden uno a uno a los dos nodos Code.

Como n8n no permite importar archivos en un nodo Code, un script (`npm run build:n8n`) **genera** el código de esos nodos a partir de las mismas clases y lo inyecta en el workflow exportado. Lo único propio de n8n son unas pocas líneas que leen los nodos anteriores:

```js
const resultado = new GestorPedidos().evaluarCobertura({
  entrada: $('Recibir pedido').first().json.body ?? {},
  respuestaPedido: $('Consultar pedido en JSON Server').first().json,
  respuestaGeo: $('Geolocalizar IP (ip-api)').first().json,
});
return [{ json: resultado }];
```

Una prueba automática ejecuta ese código generado y verifica que produce **exactamente** el mismo resultado que las clases, por lo que la lógica de `main.js` y la de n8n no pueden divergir.

---

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Generar el código de los nodos Code desde `src/` | Copiar y pegar las clases a mano | Garantiza la sincronización exigida y la verifica con pruebas |
| Dos nodos Code (antes y después de DeepSeek) | Un solo nodo al final | Solo se paga la consulta a la IA cuando el pedido ya tiene cobertura |
| La IA solo puede endurecer la decisión | Dejar que la IA decida todo | Una salida de IA mal formada o manipulada nunca aprueba un pedido que las reglas rechazaron |
| Estado `en_revision` ante fallas externas | Rechazar o aprobar automáticamente | No castigar al cliente por una caída nuestra ni aprobar sin verificar |
| Nodos HTTP con "continuar ante error" | Detener la ejecución | La clase decide la ruta segura y el pedido nunca queda a medio procesar |
| No enviar nombre, correo ni dirección exacta a DeepSeek | Enviar el pedido completo | Minimización de datos personales hacia un servicio externo |
| Respuesta JSON estricta (`response_format: json_object`) + validación de esquema | Interpretar texto libre | Resultados verificables y deterministas |
| Cobertura por IP **y** por destino | Solo por IP | La IP indica desde dónde compra; el destino, a dónde se entrega |
| URL de JSON Server en un nodo Set | Variables de entorno de n8n | Funciona aunque la instancia bloquee `$env` |

**Limitaciones conocidas.** ip-api gratuito solo admite HTTP y 45 consultas por minuto; para producción se usaría su plan con HTTPS. La geolocalización por IP es aproximada y un cliente legítimo de viaje sería rechazado por R2; en una versión siguiente ese caso podría pasar a revisión manual en lugar de rechazo.
