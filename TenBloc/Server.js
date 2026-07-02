// =====================================
// TenBloc Multiplayer Platform Server
// =====================================

const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });
console.log("TenBloc Multiplayer Server running on ws://localhost:8080");

// In-memory world + players (you can later persist to disk/DB)
let worlds = {
  "default": {
    name: "Default World",
    players: {} // username -> { x,y,z, room, cosmetics }
  }
};

// Simple friends list stub (later: load from real DB)
let friends = {
  // Example:
  // "Cjmegamind": ["Friend1", "Friend2"]
};

// Utility: broadcast to room
function broadcastToRoom(room, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.room === room) {
      client.send(msg);
    }
  });
}

// Utility: broadcast to one client
function send(ws, data) {
  ws.send(JSON.stringify(data));
}

// Anti-cheat: max allowed movement per tick
const MAX_MOVE_DIST = 2.0;

// Matchmaking: pick room (for now always "default")
function pickRoomFor(username) {
  // Friends auto-join: if any friend is online, join their room
  let targetRoom = "default";

  const userFriends = friends[username] || [];
  wss.clients.forEach(c => {
    if (c.username && userFriends.includes(c.username)) {
      targetRoom = c.room || "default";
    }
  });

  return targetRoom;
}

wss.on("connection", ws => {
  ws.username = null;
  ws.room = null;

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // JOIN: { type:"join", username, cosmetics }
    if (msg.type === "join") {
      const username = msg.username;
      ws.username = username;

      const room = pickRoomFor(username);
      ws.room = room;

      if (!worlds[room]) {
        worlds[room] = { name: room, players: {} };
      }

      // Initialize player in world if not exists
      if (!worlds[room].players[username]) {
        worlds[room].players[username] = {
          x: 0, y: 1, z: 0,
          cosmetics: msg.cosmetics || { bodyColor:"#ffffff", hat:null }
        };
      }

      console.log(`${username} joined room ${room}`);

      // Send full state to this player
      send(ws, {
        type: "state",
        room,
        players: worlds[room].players
      });

      // Broadcast player list + join notice
      broadcastToRoom(room, {
        type: "player_list",
        room,
        players: Object.keys(worlds[room].players)
      });

      broadcastToRoom(room, {
        type: "chat",
        from: "SERVER",
        message: `${username} joined the room.`
      });
    }

    // MOVE: { type:"move", username, x,y,z }
    if (msg.type === "move") {
      const username = ws.username;
      const room = ws.room;
      if (!username || !room) return;
      if (!worlds[room] || !worlds[room].players[username]) return;

      const p = worlds[room].players[username];

      // Anti-cheat: limit movement distance per update
      const dx = msg.x - p.x;
      const dy = msg.y - p.y;
      const dz = msg.z - p.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (dist > MAX_MOVE_DIST) {
        console.log(`Anti-cheat: ${username} moved too fast (${dist.toFixed(2)}).`);
        // Option: kick or clamp
        return;
      }

      p.x = msg.x;
      p.y = msg.y;
      p.z = msg.z;

      // Broadcast updated state to room
      broadcastToRoom(room, {
        type: "state",
        room,
        players: worlds[room].players
      });
    }

    // CHAT: { type:"chat", message }
    if (msg.type === "chat") {
      const username = ws.username;
      const room = ws.room;
      if (!username || !room) return;

      broadcastToRoom(room, {
        type: "chat",
        from: username,
        message: msg.message
      });
    }

    // PRIVATE SERVER / ROOM CHANGE: { type:"join_room", roomName }
    if (msg.type === "join_room") {
      const username = ws.username;
      if (!username) return;

      const newRoom = msg.roomName || "default";

      // Remove from old room
      if (ws.room && worlds[ws.room]) {
        delete worlds[ws.room].players[username];
        broadcastToRoom(ws.room, {
          type: "leave",
          username
        });
      }

      ws.room = newRoom;
      if (!worlds[newRoom]) {
        worlds[newRoom] = { name:newRoom, players:{} };
      }

      worlds[newRoom].players[username] = {
        x:0, y:1, z:0,
        cosmetics: { bodyColor:"#ffffff", hat:null }
      };

      broadcastToRoom(newRoom, {
        type:"player_list",
        room:newRoom,
        players:Object.keys(worlds[newRoom].players)
      });

      broadcastToRoom(newRoom, {
        type:"chat",
        from:"SERVER",
        message:`${username} joined room ${newRoom}.`
      });

      send(ws, {
        type:"state",
        room:newRoom,
        players:worlds[newRoom].players
      });
    }
  });

  ws.on("close", () => {
    const username = ws.username;
    const room = ws.room;
    if (!username || !room) return;

    console.log(`${username} disconnected from room ${room}`);

    if (worlds[room] && worlds[room].players[username]) {
      delete worlds[room].players[username];

      broadcastToRoom(room, {
        type:"leave",
        username
      });

      broadcastToRoom(room, {
        type:"player_list",
        room,
        players:Object.keys(worlds[room].players)
      });

      broadcastToRoom(room, {
        type:"chat",
        from:"SERVER",
        message:`${username} left the room.`
      });
    }
  });
});
