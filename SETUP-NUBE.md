# Activar la nube (Firebase, plan gratuito)

1. Entra en https://console.firebase.google.com → **Crear proyecto** (sin Analytics).
2. **Build → Authentication → Comenzar → Email/Password → Activar**.
3. En Authentication → **Settings → Authorized domains** → añade `albertocontre24.github.io`.
4. **Build → Firestore Database → Crear base de datos** → modo producción → región `eur3`.
   En la pestaña **Rules** pega el contenido de `firestore.rules` y **Publicar**.
5. **Project settings (engranaje) → Your apps → Web (</>)** → registra la app → copia el objeto `firebaseConfig`.
6. Pégalo en `firebase-config.js`: `window.FIREBASE_CONFIG = { apiKey: "...", ... };`
   (esa configuración no es secreta; la seguridad la dan las reglas del paso 4).

## Compartir listas con amigos

Para que funcione el botón **Compartir** hay que actualizar las reglas de Firestore:
**Firestore Database → Reglas**, pega el contenido de `firestore.rules` y pulsa **Publicar**.
Las listas compartidas son de solo lectura y se abren con un enlace largo e imposible de adivinar.
