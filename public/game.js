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

function joinGame(roomId, action) {
    const nick = nicknameInput.value.trim();
    if (!nick) return alert('請輸入暱稱');
    state.nickname = nick;
    const maxP = document.querySelector('input[name="maxPlayers"]:checked').value;
    socket.emit('join', { nickname: nick, roomId, playerId: state.playerId, maxPlayers: maxP, action });
}

socket.on('joined', (data) => {
    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    localStorage.setItem('rummikub_playerId', data.playerId);
    lobby.classList.remove('active');
    gameScreen.classList.add('active');
    document.getElementById('roomDisplay').textContent = data.roomCode;
});

socket.on('roomUpdate', (data) => {
    state.players = data.players || [];
    state.gameStarted = data.gameStarted;
    
    const me = state.players.find(p => p.nickname === state.nickname);
    if (!state.gameStarted && me) {
        readyBtn.style.display = 'inline-block';
        if (me.isHost) {
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
            readyBtn.textContent = '等待房主開始...';
            readyBtn.style.background = '#94a3b8';
            readyBtn.disabled = true;
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
    document.getElementById('modal-gameover').style.display = 'none';
    if (data.players) state.players = data.players;
    state.hand = data.hand;
    state.board = data.board || [];
    state.gameStarted = true;
    state.turnPlayer = data.turnPlayer;
    state.myTurn = (state.nickname === state.turnPlayer);
    state.history = [JSON.parse(JSON.stringify({ hand: state.hand, board: state.board, tempTiles: [] }))];
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
    state.myTurn = (state.nickname === state.turnPlayer);
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
    if (tile.color === 'joker') el.innerHTML = `<img src="cat_joker.png" class="joker-img">`;
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
            }
            if (state.board[sI].length === 0) state.board.splice(sI, 1);
        }
    } else if (src === 'temp') {
        const i = state.tempTiles.findIndex(t => t.id === id);
        if (i > -1) tile = state.tempTiles.splice(i, 1)[0];
    }

    if (!tile) return;

    if (targetType === 'board') {
        if (targetIdx === -1) state.board.push([tile]);
        else state.board[targetIdx].push(tile);
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

autoPlayBtn.onclick = () => socket.emit('autoPlayRequest');

const deckPile = document.getElementById('deckPile');
deckPile.onclick = () => {
    if (!state.myTurn) return alert('不是您的回合！');
    if (state.tempTiles.length > 0 || JSON.stringify(state.board) !== JSON.stringify(state.history[0].board)) {
        return alert('您已經移動了桌面上的牌，須按「還原回合」或「確定出牌」！');
    }
    socket.emit('drawTile');
};

// --- 其他 ---
function renderPlayers() {
    playersContainer.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${p.nickname === state.turnPlayer ? 'active' : ''} ${p.isFinished ? 'finished' : ''}`;
        let icon = p.isBot ? '🤖' : (p.isHost ? '👑' : '🐱');
        div.innerHTML = `<span>${icon}</span><div style="flex:1"><b>${p.nickname}</b></div><span>${p.isFinished? '🏆 NO.'+p.rank : '🎴 '+p.cardCount}</span>`;
        playersContainer.appendChild(div);
    });
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
    document.getElementById('winStatus').textContent = `優勝者：${data.winner}`;
    
    const me = state.players.find(p => p.nickname === state.nickname);
    const playAgainBtn = document.getElementById('playAgainBtn');
    if (me && me.isHost) {
        playAgainBtn.style.display = 'inline-block';
        playAgainBtn.onclick = () => socket.emit('restartGame');
    } else {
        playAgainBtn.style.display = 'none';
    }
    
    document.getElementById('modal-gameover').style.display = 'block';
});
