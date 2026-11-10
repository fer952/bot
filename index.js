require('dotenv').config();

const path = require('path');
const express = require('express');
const axios = require('axios');
const { abrirDatabase } = require('./db');
const { asegurarEsquema } = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

function obtenerConfig() {
    const fila = db.prepare('SELECT * FROM configuracion WHERE id = 1').get() || {};
    const publicUrl = (fila.public_url || process.env.PUBLIC_URL || '').replace(/\/$/, '');
    return {
        whatsapp_token: fila.whatsapp_token || process.env.WHATSAPP_TOKEN || '',
        phone_number_id: fila.phone_number_id || process.env.PHONE_NUMBER_ID || '',
        verify_token: fila.verify_token || process.env.VERIFY_TOKEN || '',
        api_version: fila.api_version || process.env.API_VERSION || 'v26.0',
        puerto: Number(fila.puerto || process.env.PORT || 3000),
        public_url: publicUrl,
        webhook_url: publicUrl ? `${publicUrl}/webhook` : '',
        actualizado_en: fila.actualizado_en || null
    };
}

function configLista(cfg) {
    return Boolean(cfg.whatsapp_token && cfg.phone_number_id && cfg.verify_token);
}

function guardarMensaje(telefono, rol, texto, origen = 'whatsapp') {
    db.prepare(`
        INSERT INTO mensajes (telefono, rol, texto, origen)
        VALUES (?, ?, ?, ?)
    `).run(String(telefono), rol, texto, origen);
}

function generarRespuesta(texto) {
    const idbuscado = parseInt(texto, 10);

    if (!isNaN(idbuscado)) {
        const tramite = db.prepare(`
            SELECT t.*, d.nombre AS departamento, d.horario
            FROM tramites t
            JOIN departamentos d ON t.departamento_id = d.id
            WHERE t.id = ?
        `).get(idbuscado);

        if (tramite) {
            let respuesta =
                `📋 *${tramite.nombre}*\n\n` +
                `🏢 *departamento:* ${tramite.departamento}\n` +
                `📌 *requisitos:*\n${tramite.requisitos}\n\n`;

            if (tramite.link) respuesta += `🔗 *enlace:* ${tramite.link}\n`;
            if (tramite.formato) respuesta += `📄 *formato:* ${tramite.formato}\n`;
            respuesta +=
                `💵 *costo:* ${tramite.costo}\n` +
                `🕒 *horario:* ${tramite.horario}`;
            return respuesta;
        }

        return `⚠️ no se encontro ningun tramite con el id *${idbuscado}*. por favor verifica e intenta de nuevo.`;
    }

    const normalizado = texto.toLowerCase();
    if (normalizado === 'menu' || normalizado === 'menú') {
        const deptos = db.prepare('SELECT * FROM departamentos').all();
        let respuesta = 'departamentos disponibles usae-jr:\n\n';

        for (const d of deptos) {
            respuesta += `${d.nombre}\n`;
            const tramitesdepto = db.prepare(
                'SELECT id, nombre FROM tramites WHERE departamento_id = ?'
            ).all(d.id);
            for (const t of tramitesdepto) {
                respuesta += `  └ [${t.id}] ${t.nombre}\n`;
            }
            respuesta += '\n';
        }

        respuesta += 'responde con el numero (id) del tramite que deseas consultar.';
        return respuesta;
    }

    return (
        '¡Hola! Bienvenido al sistema de consultas automatizado de la USAE Juventino Rosas.\n\n' +
        'Para comenzar y ver la lista completa de trámites disponibles por departamentos, escribe la palabra MENU.'
    );
}

async function enviarmensajewhatsapp(destinatario, texto) {
    const cfg = obtenerConfig();
    if (!configLista(cfg)) {
        console.error('Falta configurar token / phone number id / verify token en el panel.');
        return false;
    }

    try {
        await axios.post(
            `https://graph.facebook.com/${cfg.api_version}/${cfg.phone_number_id}/messages`,
            {
                messaging_product: 'whatsapp',
                to: destinatario,
                type: 'text',
                text: { body: texto }
            },
            {
                headers: {
                    Authorization: `Bearer ${cfg.whatsapp_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return true;
    } catch (error) {
        console.error('Error al enviar mensaje con Axios:', error.response?.data || error.message);
        return false;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/config', (req, res) => {
    const cfg = obtenerConfig();
    res.json({
        ...cfg,
        configurada: configLista(cfg),
        webhook_listo: Boolean(cfg.verify_token && cfg.webhook_url)
    });
});

app.put('/api/config', (req, res) => {
    const actual = obtenerConfig();
    const {
        whatsapp_token = actual.whatsapp_token,
        phone_number_id = actual.phone_number_id,
        verify_token = actual.verify_token,
        api_version = actual.api_version,
        puerto = actual.puerto,
        public_url = actual.public_url
    } = req.body || {};

    if (!String(verify_token).trim()) {
        return res.status(400).json({ error: 'verify_token es obligatorio' });
    }

    const puertoNum = Number(puerto);
    if (!Number.isInteger(puertoNum) || puertoNum < 1 || puertoNum > 65535) {
        return res.status(400).json({ error: 'puerto inválido' });
    }

    db.prepare(`
        UPDATE configuracion
        SET whatsapp_token = ?,
            phone_number_id = ?,
            verify_token = ?,
            api_version = ?,
            puerto = ?,
            public_url = ?,
            actualizado_en = datetime('now','localtime')
        WHERE id = 1
    `).run(
        String(whatsapp_token || '').trim(),
        String(phone_number_id || '').trim(),
        String(verify_token).trim(),
        String(api_version || 'v26.0').trim(),
        puertoNum,
        String(public_url || '').trim().replace(/\/$/, '')
    );

    const cfg = obtenerConfig();
    res.json({
        ok: true,
        ...cfg,
        configurada: configLista(cfg),
        webhook_listo: Boolean(cfg.verify_token && cfg.webhook_url)
    });
});

app.get('/api/conversaciones', (req, res) => {
    const filas = db.prepare(`
        SELECT m.telefono,
               m.texto AS ultimo_texto,
               m.rol AS ultimo_rol,
               m.creado_en AS ultima_fecha,
               (
                 SELECT COUNT(*) FROM mensajes x WHERE x.telefono = m.telefono
               ) AS total
        FROM mensajes m
        INNER JOIN (
            SELECT telefono, MAX(id) AS max_id
            FROM mensajes
            GROUP BY telefono
        ) u ON u.max_id = m.id
        ORDER BY m.id DESC
    `).all();

    res.json(filas);
});

app.get('/api/conversaciones/:telefono', (req, res) => {
    const mensajes = db.prepare(`
        SELECT id, telefono, rol, texto, origen, creado_en
        FROM mensajes
        WHERE telefono = ?
        ORDER BY id ASC
    `).all(req.params.telefono);

    res.json(mensajes);
});

app.post('/api/conversaciones/:telefono/responder', async (req, res) => {
    const telefono = String(req.params.telefono || '').trim();
    const texto = String(req.body?.texto || '').trim();

    if (!telefono || !texto) {
        return res.status(400).json({ error: 'telefono y texto son obligatorios' });
    }

    if (telefono === 'demo-local') {
        guardarMensaje(telefono, 'bot', texto, 'panel');
        return res.json({ ok: true, enviado: false, origen: 'panel' });
    }

    const enviado = await enviarmensajewhatsapp(telefono, texto);
    if (!enviado) {
        return res.status(502).json({
            error: 'No se pudo enviar por WhatsApp. Revisa token y Phone Number ID.'
        });
    }

    guardarMensaje(telefono, 'bot', texto, 'panel');
    res.json({ ok: true, enviado: true, origen: 'panel' });
});

app.get('/webhook', (req, res) => {
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const reto = req.query['hub.challenge'];
    const cfg = obtenerConfig();

    if (modo === 'subscribe' && token === cfg.verify_token) {
        res.status(200).send(reto);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    const cuerpo = req.body;

    if (cuerpo.object === 'whatsapp_business_account') {
        const entrada = cuerpo.entry?.[0];
        const cambios = entrada?.changes?.[0];
        const valor = cambios?.value;
        const mensaje = valor?.messages?.[0];

        if (mensaje && mensaje.type === 'text') {
            const remitente = mensaje.from;
            const texto = mensaje.text.body.trim();

            guardarMensaje(remitente, 'usuario', texto, 'whatsapp');
            const respuesta = generarRespuesta(texto);
            guardarMensaje(remitente, 'bot', respuesta, 'whatsapp');
            await enviarmensajewhatsapp(remitente, respuesta);
        }

        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// Función oficial para enviar mensajes a través de la API Cloud de Meta
async function enviarmensajewhatsapp(destinatario, texto) {
    try {
        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: destinatario,
                type: "text",
                text: { body: texto }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("Mensaje enviado con éxito a Meta para el usuario:", destinatario);
    } catch (error) {
        console.error("Error al enviar mensaje con Axios a Meta:", error.response?.data || error.message);
    }
}

// Ruta visual web para demostrar el funcionamiento del bot en el navegador
app.get('/demo', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Simulador Chatbot USAE Juventino Rosas</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .chat-container { width: 400px; background: white; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; flex-direction: column; overflow: hidden; }
                .chat-header { background: #075e54; color: white; padding: 15px; text-align: center; font-weight: bold; }
                .chat-messages { flex: 1; padding: 15px; overflow-y: auto; max-height: 400px; background: #e5ddd5; display: flex; flex-direction: column; gap: 10px; }
                .message { padding: 10px 14px; border-radius: 8px; max-width: 80%; white-space: pre-wrap; font-size: 14px; line-height: 1.4; }
                .user { background: #dcf8c6; align-self: flex-end; }
                .bot { background: white; align-self: flex-start; }
                .chat-input { display: flex; padding: 10px; background: #f0f2f5; border-top: 1px solid #ddd; }
                .chat-input input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; outline: none; }
                .chat-input button { background: #075e54; color: white; border: none; padding: 10px 15px; margin-left: 5px; border-radius: 4px; cursor: pointer; }
                .top { position: fixed; top: 16px; left: 16px; }
                .top a { color: #075e54; font-weight: bold; text-decoration: none; background: white; padding: 8px 12px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="top"><a href="/">← Panel de configuración</a></div>
            <div class="chat-container">
                <div class="chat-header">Bot USAE Juventino Rosas (Simulador)</div>
                <div class="chat-messages" id="chatBox">
                    <div class="message bot">¡Hola Bienvenido al sistema de consultas USAE Jr! Escribe "MENU" para consultar el tramite que deseas.</div>
                </div>
                <div class="chat-input">
                    <input type="text" id="userInput" placeholder="Escribe un mensaje..." onkeypress="if(event.key === 'Enter') enviarMensaje()">
                    <button onclick="enviarMensaje()">Enviar</button>
                </div>
            </div>

            <script>
                async function enviarMensaje() {
                    const input = document.getElementById('userInput');
                    const chatBox = document.getElementById('chatBox');
                    const texto = input.value.trim();
                    if(!texto) return;

                    chatBox.innerHTML += \`<div class="message user">\${texto}</div>\`;
                    input.value = '';
                    chatBox.scrollTop = chatBox.scrollHeight;

                    const response = await fetch('/api-simular', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ texto })
                    });
                    const data = await response.json();

                    chatBox.innerHTML += \`<div class="message bot">\${data.respuesta.replace(/\\n/g, '<br>')}</div>\`;
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/api-simular', (req, res) => {
    const texto = String(req.body?.texto || '').trim();
    const telefonoDemo = 'demo-local';

    if (!texto) {
        return res.status(400).json({ error: 'texto requerido' });
    }

    guardarMensaje(telefonoDemo, 'usuario', texto, 'demo');
    const respuesta = generarRespuesta(texto);
    guardarMensaje(telefonoDemo, 'bot', respuesta, 'demo');

    res.json({ respuesta });
});

async function main() {
    db = await abrirDatabase();
    asegurarEsquema(db);
    console.log('conectado a la base de datos sqlite exitosamente');

    const cfgInicial = obtenerConfig();
    const puerto = cfgInicial.puerto || 3000;

    app.listen(puerto, () => {
        console.log(`servidor corriendo en http://localhost:${puerto}`);
        console.log(`panel de configuración: http://localhost:${puerto}/`);
        console.log(`simulador: http://localhost:${puerto}/demo`);
        if (!configLista(cfgInicial)) {
            console.log('aviso: configura el token permanente desde el panel web');
        }
    });
}

main().catch((error) => {
    console.error('No se pudo iniciar el bot:', error);
    process.exit(1);
});
