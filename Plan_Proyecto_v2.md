# Plan de Proyecto v2: Lector con Enriquecimiento Multimodal

**Fecha:** marzo 2026
**Autor:** Ing. Martín Madrid
**Contexto:** Trabajo Final, Especialización en Inteligencia Artificial (CEIA), FIUBA

---

## 1. Visión del producto

Una aplicación web de lectura de documentos EPUB que enriquece la experiencia con música contextual y generación de imágenes, ambas guiadas por un análisis narrativo automatizado del texto. El sistema analiza el libro completo al momento de carga (~3-4 minutos) y luego ofrece una lectura fluida donde la música cambia según la escena y las imágenes se generan a demanda o automáticamente.

---

## 2. Arquitectura general

El sistema opera en dos fases:

**Fase offline (ingesta, ~3-4 minutos por libro):** el documento se procesa completamente antes de que el usuario comience a leer. Toda la inteligencia se ejecuta aquí.

**Fase online (lectura):** el lector consume los resultados precomputados. La única operación costosa en tiempo real es la generación de imágenes a demanda.

### Pipeline de dos etapas LLM

La decisión arquitectónica central es usar dos invocaciones LLM en cascada, sin entrenamiento de modelos propios. La comunicación es secuencial y unidireccional (LLM 1 → LLM 2):

**LLM 1 (nivel libro):** recibe el documento completo en una sola llamada (asumiendo 200K+ tokens de contexto) y genera un mapa del libro con:
- Personajes principales (nombre, aliases, descripción física, rol, relaciones)
- Setting (época, mundo, contexto general)
- Género/subgénero
- Resumen breve por capítulo

**LLM 2 (nivel capítulo):** recibe cada capítulo (con párrafos numerados) junto con el output de LLM 1 como contexto, y genera para cada uno:
- Lista de escenas con delimitación por rango de párrafos (start_paragraph/end_paragraph)
- Atributos narrativos por escena (emoción, pacing, tipo de escena, setting, tipo de transición)
- Un image_prompt listo para el modelo generativo de imágenes por cada escena
- Descripción de portada del capítulo
- Opcionalmente: frases clave y objetos narrativamente relevantes

El conjunto de toda esta información constituye el **Mapa de Contexto Narrativo (NCM)**.

---

## 3. Unidad de segmentación: la escena

Se abandona el párrafo como unidad base. La unidad fundamental es la **escena**, detectada por LLM 2 y delimitada por rangos de párrafos numerados.

**Justificación:** si en una misma página de lectura hay un plot twist o cambio brusco argumental, la segmentación por párrafo no puede evitar el spoiler que provocaría una transición musical prematura (o un cambio visual anticipado). La escena, al tener longitud variable y estar definida por coherencia narrativa, resuelve este problema.

**Impacto en el lector:** la aplicación no visualiza la página completa del EPUB original, sino que presenta el contenido escena por escena. Esto permite sincronizar con precisión los cambios de música y de contexto visual con los cambios narrativos reales.

---

## 4. Módulos del sistema

### 4.1 Ingesta y extracción de texto

- Entrada: documento EPUB
- Librería: EbookLib (Python)
- Salida: texto limpio por capítulo, con párrafos numerados secuencialmente

### 4.2 Análisis narrativo (LLM 1 + LLM 2)

- LLM: vía API externa (BYOK), provider-agnostic. El usuario selecciona el proveedor (e.g., Google Gemini, OpenAI). Requiere 200K+ tokens de contexto
- Sin fine-tuning, sin datasets etiquetados para entrenamiento
- Salida: NCM completo en formato JSON persistente

**LLM 1 produce (por libro):**

- `characters[]`: id, nombre, aliases, descripción física, rol, relaciones
- `setting`: época, mundo, contexto general
- `genre`: género/subgénero
- `chapter_summaries[]`: resumen breve por capítulo

**LLM 2 produce (por capítulo):**

- `scenes[]`, cada una con:
  - `title`: etiqueta corta
  - `start_paragraph` / `end_paragraph`: delimitación en el texto
  - `characters_present[]`: referencia a los personajes de LLM 1
  - `emotion`: una de 9 categorías alineadas a música (joy, sorrow, tension, anger, peace, romance, mystery, excitement, wonder)
  - `pacing`: slow / medium / fast
  - `scene_type`: action / dialogue / description / introspection / transition
  - `setting`: locación, momento del día, clima
  - `image_prompt`: prompt visual listo para el modelo generativo de imágenes
  - `transition_type`: none / time_jump / pov_change / flashback / location_change
  - `key_phrases[]`: (opcional) frases del texto candidatas a ilustración
  - `key_objects[]`: (opcional) objetos narrativamente relevantes
- `cover_description`: prompt visual para portada del capítulo

### 4.3 Música contextual

- Biblioteca: subset curado de MTG-Jamendo (~200-500 tracks, estilo ambient/cinematic)
- Indexación: cada pista se indexa con tags de mood/theme, una emoción primaria (de las 9 categorías) y un vector derivado de los tags
- Matching en dos fases: filtro por emoción compatible + ranking por similitud coseno de vectores de tags
- Reproducción: Web Audio API con crossfade al cambiar de escena
- Histeresis: el track no cambia si la emoción de la nueva escena es la misma que la actual. Solo se hace crossfade cuando hay un cambio emocional real. Escenas muy cortas pueden no disparar transición para evitar cambios constantes
- La transición musical ocurre al pasar de una escena a otra, no al cambiar de párrafo

### 4.4 Generación de imágenes

Dos flujos:

**Flujo automático (configurable):**
- Para cada escena, se usa el campo `image_prompt` del NCM como prompt directo para el modelo generativo
- Las `cover_description` por capítulo también se generan como portadas
- Configurable: habilitado/deshabilitado, por escena o por capítulo

**Flujo a demanda (on-demand):**
- El usuario selecciona un pasaje de texto visualmente descriptivo
- Se identifican personajes mencionados por string matching (con normalización de posesivos) contra la lista de LLM 1 (nombres + aliases). Si no se encuentra ningún nombre, se usa como fallback la lista de `characters_present` de la escena actual
- Se inyecta la descripción física de los personajes identificados al prompt
- El texto seleccionado + descripciones de personaje se envía directamente a la API de imágenes (sin paso LLM intermedio)
- Si ya existe una imagen generada previamente del personaje, se envía como referencia (memoria de personajes, best-effort)

**Servicio:** API externa, BYOK, provider-agnostic. El usuario selecciona el proveedor de generación de imágenes (e.g., Google Imagen, OpenAI DALL-E)

### 4.5 Aplicación web

- Frontend: React + TypeScript
- Renderizado: contenido por escenas con revelación progresiva (no por páginas EPUB nativas)
- Backend: FastAPI (Python)
- Flujo de lectura:
  1. Usuario sube EPUB
  2. Sistema muestra estimación de costo antes de procesar (basada en tokens, capítulos y settings)
  3. Backend ejecuta pipeline offline (LLM 1 → LLM 2 → NCM) con indicador de progreso y costo acumulado
  4. Frontend carga el contenido segmentado por escenas + NCM
  5. Al navegar a una nueva página, solo se muestra la primera escena. Las siguientes se revelan una a una con tap/swipe, construyendo la página progresivamente
  6. Cada revelación de escena activa crossfade musical (sujeto a histeresis: solo si la emoción cambia)
  7. Imágenes automáticas se muestran al revelarse la escena si están habilitadas
  8. El usuario puede seleccionar texto para generar imagen a demanda

### 4.6 Settings del usuario

| Setting | Descripción |
|---|---|
| Unidad de visualización | Páginas o escenas como unidad de lectura |
| Gráficos | Generar por escena, por capítulo, o solo a demanda |
| Memoria de personajes | Reutilizar imágenes previas de personajes para consistencia |
| BYOK | Bring Your Own Key para APIs de generación |
| Lazy loading | Cargar recursos multimedia bajo demanda vs. precomputar todo |

---

## 5. Decisiones de diseño resueltas

| Decisión | Resolución | Justificación |
|---|---|---|
| Comunicación LLM 1 ↔ LLM 2 | Secuencial unidireccional (LLM 1 → LLM 2) | Iterativo agrega complejidad sin ganancia significativa. Post-procesamiento reconcilia discrepancias |
| Contexto LLM 1 | Libro completo en una llamada (200K+ tokens) | Simplicidad. Books >700 páginas son edge case |
| Delimitación de escenas | Párrafos numerados, rangos enteros | Robusto, validable, sin string matching frágil |
| Taxonomía emocional | 9 categorías alineadas a música | Cada categoría mapea a un espacio musical distinto. Plutchik y GoEmotions no diseñados para matching musical |
| Escalar de tensión | Eliminado | Absorbido por la categoría emocional "tension" + pacing + scene_type |
| Visual mood | Eliminado | El prompt rewriter lo derivaría de la emoción + setting. Con image_prompt directo, no es necesario |
| Prompt rewriter | Eliminado como módulo separado | LLM 2 produce image_prompt directamente al tener contexto completo |
| On-demand images | Texto raw directo a API | El caso de uso es texto visualmente descriptivo, no abstracto |
| Music matching | Tag filtering + tag-derived vector ranking | Sin modelos de audio (CLAP, etc.). Determinístico, simple |
| NER | String matching + fallback a scene context | Matching contra nombres + aliases, con fallback a characters_present de la escena cuando no hay match directo |
| Costo | Estimación pre-procesamiento + tiers configurables | El usuario ve el costo estimado antes de procesar. Tiers: minimal, standard, full, on-demand |
| Presentación del texto | Revelación progresiva escena por escena | La página no se muestra completa: se revela una escena por tap/swipe, evitando spoilers por transiciones prematuras |
| Transiciones musicales | Histeresis: solo cambia si la emoción cambia | Misma emoción = track continúa. Escenas cortas pueden no disparar transición |
| APIs externas | Provider-agnostic con capa de abstracción | El usuario selecciona proveedor de LLM e imágenes (BYOK). Protocols: `LLMProvider`, `ImageProvider`. Un adaptador concreto por provider |
| Estructura del repo | Monorepo flat: `lectoria/` (backend) + `frontend/` + `data/` | Un solo developer, deploy compartido, CI simple. NCM schema vive como Pydantic models en backend |
| Almacenamiento NCM | JSON file-based, un directorio por libro | Patrón de acceso = cargar NCM completo. SQLite descartado: complejidad innecesaria para single-user sin queries complejas |
| Encoding vectorial de tags | One-hot con mapping table | Scene attributes se mapean a vocabulario Jamendo via tabla manual, luego one-hot. TF-IDF descartado: con 200-500 tracks los pesos IDF no varían significativamente |
| Gestión de API keys | localStorage + headers per-request | Keys en localStorage del browser, enviadas al backend por header en cada request. Backend no persiste keys. Seguridad suficiente para demo académico |

---

## 6. Qué NO incluye

- Preentrenamiento o fine-tuning de modelos
- Composición de audio generativo
- Modelos de audio para embeddings musicales (CLAP, Music2Emo)
- Soporte para PDF o DRM
- Apps móviles nativas
- Autenticación, cuentas de usuario, sincronización
- Evaluación multilingüe (se evalúa en inglés)
- Consistencia perfecta de personajes (se usa memoria como best-effort)
- Reescritura LLM de prompts para imágenes on-demand

---

## 7. Evaluación

### Cuantitativa
- Calidad del NCM: evaluar la detección de escenas y clasificación emocional contra un gold standard manual sobre un subset de libros
- Calidad de imágenes: CLIPScore entre prompt y imagen generada

### Con usuarios (10-15 participantes)
- Condición A: lectura con música y visuales guiados por NCM
- Condición B: lectura con música e imágenes aleatorias
- Medidas: preferencia, coherencia percibida (Likert), SUS para usabilidad
- Test estadístico: Wilcoxon signed-rank

---

## 8. Timeline estimado

| Fase | Semanas | Descripción |
|---|---|---|
| Setup + ingesta EPUB | 1-2 | Entorno, EbookLib, extracción por capítulo con párrafos numerados |
| LLM 1: mapa del libro | 3-5 | Prompt engineering, generación de mapa + personajes con aliases |
| LLM 2: escenas + NCM | 6-9 | Prompt para escenas, 9 emociones, image_prompt, portadas |
| Biblioteca musical + matching | 10-12 | Curar subset Jamendo, indexación por tags, vectores, lógica de matching |
| Reader UI por escenas | 8-12 | React, renderizado por escena, navegación |
| Audio contextual | 13-15 | Web Audio API, crossfade, sync con escenas |
| Generación de imágenes | 16-18 | Flujo automático (image_prompt) + on-demand (raw text), character memory |
| Integración end-to-end | 19-20 | Todo junto, settings, debugging |
| Evaluación | 21-23 | Gold standard, user study, análisis |
| Memoria | 5-24 | Escritura continua desde semana 5 |

**Total: ~24 semanas de desarrollo + escritura en paralelo.**

---

## 9. Stack tecnológico

El sistema adopta un esquema **BYOK (Bring Your Own Key)** con **abstracción de proveedores**: no se despliegan modelos localmente. Todas las capacidades de IA se consumen via API externa, y el usuario selecciona el proveedor y provee sus propias claves. Una capa de abstracción (`LLMProvider`, `ImageProvider`) aísla la lógica de dominio de las implementaciones específicas de cada API, permitiendo intercambiar proveedores sin modificar el código de negocio. Las keys se almacenan en localStorage del browser y se envían al backend per-request via headers.

| Componente | Tecnología |
|---|---|
| Backend | FastAPI (Python) |
| Frontend | React + TypeScript |
| LLM (análisis narrativo) | API externa, BYOK, provider-agnostic. Requiere 200K+ contexto |
| Generación de imágenes | API externa, BYOK, provider-agnostic |
| Biblioteca musical | MTG-Jamendo (subset curado, ~200-500 tracks) |
| Audio | Web Audio API |
| Identificación de personajes | String matching contra lista NCM (nombres + aliases) |
| Almacenamiento NCM | JSON file-based (un directorio por libro) |

---

## 10. Camino de escalada

Si sobra tiempo y el sistema base funciona:

1. **Audio embeddings (CLAP/Music2Emo)** para matching musical más expresivo
2. **Prompt rewriting LLM** para mejorar imágenes on-demand de texto abstracto
3. **Consistencia avanzada de personajes** via LoRA o IP-Adapter
4. **Soporte PDF** (ingeniería, no investigación)
5. **Generación musical** en vez de retrieval (MusicGen, ACE-Step)
6. **Sora / video generativo** para escenas cinematográficas
7. **Multilingüe** (evaluar en español)
