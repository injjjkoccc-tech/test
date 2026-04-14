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
    renderPlayers();
});

readyBtn.onclick = () => socket.emit('ready');

socket.on('gameStart', (data) => {
    state.hand = data.hand;
    state.board = data.board || [];
    state.gameStarted = true;
    state.turnPlayer = data.turnPlayer;
    state.history = [JSON.parse(JSON.stringify({ hand: state.hand, board: state.board, tempTiles: [] }))];
    renderAll();
});

socket.on('turnUpdate', (data) => {
    state.board = data.board;
    state.turnPlayer = data.turnPlayer;
    state.myTurn = (state.nickname === state.turnPlayer);
    if (state.myTurn) {
        state.history = [JSON.parse(JSON.stringify({ hand: state.hand, board: state.board, tempTiles: [] }))];
    }
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
        
        setDiv.ondragover = (e) => e.preventDefault();
        setDiv.ondrop = (e) => handleDrop(e, idx, 'board');
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
    if (e.target === board) handleDrop(e, -1, 'board');
};

workspace.ondragover = (e) => e.preventDefault();
workspace.ondrop = (e) => handleDrop(e, -2, 'workspace');

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
                state.board.push(right);
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
    } else {
        state.tempTiles.push(tile);
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

// --- 其他 ---
function renderPlayers() {
    playersContainer.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${p.nickname === state.turnPlayer ? 'active' : ''} ${p.isFinished ? 'finished' : ''}`;
        let icon = p.isBot ? '🤖' : (p.isHost ? '👑' : '👤');
        div.innerHTML = `<span>${icon}</span><div style="flex:1"><b>${p.nickname}</b></div><span>${p.isFinished? '🏆 NO.'+p.rank : '🎴 '+p.cardCount}</span>`;
        playersContainer.appendChild(div);
    });
}

function appendChat(data) {
    const div = document.createElement('div');
    div.className = 'msg-row';
    const s = data.sender || data.nickname || '玩家';
    div.innerHTML = `<span class="msg-sender">${s}:</span><span>${data.message}</span>`;
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
socket.on('tileDrawn', data => { state.hand = data.hand; renderHand(); });
socket.on('gameOver', data => {
    document.getElementById('winStatus').textContent = `優勝者：${data.winner}`;
    document.getElementById('modal-gameover').style.display = 'block';
});
