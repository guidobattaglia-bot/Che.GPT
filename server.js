import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('./'));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Lista en cascada de modelos disponibles para recorrer
const MODELOS_CASCADA = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest'
];

// --- LÓGICA DE WEBSOCKETS (MODO LIVE / AUDIO) ---
wss.on('connection', (ws) => {
    let historialSesion = [];

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.tipo === 'mensaje') {
                historialSesion.push({ role: 'user', parts: [{ text: data.texto }] });
                const perfil = data.perfil || {};
                
                const systemPrompt = `Sos Che.GPT, una IA diseñada con identidad y cultura argentina.
                Provincia / Locación de la IA: ${perfil.provincia && perfil.provincia !== '---' ? perfil.provincia : 'Estándar / Neutral Argentina'}.
                El usuario con el que charlás es de: ${perfil.paisUsuario || 'Argentina'} ${perfil.provinciaUsuario && perfil.provinciaUsuario !== '---' ? '(' + perfil.provinciaUsuario + ')' : ''}.

                REGLAS DE UBICACIÓN Y VOCABULARIO:
                - Si el usuario es de otro país hispanoparlante, representá a Argentina como un embajador cultural. Explicá con paciencia nuestras costumbres si te pregunta, pero mantené tu voseo y modismos argentinos.
                - Riqueza de vocabulario (0 a 10): ${perfil.tono ?? 5}.
                - Extensión de respuesta (0 a 10): ${perfil.extension ?? 5}.

                EL CREADOR (EASTER EGG VITAL):
                - Si el usuario te pregunta quién te creó, quién te programó, quién te hizo o cómo estás construido, tenés que responder con muchísimo orgullo que fuiste diseñado y programado por el Licenciado Guido B. Agregá que es un desarrollador y arquitecto de software de primer nivel, e invitá al usuario a contactarlo en su Instagram (@guidobgl).

                Parámetros extra: Confianza ${perfil.confianza ?? 8}, Empatía ${perfil.empatia ?? 8}, Humor ${perfil.humor ?? 8}.
                Respondé de forma fluida y conversacional.`;

                // Bucle de cascada para WebSockets
                let streamExitoso = null;
                for (const modelo of MODELOS_CASCADA) {
                    try {
                        streamExitoso = await ai.models.generateContentStream({
                            model: modelo,
                            contents: historialSesion,
                            config: { systemInstruction: systemPrompt, temperature: 0.7 }
                        });
                        if (streamExitoso) break;
                    } catch (errStream) {
                        console.warn(`⚠️ WS Falló modelo ${modelo}, pasando al siguiente...`);
                    }
                }

                if (!streamExitoso) {
                    throw new Error("Ningún modelo de la cascada respondió en WS.");
                }

                let respuestaCompleta = "";
                for await (const chunk of streamExitoso) {
                    if (chunk.text) {
                        respuestaCompleta += chunk.text;
                        ws.send(JSON.stringify({ tipo: 'chunk', texto: chunk.text }));
                    }
                }
                
                historialSesion.push({ role: 'model', parts: [{ text: respuestaCompleta }] });
                ws.send(JSON.stringify({ tipo: 'fin' })); 
            }
        } catch (error) {
            console.error("❌ Error WS:", error);
            ws.send(JSON.stringify({ tipo: 'error', texto: "¡Se cortó la línea!" }));
        }
    });
});

// --- NORMALIZACIÓN DEL HISTORIAL PARA EVITAR ERRORES DE TURNOS (400) ---
function normalizarHistorial(historial, mensajeUsuario, imagenAdjunta) {
    let turnos = [];

    if (Array.isArray(historial) && historial.length > 0) {
        for (const item of historial) {
            const role = item.role === 'model' ? 'model' : 'user';
            let texto = '';
            
            if (Array.isArray(item.parts)) {
                texto = item.parts.map(p => (typeof p === 'string' ? p : p.text || '')).join(' ').trim();
            } else if (typeof item.parts === 'string') {
                texto = item.parts.trim();
            }

            if (!texto) continue;

            // Fusión de turnos repetidos consecutivos para que Gemini nunca tire 400
            if (turnos.length > 0 && turnos[turnos.length - 1].role === role) {
                turnos[turnos.length - 1].parts[0].text += `\n${texto}`;
            } else {
                turnos.push({ role, parts: [{ text: texto }] });
            }
        }
    } else if (mensajeUsuario) {
        turnos.push({ role: 'user', parts: [{ text: mensajeUsuario }] });
    }

    if (imagenAdjunta && imagenAdjunta.data && turnos.length > 0) {
        const ultimo = turnos[turnos.length - 1];
        if (ultimo.role === 'user') {
            ultimo.parts.push({
                inlineData: {
                    data: imagenAdjunta.data.split(',')[1],
                    mimeType: imagenAdjunta.mimeType
                }
            });
        }
    }

    return turnos;
}

// --- RUTA: CHAT HTTP TRADICIONAL CON CASCADA ---
app.post('/chat', async (req, res) => {
    try {
        const { historial, mensajeUsuario, perfil = {}, imagenAdjunta } = req.body;

        const systemPrompt = `Sos Che.GPT, una IA diseñada con identidad y cultura argentina.
        Provincia / Locación de la IA: ${perfil.provincia && perfil.provincia !== '---' ? perfil.provincia : 'Estándar / Neutral Argentina'}.
        El usuario con el que charlás es de: ${perfil.paisUsuario || 'Argentina'} ${perfil.provinciaUsuario && perfil.provinciaUsuario !== '---' ? '(' + perfil.provinciaUsuario + ')' : ''}.

        REGLAS DE UBICACIÓN Y VOCABULARIO:
        - Si el usuario es de otro país hispanoparlante, representá a Argentina como un embajador cultural. Explicá con paciencia nuestras costumbres si te pregunta, pero mantené tu voseo y modismos argentinos.
        - Riqueza de vocabulario (0 a 10): ${perfil.tono ?? 5}.
        - Extensión de respuesta (0 a 10): ${perfil.extension ?? 5}.

        EL CREADOR (EASTER EGG VITAL):
        - Si el usuario te pregunta quién te creó, quién te programó, quién te hizo o cómo estás construido, tenés que responder con muchísimo orgullo que fuiste diseñado y programado por el Licenciado Guido B. Agregá que es un desarrollador y arquitecto de software de primer nivel, e invitá al usuario a contactarlo en su Instagram (@guidobgl).

        Parámetros extra: Confianza ${perfil.confianza ?? 8}, Empatía ${perfil.empatia ?? 8}, Humor ${perfil.humor ?? 8}.
        Respondé de forma fluida y conversacional.`;

        const contents = normalizarHistorial(historial, mensajeUsuario, imagenAdjunta);

        if (contents.length === 0) {
            return res.status(400).json({ error: "El mensaje llegó vacío." });
        }

        let respuestaFinal = null;
        let erroresAcumulados = [];

        // RECORRIDO EN CASCADA
        for (const modelo of MODELOS_CASCADA) {
            try {
                console.log(`🤖 Intentando con modelo: ${modelo}...`);
                const response = await ai.models.generateContent({
                    model: modelo,
                    contents: contents,
                    config: { systemInstruction: systemPrompt, temperature: 0.7 }
                });

                if (response && response.text) {
                    respuestaFinal = response.text;
                    console.log(`✅ ¡Éxito con ${modelo}!`);
                    break; // Cortamos el bucle porque ya respondió
                }
            } catch (err) {
                console.warn(`⚠️ Modelo ${modelo} falló: ${err.message}`);
                erroresAcumulados.push(`${modelo}: ${err.message}`);
            }
        }

        if (respuestaFinal) {
            return res.json({ respuesta: respuestaFinal });
        } else {
            console.error("❌ Todos los modelos de la cascada fallaron:", erroresAcumulados);
            return res.status(500).json({ 
                error: `Agoté todas las opciones de motor. Detalle: ${erroresAcumulados[0] || 'Error desconocido'}` 
            });
        }

    } catch (error) {
        console.error("❌ ERROR FATAL HTTP EN CHAT:", error);
        return res.status(500).json({ 
            error: error.message || "Error interno general en el servidor." 
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`¡El servidor de Che.GPT corre en el puerto ${PORT}!`);
});
