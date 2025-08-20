#!/usr/bin/env node

const http = require('http');
const url = require('url');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('./dist/index');

const PORT = process.env.PORT || 3000;
const connections = new Map(); // Store active TikTok connections

// Simple HTML page
function getHTMLPage(username = '', isConnected = false, logs = []) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TikTok Live Connector - Demo</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            background: rgba(255, 255, 255, 0.9);
            color: #333;
            box-sizing: border-box;
        }
        button {
            background: linear-gradient(45deg, #ff6b6b, #ee5a24);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            margin-right: 10px;
            transition: transform 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
        }
        button:disabled {
            background: #666;
            cursor: not-allowed;
            transform: none;
        }
        .status {
            margin: 20px 0;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            font-weight: bold;
        }
        .status.connected {
            background: rgba(76, 175, 80, 0.3);
            border: 1px solid #4CAF50;
        }
        .status.disconnected {
            background: rgba(244, 67, 54, 0.3);
            border: 1px solid #f44336;
        }
        .logs {
            background: rgba(0, 0, 0, 0.4);
            border-radius: 8px;
            padding: 20px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
        }
        .log-entry {
            margin-bottom: 8px;
            word-wrap: break-word;
        }
        .log-chat { color: #64b5f6; }
        .log-gift { color: #ffb74d; }
        .log-member { color: #81c784; }
        .log-like { color: #f48fb1; }
        .log-system { color: #fff176; }
        .log-error { color: #e57373; }
        .auto-refresh {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.5);
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
        }
        .tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 15px;
            padding: 0;
        }
        .tab-button {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 8px 16px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: normal;
            transition: all 0.3s ease;
            margin: 0;
        }
        .tab-button:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
        }
        .tab-button.active {
            background: linear-gradient(45deg, #ff6b6b, #ee5a24);
            border-color: #ff6b6b;
            font-weight: bold;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .no-events {
            color: rgba(255, 255, 255, 0.6);
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
    </style>
    <script>
        // Auto-refresh every 2 seconds when connected
        ${isConnected ? 'setTimeout(() => window.location.reload(), 2000);' : ''}
        
        // Tab switching function
        function showTab(tabName) {
            // Hide all tab contents
            const tabContents = document.querySelectorAll('.tab-content');
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Remove active class from all tab buttons
            const tabButtons = document.querySelectorAll('.tab-button');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            // Show selected tab content
            const selectedTab = document.getElementById('tab-' + tabName);
            if (selectedTab) {
                selectedTab.classList.add('active');
            }
            
            // Add active class to clicked button
            const clickedButton = event ? event.target : document.querySelector('[onclick*="' + tabName + '"]');
            if (clickedButton) {
                clickedButton.classList.add('active');
            }
        }
    </script>
</head>
<body>
    <div class="auto-refresh">🔄 Auto-refresh: ${isConnected ? 'ON' : 'OFF'}</div>
    <div class="container">
        <h1>🎮 TikTok Live Connector</h1>
        
        <form action="/connect" method="POST">
            <div class="form-group">
                <label for="username">TikTok Username (without @):</label>
                <input type="text" id="username" name="username" value="${username}" placeholder="e.g., officialgeilegisela" required>
            </div>
            <button type="submit" ${isConnected ? 'disabled' : ''}>
                ${isConnected ? '🔗 Connected' : '🚀 Connect to Live Stream'}
            </button>
            ${isConnected ? '<button type="button" onclick="location.href=\'/disconnect\'">🔌 Disconnect</button>' : ''}
        </form>
        
        <div class="status ${isConnected ? 'connected' : 'disconnected'}">
            ${isConnected ? `✅ Connected to @${username}` : '❌ Not connected'}
        </div>
        
        ${logs.length > 0 ? `
        <h3>📊 Live Events:</h3>
        <div class="tabs">
            <button class="tab-button active" onclick="showTab('all')">🌟 All Events (${logs.length})</button>
            <button class="tab-button" onclick="showTab('chat')">💬 Messages (${logs.filter(log => log.type === 'log-chat').length})</button>
            <button class="tab-button" onclick="showTab('gift')">🎁 Gifts (${logs.filter(log => log.type === 'log-gift').length})</button>
            <button class="tab-button" onclick="showTab('member')">👥 Users (${logs.filter(log => log.type === 'log-member').length})</button>
            <button class="tab-button" onclick="showTab('like')">❤️ Likes (${logs.filter(log => log.type === 'log-like').length})</button>
            <button class="tab-button" onclick="showTab('system')">📱 Social (${logs.filter(log => log.type === 'log-system').length})</button>
        </div>
        <div class="logs" id="logs">
            <div class="tab-content active" id="tab-all">
                ${logs.map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('')}
            </div>
            <div class="tab-content" id="tab-chat">
                ${logs.filter(log => log.type === 'log-chat').map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('') || '<div class="no-events">No chat messages yet...</div>'}
            </div>
            <div class="tab-content" id="tab-gift">
                ${logs.filter(log => log.type === 'log-gift').map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('') || '<div class="no-events">No gifts sent yet...</div>'}
            </div>
            <div class="tab-content" id="tab-member">
                ${logs.filter(log => log.type === 'log-member').map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('') || '<div class="no-events">No new users yet...</div>'}
            </div>
            <div class="tab-content" id="tab-like">
                ${logs.filter(log => log.type === 'log-like').map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('') || '<div class="no-events">No likes yet...</div>'}
            </div>
            <div class="tab-content" id="tab-system">
                ${logs.filter(log => log.type === 'log-system').map(log => `<div class="log-entry ${log.type}">${log.message}</div>`).join('') || '<div class="no-events">No social events yet...</div>'}
            </div>
        </div>
        ` : ''}
        
        <div style="margin-top: 30px; text-align: center; font-size: 14px; opacity: 0.8;">
            <p>🔗 Running on localhost:${PORT}</p>
            <p>💡 Make sure the username belongs to someone who is currently live</p>
        </div>
    </div>
</body>
</html>`;
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
        if (path === '/' && method === 'GET') {
            // Serve main page
            const currentConnection = Array.from(connections.values())[0];
            const logs = currentConnection ? currentConnection.logs : [];
            const username = currentConnection ? currentConnection.username : '';
            const isConnected = currentConnection ? currentConnection.isConnected : false;
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getHTMLPage(username, isConnected, logs));
            
        } else if (path === '/connect' && method === 'POST') {
            // Handle connect request
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const params = new URLSearchParams(body);
                    const username = params.get('username');
                    
                    if (!username) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Username is required');
                        return;
                    }
                    
                    // Disconnect existing connection
                    connections.forEach(conn => {
                        if (conn.connection) {
                            conn.connection.disconnect();
                        }
                    });
                    connections.clear();
                    
                    // Create new connection
                    const tiktokConnection = new TikTokLiveConnection(username, {
                        processInitialData: true,
                        enableExtendedGiftInfo: true,
                        fetchRoomInfoOnConnect: true
                    });
                    
                    const connectionData = {
                        username,
                        connection: tiktokConnection,
                        isConnected: false,
                        logs: []
                    };
                    
                    // Add event listeners
                    tiktokConnection.on(ControlEvent.CONNECTED, (state) => {
                        connectionData.isConnected = true;
                        connectionData.logs.unshift({
                            type: 'log-system',
                            message: `✅ Connected to room ${state.roomId} | Host: ${state.roomInfo?.owner?.uniqueId || 'Unknown'} | Viewers: ${state.roomInfo?.user_count || 'Unknown'}`
                        });
                    });
                    
                    tiktokConnection.on(ControlEvent.DISCONNECTED, () => {
                        connectionData.isConnected = false;
                        connectionData.logs.unshift({
                            type: 'log-error',
                            message: '❌ Disconnected from TikTok LIVE'
                        });
                    });
                    
                    tiktokConnection.on(ControlEvent.ERROR, (err) => {
                        connectionData.logs.unshift({
                            type: 'log-error',
                            message: `❌ Error: ${err.message}`
                        });
                    });
                    
                    tiktokConnection.on(WebcastEvent.CHAT, (data) => {
                        connectionData.logs.unshift({
                            type: 'log-chat',
                            message: `💬 ${data.user.uniqueId}: ${data.comment}`
                        });
                        // Keep only last 50 messages
                        if (connectionData.logs.length > 50) {
                            connectionData.logs = connectionData.logs.slice(0, 50);
                        }
                    });
                    
                    tiktokConnection.on(WebcastEvent.GIFT, (data) => {
                        if (data.giftType === 1 && !data.repeatEnd) {
                            connectionData.logs.unshift({
                                type: 'log-gift',
                                message: `🎁 ${data.user.uniqueId} is sending ${data.giftName} x${data.repeatCount} (streak)`
                            });
                        } else {
                            connectionData.logs.unshift({
                                type: 'log-gift',
                                message: `🎁 ${data.user.uniqueId} sent ${data.giftName} x${data.repeatCount}`
                            });
                        }
                    });
                    
                    tiktokConnection.on(WebcastEvent.MEMBER, (data) => {
                        connectionData.logs.unshift({
                            type: 'log-member',
                            message: `👋 ${data.user.uniqueId} joined the stream`
                        });
                    });
                    
                    tiktokConnection.on(WebcastEvent.LIKE, (data) => {
                        connectionData.logs.unshift({
                            type: 'log-like',
                            message: `❤️ ${data.user.uniqueId} sent ${data.likeCount} likes (total: ${data.totalLikeCount})`
                        });
                    });
                    
                    tiktokConnection.on(WebcastEvent.FOLLOW, (data) => {
                        connectionData.logs.unshift({
                            type: 'log-system',
                            message: `➕ ${data.user.uniqueId} followed the streamer!`
                        });
                    });
                    
                    connections.set(username, connectionData);
                    
                    // Check if user is live and connect
                    const isLive = await tiktokConnection.fetchIsLive();
                    if (!isLive) {
                        connectionData.logs.unshift({
                            type: 'log-error',
                            message: `❌ @${username} is not currently live. Try a different username.`
                        });
                    } else {
                        await tiktokConnection.connect();
                    }
                    
                    // Redirect back to main page
                    res.writeHead(302, { 'Location': '/' });
                    res.end();
                    
                } catch (error) {
                    console.error('Connection error:', error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Failed to connect: ' + error.message);
                }
            });
            
        } else if (path === '/disconnect' && method === 'GET') {
            // Handle disconnect request
            connections.forEach(conn => {
                if (conn.connection) {
                    conn.connection.disconnect();
                }
            });
            connections.clear();
            
            res.writeHead(302, { 'Location': '/' });
            res.end();
            
        } else if (path === '/api/logs' && method === 'GET') {
            // API endpoint for logs
            const currentConnection = Array.from(connections.values())[0];
            const logs = currentConnection ? currentConnection.logs : [];
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ logs, isConnected: currentConnection?.isConnected || false }));
            
        } else {
            // 404 Not Found
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Page not found');
        }
        
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 TikTok Live Connector Server is running!`);
    console.log(`📍 Open your browser and go to: http://localhost:${PORT}`);
    console.log(`💡 Make sure to use a TikTok username of someone who is currently live`);
    console.log(`🛑 Press Ctrl+C to stop the server`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    connections.forEach(conn => {
        if (conn.connection) {
            conn.connection.disconnect();
        }
    });
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    connections.forEach(conn => {
        if (conn.connection) {
            conn.connection.disconnect();
        }
    });
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
