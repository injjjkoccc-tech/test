const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 靜態檔案目錄
app.use(express.static(path.join(__dirname, 'public')));

// 機器人姓名庫
const BOT_NAMES = ['Anny', 'John', 'Emily', 'Michael', 'Sophia', 'William', 'Olivia', 'James', 'Emma', 'David'];

// 遊戲狀態存儲
const rooms = new Map();
const players = new Map(); // socket.id -> { nickname, roomId, playerId }

// 幫助函數：生成隨機房間號
function generateRoomId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// 核心遊戲邏輯：初始化牌組
function createDeck() {
    const colors = ['red', 'blue', 'orange', 'black'];
    let deck = [];
    for (let i = 0; i < 2; i++) {
        for (const color of colors) {
            for (let num = 1; num <= 13; num++) {
                deck.push({ id: `t-${color}-${num}-${i}`, color, number: num });
            }
        }
    }
    deck.push({ id: 'joker-1', color: 'joker', number: 0 });
    deck.push({ id: 'joker-2', color: 'joker', number: 0 });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 校驗單個組合是否合法並回傳原因
function checkSetValidity(set) {
    if (!set || set.length < 3) return { valid: false, reason: '每組至少需要 3 張牌' };
    
    // 徹底清理 tempNumber，防止任何歷史權重干擾校驗
    set.forEach(t => { if(t) delete t.tempNumber; });
    
    const jokers = set.filter(t => t && t.color === 'joker');
    const realTiles = set.filter(t => t && t.color !== 'joker');

    if (realTiles.length === 0) {
        set.forEach((t, i) => t.tempNumber = i + 1);
        return { valid: true };
    }

    // 1. 檢查是否為 Group (同數字不同色)
    const isPotentialGroup = realTiles.every(t => t.number === realTiles[0].number);
    if (isPotentialGroup) {
        if (set.length > 4) return { valid: false, reason: `群組 (Group) ${realTiles[0].number} 不能超過 4 張牌` };
        const colorsList = realTiles.map(t => t.color);
        if (new Set(colorsList).size !== realTiles.length) return { valid: false, reason: `群組顏色重複` };
        set.forEach(t => t.tempNumber = realTiles[0].number);
        return { valid: true };
    }

    // 2. 檢查是否為 Run (同色連續數字)
    const colorSet = new Set(realTiles.map(t => t.color));
    if (colorSet.size === 1) {
        if (set.length > 13) return { valid: false, reason: '順組 (Run) 長度不能超過 13 張' };
        
        const sortedReal = [...realTiles].sort((a,b) => a.number - b.number);
        // 檢查重複
        for(let i=1; i<sortedReal.length; i++) {
            if(sortedReal[i].number === sortedReal[i-1].number) return { valid: false, reason: '順組數字重複' };
        }

        const minNum = sortedReal[0].number;
        const maxNum = sortedReal[sortedReal.length - 1].number;
        const totalSpan = maxNum - minNum + 1;
        const missing = totalSpan - sortedReal.length;
        if (missing > jokers.length) return { valid: false, reason: '鬼牌不足以填補空位' };
        
        // 賦予 tempNumber（確保鬼牌能插入正確位置）
        const usedNumbers = sortedReal.map(t => t.number);
        let pointer = minNum;
        
        // 重新遍歷分配
        set.forEach(t => {
            if (t.color !== 'joker') t.tempNumber = t.number;
        });
        
        const usedSet = new Set(usedNumbers);
        // 按順序填充鬼牌位置
        set.forEach(t => {
            if (t.color === 'joker') {
                while(usedSet.has(pointer)) pointer++;
                t.tempNumber = pointer;
                usedSet.add(pointer);
            }
        });
        // 強制根據 tempNumber 排序以保證回傳給前端的順序是正確的
        set.sort((a,b) => (a.tempNumber || 0) - (b.tempNumber || 0));
        return { valid: true };
    }

    return { valid: false, reason: '組合不符合規則' };
}

// 輔助函式：計算組合分數
function calculateSetScore(set) {
    if (set.length === 0) return 0;
    const realTiles = set.filter(t => t.color !== 'joker');
    if (realTiles.length === 0) return set.length * 10; 
    
    const isGroup = realTiles.every(t => t.number === realTiles[0].number);
    if (isGroup) return realTiles[0].number * set.length; 
    
    const sortedSet = [...set].sort((a, b) => (a.tempNumber ?? a.number) - (b.tempNumber ?? b.number));
    return sortedSet.reduce((sum, t) => sum + (t.tempNumber ?? t.number), 0);
}

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const { nickname, roomId, playerId, action } = data;
        const finalPlayerId = playerId || `p-${socket.id}`;
        let roomCode = roomId ? roomId.toUpperCase() : null;
        
        if (action === 'create') roomCode = generateRoomId();
        else if (!roomCode) {
            const availableRooms = Array.from(rooms.values()).filter(r => r.players.length < r.maxPlayers && !r.gameStarted);
            roomCode = availableRooms.length > 0 ? availableRooms[0].id : generateRoomId();
        }

        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, {
                id: roomCode, players: [], maxPlayers: parseInt(data.maxPlayers) || 4,
                gameStarted: false, deck: createDeck(), board: [], turn: 0,
                chatHistory: [], isFinalRound: false, finalRoundTurns: 0
            });
        }

        const room = rooms.get(roomCode);
        const existingPlayer = room.players.find(p => p.playerId === finalPlayerId);
        
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            existingPlayer.online = true;
            socket.join(roomCode);
        } else if (room.players.length < room.maxPlayers && !room.gameStarted) {
            room.players.push({
                socketId: socket.id, playerId: finalPlayerId, nickname,
                hand: [], ready: false, isHost: room.players.length === 0,
                online: true, isBot: false, hasMeld: false, isFinished: false, rank: null
            });
            socket.join(roomCode);
        } else {
            return socket.emit('error', '無法加入房間');
        }

        players.set(socket.id, { nickname, roomId: roomCode, playerId: finalPlayerId });
        io.to(roomCode).emit('roomUpdate', {
            roomCode, players: room.players.map(p => ({
                nickname: p.nickname, ready: p.ready, isHost: p.isHost, cardCount: p.hand.length, online: p.online, isBot: p.isBot
            })),
            gameStarted: room.gameStarted, myId: finalPlayerId
        });
        socket.emit('joined', { roomCode, playerId: finalPlayerId, chatHistory: room.chatHistory });
    });

    socket.on('chat', (message) => {
        const p = players.get(socket.id);
        if (!p) return;
        const room = rooms.get(p.roomId);
        const player = room.players.find(pl => pl.socketId === socket.id);
        const chatMsg = {
            nickname: p.nickname, message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            icon: player.isHost ? '👑' : ''
        };
        room.chatHistory.push(chatMsg);
        io.to(p.roomId).emit('chat', { sender: chatMsg.nickname, message: chatMsg.message, icon: chatMsg.icon, time: chatMsg.time });
    });

    socket.on('ready', () => {
        const p = players.get(socket.id);
        if (!p) return;
        const room = rooms.get(p.roomId);
        const player = room.players.find(pl => pl.socketId === socket.id);
        
        if (player.isHost) {
            if (!room.players.every(pl => pl === player || pl.ready)) return socket.emit('error', '尚有玩家未準備');
            while (room.players.length < room.maxPlayers) {
                room.players.push({
                    socketId: null, playerId: `bot-${Math.random()}`, nickname: BOT_NAMES[room.players.length] + ' (Bot)',
                    hand: [], ready: true, isHost: false, online: true, isBot: true, isFinished: false, rank: null
                });
            }
            startNewGame(room);
        } else {
            player.ready = !player.ready;
            io.to(p.roomId).emit('roomUpdate', {
                roomCode: p.roomId, players: room.players.map(pl => ({ nickname: pl.nickname, ready: pl.ready, isHost: pl.isHost, online: pl.online })),
                gameStarted: room.gameStarted
            });
        }
    });

    function startNewGame(room) {
        room.deck = createDeck();
        room.board = [];
        room.gameStarted = true;
        room.turn = 0;
        room.isFinalRound = false;
        room.players.forEach(p => {
            p.hand = room.deck.splice(0, 14);
            p.isFinished = false;
            p.rank = null;
            p.hasMeld = false;
            if (p.socketId) {
                io.to(p.socketId).emit('gameStart', {
                    hand: p.hand, players: room.players.map(pl => ({ nickname: pl.nickname, cardCount: pl.hand.length, isBot: pl.isBot, online: pl.online, isFinished: pl.isFinished, rank: pl.rank })),
                    turnPlayer: room.players[room.turn].nickname, deckCount: room.deck.length
                });
            }
        });
        io.to(room.id).emit('chat', { sender: '系統公告', message: '🎲 遊戲開始！' });
        checkAndHandleBotTurn(room);
    }

    function updateTurnAndNotify(room, message = '') {
        let nextTurn = (room.turn + 1) % room.players.length;
        let skip = 0;
        while (room.players[nextTurn].isFinished && skip < room.players.length) {
            nextTurn = (nextTurn + 1) % room.players.length;
            skip++;
        }
        room.turn = nextTurn;
        
        // 關鍵：在通知前重新確認所有組的 tempNumber 避免鬼牌亂跳
        room.board.forEach(s => checkSetValidity(s));

        io.to(room.id).emit('turnUpdate', {
            turnPlayer: room.players[room.turn].nickname, board: room.board, deckCount: room.deck.length,
            players: room.players.map(p => ({ nickname: p.nickname, cardCount: p.hand.length, isBot: p.isBot, online: p.online, isFinished: p.isFinished, rank: p.rank }))
        });
        checkAndHandleBotTurn(room);
    }

    function checkAndHandleBotTurn(room) {
        const cp = room.players[room.turn];
        if (cp && cp.isBot && room.gameStarted) {
            setTimeout(() => executeAutoPlay(room, cp), 2000);
        }
    }

    function executeAutoPlay(room, player) {
        let changed = false;
        if (player.hasMeld) {
            let i = 0;
            while (i < player.hand.length) {
                const tile = player.hand[i];
                let acted = false;
                for (let j = 0; j < room.board.length; j++) {
                    const testSet = [...room.board[j], tile];
                    if (checkSetValidity(testSet).valid) {
                        room.board[j].push(player.hand.splice(i, 1)[0]);
                        acted = changed = true;
                        break;
                    }
                }
                if (!acted) i++;
            }
        }
        const pSets = findInitialMeldSets(player.hand);
        const score = pSets.reduce((sum, s) => sum + calculateSetScore(s), 0);
        if (pSets.length > 0 && (player.hasMeld || score >= 30)) {
            const usedIds = pSets.flat().map(t => t.id);
            player.hand = player.hand.filter(t => !usedIds.includes(t.id));
            player.hasMeld = true;
            room.board.push(...pSets);
            changed = true;
        }

        if (changed) {
            if (player.socketId) io.to(player.socketId).emit('tileDrawn', { hand: player.hand, deckCount: room.deck.length });
            if (player.hand.length === 0) processPlayerWin(room, player);
            else checkGameFinalEnd(room, `${player.nickname} 完成出牌`);
        } else if (room.deck.length > 0) {
            player.hand.push(room.deck.shift());
            if (player.socketId) io.to(player.socketId).emit('tileDrawn', { hand: player.hand, deckCount: room.deck.length });
            checkGameFinalEnd(room, `${player.nickname} 抽牌`);
        } else {
            checkGameFinalEnd(room, `${player.nickname} 略過`);
        }
    }

    socket.on('autoPlayRequest', () => {
        const p = players.get(socket.id);
        const room = rooms.get(p.roomId);
        const player = room.players.find(pl => pl.socketId === socket.id);
        if (room.turn === room.players.indexOf(player)) executeAutoPlay(room, player);
    });

    function findInitialMeldSets(hand) {
        const results = [];
        const h = [...hand];
        // 簡單 AI 尋牌邏輯 (同數不同色 / 同色連續)
        const groups = {};
        h.forEach(t => { if(t.color !== 'joker') { if(!groups[t.number]) groups[t.number] = []; groups[t.number].push(t); } });
        for(const n in groups) {
            const unique = [];
            groups[n].forEach(t => { if(!unique.find(x => x.color === t.color)) unique.push(t); });
            if(unique.length >= 3) results.push(unique);
        }
        return results;
    }

    socket.on('finishTurn', (data) => {
        const p = players.get(socket.id);
        const room = rooms.get(p.roomId);
        const player = room.players.find(pl => pl.socketId === socket.id);
        if (room.players[room.turn].playerId !== player.playerId) return socket.emit('error', '不是您的回合');

        const cleaned = data.board.filter(s => Array.isArray(s) && s.length > 0).map(s => s.filter(t => t && t.id));
        const errs = [];
        cleaned.forEach((s, i) => { if(!checkSetValidity(s).valid) errs.push(i); });
        if(errs.length > 0) return socket.emit('error', { message: '牌組規則無效', errorIndices: errs });

        if(!player.hasMeld) {
            const oldTableIds = new Set(room.board.flat().map(t => t && t.id));
            let newSetsScore = 0;
            for (const set of cleaned) {
                const hasOld = set.some(t => oldTableIds.has(t.id));
                const hasNew = set.some(t => !oldTableIds.has(t.id));
                if (hasOld && hasNew) return socket.emit('error', '破冰前不可使用桌面上的牌進行重組');
                if (hasNew && !hasOld) newSetsScore += calculateSetScore(set);
            }
            if (newSetsScore < 30) return socket.emit('error', `破冰總分需達到 30 分 (目前僅出牌 ${newSetsScore} 分)`);
            player.hasMeld = true;
        }

        // 3. 檢測是否未出牌 (若手牌與桌面狀態均無變化)
        const oldBoardStr = JSON.stringify(room.board);
        const newBoardStr = JSON.stringify(cleaned);
        
        if (oldBoardStr === newBoardStr && player.hand.length === data.hand.length) {
            // 強制抽牌 (若牌堆不空)
            if (room.deck.length > 0) {
                const tile = room.deck.shift();
                player.hand.push(tile);
                socket.emit('tileDrawn', { hand: player.hand, deckCount: room.deck.length });
                updateTurnAndNotify(room, `${player.nickname} 未出牌，系統自動補牌`);
            } else {
                updateTurnAndNotify(room, `${player.nickname} 略過回合 (牌堆空)`);
            }
            return;
        }

        room.board = cleaned;
        player.hand = data.hand;
        if(player.hand.length === 0) processPlayerWin(room, player);
        else updateTurnAndNotify(room, `${player.nickname} 完成出牌`);
    });

    function processPlayerWin(room, player) {
        room.gameStarted = false;
        io.to(room.id).emit('chat', { sender: '系統公告', message: `🏆 遊戲結束！恭喜 ${player.nickname} 獲勝！` });
        const sortedPlayers = [...room.players].sort((a,b) => a.hand.length - b.hand.length);
        io.to(room.id).emit('gameOver', { winner: player.nickname, allScores: sortedPlayers.map(p => ({ nickname: p.nickname, cardCount: p.hand.length })) });
    }

    socket.on('drawTile', () => {
        const p = players.get(socket.id);
        const room = rooms.get(p.roomId);
        const player = room.players.find(pl => pl.socketId === socket.id);
        if(room.turn !== room.players.indexOf(player)) return socket.emit('error', '非您的回合');
        if(room.deck.length === 0) return socket.emit('error', '牌堆已空');
        player.hand.push(room.deck.shift());
        socket.emit('tileDrawn', { hand: player.hand, deckCount: room.deck.length });
        checkGameFinalEnd(room, `${player.nickname} 抽牌`);
    });

    function checkGameFinalEnd(room, msg) {
        if (room.deck.length === 0 && !room.isFinalRound) {
            room.isFinalRound = true; room.finalRoundTurns = 0;
            io.to(room.id).emit('chat', { sender: '系統公告', message: '⚠️ 牌堆已空，對局進入最後一輪！' });
        }
        if (room.isFinalRound) {
            room.finalRoundTurns++;
            if (room.finalRoundTurns >= room.players.length) {
                room.gameStarted = false;
                const sortedPlayers = [...room.players].sort((a,b) => a.hand.length - b.hand.length);
                io.to(room.id).emit('gameOver', { winner: sortedPlayers[0].nickname, allScores: sortedPlayers.map(p => ({ nickname: p.nickname, cardCount: p.hand.length })) });
                return;
            }
        }
        updateTurnAndNotify(room, msg);
    }

    socket.on('restartGame', () => {
        const p = players.get(socket.id);
        const room = rooms.get(p.roomId);
        if(room.players.find(pl => pl.socketId === socket.id).isHost) startNewGame(room);
    });

    socket.on('leave', () => handleDisconnect(socket));
    socket.on('disconnect', () => handleDisconnect(socket));

    function handleDisconnect(s) {
        const p = players.get(s.id);
        if (!p) return;
        const room = rooms.get(p.roomId);
        if (room) {
            const pl = room.players.find(x => x.socketId === s.id);
            if (pl) {
                pl.online = false;
                if (room.gameStarted) { pl.isBot = true; }
                else { room.players = room.players.filter(x => x.socketId !== s.id); if (room.players.length === 0) rooms.delete(p.roomId); else if (pl.isHost) room.players[0].isHost = true; }
            }
        }
        players.delete(s.id);
    }
});

server.listen(process.env.PORT || 3000, () => console.log('拉密伺服器啟動'));
