// TikTok Live Connector Frontend
class TikTokLiveApp {
    constructor() {
        this.API_BASE = 'http://localhost:3001/api';
        this.currentSession = null;
        this.currentFilter = 'all';
        this.eventSource = null;
        this.events = [];
        this.ngrokStatus = { isConnected: false, url: null };
        this.webhooks = [];
        
        this.init();
    }

    init() {
        console.log('🚀 TikTok Live Connector App initialized');
        this.loadSessions();
        this.setupEventListeners();
        this.checkNgrokStatus();
        this.loadWebhooks();
    }

    setupEventListeners() {
        // Enter key support for username input
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createSession();
            }
        });
    }

    showAlert(message, type = 'info') {
        const container = document.getElementById('alertContainer');
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = message;
        
        container.innerHTML = '';
        container.appendChild(alert);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (container.contains(alert)) {
                container.removeChild(alert);
            }
        }, 5000);
    }

    async createSession() {
        const username = document.getElementById('username').value.trim();
        
        if (!username) {
            this.showAlert('Please enter a TikTok username', 'error');
            return;
        }

        const connectBtn = document.getElementById('connectBtn');
        const originalText = connectBtn.innerHTML;
        
        try {
            // Show loading state
            connectBtn.innerHTML = '🔄 Connecting...';
            connectBtn.disabled = true;
            
            this.showAlert('🔍 Checking if user is live and connecting...', 'info');

            const response = await fetch(`${this.API_BASE}/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to create session');
            }

            // Success!
            this.currentSession = data.sessionId;
            this.showAlert(`✅ ${data.message}`, 'success');
            
            // Update UI
            this.updateSessionUI(data);
            this.startEventStream(data.sessionId);
            
            // Clear username input
            document.getElementById('username').value = '';
            
            // Show disconnect button
            document.getElementById('disconnectBtn').style.display = 'inline-block';
            
        } catch (error) {
            console.error('Error creating session:', error);
            this.showAlert(`❌ ${error.message}`, 'error');
        } finally {
            // Reset button
            connectBtn.innerHTML = originalText;
            connectBtn.disabled = false;
        }
    }

    updateSessionUI(sessionData) {
        const statusContainer = document.getElementById('sessionStatus');
        const statsContainer = document.getElementById('sessionStats');
        
        statusContainer.innerHTML = `
            <div class="status-card">
                <strong>Status:</strong> 🟢 Connected
                <br><strong>Session ID:</strong> ${sessionData.sessionId}
                <br><strong>Room ID:</strong> ${sessionData.roomId}
                <br><strong>Streamer:</strong> @${sessionData.streamer.username}
                <br><strong>Display Name:</strong> ${sessionData.streamer.displayName}
                <br><strong>Followers:</strong> ${sessionData.streamer.followerCount?.toLocaleString() || 'Unknown'}
                <br><strong>Current Viewers:</strong> ${sessionData.streamer.viewerCount?.toLocaleString() || 'Unknown'}
            </div>
        `;
        
        statsContainer.style.display = 'block';
    }

    async endCurrentSession() {
        if (!this.currentSession) {
            this.showAlert('No active session to end', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSession}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to end session');
            }

            this.showAlert('✅ Session ended successfully', 'success');
            this.resetUI();
            this.stopEventStream();
            this.loadSessions(); // Refresh sessions list

        } catch (error) {
            console.error('Error ending session:', error);
            this.showAlert(`❌ ${error.message}`, 'error');
        }
    }

    resetUI() {
        this.currentSession = null;
        this.events = [];
        
        // Reset status
        document.getElementById('sessionStatus').innerHTML = `
            <div class="status-card disconnected">
                <strong>Status:</strong> No active session
                <br><small>Connect to a TikTok live stream to start capturing events</small>
            </div>
        `;
        
        // Hide stats
        document.getElementById('sessionStats').style.display = 'none';
        
        // Hide disconnect button
        document.getElementById('disconnectBtn').style.display = 'none';
        
        // Clear events
        document.getElementById('eventsContainer').innerHTML = `
            <div class="loading">
                <div>No active session. Connect to a live stream to see events.</div>
            </div>
        `;
    }

    startEventStream(sessionId) {
        // Close existing stream
        this.stopEventStream();
        
        console.log(`🔗 Starting event stream for session ${sessionId}`);
        
        this.eventSource = new EventSource(`${this.API_BASE}/sessions/${sessionId}/stream`);
        
        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'session_info') {
                    console.log('📊 Session info received:', data.session);
                } else if (data.type === 'events') {
                    this.handleNewEvents(data.events, data.stats);
                }
            } catch (error) {
                console.error('Error parsing event data:', error);
            }
        };
        
        this.eventSource.onerror = (error) => {
            console.error('EventSource error:', error);
            this.showAlert('❌ Connection to event stream lost', 'error');
        };
    }

    stopEventStream() {
        if (this.eventSource) {
            console.log('🔌 Stopping event stream');
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    handleNewEvents(newEvents, stats) {
        // Add new events to our local array
        newEvents.forEach(event => {
            // Check if we already have this event
            if (!this.events.find(e => e.timestamp === event.timestamp && e.type === event.type && e.username === event.username)) {
                this.events.unshift(event); // Add to beginning for most recent first
            }
        });
        
        // Keep only last 200 events
        if (this.events.length > 200) {
            this.events = this.events.slice(0, 200);
        }
        
        // Update stats
        this.updateStats(stats);
        
        // Update events display
        this.displayEvents();
    }

    updateStats(stats) {
        if (!stats) return;
        
        document.getElementById('totalEvents').textContent = stats.totalEvents || 0;
        document.getElementById('messagesCount').textContent = stats.messages || 0;
        document.getElementById('giftsCount').textContent = stats.gifts || 0;
        document.getElementById('likesCount').textContent = stats.likes || 0;
        document.getElementById('membersCount').textContent = stats.members || 0;
        document.getElementById('socialCount').textContent = stats.social || 0;
        
        // Count shares separately from social events
        const shareCount = this.events.filter(event => 
            event.type === 'social' && event.subtype === 'share'
        ).length;
        document.getElementById('sharesCount').textContent = shareCount;
    }

    showEvents(filter) {
        this.currentFilter = filter;
        
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');
        
        this.displayEvents();
    }

    displayEvents() {
        const container = document.getElementById('eventsContainer');
        
        if (this.events.length === 0) {
            container.innerHTML = `
                <div class="loading">
                    <div>No events captured yet. Waiting for live stream activity...</div>
                </div>
            `;
            return;
        }
        
        // Filter events
        let filteredEvents = this.events;
        if (this.currentFilter !== 'all') {
            if (this.currentFilter === 'shares') {
                // Special filter for shares only
                filteredEvents = this.events.filter(event => 
                    event.type === 'social' && event.subtype === 'share'
                );
            } else {
                filteredEvents = this.events.filter(event => event.type === this.currentFilter);
            }
        }
        
        // Display events
        const eventsHtml = filteredEvents.map(event => this.formatEvent(event)).join('');
        container.innerHTML = eventsHtml || `
            <div class="loading">
                <div>No ${this.currentFilter} events yet...</div>
            </div>
        `;
        
        // Auto-scroll to top for new events
        container.scrollTop = 0;
    }

    formatEvent(event) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        let content = '';
        
        switch (event.type) {
            case 'chat':
                content = `💬 ${event.username}: ${event.message}`;
                break;
            case 'gift':
                content = `🎁 ${event.username} sent ${event.giftName || 'a gift'} ${event.repeatCount > 1 ? `x${event.repeatCount}` : ''}`;
                break;
            case 'member':
                content = `👋 ${event.username} joined the stream`;
                break;
            case 'like':
                content = `❤️ ${event.username} sent ${event.likeCount || 1} likes`;
                break;
            case 'social':
                if (event.subtype === 'follow') {
                    content = `➕ ${event.username} followed the streamer`;
                } else if (event.subtype === 'share') {
                    content = `📤 ${event.username} shared the stream to their network`;
                } else if (event.subtype === 'subscribe') {
                    content = `⭐ ${event.username} subscribed to the channel`;
                } else {
                    content = `📱 ${event.username} ${event.action || 'interacted'}`;
                }
                break;
            case 'emote':
                content = `😄 ${event.username} sent an emote`;
                break;
            case 'envelope':
                content = `💰 ${event.username} sent a treasure chest`;
                break;
            case 'question':
                content = `❓ ${event.username}: ${event.questionText || 'asked a question'}`;
                break;
            case 'battle':
                if (event.subtype === 'mic_battle') {
                    const users = event.battleUsers?.map(u => u.username).join(' vs ') || 'users';
                    content = `⚔️ Battle started: ${users}`;
                } else {
                    content = `⚔️ Battle update`;
                }
                break;
            case 'room_update':
                content = `👥 ${event.viewerCount || 0} viewers watching`;
                break;
            case 'ranking':
                content = `🏆 Ranking update: ${event.subtype || 'leaderboard changed'}`;
                break;
            case 'poll':
                content = `🗳️ Poll activity`;
                break;
            case 'shopping':
                content = `🛒 Shopping event`;
                break;
            case 'moderation':
                if (event.subtype === 'message_deleted') {
                    content = `🔧 Message was deleted`;
                } else if (event.subtype === 'message_pinned') {
                    content = `📌 Message was pinned`;
                } else {
                    content = `🔧 Moderation action`;
                }
                break;
            case 'caption':
                content = `📺 Caption: ${event.captionText || 'Stream caption updated'}`;
                break;
            case 'goal':
                content = `🎯 Goal progress updated`;
                break;
            case 'banner':
                content = `📢 Banner displayed`;
                break;
            case 'link':
                content = `🔗 Link shared`;
                break;
            case 'intro':
                content = `🎪 ${event.introMessage || 'Stream intro played'}`;
                break;
            case 'error':
                content = `❌ Error: ${event.message}`;
                break;
            default:
                // Only show clean, simple format for unknown events
                content = `🔔 ${event.type} event`;
        }
        
        // Special styling for share events
        const cssClass = (event.type === 'social' && event.subtype === 'share') ? 'event-share' : `event-${event.type}`;
        
        return `
            <div class="event-item ${cssClass}">
                <span style="opacity: 0.7; font-size: 0.9em;">[${time}]</span> ${content}
            </div>
        `;
    }

    async loadSessions() {
        try {
            const response = await fetch(`${this.API_BASE}/sessions`);
            
            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('Server error - database may be initializing');
                } else {
                    throw new Error(`Server returned ${response.status}`);
                }
            }
            
            const data = await response.json();
            this.displaySessions(data.sessions || []);
            
        } catch (error) {
            console.error('Error loading sessions:', error);
            document.getElementById('sessionsList').innerHTML = `
                <div class="alert alert-error">
                    ❌ Failed to load sessions: ${error.message}
                    <br><small>The server might be starting up. Try refreshing in a moment.</small>
                </div>
            `;
        }
    }

    displaySessions(sessions) {
        const container = document.getElementById('sessionsList');
        
        if (sessions.length === 0) {
            container.innerHTML = `
                <div class="loading">
                    <div>No sessions found. Create your first session above!</div>
                </div>
            `;
            return;
        }
        
        const sessionsHtml = sessions.map(session => {
            const startTime = new Date(session.session_start).toLocaleString();
            const endTime = session.session_end ? new Date(session.session_end).toLocaleString() : 'Ongoing';
            const duration = session.session_end ? 
                this.calculateDuration(session.session_start, session.session_end) : 
                this.calculateDuration(session.session_start, new Date().toISOString());
            
            return `
                <div class="session-item ${session.isActive ? 'active' : ''}" 
                     onclick="this.loadSessionDetails('${session.id}')">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>@${session.streamer_username}</strong>
                            ${session.isActive ? '<span style="color: #00b894;">🟢 LIVE</span>' : '<span style="color: #e17055;">⚫ ENDED</span>'}
                        </div>
                        <div style="text-align: right; font-size: 0.9em; opacity: 0.8;">
                            <div>Duration: ${duration}</div>
                            <div>Events: ${session.total_events || 0}</div>
                        </div>
                    </div>
                    <div style="margin-top: 8px; font-size: 0.9em; opacity: 0.8;">
                        <div>Session ID: ${session.id}</div>
                        <div>Started: ${startTime}</div>
                        ${!session.isActive ? `<div>Ended: ${endTime}</div>` : ''}
                        <div style="margin-top: 5px;">
                            💬 ${session.total_messages || 0} | 
                            🎁 ${session.total_gifts || 0} | 
                            ❤️ ${session.total_likes || 0} | 
                            👥 ${session.total_members || 0} | 
                            📱 ${session.total_social || 0}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = sessionsHtml;
    }

    calculateDuration(start, end) {
        const startTime = new Date(start);
        const endTime = new Date(end);
        const diff = endTime - startTime;
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async loadSessionDetails(sessionId) {
        try {
            // Load session info
            const sessionResponse = await fetch(`${this.API_BASE}/sessions/${sessionId}`);
            const sessionData = await sessionResponse.json();
            
            // Load session events
            const eventsResponse = await fetch(`${this.API_BASE}/sessions/${sessionId}/events`);
            const eventsData = await eventsResponse.json();
            
            if (!sessionResponse.ok || !eventsResponse.ok) {
                throw new Error('Failed to load session details');
            }
            
            // Display session details in a modal or update current view
            this.showSessionModal(sessionData, eventsData);
            
        } catch (error) {
            console.error('Error loading session details:', error);
            this.showAlert(`❌ Failed to load session details: ${error.message}`, 'error');
        }
    }

    showSessionModal(sessionData, eventsData) {
        // Create and show modal with session details
        // For now, just log the data and show an alert
        console.log('Session Data:', sessionData);
        console.log('Events Data:', eventsData);
        
        this.showAlert(`📊 Session has ${eventsData.events.length} events. Check console for details.`, 'info');
    }

    async exportData() {
        if (!this.currentSession) {
            this.showAlert('No active session to export', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSession}/events`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to export data');
            }
            
            // Create and download JSON file
            const jsonData = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `tiktok-session-${this.currentSession}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showAlert('✅ Data exported successfully', 'success');
            
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showAlert(`❌ Failed to export data: ${error.message}`, 'error');
        }
    }
    // ===== NGROK METHODS =====

    async checkNgrokStatus() {
        try {
            const response = await fetch(`${this.API_BASE}/ngrok/status`);
            const status = await response.json();
            this.ngrokStatus = status;
            this.updateNgrokUI();
            return status;
        } catch (error) {
            console.error('Error checking ngrok status:', error);
            return { isConnected: false, url: null };
        }
    }

    async toggleNgrok() {
        try {
            const button = document.getElementById('ngrokToggleBtn');
            const statusDiv = document.getElementById('ngrokStatus');
            
            if (this.ngrokStatus.isConnected) {
                // Stop ngrok
                button.disabled = true;
                button.textContent = '🛑 Stopping...';
                
                const response = await fetch(`${this.API_BASE}/ngrok/stop`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                if (result.success) {
                    this.ngrokStatus = { isConnected: false, url: null };
                    this.updateNgrokUI();
                    this.showAlert('✅ Public access stopped', 'success');
                } else {
                    throw new Error(result.error || 'Failed to stop ngrok');
                }
            } else {
                // Start ngrok
                button.disabled = true;
                button.textContent = '🚀 Starting...';
                statusDiv.style.display = 'block';
                this.updateNgrokStatus('connecting', 'Starting tunnel...');
                
                const response = await fetch(`${this.API_BASE}/ngrok/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ port: 3001 })
                });
                const result = await response.json();
                
                if (result.success) {
                    this.ngrokStatus = { isConnected: true, url: result.url };
                    this.updateNgrokUI();
                    this.showAlert(`✅ Now public at: ${result.url}`, 'success');
                } else {
                    throw new Error(result.error || 'Failed to start ngrok');
                }
            }
        } catch (error) {
            console.error('Error toggling ngrok:', error);
            
            // Show helpful error message
            let errorMsg = error.message;
            if (errorMsg.includes('Failed after')) {
                errorMsg += '\n\n💡 Quick fixes:\n• Check internet connection\n• Try manual: open Terminal and run "ngrok http 3001"\n• Visit ngrok dashboard to verify account';
            }
            
            this.showAlert(`❌ Ngrok error: ${errorMsg}`, 'error');
            this.updateNgrokUI();
        }
    }

    updateNgrokUI() {
        const button = document.getElementById('ngrokToggleBtn');
        const statusDiv = document.getElementById('ngrokStatus');
        const urlInput = document.getElementById('publicUrl');
        
        button.disabled = false;
        
        if (this.ngrokStatus.isConnected) {
            button.textContent = '🛑 Stop Public Access';
            button.className = 'btn btn-danger';
            statusDiv.style.display = 'block';
            urlInput.value = this.ngrokStatus.url || '';
            this.updateNgrokStatus('connected', `Public at: ${this.ngrokStatus.url}`);
        } else {
            button.textContent = '🚀 Start Public Access';
            button.className = 'btn';
            statusDiv.style.display = 'none';
            urlInput.value = '';
        }
    }

    updateNgrokStatus(status, text) {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        
        statusDot.className = `status-dot ${status}`;
        statusText.textContent = text;
    }

    copyPublicUrl() {
        const urlInput = document.getElementById('publicUrl');
        urlInput.select();
        document.execCommand('copy');
        this.showAlert('📋 URL copied to clipboard!', 'info');
    }

    openPublicUrl() {
        const url = document.getElementById('publicUrl').value;
        if (url) {
            window.open(url, '_blank');
        }
    }

    showManualNgrok() {
        const instructions = `
🔧 Manual Ngrok Setup Instructions

If the automatic "Start Public Access" button doesn't work, you can set up ngrok manually:

📋 Step-by-Step:

1️⃣ Open Terminal (Applications → Utilities → Terminal)

2️⃣ Run this command:
   ngrok http 3001

3️⃣ Look for a line like:
   "Forwarding    https://abc123.ngrok.io → http://localhost:3001"

4️⃣ Copy the https://abc123.ngrok.io URL

5️⃣ Share that URL with anyone to access your dashboard!

🔧 If ngrok is not installed:
   brew install ngrok

🔑 If you need authentication:
   1. Visit: https://dashboard.ngrok.com/get-started/your-authtoken
   2. Copy your authtoken  
   3. Run: ngrok authtoken YOUR_TOKEN_HERE

⚡ Quick Fix Script:
   Run: node fix-ngrok.js

The manual method always works and gives you the same result as the button!
        `;

        // Create a modal-like alert with the instructions
        const alertDiv = document.createElement('div');
        alertDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            backdrop-filter: blur(5px);
        `;

        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            margin: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.2);
        `;

        contentDiv.innerHTML = `
            <h3 style="margin-top: 0; margin-bottom: 20px;">🔧 Manual Ngrok Setup</h3>
            <pre style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; margin-bottom: 20px;">${instructions}</pre>
            <div style="text-align: center;">
                <button onclick="this.closest('.manual-modal').remove()" style="
                    background: rgba(255,255,255,0.2);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.3);
                    padding: 10px 20px;
                    border-radius: 25px;
                    cursor: pointer;
                    font-size: 14px;
                ">✅ Got it!</button>
            </div>
        `;

        alertDiv.className = 'manual-modal';
        alertDiv.appendChild(contentDiv);
        document.body.appendChild(alertDiv);

        // Close on background click
        alertDiv.addEventListener('click', (e) => {
            if (e.target === alertDiv) {
                alertDiv.remove();
            }
        });
    }

    // ===== WEBHOOK METHODS =====

    async loadWebhooks() {
        try {
            const response = await fetch(`${this.API_BASE}/webhooks`);
            const data = await response.json();
            this.webhooks = data.webhooks || [];
            this.updateWebhooksList();
        } catch (error) {
            console.error('Error loading webhooks:', error);
        }
    }

    async addWebhook() {
        const urlInput = document.getElementById('webhookUrl');
        const url = urlInput.value.trim();
        
        if (!url) {
            this.showAlert('❌ Please enter a webhook URL', 'error');
            return;
        }
        
        if (!url.startsWith('http')) {
            this.showAlert('❌ URL must start with http:// or https://', 'error');
            return;
        }
        
        try {
            const webhookId = `webhook_${Date.now()}`;
            const response = await fetch(`${this.API_BASE}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: webhookId,
                    url: url,
                    events: ['all']
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                urlInput.value = '';
                this.loadWebhooks();
                this.showAlert('✅ Webhook added successfully', 'success');
            } else {
                throw new Error(result.error || 'Failed to add webhook');
            }
        } catch (error) {
            console.error('Error adding webhook:', error);
            this.showAlert(`❌ Failed to add webhook: ${error.message}`, 'error');
        }
    }

    async removeWebhook(webhookId) {
        try {
            const response = await fetch(`${this.API_BASE}/webhooks/${webhookId}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.loadWebhooks();
                this.showAlert('✅ Webhook removed', 'success');
            } else {
                throw new Error(result.error || 'Failed to remove webhook');
            }
        } catch (error) {
            console.error('Error removing webhook:', error);
            this.showAlert(`❌ Failed to remove webhook: ${error.message}`, 'error');
        }
    }

    async testWebhooks() {
        try {
            const response = await fetch(`${this.API_BASE}/test-webhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testData: {
                        message: 'Test webhook from TikTok Live Connector',
                        timestamp: new Date().toISOString(),
                        testType: 'manual'
                    }
                })
            });
            
            const result = await response.json();
            
            if (result.results) {
                const successCount = result.results.filter(r => r.success).length;
                const totalCount = result.results.length;
                this.showAlert(`📡 Webhook test complete: ${successCount}/${totalCount} successful`, 'info');
            } else {
                this.showAlert('📡 Webhook test sent', 'info');
            }
        } catch (error) {
            console.error('Error testing webhooks:', error);
            this.showAlert(`❌ Webhook test failed: ${error.message}`, 'error');
        }
    }

    updateWebhooksList() {
        const container = document.getElementById('webhooksList');
        
        if (this.webhooks.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 15px;">No webhooks configured</div>';
            return;
        }
        
        const webhooksHtml = this.webhooks.map(webhook => `
            <div class="webhook-item">
                <div class="webhook-url">${webhook.url}</div>
                <div class="webhook-status ${webhook.errors > 0 ? 'error' : ''}">${webhook.totalSent} sent</div>
                <button class="btn btn-secondary" onclick="app.removeWebhook('${webhook.id}')" style="padding: 4px 8px; font-size: 12px;">🗑️</button>
            </div>
        `).join('');
        
        container.innerHTML = webhooksHtml;
    }
}

// Global functions for HTML onclick handlers
let app;

function toggleNgrok() {
    app.toggleNgrok();
}

function copyPublicUrl() {
    app.copyPublicUrl();
}

function openPublicUrl() {
    app.openPublicUrl();
}

function addWebhook() {
    app.addWebhook();
}

function testWebhooks() {
    app.testWebhooks();
}

function showManualNgrok() {
    app.showManualNgrok();
}

function createSession() {
    app.createSession();
}

function endCurrentSession() {
    app.endCurrentSession();
}

function showEvents(filter) {
    app.showEvents(filter);
}

function loadSessions() {
    app.loadSessions();
}

function exportData() {
    app.exportData();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    app = new TikTokLiveApp();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (app) {
        app.stopEventStream();
    }
});
