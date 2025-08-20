#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Database = require('./database');
const NgrokManager = require('./ngrok-manager');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('./dist/index');

const app = express();
const PORT = process.env.PORT || 3001;
const db = new Database();
const ngrokManager = new NgrokManager();

// Store active connections and sessions
const activeSessions = new Map();
const activeConnections = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // We'll create this for frontend files

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.size
    });
});

// Create new session and connect to TikTok Live
app.post('/api/sessions', async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        // Generate session ID
        const sessionId = uuidv4();
        
        console.log(`🚀 Creating session ${sessionId} for @${username}`);

        // Create TikTok connection
        const connection = new TikTokLiveConnection(username, {
            processInitialData: true,
            enableExtendedGiftInfo: true,
            fetchRoomInfoOnConnect: true
        });

        // Check if user is live first
        try {
            const isLive = await connection.fetchIsLive();
            if (!isLive) {
                return res.status(400).json({ 
                    error: `@${username} is not currently live`,
                    suggestion: 'Try with a different username or wait for them to go live'
                });
            }
        } catch (error) {
            return res.status(400).json({ 
                error: 'Failed to check live status',
                details: error.message
            });
        }

        // Session data
        const sessionData = {
            id: sessionId,
            username,
            connection,
            status: 'connecting',
            startTime: new Date(),
            events: [],
            stats: {
                totalEvents: 0,
                messages: 0,
                gifts: 0,
                likes: 0,
                members: 0,
                social: 0,
                emotes: 0,
                envelopes: 0,
                questions: 0,
                battles: 0,
                roomUpdates: 0,
                rankings: 0,
                polls: 0,
                shopping: 0,
                moderation: 0,
                captions: 0,
                goals: 0,
                banners: 0,
                links: 0,
                intros: 0,
                other: 0
            }
        };

        // Set up event handlers
        setupEventHandlers(connection, sessionId, sessionData);

        // Store session
        activeSessions.set(sessionId, sessionData);
        activeConnections.set(sessionId, connection);

        // Connect to TikTok Live
        try {
            const state = await connection.connect();
            
            // Update session status
            sessionData.status = 'connected';
            sessionData.roomId = state.roomId;
            sessionData.roomInfo = state.roomInfo;

            // Create session in database
            await db.createSession(sessionId, username, state.roomId, state.roomInfo);

            // Update streamer info
            if (state.roomInfo && state.roomInfo.owner) {
                await db.upsertStreamer(username, {
                    displayName: state.roomInfo.owner.display_id || username,
                    followerCount: state.roomInfo.owner.follow_count || 0,
                    bio: state.roomInfo.owner.bio_description || '',
                    profileImage: state.roomInfo.owner.avatar_large?.url_list?.[0] || ''
                });
            }

            console.log(`✅ Session ${sessionId} connected to room ${state.roomId}`);

            res.json({
                sessionId,
                status: 'connected',
                roomId: state.roomId,
                streamer: {
                    username,
                    displayName: state.roomInfo?.owner?.display_id || username,
                    followerCount: state.roomInfo?.owner?.follow_count || 0,
                    viewerCount: state.roomInfo?.user_count || 0
                },
                message: `Successfully connected to @${username}'s live stream`
            });

        } catch (error) {
            // Clean up on connection failure
            activeSessions.delete(sessionId);
            activeConnections.delete(sessionId);
            
            console.error(`❌ Failed to connect session ${sessionId}:`, error.message);
            
            res.status(500).json({
                error: 'Failed to connect to live stream',
                details: error.message
            });
        }

    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Get session info
app.get('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Check active session first
        const activeSession = activeSessions.get(sessionId);
        if (activeSession) {
            return res.json({
                ...activeSession,
                connection: undefined, // Don't serialize the connection object
                isActive: true
            });
        }

        // Check database for ended session
        const dbSession = await db.getSession(sessionId);
        if (dbSession) {
            return res.json({
                ...dbSession,
                isActive: false
            });
        }

        res.status(404).json({ error: 'Session not found' });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get session events
app.get('/api/sessions/:sessionId/events', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { type, limit = 100 } = req.query;
        
        // Check if session is active
        const activeSession = activeSessions.get(sessionId);
        if (activeSession) {
            let events = activeSession.events;
            
            // Filter by type if specified
            if (type) {
                events = events.filter(event => event.type === type);
            }
            
            // Limit results
            events = events.slice(-parseInt(limit));
            
            return res.json({
                sessionId,
                events: events.reverse(), // Most recent first
                stats: activeSession.stats,
                isActive: true
            });
        }

        // Get from database for ended sessions
        const events = await db.getSessionEvents(sessionId, type, parseInt(limit));
        const sessionStats = await db.getSessionStats(sessionId);
        
        res.json({
            sessionId,
            events,
            stats: sessionStats,
            isActive: false
        });
    } catch (error) {
        console.error('Error getting session events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// End session
app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = activeSessions.get(sessionId);
        const connection = activeConnections.get(sessionId);
        
        if (connection) {
            connection.disconnect();
            activeConnections.delete(sessionId);
        }
        
        if (session) {
            session.status = 'ended';
            session.endTime = new Date();
            activeSessions.delete(sessionId);
        }

        // Update database
        await db.endSession(sessionId);
        
        console.log(`🔚 Session ${sessionId} ended`);
        
        res.json({ 
            message: 'Session ended successfully',
            sessionId
        });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all sessions
app.get('/api/sessions', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        
        const dbSessions = await db.getAllSessions(parseInt(limit));
        
        // Add active session info
        const sessions = dbSessions.map(session => ({
            ...session,
            isActive: activeSessions.has(session.id)
        }));
        
        res.json({
            sessions,
            totalActive: activeSessions.size
        });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// WebSocket-like endpoint for real-time events (SSE)
app.get('/api/sessions/:sessionId/stream', (req, res) => {
    const { sessionId } = req.params;
    
    // Set up Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const session = activeSessions.get(sessionId);
    if (!session) {
        res.write(`data: ${JSON.stringify({ error: 'Session not found' })}\n\n`);
        res.end();
        return;
    }

    // Send initial session info
    res.write(`data: ${JSON.stringify({ 
        type: 'session_info', 
        session: {
            id: sessionId,
            username: session.username,
            status: session.status,
            stats: session.stats
        }
    })}\n\n`);

    // Set up interval to send events
    const interval = setInterval(() => {
        const currentSession = activeSessions.get(sessionId);
        if (!currentSession || currentSession.status === 'ended') {
            clearInterval(interval);
            res.end();
            return;
        }

        // Send recent events
        const recentEvents = currentSession.events.slice(-5);
        if (recentEvents.length > 0) {
            res.write(`data: ${JSON.stringify({ 
                type: 'events', 
                events: recentEvents,
                stats: currentSession.stats
            })}\n\n`);
        }
    }, 1000);

    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

// Event handler setup
function setupEventHandlers(connection, sessionId, sessionData) {
    // Connection events
    connection.on(ControlEvent.CONNECTED, async (state) => {
        console.log(`🔗 Session ${sessionId} connected to room ${state.roomId}`);
        sessionData.status = 'connected';
        sessionData.roomId = state.roomId;
        sessionData.roomInfo = state.roomInfo;
    });

    connection.on(ControlEvent.DISCONNECTED, async () => {
        console.log(`🔌 Session ${sessionId} disconnected`);
        sessionData.status = 'disconnected';
        await db.endSession(sessionId);
        activeSessions.delete(sessionId);
        activeConnections.delete(sessionId);
    });

    connection.on(ControlEvent.ERROR, async (err) => {
        console.error(`❌ Session ${sessionId} error:`, err.message);
        const errorEvent = {
            type: 'error',
            message: err.message,
            timestamp: new Date().toISOString()
        };
        sessionData.events.push(errorEvent);
        await db.addEvent(sessionId, 'error', errorEvent);
    });

    // Message events
    connection.on(WebcastEvent.CHAT, async (data) => {
        const event = {
            type: 'chat',
            userId: data.user.userId,
            username: data.user.uniqueId,
            message: data.comment,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.messages++;
        
        await db.addEvent(sessionId, 'chat', event);
        await db.updateSessionCounters(sessionId, 'chat');
    });

    connection.on(WebcastEvent.GIFT, async (data) => {
        const event = {
            type: 'gift',
            userId: data.user.userId,
            username: data.user.uniqueId,
            giftName: data.giftName,
            giftId: data.giftId,
            repeatCount: data.repeatCount,
            repeatEnd: data.repeatEnd,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.gifts++;
        
        await db.addEvent(sessionId, 'gift', event);
        await db.updateSessionCounters(sessionId, 'gift');
    });

    connection.on(WebcastEvent.MEMBER, async (data) => {
        const event = {
            type: 'member',
            userId: data.user.userId,
            username: data.user.uniqueId,
            action: 'joined',
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.members++;
        
        await db.addEvent(sessionId, 'member', event);
        await db.updateSessionCounters(sessionId, 'member');
    });

    connection.on(WebcastEvent.LIKE, async (data) => {
        const event = {
            type: 'like',
            userId: data.user.userId,
            username: data.user.uniqueId,
            likeCount: data.likeCount,
            totalLikeCount: data.totalLikeCount,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.likes++;
        
        await db.addEvent(sessionId, 'like', event);
        await db.updateSessionCounters(sessionId, 'like');
    });

    connection.on(WebcastEvent.FOLLOW, async (data) => {
        const event = {
            type: 'social',
            subtype: 'follow',
            userId: data.user.userId,
            username: data.user.uniqueId,
            action: 'followed',
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.social++;
        
        await db.addEvent(sessionId, 'social', event);
        await db.updateSessionCounters(sessionId, 'social');
    });

    connection.on(WebcastEvent.SHARE, async (data) => {
        const event = {
            type: 'social',
            subtype: 'share',
            userId: data.user.userId,
            username: data.user.uniqueId,
            action: 'shared',
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.social++;
        
        await db.addEvent(sessionId, 'social', event);
        await db.updateSessionCounters(sessionId, 'social');
    });

    connection.on(WebcastEvent.SUBSCRIBE, async (data) => {
        const event = {
            type: 'social',
            subtype: 'subscribe',
            userId: data.user.userId,
            username: data.user.uniqueId,
            action: 'subscribed',
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.social++;
        
        await db.addEvent(sessionId, 'social', event);
        await db.updateSessionCounters(sessionId, 'social');
    });

    // Additional Events - Rich Data Capture
    connection.on(WebcastEvent.EMOTE, async (data) => {
        const event = {
            type: 'emote',
            userId: data.user.userId,
            username: data.user.uniqueId,
            emoteId: data.emote?.id,
            emoteName: data.emote?.image?.url_list?.[0],
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.emotes++;
        
        await db.addEvent(sessionId, 'emote', event);
        await db.updateSessionCounters(sessionId, 'emote');
    });

    connection.on(WebcastEvent.ENVELOPE, async (data) => {
        const event = {
            type: 'envelope',
            userId: data.user?.userId,
            username: data.user?.uniqueId,
            envelopeInfo: data.envelopeInfo,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.envelopes++;
        
        await db.addEvent(sessionId, 'envelope', event);
        await db.updateSessionCounters(sessionId, 'envelope');
    });

    connection.on(WebcastEvent.QUESTION_NEW, async (data) => {
        const event = {
            type: 'question',
            userId: data.user?.userId,
            username: data.user?.uniqueId,
            questionText: data.questionText,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'question', event);
        await db.updateSessionCounters(sessionId, 'question');
    });

    connection.on(WebcastEvent.LINK_MIC_BATTLE, async (data) => {
        const event = {
            type: 'battle',
            subtype: 'mic_battle',
            battleUsers: data.battleUsers?.map(user => ({
                userId: user.userId,
                username: user.uniqueId,
                displayName: user.displayId
            })),
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'battle', event);
        await db.updateSessionCounters(sessionId, 'battle');
    });

    connection.on(WebcastEvent.LINK_MIC_ARMIES, async (data) => {
        const event = {
            type: 'battle',
            subtype: 'mic_armies',
            battleInfo: data.battleInfo,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'battle', event);
        await db.updateSessionCounters(sessionId, 'battle');
    });

    connection.on(WebcastEvent.LIVE_INTRO, async (data) => {
        const event = {
            type: 'intro',
            introMessage: data.intro,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'intro', event);
        await db.updateSessionCounters(sessionId, 'intro');
    });

    connection.on(WebcastEvent.ROOM_USER, async (data) => {
        const event = {
            type: 'room_update',
            viewerCount: data.viewerCount,
            totalUserCount: data.totalUser,
            topViewers: data.topViewers?.slice(0, 10).map(user => ({
                userId: user.userId,
                username: user.uniqueId,
                coinCount: user.coinCount
            })),
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'room_update', event);
        await db.updateSessionCounters(sessionId, 'room_update');
    });

    // Advanced Events (2.0.4+)
    connection.on(WebcastEvent.GOAL_UPDATE, async (data) => {
        const event = {
            type: 'goal',
            goalUpdate: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'goal', event);
        await db.updateSessionCounters(sessionId, 'goal');
    });

    connection.on(WebcastEvent.RANK_UPDATE, async (data) => {
        const event = {
            type: 'ranking',
            subtype: 'rank_update',
            rankInfo: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'ranking', event);
        await db.updateSessionCounters(sessionId, 'ranking');
    });

    connection.on(WebcastEvent.HOURLY_RANK, async (data) => {
        const event = {
            type: 'ranking',
            subtype: 'hourly_rank',
            rankInfo: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'ranking', event);
        await db.updateSessionCounters(sessionId, 'ranking');
    });

    connection.on(WebcastEvent.POLL_MESSAGE, async (data) => {
        const event = {
            type: 'poll',
            pollData: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'poll', event);
        await db.updateSessionCounters(sessionId, 'poll');
    });

    connection.on(WebcastEvent.OEC_LIVE_SHOPPING, async (data) => {
        const event = {
            type: 'shopping',
            shoppingData: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'shopping', event);
        await db.updateSessionCounters(sessionId, 'shopping');
    });

    connection.on(WebcastEvent.IN_ROOM_BANNER, async (data) => {
        const event = {
            type: 'banner',
            bannerData: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'banner', event);
        await db.updateSessionCounters(sessionId, 'banner');
    });

    connection.on(WebcastEvent.IM_DELETE, async (data) => {
        const event = {
            type: 'moderation',
            subtype: 'message_deleted',
            deleteInfo: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'moderation', event);
        await db.updateSessionCounters(sessionId, 'moderation');
    });

    connection.on(WebcastEvent.ROOM_PIN, async (data) => {
        const event = {
            type: 'moderation',
            subtype: 'message_pinned',
            pinInfo: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'moderation', event);
        await db.updateSessionCounters(sessionId, 'moderation');
    });

    connection.on(WebcastEvent.CAPTION_MESSAGE, async (data) => {
        const event = {
            type: 'caption',
            captionText: data.caption || data.text,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'caption', event);
        await db.updateSessionCounters(sessionId, 'caption');
    });

    connection.on(WebcastEvent.LINK_MESSAGE, async (data) => {
        const event = {
            type: 'link',
            linkData: data,
            timestamp: new Date().toISOString(),
            raw: data
        };
        
        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        
        await db.addEvent(sessionId, 'link', event);
        await db.updateSessionCounters(sessionId, 'link');
    });

    // Catch-all for any other events
    connection.on('*', async (eventName, data) => {
        if (!['connected', 'disconnected', 'error', 'rawData', 'decodedData', 'websocketConnected'].includes(eventName)) {
            const event = {
                type: 'other',
                subtype: eventName,
                eventData: data,
                timestamp: new Date().toISOString(),
                raw: data
            };
            
            sessionData.events.push(event);
            sessionData.stats.totalEvents++;
            
            await db.addEvent(sessionId, 'other', event);
            await db.updateSessionCounters(sessionId, 'other');
            
            console.log(`🔔 Captured unknown event: ${eventName}`);
        }
    });
}

// ===== NGROK & EXTERNAL API ENDPOINTS =====

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.size,
        ngrok: ngrokManager.getStatus()
    });
});

// Start ngrok tunnel
app.post('/api/ngrok/start', async (req, res) => {
    try {
        const { port = PORT } = req.body;
        const result = await ngrokManager.startTunnel(port);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop ngrok tunnel
app.post('/api/ngrok/stop', async (req, res) => {
    try {
        const result = await ngrokManager.stopTunnel();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get ngrok status
app.get('/api/ngrok/status', (req, res) => {
    res.json(ngrokManager.getStatus());
});

// Add webhook
app.post('/api/webhooks', (req, res) => {
    try {
        const { id, url, events = ['all'], headers = {} } = req.body;
        
        if (!id || !url) {
            return res.status(400).json({ 
                success: false, 
                error: 'ID and URL are required' 
            });
        }
        
        const result = ngrokManager.addWebhook(id, url, events, headers);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove webhook
app.delete('/api/webhooks/:id', (req, res) => {
    try {
        const { id } = req.params;
        const result = ngrokManager.removeWebhook(id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all webhooks
app.get('/api/webhooks', (req, res) => {
    const status = ngrokManager.getStatus();
    res.json({ webhooks: status.webhooks });
});

// Send session data to external API
app.post('/api/export/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { externalApiUrl, apiKey, format = 'json' } = req.body;
        
        if (!externalApiUrl) {
            return res.status(400).json({ 
                success: false, 
                error: 'External API URL is required' 
            });
        }
        
        // Get session data
        const sessionData = await db.getSessionById(id);
        if (!sessionData) {
            return res.status(404).json({ 
                success: false, 
                error: 'Session not found' 
            });
        }
        
        // Send to external API
        const result = await ngrokManager.sendSessionData(sessionData, externalApiUrl, apiKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export session data in various formats (with default format)
app.get('/api/export/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const format = 'json';
        
        // Get session data
        const sessionData = await db.getSessionById(id);
        if (!sessionData) {
            return res.status(404).json({ 
                success: false, 
                error: 'Session not found' 
            });
        }
        
        // Get session events
        const events = await db.getSessionEvents(id);
        sessionData.events = events;
        
        const exportedData = ngrokManager.exportSessionData(sessionData, format);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="session-${id}.${format}"`);
        res.send(exportedData);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export session data in various formats (with specified format)
app.get('/api/export/session/:id/:format', async (req, res) => {
    try {
        const { id, format } = req.params;
        
        // Get session data
        const sessionData = await db.getSessionById(id);
        if (!sessionData) {
            return res.status(404).json({ 
                success: false, 
                error: 'Session not found' 
            });
        }
        
        // Get session events
        const events = await db.getSessionEvents(id);
        sessionData.events = events;
        
        const exportedData = ngrokManager.exportSessionData(sessionData, format);
        
        // Set appropriate content type
        const contentTypes = {
            'json': 'application/json',
            'csv': 'text/csv',
            'summary': 'application/json'
        };
        
        res.setHeader('Content-Type', contentTypes[format] || 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="session-${id}.${format}"`);
        res.send(exportedData);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Real-time webhook test
app.post('/api/test-webhook', async (req, res) => {
    try {
        const { webhookId, testData = { message: 'Test webhook from TikTok Live Connector' } } = req.body;
        
        if (webhookId) {
            // Test specific webhook
            const results = await ngrokManager.sendToWebhooks('test', testData);
            const result = results.find(r => r.id === webhookId);
            res.json(result || { success: false, error: 'Webhook not found' });
        } else {
            // Test all webhooks
            const results = await ngrokManager.sendToWebhooks('test', testData);
            res.json({ results });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API documentation endpoint
app.get('/api-docs', (req, res) => {
    const ngrokStatus = ngrokManager.getStatus();
    const baseUrl = ngrokStatus.isConnected ? ngrokStatus.url : `http://localhost:${PORT}`;
    
    res.json({
        title: 'TikTok Live Connector API',
        version: '1.0.0',
        baseUrl,
        ngrok: ngrokStatus,
        endpoints: {
            sessions: {
                'GET /api/sessions': 'List all sessions',
                'POST /api/sessions': 'Create new session',
                'GET /api/sessions/:id': 'Get session info',
                'GET /api/sessions/:id/events': 'Get session events (SSE)',
                'DELETE /api/sessions/:id': 'End session'
            },
            ngrok: {
                'POST /api/ngrok/start': 'Start ngrok tunnel',
                'POST /api/ngrok/stop': 'Stop ngrok tunnel',
                'GET /api/ngrok/status': 'Get ngrok status'
            },
            webhooks: {
                'POST /api/webhooks': 'Add webhook',
                'GET /api/webhooks': 'List webhooks',
                'DELETE /api/webhooks/:id': 'Remove webhook',
                'POST /api/test-webhook': 'Test webhooks'
            },
            export: {
                'GET /api/export/session/:id/:format': 'Export session data',
                'POST /api/export/session/:id': 'Send session to external API'
            },
            misc: {
                'GET /api/health': 'Health check',
                'GET /api-docs': 'API documentation'
            }
        }
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down backend server...');
    
    // Stop ngrok tunnel
    if (ngrokManager.getStatus().isConnected) {
        console.log('🔌 Stopping ngrok tunnel...');
        await ngrokManager.stopTunnel();
    }
    
    // End all active sessions
    for (const [sessionId, connection] of activeConnections) {
        try {
            connection.disconnect();
            await db.endSession(sessionId);
        } catch (error) {
            console.error(`Error ending session ${sessionId}:`, error);
        }
    }
    
    // Close database
    db.close();
    
    console.log('✅ Backend server closed');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down backend server...');
    
    // Stop ngrok tunnel
    if (ngrokManager.getStatus().isConnected) {
        console.log('🔌 Stopping ngrok tunnel...');
        await ngrokManager.stopTunnel();
    }
    
    // End all active sessions
    for (const [sessionId, connection] of activeConnections) {
        try {
            connection.disconnect();
            await db.endSession(sessionId);
        } catch (error) {
            console.error(`Error ending session ${sessionId}:`, error);
        }
    }
    
    // Close database
    db.close();
    
    console.log('✅ Backend server closed');
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TikTok Live Connector Backend Server is running!`);
    console.log(`📍 API Server: http://localhost:${PORT}`);
    console.log(`📊 Database: SQLite (tiktok_sessions.db)`);
    console.log(`🔗 API Endpoints:`);
    console.log(`   POST /api/sessions - Create new session`);
    console.log(`   GET  /api/sessions - List all sessions`);
    console.log(`   GET  /api/sessions/:id - Get session info`);
    console.log(`   GET  /api/sessions/:id/events - Get session events`);
    console.log(`   DELETE /api/sessions/:id - End session`);
    console.log(`🛑 Press Ctrl+C to stop the server`);
});
