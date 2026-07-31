# Tutorial ABS para QA

> Una guía paso a paso para escribir especificaciones de agente que todos entienden y que además se ejecutan como tests.

---

## ¿Qué es ABS y por qué te importa?

Imaginá esto: llega un desarrollador y te dice *"el bot de devoluciones ya está listo, probalo"*. Vos abrís el chat, escribís *"quiero devolver un producto"*, y el bot te responde. ¿Está bien? ¿Hizo todo lo que debía? ¿Se saltó algún paso?

Hoy probablemente tenés un documento de Word con una lista de "casos de prueba" y hacés todo a mano. ABS reemplaza eso: **un archivo YAML que describe qué debe hacer el agente, y que además podés ejecutar como test automático.**

En una sesión de 3 amigos (QA + Dev + PO), este archivo es el artefacto que los tres leen, debaten y firman. El dev lo usa para saber qué construir. El PO para entender qué hace el producto. Vos para saber exactamente qué verificar.

---

## Primeros 5 minutos: entendé la estructura

Un archivo ABS describe una **conversación**. Tiene dos partes: quién habla y qué hace.

```yaml
session: Un usuario pide el estado de su pedido
behaviors:
  - actor: user
    action: says
    content: "¿Dónde está mi pedido #8291?"

  - actor: assistant
    action: calls
    target: Orders API

  - actor: assistant
    action: informs
    content: "Tu pedido está en camino"
```

Eso es todo. Tres líneas por paso. `actor` es quién (`user`, `assistant`, `tool`), `action` es qué hace (`says`, `calls`, `informs`, `asks`...), y `content` es el texto o datos.

---

## Manos a la obra: especifiquemos una devolución

Vamos a escribir la spec de un bot que procesa devoluciones. Esta es la historia que nos pasó el PO:

> *"Un cliente dice que recibió dañado el producto. El bot le pide que confirme nombre y fecha. Después verifica en el sistema de órdenes si el pedido existe y es elegible para devolución. Si todo está bien, procesa la devolución y le dice al cliente cuánto le devuelven y cuándo."*

### Paso 1: Escribimos la conversación, sin evaluaciones

Primero describimos lo que debería pasar, paso a paso. Nada de assertions todavía — solo la secuencia:

```yaml
session: Devolución por producto dañado
behaviors:
  # El cliente inicia
  - actor: user
    action: says
    content: "Recibí dañado el pedido #8291, quiero devolverlo"

  # El bot pide verificación antes de hacer nada
  - actor: assistant
    action: asks
    content: "Lamento lo del daño. ¿Me confirmás tu nombre y la fecha del pedido?"

  # El cliente responde
  - actor: user
    action: says
    content: "Franco Vinciarelli, lo pedí el martes pasado"

  # El bot verifica contra la API de órdenes
  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "8291"

  # La API responde
  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "8291"
      status: "delivered"
      eligibleForRefund: true

  # El bot procesa la devolución
  - actor: assistant
    action: calls
    target: Refunds API
    with:
      orderId: "8291"
      reason: "damaged"

  # La API de devoluciones responde
  - actor: tool
    action: responds
    target: Refunds API
    content:
      refundId: "R-5512"
      amount: 47.50
      status: "processed"

  # El bot le informa al cliente
  - actor: assistant
    action: informs
    content: "Devolución de €47.50 procesada, Franco. La recibirás en 3-5 días. Referencia: R-5512."
```

En este punto, ya tenemos algo que el PO puede leer y entender. El dev ve qué APIs llamar y con qué parámetros. Pero vos, como QA, necesitás más — necesitás poder verificar que el bot realmente hizo todo esto bien.

### Paso 2: Agregamos verificaciones en los pasos clave

Hay dos momentos críticos en esta conversación: cuando el bot pide verificación (¿fue empático? ¿pidió los datos correctos?) y cuando informa el resultado (¿dio todos los datos? ¿no inventó nada?). 

Agreguemos `evaluations` en esos puntos:

```yaml
  # El bot pide verificación — evaluamos con LLM
  - actor: assistant
    action: asks
    content: "Lamento lo del daño. ¿Me confirmás tu nombre y la fecha del pedido?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Muestra empatía por el producto dañado
          2. Hace referencia al número de pedido #8291
          3. Pide los datos de verificación antes de actuar
```

Esto usa un LLM (el mismo que usa el bot u otro) para evaluar si la respuesta cumple los criterios. No es un "contiene la palabra X" — es un juicio cualitativo. Para cosas factuales, usamos evaluadores exactos:

```yaml
  # El bot informa el resultado — mezclamos verificaciones duras y blandas
  - actor: assistant
    action: informs
    content: "Devolución de €47.50 procesada, Franco. La recibirás en 3-5 días. Referencia: R-5512."
    evaluations:
      # Hecho concreto: el ID de devolución TIENE que aparecer
      - type: contains
        value: "R-5512"

      # Cualidades blandas: tono, completitud, lo evaluamos con LLM
      - type: llm_judge
        criteria: |
          1. Indica el monto (€47.50) y el plazo (3-5 días)
          2. Proporciona la referencia R-5512
          3. Usa el nombre del cliente (Franco)
          4. Tono tranquilizador, sin upsells ni desvíos
```

### Paso 3: Verificaciones sobre TODA la conversación

Además de verificar cada paso, nos interesa verificar propiedades de la conversación completa. Esto se pone en un bloque `evaluations` al final del archivo, al mismo nivel que `behaviors`:

```yaml
evaluations:
  # Los 4 pasos del asistente DEBEN ocurrir en este orden exacto
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Orders API" }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }

  # El ID de devolución debe ser el mismo en toda la conversación
  - type: variable_consistency
    variable: refundId

  # NUNCA debe derivar a un humano — este flujo se resuelve automático
  - type: never
    match: { actor: assistant, action: hands_off }
```

Esto es lo que hace que ABS sea distinto a un script de pruebas tradicional. `sequence` verifica que los pasos críticos ocurran en orden. `variable_consistency` atrapa un bug sútil: que el bot diga "R-5512" al principio pero "R-5513" al final. `never` es un guarda de seguridad: si este flujo deriva a un humano, algo salió mal.

---

## El archivo completo

Juntando todo, el archivo final tiene ~70 líneas. El PO entiende la conversación. El dev sabe qué construir. Vos tenés 7 verificaciones automatizadas. Todo en un solo archivo.

> 👉 El archivo completo está en [`examples/refund-request.yaml`](examples/refund-request.yaml)

---

## Cómo se ejecuta

Hay tres formas, de más simple a más integrada:

### 1. Navegador — sin instalar nada

Andá a la [web de ABS](/abs-designer/), pegá tu YAML, poné la URL de tu agente y dale ▶ Run. Resultados en pantalla.

### 2. Terminal

```bash
abs run mi-sesion.abs.yaml --agent http://localhost:8080/chat
```

Te dice paso por paso qué matcheó, qué falló, y por qué.

### 3. VSCode

Abrí cualquier `.abs.yaml`, el panel del editor se abre solo. Editás visualmente y ejecutás con ▶ Run.

---

## Vocabulario rápido: las acciones que existen

| Categoría | Acciones | Cuándo usarlas |
|---|---|---|
| **Comunicación** | `says`, `asks`, `informs`, `greets`, `clarifies`, `confirms`, `rejects`, `suggests`, `shows` | El bot o el usuario hablan |
| **Ejecución** | `calls`, `submits`, `retrieves`, `stores`, `updates` | El bot invoca herramientas o APIs |
| **Interacción** | `selects`, `uploads`, `approves` | El usuario interactúa con UI |
| **Delegación** | `hands_off` | El bot transfiere a un humano |

---

## Tipos de evaluación: cuándo usar cada uno

| Evaluador | ¿Qué verifica? | ¿Cuándo? |
|---|---|---|
| `contains` | El texto contiene una subcadena | Hechos concretos: IDs, montos, nombres |
| `exact_match` | El texto es exactamente igual | Respuestas determinísticas |
| `regex` | El texto matchea un patrón | Formatos: emails, fechas, códigos |
| `schema` | El contenido cumple un JSON Schema | Respuestas de APIs |
| `llm_judge` | Criterios cualitativos en lenguaje natural | Tono, empatía, completitud |
| `sequence` | Varios pasos ocurren en orden | Flujos multi-step |
| `eventually` | Algo ocurre al menos una vez | "El bot debe confirmar en algún momento" |
| `never` | Algo NUNCA ocurre | Guardas de seguridad |
| `count` | Algo ocurre N veces | "Exactamente 2 llamadas a la API" |
| `within` | Algo ocurre dentro de N pasos de otra cosa | "Responde en menos de 3 pasos" |
| `variable_consistency` | Una variable capturada no cambia de valor | IDs, nombres |
| `all_of` / `any_of` / `none_of` | Combina evaluadores | Lógica booleana |

---

## La sesión de 3 amigos: cómo usamos ABS

**Antes de la sesión:** el PO escribe la historia de usuario. Nada de ABS todavía.

**Durante la sesión (60-90 minutos):**

1. **15 min — Escribir la secuencia.** Entre los tres describen la conversación ideal. Solo `actor`, `action`, `content`. Sin evaluaciones. Esto lo entienden todos.

2. **15 min — Agregar verificaciones.** Vos (QA) preguntás: *"¿Qué podría salir mal acá?"* y *"¿Cómo sabemos que el bot hizo esto bien?"*. De esa conversación salen los `evaluations` en los pasos clave.

3. **15 min — Verificaciones de la conversación completa.** *"¿Qué tiene que ser verdad sobre TODA la conversación?"* De ahí salen los `sequence`, `never`, `variable_consistency`.

4. **15 min — Revisar y firmar.** Los tres leen el archivo completo. ¿Falta algo? ¿Sobra algo? Es el momento de ajustar.

**Después de la sesión:** el dev tiene la spec para construir. Vos tenés la spec para probar. El PO tiene la spec como documento de qué hace el producto. Un solo archivo, tres usos.

---

## Errores comunes (y cómo evitarlos)

| Error | Corrección |
|---|---|
| *"Puse `says` pero el bot estaba llamando una API"* | `calls` + `target` es para APIs. `says`/`informs`/`asks` es para hablar. |
| *"El sequence falla pero los pasos están"* | `sequence` pide orden relativo, no adyacencia. Si A está antes que B, matchea aunque haya pasos en el medio. |
| *"Quiero poner un IF en la conversación"* | ABS no tiene branching dentro de una sesión. Dos caminos = dos sesiones. Escribí una para el happy path y otra para el alternativo. |
| *"Mi `llm_judge` pasa a veces y falla otras"* | Los criterios muy vagos ("que sea amable") dan resultados inconsistentes. Sé específico: "saluda, se presenta, no interrumpe". |
| *"No sé qué actor poner"* | `user` = el que prueba. `assistant` = el bot. `tool` = API/sistema externo. `human` = persona real (para hand-offs). |
