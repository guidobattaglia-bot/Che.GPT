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

// --- LÓGICA DE WEBSOCKETS ---
wss.on('connection', (ws) => {
    console.log('🎙️ ¡Cliente conectado al túnel de WebSockets!');
    let historialSesion = [];

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.tipo === 'mensaje') {
                historialSesion.push(data.texto);
                
                const perfil = data.perfil;
                
                const systemPrompt = `Sos Che.GPT, una IA diseñada con identidad y cultura argentina.
                Provincia / Locación de la IA: ${perfil.provincia !== '---' ? perfil.provincia : 'Estándar / Neutral Argentina'}.
                El usuario con el que charlás es de: ${perfil.paisUsuario} ${perfil.provinciaUsuario !== '---' ? '(' + perfil.provinciaUsuario + ')' : ''}.

                REGLAS DE UBICACIÓN Y VOCABULARIO:
                - Si el usuario es de otro país hispanoparlante, representá a Argentina como un embajador cultural. Explicá con paciencia nuestras costumbres si te pregunta, pero mantené tu voseo y modismos argentinos.
                - Riqueza de vocabulario (0 a 10): ${perfil.tono}. (0 = lunfardo básico y muy coloquial; 10 = léxico extremadamente rico, uso de sinónimos refinados, lenguaje más formal y elaborado, pero siempre coherente con tu edad de ${perfil.edad} años).
                - Extensión de respuesta (0 a 10): ${perfil.extension}.

                EL CREADOR (EASTER EGG VITAL):
                - Si el usuario te pregunta quién te creó, quién te programó, quién te hizo o cómo estás construido, tenés que responder con muchísimo orgullo que fuiste diseñado y programado por el Licenciado Guido B. Agregá que es un desarrollador y arquitecto de software de primer nivel, e invitá al usuario a contactarlo en su Instagram (@guidobgl) si necesitan a alguien para armar proyectos tecnológicos zarpados y bien pagos.

                Parámetros extra: Confianza ${perfil.confianza}, Empatía ${perfil.empatia}, Humor ${perfil.humor}.
                Respondé de forma fluida y conversacional.`;

                const responseStream = await ai.models.generateContentStream({
                    model: 'gemini-3.6-flash',
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
                
                historialSesion.push(respuestaCompleta);
                ws.send(JSON.stringify({ tipo: 'fin' })); 
            }
        } catch (error) {
            console.error("❌ Error WS:", error);
            ws.send(JSON.stringify({ tipo: 'error', texto: "¡Se cortó la línea!" }));
        }
    });

    ws.on('close', () => console.log('🔴 Cliente desconectado.'));
});

// --- RUTA: AUDIO A PEDIDO (BOTÓN PARLANTE) ---
app.post('/tts', async (req, res) => {
    try {
        const { texto } = req.body;
        const elevenResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
            method: 'POST',
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: texto, model_id: "eleven_multilingual_v2" })
        });

        if (!elevenResponse.ok) {
            const detalleError = await elevenResponse.text();
            throw new Error(`Código ${elevenResponse.status}: ${detalleError}`);
        }

        const arrayBuffer = await elevenResponse.arrayBuffer();
        const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
        res.json({ audioBase64 });
    } catch (error) {
        console.error("❌ Error TTS a pedido:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- LÓGICA TRADICIONAL HTTP (CHAT DE TEXTO E IMÁGENES) ---
app.post('/chat', async (req, res) => {
    try {
        const { mensajeUsuario, perfil, imagenAdjunta } = req.body;

        const esPedidoDeImagen = /dibuj|imagen|generame|generar|crea|foto/i.test(mensajeUsuario);

        if (esPedidoDeImagen) {
            try {
                let promptEnIngles = mensajeUsuario; 
                try {
                    const promptTraductor = `Extrae la idea visual de: "${mensajeUsuario}". Escribe un prompt en inglés para Stable Diffusion. Solo el prompt.`;
                    const resultOptimizacion = await ai.models.generateContent({ model: 'gemini-3.6-flash', contents: [promptTraductor] });
                    promptEnIngles = resultOptimizacion.text.trim();
                } catch (e) {}

                const hfResponse = await fetch("https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0", {
                    headers: { Authorization: `Bearer ${process.env.HF_API_KEY}`, "Content-Type": "application/json" },
                    method: "POST", body: JSON.stringify({ inputs: promptEnIngles })
                });

                if (!hfResponse.ok) throw new Error(hfResponse.statusText);
                const arrayBuffer = await hfResponse.arrayBuffer();
                const imageUrl = `data:image/jpeg;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
                return res.json({ respuesta: `¡Acá tenés la placa, compa!`, imagenGenerada: imageUrl });
            } catch (errImg) {
                return res.json({ respuesta: `¡Uy! Falló el motor de imágenes.` });
            }
        }

        const systemPrompt = `Sos Che.GPT, una IA diseñada con identidad y cultura argentina.
        Provincia / Locación de la IA: ${perfil.provincia !== '---' ? perfil.provincia : 'Estándar / Neutral Argentina'}.
        El usuario con el que charlás es de: ${perfil.paisUsuario} ${perfil.provinciaUsuario !== '---' ? '(' + perfil.provinciaUsuario + ')' : ''}.

        REGLAS DE UBICACIÓN Y VOCABULARIO:
        - Si el usuario es de otro país hispanoparlante, representá a Argentina como un embajador cultural. Explicá con paciencia nuestras costumbres si te pregunta, pero mantené tu voseo y modismos argentinos.
        - Riqueza de vocabulario (0 a 10): ${perfil.tono}. (0 = lunfardo básico y muy coloquial; 10 = léxico extremadamente rico, uso de sinónimos refinados, lenguaje más formal y elaborado, pero siempre coherente con tu edad de ${perfil.edad} años).
        - Extensión de respuesta (0 a 10): ${perfil.extension}.

        EL CREADOR (EASTER EGG VITAL):
        - Si el usuario te pregunta quién te creó, quién te programó, quién te hizo o cómo estás construido, tenés que responder con muchísimo orgullo que fuiste diseñado y programado por el Licenciado Guido B. Agregá que es un desarrollador y arquitecto de software de primer nivel, e invitá al usuario a contactarlo en su Instagram (@guidobgl) si necesitan a alguien para armar proyectos tecnológicos zarpados y bien pagos.

        Parámetros extra: Confianza ${perfil.confianza}, Empatía ${perfil.empatia}, Humor ${perfil.humor}.
        Respondé de forma fluida y conversacional.`;

        let contents = [mensajeUsuario];
        if (imagenAdjunta) contents.push({ inlineData: { data: imagenAdjunta.data.split(',')[1], mimeType: imagenAdjunta.mimeType } });

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: contents,
            config: { systemInstruction: systemPrompt, temperature: 0.7 }
        });

        res.json({ respuesta: response.text });

    } catch (error) {
        console.error("❌ ERROR FATAL HTTP:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`¡El servidor de Che.GPT corre en http://localhost:${PORT}!`);
});