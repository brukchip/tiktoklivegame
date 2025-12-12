// TikTok Live Connector Frontend
class TikTokLiveApp {
    constructor() {
        // Automatically detect API base URL - works both locally and on deployed server
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.API_BASE = isLocalhost
            ? 'http://localhost:3001/api'
            : `${window.location.protocol}//${window.location.host}/api`;

        console.log('🌐 API Base URL:', this.API_BASE);

        this.currentSession = null;
        this.currentFilter = 'all';
        this.eventSource = null;
        this.events = [];
        this.ngrokStatus = { isConnected: false, url: null };

        // Pagination for sessions
        this.currentPage = 1;
        this.sessionsPerPage = 5;
        this.totalSessions = 0;

        this.init();
    }

    init() {
        console.log('🚀 TikTok Live Connector App initialized');
        this.loadSessions();
        this.setupEventListeners();
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

    async endSession(sessionId) {
        if (!sessionId) {
            this.showAlert('❌ No session ID provided', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/sessions/${sessionId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('✅ Session ended successfully', 'success');

                // Refresh sessions list to show updated status
                this.loadSessions();

                // If this was the current session, reset UI
                if (this.currentSession === sessionId) {
                    this.resetUI();
                }
            } else {
                throw new Error(result.error || 'Failed to end session');
            }

        } catch (error) {
            console.error('Error ending session:', error);
            this.showAlert(`❌ Failed to end session: ${error.message}`, 'error');
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

        // Store total sessions and calculate pagination
        this.totalSessions = sessions.length;
        const totalPages = Math.ceil(this.totalSessions / this.sessionsPerPage);

        // Calculate start and end indices for current page
        const startIndex = (this.currentPage - 1) * this.sessionsPerPage;
        const endIndex = Math.min(startIndex + this.sessionsPerPage, this.totalSessions);
        const paginatedSessions = sessions.slice(startIndex, endIndex);

        const sessionsHtml = paginatedSessions.map(session => {
            const startTime = new Date(session.session_start).toLocaleString();
            const endTime = session.session_end ? new Date(session.session_end).toLocaleString() : 'Ongoing';
            const duration = session.session_end ?
                this.calculateDuration(session.session_start, session.session_end) :
                this.calculateDuration(session.session_start, new Date().toISOString());

            return `
                <div class="session-item ${session.isActive ? 'active' : ''}" 
                     data-session-id="${session.id}"
                     style="cursor: pointer; position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div onclick="app.loadSessionDetails('${session.id}')" style="flex: 1;">
                            <strong>@${session.streamer_username}</strong>
                            ${session.isActive ? '<span style="color: #00b894;">🟢 LIVE</span>' : '<span style="color: #e17055;">⚫ ENDED</span>'}
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="text-align: right; font-size: 0.9em; opacity: 0.8;">
                            <div>Duration: ${duration}</div>
                            <div>Events: ${session.total_events || 0}</div>
                        </div>
                            <div style="display: flex; flex-direction: column; gap: 5px;">
                                ${session.isActive ?
                    `<button onclick="app.endSession('${session.id}')" 
                                             style="background: #e74c3c; color: white; border: none; padding: 6px 12px; 
                                                    border-radius: 15px; cursor: pointer; font-size: 0.8em; 
                                                    transition: all 0.3s ease;" 
                                             onmouseover="this.style.background='#c0392b'" 
                                             onmouseout="this.style.background='#e74c3c'">
                                        🛑 End Session
                                     </button>` :
                    `<button onclick="app.viewSessionEvents('${session.id}')" 
                                             style="background: #3498db; color: white; border: none; padding: 6px 12px; 
                                                    border-radius: 15px; cursor: pointer; font-size: 0.8em;
                                                    transition: all 0.3s ease;" 
                                             onmouseover="this.style.background='#2980b9'" 
                                             onmouseout="this.style.background='#3498db'">
                                        📊 View Events
                                     </button>`
                }
                                <button onclick="app.useSessionForGaming('${session.id}', '${session.streamer_username}')" 
                                        style="background: #9b59b6; color: white; border: none; padding: 6px 12px; 
                                               border-radius: 15px; cursor: pointer; font-size: 0.8em;
                                               transition: all 0.3s ease;" 
                                        onmouseover="this.style.background='#8e44ad'" 
                                        onmouseout="this.style.background='#9b59b6'">
                                    🎮 Use for Gaming
                                </button>
                    </div>
                        </div>
                    </div>
                    <div style="margin-top: 8px; font-size: 0.9em; opacity: 0.8;" onclick="app.loadSessionDetails('${session.id}')">
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

        // Add pagination controls
        const paginationHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; 
                        margin-top: 20px; padding: 15px; border-top: 1px solid #ddd;">
                <div style="font-size: 0.9em; color: #666;">
                    Showing ${startIndex + 1}-${endIndex} of ${this.totalSessions} sessions
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <button onclick="app.previousPage()" 
                            ${this.currentPage === 1 ? 'disabled' : ''}
                            style="background: ${this.currentPage === 1 ? '#ccc' : '#3498db'}; 
                                   color: white; border: none; padding: 8px 15px; 
                                   border-radius: 20px; cursor: ${this.currentPage === 1 ? 'not-allowed' : 'pointer'};">
                        ← Previous
                    </button>
                    <span style="font-weight: bold; color: #333;">
                        Page ${this.currentPage} of ${totalPages}
                    </span>
                    <button onclick="app.nextPage()" 
                            ${this.currentPage === totalPages ? 'disabled' : ''}
                            style="background: ${this.currentPage === totalPages ? '#ccc' : '#3498db'}; 
                                   color: white; border: none; padding: 8px 15px; 
                                   border-radius: 20px; cursor: ${this.currentPage === totalPages ? 'not-allowed' : 'pointer'};">
                        Next →
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = sessionsHtml + paginationHtml;
    }

    // New interactive functions for session management
    async loadSessionDetails(sessionId) {
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${sessionId}`);
            const data = await response.json();

            if (data.session) {
                // Show detailed session info in a modal or alert
                const session = data.session;
                const details = `
📋 Session Details:
🆔 ID: ${session.id}
👤 Streamer: @${session.streamer_username}
📡 Room ID: ${session.room_id}
⏰ Started: ${new Date(session.session_start).toLocaleString()}
${session.session_end ? `⏹️ Ended: ${new Date(session.session_end).toLocaleString()}` : '🟢 Currently LIVE'}
📊 Total Events: ${session.total_events || 0}
💬 Messages: ${session.total_messages || 0}
🎁 Gifts: ${session.total_gifts || 0}
❤️ Likes: ${session.total_likes || 0}
👥 Members: ${session.total_members || 0}
📱 Social: ${session.total_social || 0}
                `;
                alert(details);
            }
        } catch (error) {
            console.error('Error loading session details:', error);
            this.showAlert('❌ Failed to load session details', 'error');
        }
    }

    async viewSessionEvents(sessionId) {
        // Redirect to data analytics page with this session
        window.open(`data.html?session=${sessionId}`, '_blank');
    }

    async useSessionForGaming(sessionId, username) {
        // Redirect to gaming page and auto-select this session
        const gamingUrl = `gaming.html?session=${sessionId}&username=${username}`;
        window.open(gamingUrl, '_blank');
    }

    // Pagination functions
    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadSessions(); // Reload sessions with new page
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.totalSessions / this.sessionsPerPage);
        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.loadSessions(); // Reload sessions with new page
        }
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
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if not already done
    if (!window.app) {
        window.app = new TikTokLiveApp();
    }
});

// Global functions for onclick handlers inside HTML templates
function createSession() {
    window.app?.createSession();
}

function endCurrentSession() {
    window.app?.endCurrentSession();
}

function loadSessions() {
    window.app?.loadSessions();
}

function exportData() {
    window.app?.exportData();
}

function showEvents(filter) {
    window.app?.showEvents(filter);
}

// Deprecated ngrok placeholders to prevent UI errors
function toggleNgrok() { }
function showManualNgrok() { }
function copyPublicUrl() { }
function openPublicUrl() { }

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.app?.stopEventStream();
});
