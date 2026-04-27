const socket = io();

let state = {
    nickname: '',
    roomCode: '',
    playerId: localStorage.getItem('rummikub_playerId') || '',
    players: [],
    hand: [],
    board: [],
    tempTiles: [], 
    gameStarted: false,
    turnPlayer: '',
    myTurn: false,
    history: [] 
};

// --- DOM ---
const lobby = document.getElementById('lobby');
const gameScreen = document.getElementById('game-screen');
const nicknameInput = document.getElementById('nickname');
const roomIdInput = document.getElementById('roomIdInput');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const quickJoinBtn = document.getElementById('quickJoinBtn');
const playersContainer = document.getElementById('playersContainer');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const readyBtn = document.getElementById('readyBtn');
const playerHand = document.getElementById('playerHand');
const board = document.getElementById('board');
const workspace = document.getElementById('workspace');

// --- 按鈕 ---
const finishBtn = document.getElementById('finishBtn');
const undoBtn = document.getElementById('undoBtn');
const sortByColorBtn = document.getElementById('sortByColor');
const sortByNumBtn = document.getElementById('sortByNum');
const autoPlayBtn = document.getElementById('autoPlayBtn');

// --- 加入/創建 ---
createBtn.onclick = () => joinGame(null, 'create');
quickJoinBtn.onclick = () => joinGame(null, 'quickJoin');
joinBtn.onclick = () => {
    const rId = roomIdInput.value.trim();
    if (rId) joinGame(rId, 'join');
};

let actionQueue = [];

function joinGame(roomId, action) {
    const nick = nicknameInput.value.trim();
    if (!nick && action !== 'rejoin') return alert('請輸入暱稱');
    if (nick) state.nickname = nick;
    const maxP = document.querySelector('input[name="maxPlayers"]:checked') ? document.querySelector('input[name="maxPlayers"]:checked').value : 4;
    const isPriv = document.querySelector('input[name="roomPrivacy"]:checked') ? (document.querySelector('input[name="roomPrivacy"]:checked').value === 'private') : false;
    socket.emit('join', { nickname: state.nickname, roomId, playerId: state.playerId, maxPlayers: maxP, isPrivate: isPriv, action });
}

socket.on('joined', (data) => {
    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    localStorage.setItem('rummikub_playerId', data.playerId);
    localStorage.setItem('rummikub_roomId', data.roomCode);
    localStorage.setItem('rummikub_nickname', state.nickname);
    lobby.classList.remove('active');
    gameScreen.classList.add('active');
    document.getElementById('roomDisplay').textContent = data.roomCode;
});

// 規則按鈕綁定（入口與房間內共用同一個 Modal）
const rulesModal = document.getElementById('rulesModal');
document.getElementById('lobbyRulesBtn').onclick = () => { rulesModal.style.display = 'flex'; };
document.getElementById('gameRulesBtn').onclick = () => { rulesModal.style.display = 'flex'; };
// 點擊遮罩背景也可關閉
rulesModal.addEventListener('click', (e) => { if (e.target === rulesModal) rulesModal.style.display = 'none'; });

// INITIALIZE LOBBY
const savedName = localStorage.getItem('rummikub_nickname');
if (savedName) document.getElementById('nickname').value = savedName;
const savedPlayerId = localStorage.getItem('rummikub_playerId');
const savedRoomId = localStorage.getItem('rummikub_roomId');

if (savedPlayerId && savedRoomId) {
    socket.emit('checkRoomStatus', { roomId: savedRoomId, playerId: savedPlayerId });
}

socket.on('roomStatusValid', () => {
    const rejoinBtn = document.getElementById('rejoinRoomBtn');
    if (rejoinBtn) {
        rejoinBtn.style.display = 'block';
        rejoinBtn.onclick = () => {
            state.playerId = savedPlayerId;
            state.nickname = document.getElementById('nickname').value.trim() || savedName;
            joinGame(savedRoomId, 'rejoin');
        };
    }
});

socket.on('roomStatusInvalid', () => {
    localStorage.removeItem('rummikub_roomId');
});

socket.on('roomUpdate', (data) => {
    state.players = data.players || [];
    state.gameStarted = data.gameStarted;
    if(data.maxPlayers) state.maxPlayers = data.maxPlayers;
    
    const me = state.players.find(p => p.playerId === state.playerId);
    if (!state.gameStarted && me) {
        if (me.isHost) {
            readyBtn.style.display = 'inline-block';
            const others = state.players.filter(p => !p.isHost);
            if (others.length === 0) {
                readyBtn.textContent = '直接開始';
                readyBtn.style.background = '#38bdf8';
                readyBtn.disabled = false;
            } else {
                readyBtn.textContent = '開始倒數';
                readyBtn.style.background = '#22c55e';
                readyBtn.disabled = false;
            }
        } else {
            readyBtn.style.display = 'none';
        }
    } else if (state.gameStarted) {
        readyBtn.style.display = 'none';
        document.getElementById('deckPile').style.display = 'flex';
        document.getElementById('interactionFooter').style.display = 'flex';
        document.getElementById('actionFloatingBar').style.display = 'flex';
    }
    
    renderPlayers();
});

readyBtn.onclick = () => {
    if (!readyBtn.disabled && readyBtn.textContent === '開始倒數') {
        socket.emit('startCountdown');
    } else if (!readyBtn.disabled && readyBtn.textContent === '直接開始') {
        socket.emit('instantStart');
    }
};

socket.on('countdownUpdate', (data) => {
    readyBtn.style.display = 'inline-block';
    readyBtn.disabled = true;
    readyBtn.textContent = `倒數 ${data.count} 秒...`;
    readyBtn.style.background = '#f59e0b';
});

socket.on('gameStart', (data) => {
    const gameOverModal = document.getElementById('modal-gameover');
    if (gameOverModal) gameOverModal.style.display = 'none';
    
    // 恢復互動按鈕
    const colors = { 'autoPlayBtn': '#f59e0b', 'finishBtn': '#22c55e', 'undoBtn': '#ef4444', 'sortByColor': '#38bdf8', 'sortByNum': '#38bdf8' };
    ['autoPlayBtn', 'finishBtn', 'undoBtn', 'sortByColor', 'sortByNum'].forEach(id => {
        const btn = document.getElementById(id);
        if(btn) { 
            btn.disabled = false; 
            btn.style.background = colors[id] || ''; 
            btn.style.cursor = 'pointer'; 
        }
    });
    const rb = document.getElementById('readyBtn');
    if (rb) rb.style.display = 'none';

    if (data.players) state.players = data.players;
    state.hand = data.hand;
    state.board = data.board || [];
    state.tempTiles = [];
    state.gameStarted = true;
    if(data.maxPlayers) state.maxPlayers = data.maxPlayers;
    state.turnPlayer = data.turnPlayer;
    state.turnPlayerId = data.turnPlayerId;
    state.myTurn = (state.playerId === state.turnPlayerId);
    state.history = [JSON.parse(JSON.stringify({ hand: state.hand, board: state.board, tempTiles: [] }))];
    
    playScreenEffect('GAME START!', '#38bdf8');
    document.getElementById('deckCountText').textContent = data.deckCount || 0;
    
    document.getElementById('deckPile').style.display = 'flex';
    document.getElementById('interactionFooter').style.display = 'flex';
    document.getElementById('actionFloatingBar').style.display = 'flex';
    readyBtn.style.display = 'none';
    
    renderAll();
});

socket.on('turnUpdate', (data) => {
    if (data.players) state.players = data.players;
    state.board = data.board;
    state.turnPlayer = data.turnPlayer;
    state.turnPlayerId = data.turnPlayerId;
    state.myTurn = (state.playerId === state.turnPlayerId);
    if (state.myTurn) {
        state.history = [JSON.parse(JSON.stringify({ hand: state.hand, board: state.board, tempTiles: [] }))];
    }
    document.getElementById('deckCountText').textContent = data.deckCount || 0;
    renderAll();
});

// --- 渲染核心 ---
function renderAll() {
    renderBoard();
    renderHand();
    renderPlayers();
}

function renderHand() {
    playerHand.innerHTML = '';
    state.hand.forEach(tile => renderTile(tile, playerHand, 'hand'));
    workspace.innerHTML = '';
    state.tempTiles.forEach(tile => renderTile(tile, workspace, 'temp'));
}

function renderBoard(errorIdx = []) {
    board.innerHTML = '';
    state.board.forEach((set, idx) => {
        const setDiv = document.createElement('div');
        setDiv.className = `tile-set ${errorIdx.includes(idx) ? 'error-set' : ''}`;
        set.forEach((tile, tIdx) => renderTile(tile, setDiv, 'board', idx, tIdx));
        board.appendChild(setDiv);
    });
}

function renderTile(tile, container, source, setIdx, tileIdx) {
    if (!tile) return;
    const el = document.createElement('div');
    el.className = `tile ${tile.color}`;
    el.draggable = state.myTurn;
    if (tile.color === 'joker') el.innerHTML = '<img src="cat_joker.png" class="joker-img" alt="JOKER">';
    else el.innerHTML = tile.number;

    el.ondragstart = (e) => {
        if (!state.myTurn) return e.preventDefault();
        e.dataTransfer.setData('tileId', tile.id);
        e.dataTransfer.setData('source', source);
        if (source === 'board') {
            e.dataTransfer.setData('setIdx', setIdx);
            e.dataTransfer.setData('tileIdx', tileIdx);
        }
    };
    container.appendChild(el);
}

// --- 拖拽核心 ---
board.ondragover = (e) => e.preventDefault();
board.ondrop = (e) => {
    e.preventDefault();
    const setDiv = e.target.closest('.tile-set');
    if (setDiv) {
        const idx = Array.from(board.children).indexOf(setDiv);
        handleDrop(e, idx, 'board');
    } else {
        handleDrop(e, -1, 'board');
    }
};

workspace.ondragover = (e) => e.preventDefault();
workspace.ondrop = (e) => handleDrop(e, -2, 'workspace');

playerHand.ondragover = (e) => e.preventDefault();
playerHand.ondrop = (e) => handleDrop(e, -3, 'handTarget');

function handleDrop(e, targetIdx, targetType) {
    e.preventDefault();
    const id = e.dataTransfer.getData('tileId');
    const src = e.dataTransfer.getData('source');
    
    let tile = null;
    let adjust = 0;
    if (src === 'hand') {
        const i = state.hand.findIndex(t => t.id === id);
        if (i > -1) tile = state.hand.splice(i, 1)[0];
    } else if (src === 'board') {
        const sI = parseInt(e.dataTransfer.getData('setIdx'));
        const tI = parseInt(e.dataTransfer.getData('tileIdx'));
        if (state.board[sI]) {
            tile = state.board[sI].splice(tI, 1)[0];
            // 自動分裂
            if (tI > 0 && tI < state.board[sI].length) {
                const right = state.board[sI].splice(tI);
                state.board.splice(sI + 1, 0, right);
                if (targetType === 'board' && targetIdx > sI) adjust += 1;
            }
            if (state.board[sI].length === 0) {
                state.board.splice(sI, 1);
                if (targetType === 'board' && targetIdx > sI) adjust -= 1;
                if (targetType === 'board' && targetIdx === sI) targetIdx = -1;
            }
        }
    } else if (src === 'temp') {
        const i = state.tempTiles.findIndex(t => t.id === id);
        if (i > -1) tile = state.tempTiles.splice(i, 1)[0];
    }

    if (!tile) return;

    if (targetType === 'board') {
        const finalIdx = targetIdx + adjust;
        if (finalIdx === -1 || finalIdx < 0 || finalIdx >= state.board.length) state.board.push([tile]);
        else state.board[finalIdx].push(tile);
    } else if (targetType === 'workspace') {
        state.tempTiles.push(tile);
    } else if (targetType === 'handTarget') {
        const wasInHand = state.history[0] && state.history[0].hand.find(t => t.id === tile.id);
        if (!wasInHand) {
            alert('這是桌面上的牌，不能收回手牌！若想調整可放至「調整暫存區」或按「還原回合」。');
            state.tempTiles.push(tile);
        } else {
            state.hand.push(tile);
        }
    }
    renderAll();
}

// --- 按鈕 ---
finishBtn.onclick = () => {
    if (!state.myTurn) return;
    if (state.tempTiles.length > 0) return alert('請將取下的牌放回桌面！');
    socket.emit('finishTurn', { board: state.board, hand: state.hand });
};

undoBtn.onclick = () => {
    if (!state.myTurn || state.history.length === 0) return;
    const snap = state.history[0];
    state.hand = JSON.parse(JSON.stringify(snap.hand));
    state.board = JSON.parse(JSON.stringify(snap.board));
    state.tempTiles = [];
    renderAll();
};

sortByColorBtn.onclick = () => {
    const order = { 'red': 1, 'blue': 2, 'orange': 3, 'black': 4, 'joker': 5 };
    state.hand.sort((a,b) => order[a.color] !== order[b.color] ? order[a.color] - order[b.color] : a.number - b.number);
    renderHand();
};

sortByNumBtn.onclick = () => {
    state.hand.sort((a,b) => a.number !== b.number ? a.number - b.number : 1);
    renderHand();
};

autoPlayBtn.onclick = () => {
    if (state.myTurn && state.history.length > 0) {
        const snap = state.history[0];
        state.hand = JSON.parse(JSON.stringify(snap.hand));
        state.board = JSON.parse(JSON.stringify(snap.board));
        state.tempTiles = [];
        renderAll();
    }
    socket.emit('autoPlayRequest');
};

const deckPile = document.getElementById('deckPile');
deckPile.onclick = () => {
    if (!state.gameStarted) return;
    if (!state.myTurn) return alert('不是您的回合！');
    if (state.tempTiles.length > 0 || JSON.stringify(state.board) !== JSON.stringify(state.history[0].board)) {
        return alert('您已經移動了桌面上的牌，須按「還原回合」或「確定出牌」！');
    }
    socket.emit('drawTile');
};

// --- 其他 ---
function renderPlayers() {
    playersContainer.innerHTML = '';
    const slots = state.maxPlayers || state.players.length; 
    for(let i=0; i<slots; i++) {
        const p = state.players[i];
        if (p) {
            const div = document.createElement('div');
            div.className = `player-card ${p.playerId === state.turnPlayerId ? 'active' : ''} ${p.isFinished ? 'finished' : ''}`;
            let icon = p.isBot ? '🤖' : (p.isHost ? '👑' : '🌸');
            if (!p.online) icon = '🔌';
            const isMe = (p.playerId === state.playerId);
            const nameColor = isMe ? '#38bdf8' : 'white';
            const nameText = isMe ? `${p.nickname} (你)` : p.nickname;
            div.innerHTML = `<span>${icon}</span><div style="flex:1"><b style="color:${nameColor}">${nameText}</b></div><span style="display:flex; align-items:center; gap:5px;">${p.isFinished? '🏆 NO.'+p.rank : '<img src="cat_card_back.png" style="width:14px; height:20px; border-radius:2px; box-shadow: 1px 1px 2px rgba(0,0,0,0.5);"> '+p.cardCount}</span>`;
            playersContainer.appendChild(div);
        } else {
            const div = document.createElement('div');
            div.className = `player-card`;
            div.innerHTML = `<span>👤</span><div style="flex:1; color:gray"><b>待加入...</b></div><span>--</span>`;
            playersContainer.appendChild(div);
        }
    }
}

function appendChat(data) {
    const div = document.createElement('div');
    div.className = 'msg-row';
    const s = data.sender || data.nickname || '玩家';
    const icon = data.icon ? data.icon + ' ' : '';
    div.innerHTML = `<span class="msg-sender">${icon}${s}:</span><span>${data.message}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
socket.on('chat', appendChat);

sendChatBtn.onclick = () => {
    const m = chatInput.value.trim();
    if (m) { socket.emit('chat', m); chatInput.value = ''; }
};

socket.on('error', data => {
    alert(typeof data === 'string' ? data : data.message);
    if (data.errorIndices) renderBoard(data.errorIndices);
});
socket.on('tileDrawn', data => { 
    if (data.drawnTile) state.hand.push(data.drawnTile);
    else if (data.hand) state.hand = data.hand;
    document.getElementById('deckCountText').textContent = data.deckCount || 0;
    renderHand(); 
});
socket.on('gameOver', data => {
    state.gameStarted = false;

    const myScore = (data.allScores || []).find(s => s.nickname === state.nickname);
    if (myScore && myScore.rank === 1) {
        playScreenEffect('You Win!', '#facc15');
    } else {
        playScreenEffect('GAME OVER!', '#38bdf8');
    }

    // 聊天室印出最終排名
    const rankMsg = (data.allScores || []).map(p => {
        const medal = ['🥇','🥈','🥉'][p.rank - 1] || `第${p.rank}名`;
        const cards = p.cardCount > 0 ? ` (剩 ${p.cardCount} 張)` : ' ✓';
        return `${medal} ${p.nickname}${cards}`;
    }).join('　');
    appendChat({ sender: '最終排名', message: rankMsg || `🏆 ${data.winner}`, icon: '🏆' });
    if (data.isDraw) appendChat({ sender: '系統公告', message: '⚠️ 本局為流局，按剩餘手牌數決定名次', icon: '📢' });

    // 停用操作按鈕
    ['autoPlayBtn', 'finishBtn', 'undoBtn', 'sortByColor', 'sortByNum'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = true; btn.style.background = '#94a3b8'; btn.style.cursor = 'not-allowed'; }
    });

    // 顯示「再來一局」或「遊戲結束」
    const rb = document.getElementById('readyBtn');
    rb.style.display = 'inline-block';
    const me = state.players.find(p => p.playerId === state.playerId);
    if (me && me.isHost) {
        rb.textContent = '再來一局';
        rb.disabled = false;
        rb.style.background = '#22c55e';
        rb.style.cursor = 'pointer';
        rb.onclick = () => socket.emit('restartGame');
    } else {
        rb.textContent = '遊戲結束';
        rb.disabled = true;
        rb.style.background = '#94a3b8';
        rb.style.cursor = 'not-allowed';
        rb.onclick = null;
    }
});


function playScreenEffect(text, color) {
    const el = document.getElementById('screenEffect');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'white';
    el.style.textShadow = `0 0 30px ${color || '#38bdf8'}`;
    el.style.display = 'flex';
    el.style.animation = 'none';
    setTimeout(() => { el.style.animation = 'scaleFade 2.5s cubic-bezier(0.17, 0.89, 0.32, 1.25) forwards'; }, 10);
    setTimeout(() => { el.style.display = 'none'; }, 2500);
}
