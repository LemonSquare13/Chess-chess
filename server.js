const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');
const Chess = require('./chess.js');
const Auth = require('./auth.js');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));

const PORT = 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const cacheHeader = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': cacheHeader, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, filePath);
});

const players = new Map();
const rooms = new Map();
const rawSockets = new Map();
let socketCounter = 1;

function getRoomsList() {
  const list = [];
  for (const r of rooms.values()) {
    list.push({
      id: r.id, name: r.name,
      hostName: r.hostName || 'Unknown',
      white: r.whiteName || null,
      black: r.blackName || null,
      spectators: r.spectatorNames.length, status: r.game.status, startTime: r.startTime
    });
  }
  return list;
}

function getRoomDetails(roomId) {
  const r = rooms.get(roomId);
  if (!r) return null;
  return {
    id: r.id, name: r.name, hostName: r.hostName,
    white: r.whiteName ? { id: r.whiteName, name: r.whiteName } : null,
    black: r.blackName ? { id: r.blackName, name: r.blackName } : null,
    spectators: r.spectatorNames.map(n => ({ id: n, name: n })),
    gameState: { 
      board: r.game.board, 
      turn: r.game.turn, 
      status: r.game.status, 
      winner: r.game.winner, 
      legalMoves: r.game.generateMoves(r.game.turn), 
      moveHistory: r.game.moveHistory, 
      lastMove: r.game.lastMove,
      inCheck: { w: r.game.isCheck('w'), b: r.game.isCheck('b') }
    },
    selection: r.selection || { w: null, b: null },
    startTime: r.startTime,
    restartRequestedBy: r.restartRequestedBy || null,
    drawRequestedBy: r.drawRequestedBy || null
  };
}

function broadcastRoomsList() { broadcast(JSON.stringify({ type: 'rooms_list', rooms: getRoomsList() })); }
function broadcastRoomState(roomId) {
  const r = rooms.get(roomId); if (!r) return;
  const state = { type: 'room_state', room: getRoomDetails(roomId) };
  const inRoomNames = [r.whiteName, r.blackName, ...r.spectatorNames].filter(n => n !== null);
  
  for (const pId of players.keys()) {
    const p = players.get(pId);
    if (inRoomNames.includes(p.name)) sendToSocket(pId, state);
  }
}

server.on('upgrade', (req, socket, head) => {
  if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  
  try {
    const acceptKey = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');
  } catch (e) { socket.destroy(); return; }
  
  const socketId = 'sock_' + (socketCounter++);
  rawSockets.set(socketId, socket);
  socket.setNoDelay(true);
  const client = { socket, socketId, buffer: Buffer.alloc(0) };
  
  socket.on('data', (chunk) => {
    try {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length >= 2) {
        const opcode = client.buffer[0] & 0x0f;
        const isMasked = (client.buffer[1] & 0x80) === 0x80;
        let payloadLength = client.buffer[1] & 0x7f;
        let offset = 2;
        
        if (payloadLength === 126) { 
          if (client.buffer.length < 4) break; 
          payloadLength = client.buffer.readUInt16BE(2); offset += 2; 
        } else if (payloadLength === 127) { 
          if (client.buffer.length < 10) break; 
          const len = Number(client.buffer.readBigUInt64BE(2)); offset += 8; payloadLength = len; 
        }
        
        if (isMasked) {
          if (client.buffer.length < offset + 4 + payloadLength) break;
          const mask = client.buffer.subarray(offset, offset + 4); offset += 4;
          const payload = client.buffer.subarray(offset, offset + payloadLength);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
          
          if (opcode === 0x1) {
            try { handleMessage(client, JSON.parse(payload.toString('utf8'))); } catch (e) { }
          }
          client.buffer = client.buffer.subarray(offset + payloadLength); 
        } else {
          client.buffer = client.buffer.subarray(offset + payloadLength);
        }
        
        if (opcode === 0x8) { handleDisconnect(client); return; }
      }
    } catch (e) { }
  });
  socket.on('close', () => { rawSockets.delete(socketId); handleDisconnect(client); });
  socket.on('error', () => { rawSockets.delete(socketId); handleDisconnect(client); });
});

function handleMessage(client, msg) {
  if (msg.type === 'get_users') {
    sendToSocket(client.socketId, { type: 'users_list', users: Auth.getUsersList() });
  }
  else if (msg.type === 'register_user') {
    if (Auth.registerUser(msg.username)) {
      broadcast(JSON.stringify({ type: 'users_list', users: Auth.getUsersList() }));
      sendToSocket(client.socketId, { type: 'register_success', username: msg.username });
    } else {
      sendToSocket(client.socketId, { type: 'error', text: 'Username already exists.' });
    }
  }
  else if (msg.type === 'login') {
    if (typeof msg.username !== 'string' || !/^[A-Za-z0-9_-]{2,18}$/.test(msg.username)) { sendToSocket(client.socketId, { type: 'error', text: 'Invalid username.' }); return; }
    const user = Auth.getUser(msg.username);
    if (!user) { sendToSocket(client.socketId, { type: 'error', text: 'User not found' }); return; }
    
    const existingSession = Auth.getSession(msg.username);
    if (existingSession && existingSession !== client.socketId) {
      if (user.isLocked) {
        sendToSocket(existingSession, { type: 'login_approval_request', username: msg.username, newSocketId: client.socketId });
        sendToSocket(client.socketId, { type: 'waiting_approval', text: 'Waiting for user approval...' });
        return;
      }
      sendToSocket(client.socketId, { type: 'force_login_prompt', username: msg.username });
      return;
    }

    if (user.password && user.password !== msg.password) {
      sendToSocket(client.socketId, { type: 'error', text: 'Incorrect password' }); return;
    }

    Auth.setSession(msg.username, client.socketId);
    players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
    
    let userRoomId = null;
    for (const r of rooms.values()) {
      if (r.whiteName === msg.username || r.blackName === msg.username || r.spectatorNames.includes(msg.username)) {
        userRoomId = r.id; break;
      }
    }

    sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
    
    if (userRoomId) {
      players.get(client.socketId).roomId = userRoomId;
      sendToSocket(client.socketId, { type: 'joined_room', room: getRoomDetails(userRoomId) });
    } else {
      sendToSocket(client.socketId, { type: 'rooms_list', rooms: getRoomsList() });
    }
    
    broadcast(JSON.stringify({ type: 'system', text: `${msg.username} logged in.` }));
  }
  else if (msg.type === 'master_login') {
    const admin = Auth.getUser('admin');
    if (admin && msg.masterKey === admin.masterKey) {
      const oldSession = Auth.getSession(msg.username);
      if (oldSession) { sendToSocket(oldSession, { type: 'kicked' }); players.delete(oldSession); }
      
      Auth.setSession(msg.username, client.socketId);
      players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
      
      let userRoomId = null;
      for (const r of rooms.values()) {
        if (r.whiteName === msg.username || r.blackName === msg.username || r.spectatorNames.includes(msg.username)) { userRoomId = r.id; break; }
      }

      sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
      if (userRoomId) {
        players.get(client.socketId).roomId = userRoomId;
        sendToSocket(client.socketId, { type: 'joined_room', room: getRoomDetails(userRoomId) });
      } else {
        sendToSocket(client.socketId, { type: 'rooms_list', rooms: getRoomsList() });
      }
      broadcast(JSON.stringify({ type: 'system', text: `Admin Override: ${msg.username} logged in.` }));
    } else { sendToSocket(client.socketId, { type: 'error', text: 'Invalid Master Key' }); }
  }
  else if (msg.type === 'force_login') {
    const oldSession = Auth.getSession(msg.username);
    if (oldSession) { sendToSocket(oldSession, { type: 'kicked' }); players.delete(oldSession); }
    Auth.setSession(msg.username, client.socketId);
    players.set(client.socketId, { id: client.socketId, name: msg.username, socket: client.socket, isOnline: true, roomId: null, isGuest: false });
    
    let userRoomId = null;
    for (const r of rooms.values()) {
      if (r.whiteName === msg.username || r.blackName === msg.username || r.spectatorNames.includes(msg.username)) { userRoomId = r.id; break; }
    }

    sendToSocket(client.socketId, { type: 'login_success', username: msg.username });
    if (userRoomId) {
      players.get(client.socketId).roomId = userRoomId;
      sendToSocket(client.socketId, { type: 'joined_room', room: getRoomDetails(userRoomId) });
    } else {
      sendToSocket(client.socketId, { type: 'rooms_list', rooms: getRoomsList() });
    }
    broadcast(JSON.stringify({ type: 'system', text: `${msg.username} force logged in.` }));
  }
  else if (msg.type === 'respond_login_request') {
    const waitingSocketId = msg.waitingSocketId;
    if (msg.accept) {
      const loggedUsername = Auth.getUsernameBySocket(client.socketId);
      if (loggedUsername) { sendToSocket(client.socketId, { type: 'kicked' }); players.delete(client.socketId); Auth.clearSession(loggedUsername); }
      const targetUser = Auth.getUser(msg.targetUsername);
      if (targetUser) {
        Auth.setSession(msg.targetUsername, waitingSocketId);
        players.set(waitingSocketId, { id: waitingSocketId, name: msg.targetUsername, socket: rawSockets.get(waitingSocketId), isOnline: true, roomId: null, isGuest: false });
        
        let userRoomId = null;
        for (const r of rooms.values()) {
          if (r.whiteName === msg.targetUsername || r.blackName === msg.targetUsername || r.spectatorNames.includes(msg.targetUsername)) { userRoomId = r.id; break; }
        }
        sendToSocket(waitingSocketId, { type: 'login_success', username: msg.targetUsername });
        if (userRoomId) {
          players.get(waitingSocketId).roomId = userRoomId;
          sendToSocket(waitingSocketId, { type: 'joined_room', room: getRoomDetails(userRoomId) });
        } else {
          sendToSocket(waitingSocketId, { type: 'rooms_list', rooms: getRoomsList() });
        }
        broadcast(JSON.stringify({ type: 'system', text: `${msg.targetUsername} logged in.` }));
      }
    } else { sendToSocket(waitingSocketId, { type: 'error', text: 'Login request denied by user.' }); }
  }
  else if (msg.type === 'update_settings') {
    const loggedUsername = Auth.getUsernameBySocket(client.socketId);
    if (!loggedUsername) return;
    if (Auth.updateUser(loggedUsername, msg.data)) {
      broadcast(JSON.stringify({ type: 'users_list', users: Auth.getUsersList() }));
      sendToSocket(client.socketId, { type: 'system', text: 'Settings saved.' });
      if (msg.data.newUsername) {
        const p = players.get(client.socketId);
        if (p) p.name = msg.data.newUsername;
        broadcast(JSON.stringify({ type: 'system', text: `User renamed to ${msg.data.newUsername}` }));
      }
    } else { sendToSocket(client.socketId, { type: 'error', text: 'Username taken or invalid.' }); }
  }
  else if (msg.type === 'create_room') {
    const p = players.get(client.socketId); if (!p) return;
    const roomId = 'room_' + Date.now();
    rooms.set(roomId, { id: roomId, name: msg.name || `${p.name}'s Room`, hostName: p.name, whiteName: p.name, blackName: null, spectatorNames: [], game: new Chess(), startTime: null, restartRequestedBy: null, drawRequestedBy: null, selection: { w: null, b: null } });
    p.roomId = roomId;
    broadcastRoomsList();
    sendToSocket(client.socketId, { type: 'joined_room', room: getRoomDetails(roomId) });
  }
  else if (msg.type === 'join_room') {
    const room = rooms.get(msg.roomId); if (!room) return;
    const p = players.get(client.socketId); if (!p) return;
    
    if (msg.color === 'w') {
      if (room.whiteName && room.whiteName !== p.name) { sendToSocket(p.id, { type: 'error', text: "May iba na (White is taken)" }); return; }
      room.whiteName = p.name;
      room.spectatorNames = room.spectatorNames.filter(n => n !== p.name);
    } else if (msg.color === 'b') {
      if (room.blackName && room.blackName !== p.name) { sendToSocket(p.id, { type: 'error', text: "May iba na (Black is taken)" }); return; }
      room.blackName = p.name;
      room.spectatorNames = room.spectatorNames.filter(n => n !== p.name);
    } else {
      if (!room.spectatorNames.includes(p.name)) room.spectatorNames.push(p.name);
    }
    p.roomId = room.id;
    broadcastRoomsList(); 
    sendToSocket(p.id, { type: 'joined_room', room: getRoomDetails(room.id) });
    broadcastRoomState(room.id);
  }
  else if (msg.type === 'leave_room') {
    const p = players.get(client.socketId);
    if (p && p.roomId) { leaveRoom(p); sendToSocket(p.id, { type: 'left_room' }); }
  }
  else if (msg.type === 'delete_room') {
    const p = players.get(client.socketId);
    if (p && p.roomId) {
      const room = rooms.get(p.roomId);
      if (room && room.hostName === p.name) {
        const inRoom = [room.whiteName, room.blackName, ...room.spectatorNames].filter(n => n !== null);
        for (const uName of inRoom) {
          for (const [sId, pl] of players.entries()) {
            if (pl.name === uName) { sendToSocket(sId, { type: 'room_deleted' }); pl.roomId = null; break; }
          }
        }
        rooms.delete(room.id);
        broadcastRoomsList();
      }
    }
  }
  else if (msg.type === 'select_square') {
    const p = players.get(client.socketId);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId); if (!room) return;

    if (p.name === room.whiteName) room.selection.w = msg.square;
    else if (p.name === room.blackName) room.selection.b = msg.square;
    
    const state = { type: 'room_state', room: getRoomDetails(room.id) };
    const inRoomNames = [room.whiteName, room.blackName, ...room.spectatorNames].filter(n => n !== null);
    for (const pId of players.keys()) {
      const pl = players.get(pId);
      if (inRoomNames.includes(pl.name)) sendToSocket(pId, state);
    }
  }
  else if (msg.type === 'move') {
    const p = players.get(client.socketId);
    if (!p || !p.roomId || p.isGuest) return;
    const room = rooms.get(p.roomId); if (!room) return;
    if ((room.game.turn === 'w' && room.whiteName !== p.name) || (room.game.turn === 'b' && room.blackName !== p.name)) return;
    if (room.game.history.length === 0 && !room.startTime) room.startTime = Date.now(); 
    
    if (room.game.makeMove(msg.from, msg.to, msg.promotion)) {
      room.selection.w = null;
      room.selection.b = null;
      broadcastRoomState(room.id);
    }
  }
  else if (msg.type === 'reset_game') {
    const p = players.get(client.socketId);
    if (p && p.roomId) {
      const room = rooms.get(p.roomId); if (!room) return;
      if (p.name === room.hostName) {
        room.game = new Chess(); room.startTime = null; room.restartRequestedBy = null; room.drawRequestedBy = null; room.selection = { w: null, b: null };
        broadcastRoomState(room.id);
        broadcast(JSON.stringify({ type: 'system', text: `Game is Restarted.` }));
      } else {
        if (room.restartRequestedBy) return;
        room.restartRequestedBy = p.name;
        for (const [sId, pl] of players.entries()) {
          if (pl.name === room.hostName) sendToSocket(sId, { type: 'restart_request', requesterName: p.name });
        }
      }
    }
  }
  else if (msg.type === 'respond_restart') {
    const p = players.get(client.socketId);
    if (p && p.roomId) {
      const room = rooms.get(p.roomId);
      if (room && p.name === room.hostName && room.restartRequestedBy) {
        if (msg.accept) {
          room.game = new Chess(); room.startTime = null; room.selection = { w: null, b: null };
          broadcast(JSON.stringify({ type: 'system', text: `Host accepted restart.` }));
          broadcastRoomState(room.id);
        } else {
          for (const [sId, pl] of players.entries()) {
            if (pl.name === room.restartRequestedBy) sendToSocket(sId, { type: 'system', text: 'Host declined restart request.' });
          }
        }
        room.restartRequestedBy = null;
      }
    }
  }
  else if (msg.type === 'offer_draw') {
    const p = players.get(client.socketId); if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId); if (!room || room.game.status !== 'playing') return;
    const color = room.whiteName === p.name ? 'w' : room.blackName === p.name ? 'b' : null;
    if (!color || room.drawRequestedBy) return;
    room.drawRequestedBy = p.name;
    const opponentName = color === 'w' ? room.blackName : room.whiteName;
    for (const [sid, pl] of players.entries()) if (pl.name === opponentName) sendToSocket(sid, { type: 'draw_request', requesterName: p.name });
    sendToSocket(client.socketId, { type: 'system', text: 'Draw offer sent.' });
  }
  else if (msg.type === 'respond_draw') {
    const p = players.get(client.socketId); if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId); if (!room || !room.drawRequestedBy || room.drawRequestedBy === p.name) return;
    if (msg.accept) room.game.acceptDraw();
    const requester = room.drawRequestedBy; room.drawRequestedBy = null;
    broadcast(JSON.stringify({ type: 'system', text: msg.accept ? 'Draw accepted. The game is a draw.' : 'Draw offer declined.' }));
    broadcastRoomState(room.id);
    if (!msg.accept) for (const [sid, pl] of players.entries()) if (pl.name === requester) sendToSocket(sid, { type: 'system', text: 'Your draw offer was declined.' });
  }
  else if (msg.type === 'resign') {
    const p = players.get(client.socketId); if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId); if (!room || room.game.status !== 'playing') return;
    const color = room.whiteName === p.name ? 'w' : room.blackName === p.name ? 'b' : null;
    if (!color) return;
    room.game.resign(color); room.drawRequestedBy = null;
    broadcast(JSON.stringify({ type: 'system', text: `${p.name} resigned.` }));
    broadcastRoomState(room.id);
  }
  else if (msg.type === 'send_emote') {
    const p = players.get(client.socketId); if (!p) return;
    
    let isWhite = false; 
    let targets = [];

    if (p.roomId && rooms.has(p.roomId)) {
      const room = rooms.get(p.roomId);
      isWhite = room.whiteName === p.name;
      const inRoom = [room.whiteName, room.blackName, ...room.spectatorNames].filter(n => n !== null);
      for (const [sId, pl] of players.entries()) {
        if (inRoom.includes(pl.name)) targets.push(sId);
      }
    } else {
      for (const [sId, pl] of players.entries()) {
        if (pl.roomId === null) targets.push(sId);
      }
    }

    const emoteMsg = JSON.stringify({ 
      type: 'emote_received', 
      emote: msg.emote, 
      sender: p.name,
      isWhite: isWhite
    });

    for (const sId of targets) {
      sendToSocket(sId, JSON.parse(emoteMsg));
    }
  }
  else if (msg.type === 'chat') {
    const p = players.get(client.socketId); if (!p || typeof msg.text !== 'string') return;
    const cleanText = msg.text.trim().slice(0, 500); if (!cleanText) return;
    if (p.roomId && rooms.has(p.roomId)) {
      const room = rooms.get(p.roomId);
      const inRoom = [room.whiteName, room.blackName, ...room.spectatorNames].filter(n => n !== null);
      const chatMsg = JSON.stringify({ type: 'chat', sender: p.name, text: cleanText });
      for (const [sId, pl] of players.entries()) {
        if (inRoom.includes(pl.name)) sendToSocket(sId, JSON.parse(chatMsg));
      }
    } else broadcast(JSON.stringify({ type: 'chat', sender: p.name, text: msg.text }));
  }
}

function leaveRoom(player) {
  const room = rooms.get(player.roomId); if (!room) return;
  if (room.whiteName === player.name) room.whiteName = null;
  else if (room.blackName === player.name) room.blackName = null;
  else room.spectatorNames = room.spectatorNames.filter(n => n !== player.name);
  
  if (room.hostName === player.name) {
    if (room.whiteName) room.hostName = room.whiteName;
    else if (room.blackName) room.hostName = room.blackName;
    else if (room.spectatorNames.length > 0) room.hostName = room.spectatorNames[0];
    else room.hostName = 'Unknown';
  }
  player.roomId = null;
  
  if (!room.whiteName && !room.blackName && room.spectatorNames.length === 0) rooms.delete(room.id);
  broadcastRoomsList(); 
  if (rooms.has(room.id)) broadcastRoomState(room.id);
}

function handleDisconnect(client) {
  const p = players.get(client.socketId);
  if (p) {
    const username = Auth.getUsernameBySocket(client.socketId);
    if (username) Auth.clearSession(username);
    players.delete(client.socketId);
    broadcast(JSON.stringify({ type: 'system', text: `${p.name} disconnected.` }));
  }
}

function createFrame(data) {
  const payload = Buffer.from(data), len = payload.length; let header;
  if (len < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

function broadcast(message) {
  const frame = createFrame(message);
  for (const sock of rawSockets.values()) {
    if (sock && !sock.destroyed) {
      try { sock.write(frame); } catch(e) { }
    }
  }
}

function sendToSocket(socketId, message) {
  const p = players.get(socketId);
  const sock = p ? p.socket : rawSockets.get(socketId);
  if (sock && !sock.destroyed) {
    try { sock.write(createFrame(JSON.stringify(message))); } catch(e) {}
  }
}

server.listen(PORT, HOST, () => {
  console.log('  Phase 21 Server Started (Syntax Fixed)');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) console.log('  http://' + net.address + ':' + PORT);
  }
});