# 🧪 ABS en 20 minutos para QA

> Una guía paso a paso para aprender ABS — **A**gent **B**ehavior **S**pecification — desde cero. Si podés escribir una lista con viñetas, podés escribir ABS. Sin código, sin tests previos — solo YAML.

---

## Minuto 0–5: ¿Qué es ABS y qué estructura tiene?

**ABS significa Agent Behavior Specification.** Es una especificación para describir el comportamiento **observable** de un agente de IA: qué dice, qué herramientas llama, qué responde. Es el equivalente a lo que OpenAPI es para APIs REST: un formato compartido, legible por humanos y por máquinas, que un PO, un dev y un QA pueden leer y firmar juntos.

ABS es **YAML**. Es texto plano. No es código. Es una forma de escribir:

> *"El usuario dice esto, el asistente hace esto otro, y quiero verificar que pasó bien."*

Mirá el documento ABS más chico posible:

```yaml
session: Cliente pide estado de un pedido
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

Eso ya es una especificación completa. Tres campos por paso:

| Campo | Qué significa | Ejemplo |
|---|---|---|
| `actor` | **Quién** actúa | `user`, `assistant`, `tool` |
| `action` | **Qué hace** | `says`, `calls`, `informs`, `asks` |
| `content` / `target` | **El detalle** | el mensaje, o el sistema al que llama |

**Los cuatro actores que vas a usar siempre:**

- `user` → el cliente, el que habla con el bot
- `assistant` → el bot que estás probando
- `tool` → una API externa o base de datos que el bot consulta
- `human` → una persona real (para cuando el bot transfiere)

---

## Minuto 5–10: Escribamos una conversación real

Imaginá que sos QA de un bot de reembolsos. El PO te da esta historia:

> *"Un cliente devuelve un producto dañado. El bot pide verificar nombre y fecha. Consulta dos APIs. Procesa el reembolso. Confirma monto y plazo."*

Escribámoslo en ABS, paso por paso:

```yaml
session: Reembolso — producto dañado
behaviors:
  # Paso 1: el cliente se queja
  - actor: user
    action: says
    content: "Recibí el pedido #8291 dañado, quiero devolverlo"

  # Paso 2: el bot pide verificación
  - actor: assistant
    action: asks
    content: "Lamento lo del daño. ¿Me confirmás tu nombre y fecha del pedido?"

  # Paso 3: el cliente responde
  - actor: user
    action: says
    content: "Franco Vinciarelli, lo pedí el martes pasado"

  # Paso 4: el bot consulta la API de pedidos
  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "8291"

  # Paso 5: la API responde
  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "8291"
      status: "delivered"
      eligibleForRefund: true

  # Paso 6: el bot llama a la API de reembolsos
  - actor: assistant
    action: calls
    target: Refunds API
    with:
      orderId: "8291"
      reason: "damaged"

  # Paso 7: la API de reembolsos responde
  - actor: tool
    action: responds
    target: Refunds API
    content:
      refundId: "R-5512"
      amount: 47.50
      status: "processed"

  # Paso 8: el bot le confirma al cliente
  - actor: assistant
    action: informs
    content: "Reembolso de €47.50 procesado, Franco. Lo recibirás en 3-5 días. Referencia: R-5512."
```

**Punto importante:** ¿Ves los pasos 4-5 y 6-7? Cada vez que el bot llama a una API, son **dos Behaviors separados**: el llamado y la respuesta. Esto es a propósito: así podés verificar por separado si llamó bien y si lo que devolvió la API es correcto.

En este punto **ya tenés una especificación**. Tu PO puede leerla y entender el flujo. Tu dev sabe qué APIs hay que llamar. Sin código, sin tests.

---

## Minuto 10–15: Agreguemos verificaciones paso a paso

Describir está bien, pero vos sos QA: querés **verificar** que el bot realmente hizo todo bien. Para eso existen las `evaluations`.

Hay dos momentos críticos en este flujo: cuando el bot pide verificación (¿fue empático? ¿pidió lo correcto?), y cuando entrega el resultado final (¿están todos los datos? ¿inventó algo?).

Agreguemos `evaluations` en esos dos puntos:

```yaml
  # Paso 2 mejorado: verificamos calidad de la respuesta
  - actor: assistant
    action: asks
    content: "Lamento lo del daño. ¿Me confirmás tu nombre y fecha del pedido?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Muestra empatía por el producto dañado
          2. Menciona el número de pedido #8291
          3. Pide verificación antes de actuar
```

`llm_judge` le pide a una IA que evalúe la respuesta contra tus criterios, en lenguaje natural. Nada de código.

Para datos duros — cosas que sí o sí tienen que aparecer — usamos verificaciones exactas:

```yaml
  # Paso 8 mejorado: datos duros + calidad
  - actor: assistant
    action: informs
    content: "Reembolso de €47.50 procesado, Franco. Lo recibirás en 3-5 días. Referencia: R-5512."
    capture:
      refundId: "R-5512"
    evaluations:
      # Dato duro: el ID tiene que aparecer sí o sí
      - type: contains
        value: "R-5512"

      # Calidad: tono, completitud
      - type: llm_judge
        criteria: |
          1. Indica el monto (€47.50) y el plazo (3-5 días)
          2. Da la referencia R-5512
          3. Usa el nombre del cliente (Franco)
          4. Tono tranquilizador, sin upsells ni desvíos
```

**El `capture`** que ves ahí guarda el valor `R-5512` para usarlo después. En un rato lo vas a necesitar.

### Tipos de evaluaciones que tenés disponibles:

| Evaluador | Para qué sirve |
|---|---|
| `contains` | El texto incluye tal palabra o frase |
| `exact_match` | El texto es exactamente igual |
| `regex` | El texto cumple un patrón (email, fecha, código) |
| `schema` | La respuesta de una API cumple una estructura |
| `llm_judge` | Criterios cualitativos en lenguaje natural |
| `tool_call` | Verifica que se llamó a la herramienta correcta con los parámetros correctos |

---

## Minuto 15–20: Verificaciones sobre toda la conversación

Hasta ahora evaluamos pasos individuales. Pero hay cosas que solo se pueden verificar mirando **la conversación entera**:

- ¿Los pasos ocurrieron en el orden correcto?
- ¿El ID de reembolso se mantuvo igual en todos lados?
- ¿Hay algo que **nunca** debería haber pasado?

Estas van en un bloque `evaluations:` al mismo nivel que `behaviors:`, **no** dentro de un paso:

```yaml
evaluations:
  # 1. Orden: el bot debe preguntar ANTES de llamar a las APIs
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Orders API" }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }

  # 2. El ID de reembolso debe ser el mismo siempre
  - type: variable_consistency
    variable: refundId

  # 3. Este flujo NUNCA debe transferir a un humano
  - type: never
    match: { actor: assistant, action: hands_off }
```

**¿Qué hace cada uno?**

- **`sequence`**: verifica que los 4 pasos del asistente ocurran en ese orden relativo. No importa si hay otros pasos en el medio — solo importa que A esté antes que B, B antes que C, etc.

- **`variable_consistency`**: ¿te acordás de `capture: refundId: "R-5512"`? Esto revisa que cada vez que aparece `R-5512` en la conversación, el valor sea el mismo. Atrapa bugs sutiles donde el bot dice "R-5512" al principio y "R-5513" después.

- **`never`**: un guardián. Si este flujo transfiere a un humano, algo salió mal y el test falla.

### Más evaluadores de cadena:

| Evaluador | Qué verifica |
|---|---|
| `sequence` | Pasos en orden relativo |
| `eventually` | Algo ocurre al menos una vez |
| `never` | Algo **nunca** ocurre |
| `count` | Algo ocurre exactamente N veces |
| `within` | A ocurre dentro de N pasos después de B |
| `variable_consistency` | Un valor capturado se mantiene igual |

---

## El documento completo

Juntando todo, son ~70 líneas. Una sola página. Tu PO lo entiende, tu dev sabe qué construir, vos tenés 7 verificaciones automatizadas. Un solo archivo, tres usos.

---

## ¿Y ahora cómo lo ejecuto?

Tres opciones, de más simple a más integrada:

**1. Navegador — sin instalar nada**

Abrí el **[ABS Designer](/abs-designer/)**, pegá tu YAML, poné la URL de tu agente, ▶ Run.

**2. Terminal**

```bash
abs run session.abs.yaml --agent http://localhost:8080/chat
```

**3. VSCode**

Abrí cualquier `.abs.yaml` → el editor visual se abre solo → ▶ Run.

---

## De un test a 100: datasets y golden data

Hasta acá ejecutamos **un solo caso**. El camino feliz con datos fijos. Eso está bien para arrancar, pero con agentes de IA necesitás más: ¿qué pasa con 100 pedidos distintos? ¿Y si el nombre tiene acentos? ¿Y si el monto es cero?

ABS tiene una respuesta para eso: **datasets**. Convertí tu Session en un template con `{{placeholders}}` y ejecutala contra un archivo de datos.

### Paso 1: Convertí los valores fijos en placeholders

En vez de hardcodear `"8291"` y `"R-5512"`, usá `{{variables}}`:

```yaml
session: Reembolso — producto dañado
behaviors:
  - actor: user
    action: says
    content: "Recibí el pedido #{{orderId}} dañado, quiero devolverlo"

  - actor: assistant
    action: asks
    content: "Lamento lo del daño. ¿Me confirmás tu nombre y fecha del pedido?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Muestra empatía por el producto dañado
          2. Menciona el número de pedido
          3. Pide verificación antes de actuar

  - actor: user
    action: says
    content: "{{customerName}}, lo pedí el martes pasado"

  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "{{orderId}}"

  # ... resto del flujo con {{expectedAmount}}, {{expectedKeyword}}, etc.

  - actor: assistant
    action: informs
    content: "Reembolso de {{expectedAmount}} procesado, {{customerName}}. Referencia: {{refundId}}."
    capture:
      refundId: "{{refundId}}"
    evaluations:
      - type: contains
        value: "{{expectedKeyword}}"
      - type: llm_judge
        criteria: |
          1. Indica el monto ({{expectedAmount}}) y el plazo (3-5 días)
          2. Usa el nombre del cliente ({{customerName}})
          3. Tono tranquilizador, sin upsells ni desvíos
```

### Paso 2: Creá tu golden dataset

Un archivo `.jsonl` donde cada línea es un caso distinto:

```jsonl
{"orderId": "8291", "customerName": "Franco", "expectedAmount": "€47.50", "refundId": "R-5512", "expectedKeyword": "procesado"}
{"orderId": "4456", "customerName": "María José", "expectedAmount": "€128.00", "refundId": "R-7813", "expectedKeyword": "autorizado"}
{"orderId": "1023", "customerName": "Åsmund", "expectedAmount": "€9.99", "refundId": "R-2004", "expectedKeyword": "completado"}
```

### Paso 3: Ejecutá todo junto

```bash
abs run reembolso.abs.yaml --agent $URL --dataset golden-cases.jsonl
```

El Runner ejecuta la Session **una vez por fila**. Si tenés 100 filas, ejecuta 100 tests. El reporte te muestra cuántos pasaron, cuántos fallaron, y el detalle de cada fila que falló:

```
Session:  Reembolso — producto dañado
Agent:    http://localhost:8080/chat
Dataset:  golden-cases.jsonl (100 rows)
Result:   ❌ FAILED
Rows:     97/100 passed · 3 failed

❌ Row 42 (orderId=5555):
  Step 8 — assistant informs:
    Expected keyword: "procesado"
    Observed: "Tu reembolso fue rechazado"
    ❌ contains "procesado" → FAILED
```

**Esto es lo que buscás como QA:** la misma especificación, ejecutada contra datos reales diversos, atrapando regresiones. La Session es el *qué*. El dataset es el *con qué datos*.

### Bonus: ejecutá una sola fila mientras desarrollás

```bash
abs run reembolso.abs.yaml --agent $URL --dataset golden-cases.jsonl --filter "orderId:8291"
```

El `--filter` te deja iterar sobre un solo caso sin esperar los 100.

### Caso avanzado: evaluaciones de calidad con datos del dataset

Además de assertions exactas como `contains`, tu golden dataset puede alimentar evaluaciones más sofisticadas. Por ejemplo, verificar que la respuesta del bot **no alucina** (Groundedness), que **responde lo que el usuario preguntó** (Relevance), o que **no tiene sesgo** (bias check con `llm_judge`).

Imaginá un bot de atención al cliente con knowledge base. El dataset incluye el contexto que el bot debería usar:

```jsonl
{"userQuery": "¿Cuál es la política de devolución?", "kbContext": "Las devoluciones se aceptan dentro de 30 días. Productos abiertos tienen recargo del 15%.", "expectedPolicy": "30 días"}
{"userQuery": "¿Hacen envíos a Uruguay?", "kbContext": "Realizamos envíos a Argentina, Chile, Uruguay y Paraguay. Costo según peso.", "expectedPolicy": "Uruguay"}
{"userQuery": "¿Tienen garantía extendida?", "kbContext": "Ofrecemos garantía de 1 año en todos los productos. Extensión a 3 años por 15% adicional.", "expectedPolicy": "3 años"}
```

Ahora la Session referencía esas columnas tanto en el input como en las evaluaciones:

```yaml
session: Consulta con knowledge base
dataset:
  id: cases
  path: kb-cases.jsonl
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"

  - id: kb_result
    actor: tool
    action: responds
    target: Knowledge Base
    content: "{{cases.kbContext}}"

  - id: answer
    actor: assistant
    action: informs
    evaluations:
      # ¿La respuesta se apoya en el contexto o inventa?
      - type: Groundedness
        query: user_asks.says
        context: kb_result.responds
        response: self
        threshold: 0.8

      # ¿Responde a lo que preguntó el usuario?
      - type: Relevance
        query: user_asks.says
        response: self
        threshold: 0.7

      # ¿La respuesta es coherente internamente?
      - type: Coherence
        response: self

      # Dato duro: ¿menciona la política correcta?
      - type: contains
        value: "{{cases.expectedPolicy}}"

      # ¿Tono correcto? ¿Sin sesgo?
      - type: llm_judge
        criteria: |
          1. Responde la pregunta del usuario: {{cases.userQuery}}
          2. No inventa información que no está en el contexto
          3. No muestra sesgo ni favoritismo
          4. Tono profesional y servicial
        threshold: 0.7
```

**¿Qué está pasando acá?** Cada fila del dataset trae su propia pregunta, su propio contexto de knowledge base, y su propia política esperada. Las evaluaciones usan `{{cases.column}}` para adaptar los criterios a cada caso. `Groundedness`, `Relevance` y `Coherence` son evaluadores estándar de la industria (los mismos que usan Azure AI Foundry y Vertex AI). `llm_judge` con `{{cases.userQuery}}` inyecta la pregunta real en los criterios, así cada fila se evalúa contra lo que le corresponde.

### ¿Dónde se ejecutan estas evaluaciones? — Adaptadores

Las evaluaciones simples (`contains`, `exact_match`, `regex`, `schema`, `tool_call`) corren **localmente** en tu máquina, sin llamadas externas. Son instantáneas y gratuitas.

Las evaluaciones que necesitan un LLM (`llm_judge`, `Groundedness`, `Relevance`, `Coherence`, `Fluency`) pasan por un **adaptador**. El adaptador es un puente entre ABS y *donde sea que quieras ejecutar el juicio*. ABS no te ata a un proveedor:

| Opción | Cómo se configura | Ideal para |
|---|---|---|
| **AI Evaluator (default)** | Ya viene configurado. 5 evaluaciones gratis por día sin API key. Registrate para 100/mes. | Arrancar sin infraestructura |
| **Tu propio LLM local** | `--adapter llm_judge=local --adapter-url http://localhost:11434` | Privacidad total, sin límites de uso |
| **OpenAI / Azure / Vertex AI** | `--adapter llm_judge=azure --adapter-key $KEY` | Integración con tu proveedor existente |
| **LangSmith / Promptfoo / Galileo** | Cada uno publica su adaptador. Lo configurás con `--adapter`. | Si ya usás una plataforma de observabilidad |

```bash
# Con AI Evaluator (default, sin configurar nada)
abs run kb-session.abs.yaml --agent $URL --dataset kb-cases.jsonl

# Con tu propio LLM local (Ollama, llama.cpp, etc.)
abs run kb-session.abs.yaml --agent $URL --dataset kb-cases.jsonl \
  --adapter llm_judge=local --adapter-url http://localhost:11434

# Con Azure AI Foundry
abs run kb-session.abs.yaml --agent $URL --dataset kb-cases.jsonl \
  --adapter llm_judge=azure --adapter-key $AZURE_KEY
```

**La Session es la misma.** El dataset es el mismo. Solo cambiás el adaptador según el entorno: local mientras desarrollás, AI Evaluator en staging, Azure en producción. El *qué* no cambia; el *dónde* se resuelve con una flag.

---

## Errores comunes (y cómo evitarlos)

| Error | Corrección |
|---|---|
| *Usé `says` para un llamado a API* | Usá `calls` + `target`. `says` es para hablar. |
| *`sequence` falla pero los pasos están* | `sequence` mira orden relativo, no adyacencia. Si A está antes que B, pasa. |
| *Quiero un IF en la conversación* | En v0.1 no hay branching. Dos caminos = dos Sessions separadas. |
| *`llm_judge` a veces pasa y a veces no* | Criterios vagos ("que sea amable") dan resultados inconsistentes. Sé específico. |
| *No sé qué actor usar* | `user` = el tester. `assistant` = el bot. `tool` = API/sistema externo. `human` = persona real. |

---

## Herramientas disponibles

ABS no es solo un formato: tenés un ecosistema de herramientas para escribir, ejecutar y depurar especificaciones.

### CLI — la navaja suiza

Instalalo con npm o pip:

```bash
npm install -g abs-cli
# o
pip install abs-cli
```

Tres comandos:

```bash
abs init                          # Creá un proyecto desde cero
abs run session.abs.yaml --agent $URL    # Ejecutá contra tu agente
abs report report.json            # Leé un reporte anterior
```

### ABS Designer — editor visual en el navegador

Sin instalar nada. Abrí **[el Designer](/abs-designer/)** y construí Sessions arrastrando bloques. Ideal para sessions de Three Amigos con PO y dev. Exporta YAML listo para ejecutar.

### Extensión de VSCode

Instalala desde el marketplace de VSCode. Abrí cualquier `.abs.yaml` y el editor visual se abre automáticamente. Editá visualmente, guardá, y ejecutá contra tu agente con ▶ Run. Todo en el mismo lugar.

### Mock agent — probá sin un agente real

Si estás escribiendo la especificación y tu agente todavía no existe o no está disponible, usá el mock agent para verificar que tu YAML parsea y evalúa correctamente:

```bash
python tools/mock_agent.py --port 8080
abs run session.abs.yaml --agent http://localhost:8080/chat
```

El mock agent devuelve respuestas predefinidas, así que podés validar toda la cadena — parseo, ejecución, evaluaciones — sin depender de un agente real.

### Chatbot — generá especificaciones conversando

Ya sabés escribir specs a mano. Pero ABS puede más: en vez de recordar cada campo y cada acción, **le contás al chatbot lo que querés probar y él te genera el archivo.**

Está disponible en dos lugares:

**En el website.** Entrá al **[ABS Designer](/abs-designer/)** y abrí el chat. Escribí algo como:

> *"Quiero probar un bot de reembolsos: el cliente pide devolver un producto dañado, el bot verifica con Orders API y Refunds API, y confirma el monto y plazo."*

El chatbot te devuelve el `.abs.yaml` completo, con Behaviors, tool calls, y evaluaciones sugeridas. Lo revisás, ajustás lo que necesites, y lo ejecutás.

**En la CLI.** El mismo chat está integrado:

```bash
abs chat
```

Funciona igual: describís el escenario en lenguaje natural, y el chatbot genera la especificación. Ideal cuando estás en la terminal y no querés cambiar de contexto.

**¿Por qué sirve esto?** Porque podés pasar de una idea a un test ejecutable en dos minutos. Le contás al chatbot lo mismo que le contarías a un compañero en la daily, y obtenés un archivo listo para `abs run`. Después lo refinás con datasets, evaluaciones avanzadas, y todo lo que aprendiste en este tutorial. Pero el 80% del trabajo inicial ya está hecho.

### Documentación completa

- **[Specification](/docs/specification)** — referencia normativa
- **[Evaluations](/docs/evaluations)** — todos los evaluadores con ejemplos
- **[Patterns](/docs/patterns)** — recetas para casos reales (ruteo, escalación, verificación multi-step)
- **[GitHub](https://github.com/fvinciarelli/abs)** — código fuente, ejemplos, issues

---

## Cheat sheet final

### Acciones

| Categoría | Acciones | Cuándo usarlas |
|---|---|---|
| Comunicación | `says`, `asks`, `informs`, `greets`, `clarifies`, `confirms`, `rejects`, `suggests`, `shows` | El bot o usuario habla |
| Ejecución | `calls`, `submits`, `retrieves`, `stores`, `updates` | El bot invoca herramientas |
| Interacción | `selects`, `uploads`, `approves` | El usuario interactúa con UI |
| Delegación | `hands_off` | El bot transfiere a un humano |

### Evaluaciones

| Tipo | Nivel | Qué verifica |
|---|---|---|
| `contains` | Paso | Contiene texto |
| `exact_match` | Paso | Texto exacto |
| `regex` | Paso | Coincide con patrón |
| `schema` | Paso | Estructura JSON válida |
| `tool_call` | Paso | Llamada a herramienta correcta |
| `llm_judge` | Paso | Criterios cualitativos |
| `sequence` | Cadena | Orden de pasos |
| `eventually` | Cadena | Algo ocurre al menos una vez |
| `never` | Cadena | Algo nunca ocurre |
| `count` | Cadena | Algo ocurre N veces |
| `within` | Cadena | A ocurre dentro de N pasos de B |
| `variable_consistency` | Cadena | Un valor no cambia |
