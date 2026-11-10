// carga las variables de entorno desde el archivo .env
require('dotenv').config();

// importa el framework express para levantar el servidor local
const express = require('express');

// importa axios para realizar peticiones http hacia la api de meta
const axios = require('axios');

// importa sqlite3 para manejar la base de datos relacional
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// inicializa la aplicacion de express
const app = express();

// configura express para que entienda formato json en las peticiones entrantes
app.use(express.json());

// variable global para la conexion a la base de datos
let db;

// funcion asincrona para conectar con la base de datos sqlite al iniciar
async function iniciardb() {
    db = await open({
        filename: './usae_bot.db',
        driver: sqlite3.Database
    });
    console.log('conectado a la base de datos sqlite exitosamente');
}

// ejecuta la conexion a la base de datos
iniciardb();

// endpoint tipo get para la verificacion del webhook requerida por meta
app.get('/webhook', (req, res) => {
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const reto = req.query['hub.challenge'];

    // validamos que el modo sea subscribe y el token coincida con el entorno
    if (modo === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        res.status(200).send(reto);
    } else {
        res.sendStatus(403);
    }
});

//endpoint tipo post para recibir los mensajes enviados por los usuarios
app.post('/webhook', async (req, res) => {
    const cuerpo = req.body;

    // validamos que la peticion provenga de una cuenta de whatsapp business
    if (cuerpo.object === 'whatsapp_business_account') {
        const entrada = cuerpo.entry?.[0];
        const cambios = entrada?.changes?.[0];
        const valor = cambios?.value;
        const mensaje = valor?.messages?.[0];

        //si el verifica si recibido es de tipo texto
        if (mensaje && mensaje.type === 'text') {
            const remitente = mensaje.from; 
            const texto = mensaje.text.body.trim();
            let respuesta = "";

            // intenta convertir el texto del usuario en un numero entero (id de tramite)
            const idbuscado = parseInt(texto);

            // si el usuario escribio un numero valido
            if (!isNaN(idbuscado)) {
                // consultamos el tramite y su departamento correspondiente en sqlite usando join
                const tramite = await db.get(`
                    SELECT t.*, d.nombre AS departamento, d.horario 
                    FROM tramites t 
                    JOIN departamentos d ON t.departamento_id = d.id 
                    WHERE t.id = ?
                `, [idbuscado]);

                // si encontramos el tramite construimos la respuesta detallada
                if (tramite) {
                    respuesta = `📋 *${tramite.nombre}*\n\n` +
                                `🏢 *departamento:* ${tramite.departamento}\n` +
                                `📌 *requisitos:*\n${tramite.requisitos}\n\n`;

                    if (tramite.link) {
                        respuesta += `🔗 *enlace:* ${tramite.link}\n`;
                    }
                    if (tramite.formato) {
                        respuesta += `📄 *formato:* ${tramite.formato}\n`;
                    }
                    respuesta += `💵 *costo:* ${tramite.costo}\n` +
                                 `🕒 *horario:* ${tramite.horario}`;
                } else {
                    respuesta = `⚠️ no se encontro ningun tramite con el id *${idbuscado}*. por favor verifica e intenta de nuevo.`;
                }

            } else if (texto.toLowerCase() === "menu" || texto.toLowerCase() === "menú") {
                // si el usuario pide el menu, consultamos todos los departamentos
                const deptos = await db.all('SELECT * FROM departamentos');
                respuesta = "departamentos disponibles usae-jr:\n\n";
                
                // recorre cada departamento y sus respectivos tramites para armar el submenu
                for (const d of deptos) {
                    respuesta += `${d.nombre}\n`;
                    const tramitesdepto = await db.all('SELECT id, nombre FROM tramites WHERE departamento_id = ?', [d.id]);
                    for (const t of tramitesdepto) {
                        respuesta += `  └ [${t.id}] ${t.nombre}\n`;
                    }
                    respuesta += "\n";
                }
                respuesta += "responde con el numero (id) del tramite que deseas consultar.";

            } else {
                // mensaje de bienvenida por defecto si escribe cualquier otra cosa
                respuesta = "¡Hola! Bienvenido al sistema de consultas automatizado de la USAE Juventino Rosas.\n\n" +
                             "Para comenzar y ver la lista completa de trámites disponibles por departamentos, escribe la palabra MENU.";
            }

            // enviamos la respuesta generada de regreso al usuario por whatsapp de forma dinamica
            await enviarmensajewhatsapp(remitente, respuesta);
        }

        // respondemos a meta que el mensaje fue procesado correctamente (evita el error 400 en webhook)
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
            </style>
        </head>
        <body>
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

                    // Mostrar mensaje del usuario
                    chatBox.innerHTML += \`<div class="message user">\${texto}</div>\`;
                    input.value = '';
                    chatBox.scrollTop = chatBox.scrollHeight;

                    // Enviar al servidor local simulando el webhook
                    const response = await fetch('/api-simular', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ texto })
                    });
                    const data = await response.json();

                    // Mostrar respuesta del bot
                    chatBox.innerHTML += \`<div class="message bot">\${data.respuesta.replace(/\\n/g, '<br>')}</div>\`;
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            </script>
        </body>
        </html>
    `);
});

// Endpoint auxiliar para procesar la prueba visual sin involucrar a Meta
app.post('/api-simular', async (req, res) => {
    const { texto } = req.body;
    let respuesta = "";
    const idbuscado = parseInt(texto);

    if (!isNaN(idbuscado)) {
        const tramite = await db.get(`
            SELECT t.*, d.nombre AS departamento, d.horario 
            FROM tramites t 
            JOIN departamentos d ON t.departamento_id = d.id 
            WHERE t.id = ?
        `, [idbuscado]);

        if (tramite) {
            respuesta = `📋 ${tramite.nombre}\n\n` +
                        `🏢 departamento: ${tramite.departamento}\n` +
                        `📌 requisitos:\n${tramite.requisitos}\n\n`;
            if (tramite.link) respuesta += `🔗 enlace: ${tramite.link}\n`;
            if (tramite.formato) respuesta += `📄 formato: ${tramite.formato}\n`;
            respuesta += `💵 costo: ${tramite.costo}\n🕒 horario: ${tramite.horario}`;
        } else {
            respuesta = `⚠️ No se encontró ningún trámite con el ID ${idbuscado}.`;
        }
    } else if (texto.toLowerCase() === "menu" || texto.toLowerCase() === "menú") {
        const deptos = await db.all('SELECT * FROM departamentos');
        respuesta = "Departamentos disponibles USAE-JR:\n\n";
        for (const d of deptos) {
            respuesta += `${d.nombre}\n`;
            const tramitesdepto = await db.all('SELECT id, nombre FROM tramites WHERE departamento_id = ?', [d.id]);
            for (const t of tramitesdepto) {
                respuesta += `  └ [${t.id}] ${t.nombre}\n`;
            }
            respuesta += "\n";
        }
    } else {
        respuesta = "¡Hola! Bienvenido al sistema de consultas automatizado de la USAE Juventino Rosas.\n\nEscribe MENU.";
    }

    res.json({ respuesta });
});



// el servidor local en el puerto 3000
app.listen(3000, () => console.log('servidor corriendo en el puerto 3000'))