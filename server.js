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

                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-2.5-flash',
                    contents: historialSesion,
                    config: { systemInstruction: systemPrompt, temperature: 0.7 }
                });

                let respuestaCompleta = "";
                for await (const chunk of responseStream) {
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

// --- FUNCIÓN PARA NORMALIZAR Y BLINDAR EL HISTORIAL PARA GEMINI ---
function prepararContents(historial, mensajeUsuario, imagenAdjunta) {
    let lista = [];

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

            // Evitamos turnos duplicados seguidos del mismo rol (ej: user seguido de user)
            if (lista.length > 0 && lista[lista.length - 1].role === role) {
                lista[lista.length - 1].parts[0].text += `\n${texto}`;
            } else {
                lista.push({ role, parts: [{ text: texto }] });
            }
        }
    } else if (mensajeUsuario) {
        lista.push({ role: 'user', parts: [{ text: mensajeUsuario }] });
    }

    // Si hay imagen adjunta, la pegamos en el último turno del usuario
    if (imagenAdjunta && imagenAdjunta.data && lista.length > 0) {
        const ultimoTurno = lista[lista.length - 1];
        if (ultimoTurno.role === 'user') {
            ultimoTurno.parts.push({
                inlineData: {
                    data: imagenAdjunta.data.split(',')[1],
                    mimeType: imagenAdjunta.mimeType
                }
            });
        }
    }

    return lista;
}

// --- RUTA: CHAT HTTP TRADICIONAL ---
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

        const contents = prepararContents(historial, mensajeUsuario, imagenAdjunta);

        if (contents.length === 0) {
            return res.status(400).json({ error: "El mensaje llegó vacío." });
        }

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: contents,
                config: { systemInstruction: systemPrompt, temperature: 0.7 }
            });
        } catch (errModel) {
            console.warn("⚠️ Reintentando con fallback gemini-2.0-flash...", errModel.message);
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: contents,
                config: { systemInstruction: systemPrompt, temperature: 0.7 }
            });
        }

        const textoRespuesta = response.text || "Che, me quedé recalculando. Probá preguntarme de nuevo.";
        return res.json({ respuesta: textoRespuesta });

    } catch (error) {
        console.error("❌ ERROR FATAL HTTP EN CHAT:", error);
        return res.status(500).json({ 
            error: error.message || "Error interno al consultar la IA" 
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`¡El servidor de Che.GPT corre en el puerto ${PORT}!`);
});
