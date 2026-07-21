# Recorrido Vuelo N142QS - Tributo a Lionel Messi

Este es un proyecto web especial e inmersivo en homenaje al más grande de todos los tiempos, Lionel Messi, siguiendo el recorrido de su vuelo de regreso a casa (Rosario, Argentina) desde Miami tras finalizar el Mundial 2026 como subcampeón del mundo.

## Características

- **Globo Terráqueo 3D Interactivo**: Desarrollado con Three.js y OrbitControls. Permite explorar el planeta, rotarlo y acercarse.
- **Ruta Geodésica Animada**: Representación en 3D de la trayectoria real entre Miami (KMIA) y Rosario (SAAR) con partículas en movimiento usando los colores de la bandera argentina.
- **Panel de Telemetría Dinámico**: Muestra en tiempo real datos como velocidad, altitud, coordenadas, distancia restante y porcentaje del viaje completado.
- **Controlador de Simulación**: Ajusta la velocidad de la simulación desde x1 (tiempo real) hasta x1000 para observar todo el viaje en segundos.
- **Sonido Inmersivo**: Un sintetizador generativo ambiental programado de forma nativa con **Web Audio API** que reproduce acordes épicos y atmosféricos en homenaje al capitán.
- **Diseño Glassmorphic Premium**: Interfaz moderna y adaptativa con tonos celestes, blancos, dorados y azul profundo espacial.

## Tecnologías Utilizadas

- **HTML5** (Semántico)
- **CSS3** (Personalizado con variables de color y blur)
- **JavaScript (ES6+)**
- **Three.js** (Renderizado 3D de alto rendimiento)
- **Web Audio API** (Sintetizador generativo de audio nativo)

## Cómo Ejecutar en Local

Puedes abrir directamente el archivo `index.html` en tu navegador, o usar un servidor local para una mejor experiencia de carga de recursos y módulos:

```bash
# Si tienes VS Code, puedes usar la extensión Live Server.
# O con Python en la terminal:
python -m http.server 8000
```
Luego visita `http://localhost:8000`.

## Despliegue

Este proyecto está diseñado para subirse a GitHub y publicarse automáticamente en plataformas como **Vercel** o **GitHub Pages**.
