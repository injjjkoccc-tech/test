const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const TEST_ROUNDS = 100;

async function runTest() {
    console.log(`🚀 開始進行 ${TEST_ROUNDS} 次循環自動化壓力測試...`);
    
    // 建立 4 個虛擬玩家連線
    const sockets = [];
    for (let i = 0; i < 4; i++) {
        const socket = io(SERVER_URL);
        sockets.push(socket);
        
        await new Promise((resolve) => {
            socket.on('connect', () => {
                socket.emit('join', { 
                    nickname: `Tester-${i}`, 
                    roomId: 'TEST', 
                    action: i === 0 ? 'create' : 'join',
                    maxPlayers: 4
                });
            });
            socket.on('joined', resolve);
        });
    }

    console.log('✅ 所有虛擬測試員已就位。');

    // 準備遊戲
    sockets.forEach(s => s.emit('ready'));
    
    let currentTurn = 0;
    let completedRounds = 0;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            console.log('⚠️ 測試超時，可能存在死鎖或邏輯遺漏。');
            cleanup();
            reject();
        }, 30000);

        function cleanup() {
            clearTimeout(timeout);
            sockets.forEach(s => s.disconnect());
        }

        // 監聽最後一個玩家的遊戲結束
        sockets[0].on('gameOver', (data) => {
            console.log(`🏆 遊戲正常結束。獲勝者: ${data.winner}`);
            completedRounds++;
            if (completedRounds >= TEST_ROUNDS) {
                console.log(`🎉 成功完成 ${TEST_ROUNDS} 次對局循環測試，未發現系統崩潰！`);
                cleanup();
                resolve();
            } else {
                // 房主重啟
                sockets[0].emit('restartGame');
            }
        });

        // 模擬自動出牌交互
        sockets.forEach((s, idx) => {
            s.on('turnUpdate', (data) => {
                if (data.turnPlayer === `Tester-${idx}`) {
                    // 隨機延時模擬思考，快速執行自動出牌
                    setTimeout(() => {
                        s.emit('autoPlayRequest');
                    }, 50);
                }
            });
        });
    });
}

runTest().catch(err => {
    console.error('❌ 測試失敗:', err);
    process.exit(1);
});
