require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const tmi = require('tmi.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

// Rutas amigables
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'control.html'));
});
app.get('/control', (req, res) => {
    res.sendFile(path.join(__dirname, 'control.html'));
});
app.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, 'overlay.html'));
});

let estadoSorteo = {
    palabraClave: "",
    incluirRegulares: true,
    incluirSubs: true,
    incluirVips: true,
    incluirMods: true,
    participantes: [],
    ganador: null,
    oculto: true
};

const canalTwitch = process.env.TWITCH_CHANNEL ? process.env.TWITCH_CHANNEL.toLowerCase() : '';

if (canalTwitch) {
    const client = new tmi.Client({ channels: [canalTwitch] });
    client.connect().catch(console.error);

    client.on('message', (channel, tags, message, self) => {
        if (self) return;

        let msg = message.trim().toLowerCase();
        let username = tags['username'] ? tags['username'].toLowerCase() : '';
        let miCanal = canalTwitch;
        
        let esBroadcaster = (username === miCanal || (tags.badges && tags.badges.broadcaster));
        let esMod = tags.mod || esBroadcaster;
        let esVip = tags.vip || (tags.badges && tags.badges.vip);
        let esSub = tags.subscriber || (tags.badges && tags.badges.subscriber);
        let esRegular = !esMod && !esVip && !esSub;

        if (esMod) {
            if (msg.startsWith('-srt ')) {
                let parts = message.trim().split(' ');
                if (parts.length > 1) {
                    estadoSorteo.palabraClave = parts[1].toLowerCase();
                    estadoSorteo.participantes = [];
                    estadoSorteo.ganador = null;
                    estadoSorteo.oculto = false;
                    broadcast();
                }
                return;
            }
            if (msg === '-showruleta') {
                estadoSorteo.oculto = false;
                broadcast();
                return;
            }
            if (msg === '-hideruleta') {
                estadoSorteo.oculto = true;
                broadcast();
                return;
            }
            if (msg === '-spin') {
                if (estadoSorteo.participantes.length > 0) {
                    let randomIndex = Math.floor(Math.random() * estadoSorteo.participantes.length);
                    estadoSorteo.ganador = estadoSorteo.participantes[randomIndex];
                    broadcast();
                }
                return;
            }
        }

        if (estadoSorteo.oculto || !estadoSorteo.palabraClave) return;

        if (msg === estadoSorteo.palabraClave) {
            let permitido = false;
            if (esRegular && estadoSorteo.incluirRegulares) permitido = true;
            if (esSub && estadoSorteo.incluirSubs) permitido = true;
            if (esVip && estadoSorteo.incluirVips) permitido = true;
            if (esMod && estadoSorteo.incluirMods) permitido = true;

            if (permitido) {
                let nombreOriginal = tags['display-name'] || tags['username'];
                if (!estadoSorteo.participantes.some(p => p.toLowerCase() === username)) {
                    estadoSorteo.participantes.push(nombreOriginal);
                    broadcast();
                }
            }
        }
    });
} else {
    console.warn("⚠️ ALERTA: TWITCH_CHANNEL no está definido en las variables de entorno.");
}

function broadcast() {
    const dataString = JSON.stringify(estadoSorteo);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(dataString);
        }
    });
}

wss.on('connection', (ws) => {
    ws.send(JSON.stringify(estadoSorteo));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'actualizarConfig') {
                estadoSorteo.palabraClave = data.palabra.toLowerCase();
                estadoSorteo.incluirRegulares = data.regulares;
                estadoSorteo.incluirSubs = data.subs;
                estadoSorteo.incluirVips = data.vips;
                estadoSorteo.incluirMods = data.mods;
                estadoSorteo.participantes = [];
                estadoSorteo.ganador = null;
                estadoSorteo.oculto = false;
                broadcast();
            } else if (data.action === 'mostrar') {
                estadoSorteo.oculto = false;
                broadcast();
            } else if (data.action === 'ocultar') {
                estadoSorteo.oculto = true;
                broadcast();
            } else if (data.action === 'elegirGanador') {
                if (estadoSorteo.participantes.length > 0) {
                    let randomIndex = Math.floor(Math.random() * estadoSorteo.participantes.length);
                    estadoSorteo.ganador = estadoSorteo.participantes[randomIndex];
                    broadcast();
                }
            } else if (data.action === 'reiniciar') {
                estadoSorteo.participantes = [];
                estadoSorteo.ganador = null;
                broadcast();
            }
        } catch (e) {
            console.error("Error procesando mensaje:", e);
        }
    });
});

// Puerto asignado dinámicamente por Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`--- SORTEO CON RULETA INICIADO EN PUERTO ${PORT} ---`);
    console.log(`Canal conectado: ${canalTwitch || 'Ninguno'}`);
});