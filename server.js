require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const tmi = require('tmi.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

let estadoSorteo = {
    palabraClave: "",
    incluirRegulares: true,
    incluirSubs: true,
    incluirVips: true,
    incluirMods: true,
    participantes: [], // Lista de usuarios únicos
    ganador: null,
    oculto: true // Empieza oculto hasta que usen -show
};

const canalTwitch = process.env.TWITCH_CHANNEL ? process.env.TWITCH_CHANNEL.toLowerCase() : '';

const client = new tmi.Client({ channels: [canalTwitch] });
client.connect();

client.on('message', (channel, tags, message, self) => {
    if (self) return;

    let msg = message.trim().toLowerCase();
    let username = tags['username'] ? tags['username'].toLowerCase() : '';
    let miCanal = canalTwitch;
    
    // Identificar roles del usuario
    let esBroadcaster = (username === miCanal || (tags.badges && tags.badges.broadcaster));
    let esMod = tags.mod || esBroadcaster;
    let esVip = tags.vip || (tags.badges && tags.badges.vip);
    let esSub = tags.subscriber || (tags.badges && tags.badges.subscriber);
    let esRegular = !esMod && !esVip && !esSub;

    // --- COMANDOS DE CONTROL DESDE EL CHAT (Solo moderadores o el streamer) ---
    if (esMod) {
        if (msg.startsWith('-srt ')) {
            // Ejemplo: !sorteo a  (Define la letra o palabra clave)
            let parts = message.trim().split(' ');
            if (parts.length > 1) {
                estadoSorteo.palabraClave = parts[1].toLowerCase();
                estadoSorteo.participantes = []; // Reinicia participantes al cambiar de palabra
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

    // --- VALIDACIÓN DE PARTICIPACIÓN ---
    // Si el sorteo no está activo o la palabra está vacía, ignora
    if (estadoSorteo.oculto || !estadoSorteo.palabraClave) return;

    // Validar si el mensaje coincide exactamente con la letra/palabra o si la contiene (según prefieras)
    // Aquí validamos si el mensaje es exactamente igual a la palabra clave ingresada
    if (msg === estadoSorteo.palabraClave) {
        // Filtrar según los permisos configurados en el panel
        let permitido = false;
        if (esRegular && estadoSorteo.incluirRegulares) permitido = true;
        if (esSub && estadoSorteo.incluirSubs) permitido = true;
        if (esVip && estadoSorteo.incluirVips) permitido = true;
        if (esMod && estadoSorteo.incluirMods) permitido = true;

        if (permitido) {
            // Añadir a la lista si no está ya participando
            let nombreOriginal = tags['display-name'] || tags['username'];
            if (!estadoSorteo.participantes.some(p => p.toLowerCase() === username)) {
                estadoSorteo.participantes.push(nombreOriginal);
                broadcast();
            }
        }
    }
});

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
            console.error(e);
        }
    });
});

server.listen(3000, () => {
    console.log('--- SORTEO CON RULETA INICIADO ---');
    console.log(`Canal conectado: ${canalTwitch}`);
    console.log('Panel de Control: http://localhost:3000/control.html');
    console.log('Overlay para OBS: http://localhost:3000/overlay.html');
});