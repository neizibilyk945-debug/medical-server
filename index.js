const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 房间存储: { roomCode: { host: socketId, members: [socketId] } }
const rooms = new Map();

// 生成四位随机数字密码
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// 健康检查端点 (Render 需要)
app.get('/', (req, res) => {
    res.send('MedicalSyncPlayer Server Running');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', rooms: rooms.size });
});

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    // 创建房间
    socket.on('create-room', (callback) => {
        const roomCode = generateRoomCode();
        rooms.set(roomCode, {
            host: socket.id,
            members: [socket.id],
            currentUrl: null
        });
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        console.log(`房间 ${roomCode} 已创建，房主: ${socket.id}`);
        callback({ success: true, roomCode: roomCode, isHost: true });
    });

    // 加入房间
    socket.on('join-room', (roomCode, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            callback({ success: false, message: '房间不存在' });
            return;
        }

        room.members.push(socket.id);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = false;

        console.log(`用户 ${socket.id} 加入房间 ${roomCode}`);

        // 广播房间最新状态（包括人数）
        io.to(roomCode).emit('room-update', {
            count: room.members.length,
            message: '新成员加入'
        });

        callback({
            success: true,
            roomCode: roomCode,
            isHost: false,
            currentUrl: room.currentUrl
        });
    });

    // 房主同步视频状态
    socket.on('sync-video', (data) => {
        if (!socket.roomCode || !socket.isHost) return;

        // 仅在调试模式下打印
        // console.log(`同步: ${data.url} @ ${data.time}s`); 

        const room = rooms.get(socket.roomCode);
        if (room) {
            room.currentUrl = data.url;
            socket.to(socket.roomCode).emit('video-sync', {
                type: 'super-sync',
                url: data.url,
                time: data.time,
                paused: data.paused
            });
        }
    });

    // 离开房间
    socket.on('leave-room', () => {
        leaveRoom(socket);
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('用户断开:', socket.id);
        leaveRoom(socket);
    });
});

function leaveRoom(socket) {
    if (!socket.roomCode) return;

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    // 移除成员
    room.members = room.members.filter(id => id !== socket.id);

    // 如果是房主离开，解散房间
    if (socket.isHost) {
        io.to(socket.roomCode).emit('room-closed', { message: '房主已离开，房间解散' });
        rooms.delete(socket.roomCode);
        console.log(`房间 ${socket.roomCode} 已解散`);
    } else {
        // 广播房间封最新状态
        io.to(socket.roomCode).emit('room-update', {
            count: room.members.length,
            message: '成员离开'
        });
    }

    socket.leave(socket.roomCode);
    socket.roomCode = null;
    socket.isHost = false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});
