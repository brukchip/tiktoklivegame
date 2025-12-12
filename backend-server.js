#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Database = require('./database');
const NgrokManager = require('./ngrok-manager');
const GamingSystem = require('./gaming-system');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('./dist/index');

const app = express();
const PORT = process.env.PORT || 3001;
const db = new Database();
const ngrokManager = new NgrokManager();
const gamingSystem = new GamingSystem(db);

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

        // Default connection options (Mimicking a real browser)
        const BaseConnectionOptions = {
            processInitialData: true,
            enableExtendedGiftInfo: true,
            fetchRoomInfoOnConnect: true,
            requestOptions: {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.tiktok.com/",
                }
            }
        };

        // Add optional overrides (Proxy/Session) if they exist, but don't require them
        if (process.env.TIKTOK_SESSION_ID) BaseConnectionOptions.sessionId = process.env.TIKTOK_SESSION_ID;
        if (process.env.PROXY_URL) BaseConnectionOptions.requestOptions.proxy = process.env.PROXY_URL;

        // Session data placeholders
        const sessionData = {
            id: sessionId,
            username,
            connection: null, // Will set later
            status: 'connecting',
            startTime: new Date(),
            events: [],
            stats: { totalEvents: 0, messages: 0, gifts: 0, likes: 0, members: 0, social: 0, emotes: 0, envelopes: 0, questions: 0, battles: 0, roomUpdates: 0, rankings: 0, polls: 0, shopping: 0, moderation: 0, captions: 0, goals: 0, banners: 0, links: 0, intros: 0, other: 0 }
        };

        // Store session early so we can track it
        activeSessions.set(sessionId, sessionData);

        // --- RETRY CONNECT LOGIC ---
        const connectWithRetry = async (attempt = 1) => {
            try {
                let options = { ...BaseConnectionOptions };

                // On retry, try "Light Mode" (less suspicious)
                if (attempt > 1) {
                    console.log(`⚠️ Retry ${attempt}: Switching to Light Mode (Minimal Data)`);
                    options.processInitialData = false;
                    options.fetchRoomInfoOnConnect = false;
                    options.enableExtendedGiftInfo = false;
                }

                console.log(`🚀 Connecting to @${username} (Attempt ${attempt})...`);
                const connection = new TikTokLiveConnection(username, options);

                // Bind events so they start capturing immediately
                setupEventHandlers(connection, sessionId, sessionData);

                // Update session reference
                activeConnections.set(sessionId, connection);
                sessionData.connection = connection;

                const state = await connection.connect();
                return { connection, state };

            } catch (err) {
                if (attempt < 3) { // Try up to 3 times
                    console.log(`❌ Attempt ${attempt} failed: ${err.message}. Retrying...`);
                    await new Promise(r => setTimeout(r, 2000)); // Wait 2s
                    return connectWithRetry(attempt + 1);
                }
                throw err;
            }
        };

        try {
            // Check Live Status (Optional - if it fails, we just try to connect anyway)
            try {
                const checkConn = new TikTokLiveConnection(username, BaseConnectionOptions);
                const isLive = await checkConn.fetchIsLive();
                if (!isLive) console.log(`⚠️ API says @${username} is offline, but trying connection anyway...`);
            } catch (e) { /* Ignore check errors */ }

            // Perform Connection
            const { state } = await connectWithRetry();

            // Update session status
            sessionData.status = 'connected';
            sessionData.roomId = state.roomId;
            sessionData.roomInfo = state.roomInfo || { owner: { display_id: username } };

            // Create session in database
            await db.createSession(sessionId, username, state.roomId, sessionData.roomInfo);

            // Update streamer info
            if (sessionData.roomInfo && sessionData.roomInfo.owner) {
                await db.upsertStreamer(username, {
                    displayName: sessionData.roomInfo.owner.display_id || username,
                    followerCount: sessionData.roomInfo.owner.follow_count || 0,
                    bio: sessionData.roomInfo.owner.bio_description || '',
                    profileImage: sessionData.roomInfo.owner.avatar_large?.url_list?.[0] || ''
                });
            }

            console.log(`✅ Session ${sessionId} connected to room ${state.roomId}`);

            res.json({
                sessionId,
                status: 'connected',
                roomId: state.roomId,
                streamer: {
                    username,
                    displayName: sessionData.roomInfo?.owner?.display_id || username,
                    followerCount: sessionData.roomInfo?.owner?.follow_count || 0,
                    viewerCount: sessionData.roomInfo?.user_count || 0
                },
                message: `Successfully connected to @${username}'s live stream`
            });


        } catch (error) {
            // Clean up on connection failure
            activeSessions.delete(sessionId);
            activeConnections.delete(sessionId);

            console.error(`❌ Failed to connect session ${sessionId}:`, error.message);

            // Provide helpful error messages based on error type
            let userFriendlyError = 'Failed to connect to live stream';
            let suggestion = 'Please try again in a few moments';

            if (error.message.includes('not found') || error.message.includes('404')) {
                userFriendlyError = `@${username} not found or not currently live`;
                suggestion = 'Check the username spelling or wait for them to go live';
            } else if (error.message.includes('rate limit') || error.message.includes('429')) {
                userFriendlyError = 'Too many requests - rate limited';
                suggestion = 'Please wait a few minutes before trying again';
            } else if (error.message.includes('timeout')) {
                userFriendlyError = 'Connection timeout';
                suggestion = 'Check your internet connection and try again';
            } else if (error.message.includes('captcha') || error.message.includes('blocked')) {
                userFriendlyError = 'Connection blocked by TikTok (Captcha/IP)';
                suggestion = 'Server IP is likely blocked. Try using a Proxy or Session ID.';
            } else {
                // Include the actual error message for generic failures
                userFriendlyError = `Failed to connect: ${error.message}`;
            }

            res.status(500).json({
                error: userFriendlyError,
                suggestion: suggestion,
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
            success: true,
            message: 'Session ended successfully',
            sessionId
        });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
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
        // Don't auto-end sessions on disconnect - only update status
        // Sessions should only be ended manually via the API
        // await db.endSession(sessionId);  // Commented out to prevent auto-ending
        // activeSessions.delete(sessionId);  // Keep session data for potential reconnection
        activeConnections.delete(sessionId); // Only remove the connection
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

            // Enhanced user profile data with corrected profile picture extraction
            userProfile: {
                nickname: data.user.nickname,
                bio: data.user.bioDescription,
                // Fix: TikTok stores profile pictures in .url array, not .url_list
                profilePicture: data.user.profilePicture?.url?.[0] || data.user.profilePicture?.url_list?.[0],
                profilePictureMedium: data.user.profilePictureMedium?.url?.[0] || data.user.profilePictureMedium?.url_list?.[0],
                profilePictureLarge: data.user.profilePictureLarge?.url?.[0] || data.user.profilePictureLarge?.url_list?.[0],
                verified: data.user.verified,
                followerCount: data.user.followInfo?.followerCount,
                followingCount: data.user.followInfo?.followingCount,
                payGrade: data.user.payGrade?.name,
                payLevel: data.user.payGrade?.level,
                fanTicketCount: data.user.fanTicketCount,
                badges: data.user.badges?.map(badge => ({
                    type: badge.badgeDisplayType,
                    text: badge.text?.defaultPattern,
                    image: badge.image?.image?.url_list?.[0]
                })),
                border: data.user.border?.image?.url_list?.[0]
            },

            raw: data
        };

        sessionData.events.push(event);
        sessionData.stats.totalEvents++;
        sessionData.stats.messages++;

        await db.addEvent(sessionId, 'chat', event);
        await db.updateSessionCounters(sessionId, 'chat');

        // ===== GAMING SYSTEM INTEGRATION =====
        // Check if this chat message should be processed by gaming system
        const username = data.user.uniqueId;
        const message = data.comment;

        // Lucky Wheel - check for configured keyword messages with profile picture capture
        if (gamingSystem.addLuckyWheelEntry(sessionId, username, message, event.userProfile)) {
            const activeGame = gamingSystem.getActiveGame(sessionId);
            const keyword = activeGame && activeGame.type === 'luckywheel' ? activeGame.keyword : 'GAME';
            console.log(`🎰 Gaming: ${username} entered Lucky Wheel with message: "${message}" (keyword: ${keyword})`);

            // Enhanced debugging for profile pictures
            if (event.userProfile) {
                console.log(`🖼️ Profile data for ${username}:`);
                console.log(`   profilePicture: ${event.userProfile.profilePicture || 'null'}`);
                console.log(`   profilePictureMedium: ${event.userProfile.profilePictureMedium || 'null'}`);
                console.log(`   profilePictureLarge: ${event.userProfile.profilePictureLarge || 'null'}`);
                console.log(`   raw data keys:`, Object.keys(data.user));
            }
        }

        // Poll - check for voting keywords
        if (gamingSystem.addPollVote(sessionId, username, message)) {
            console.log(`🗳️ Gaming: ${username} voted in poll with message: "${message}"`);
        }

        // Race - add participant movement
        if (gamingSystem.addRaceParticipant(sessionId, username, message)) {
            console.log(`🏁 Gaming: ${username} moved in race with message: "${message}"`);
        }
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

            // Enhanced user profile data
            userProfile: {
                nickname: data.user.nickname,
                profilePicture: data.user.profilePicture?.url?.[0] || data.user.profilePicture?.url_list?.[0],
                verified: data.user.verified,
                followerCount: data.user.followInfo?.followerCount,
                payGrade: data.user.payGrade?.name,
                payLevel: data.user.payGrade?.level,
                fanTicketCount: data.user.fanTicketCount
            },

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
            userId: data.user?.userId || 'unknown',
            username: data.user?.uniqueId || 'unknown',
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

            // Enhanced user profile data
            userProfile: {
                nickname: data.user.nickname,
                profilePicture: data.user.profilePicture?.url?.[0] || data.user.profilePicture?.url_list?.[0],
                verified: data.user.verified,
                followerCount: data.user.followInfo?.followerCount,
                payGrade: data.user.payGrade?.name
            },

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

            // Enhanced user profile data
            userProfile: {
                nickname: data.user.nickname,
                profilePicture: data.user.profilePicture?.url?.[0] || data.user.profilePicture?.url_list?.[0],
                verified: data.user.verified,
                followerCount: data.user.followInfo?.followerCount,
                payGrade: data.user.payGrade?.name
            },

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

// ===== USER PROFILE API ENDPOINTS =====

// 2. Get Session Participants
app.get('/api/sessions/:sessionId/participants', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 50 } = req.query;

        console.log('👥 Fetching participants for session:', sessionId);

        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Collect unique participants from events
        const participantsMap = new Map();

        session.events.forEach(event => {
            if (event.userId && event.username) {
                const participant = {
                    userId: event.userId,
                    username: event.username,
                    firstSeen: participantsMap.has(event.userId) ?
                        participantsMap.get(event.userId).firstSeen : event.timestamp,
                    lastSeen: event.timestamp,
                    eventCount: (participantsMap.get(event.userId)?.eventCount || 0) + 1,
                    eventTypes: new Set(participantsMap.get(event.userId)?.eventTypes || [])
                };

                participant.eventTypes.add(event.type);

                // Add profile data if available in raw event
                if (event.raw?.user) {
                    const user = event.raw.user;
                    participant.profile = {
                        nickname: user.nickname,
                        profilePicture: user.profilePicture?.url_list?.[0],
                        verified: user.verified,
                        followerCount: user.followInfo?.followerCount,
                        payGrade: user.payGrade?.name
                    };
                }

                participantsMap.set(event.userId, {
                    ...participant,
                    eventTypes: Array.from(participant.eventTypes)
                });
            }
        });

        // Convert to array and sort by event count
        const participants = Array.from(participantsMap.values())
            .sort((a, b) => b.eventCount - a.eventCount)
            .slice(0, parseInt(limit));

        res.json({
            success: true,
            sessionId,
            participants,
            totalUniqueParticipants: participantsMap.size,
            isActive: session.status === 'connected'
        });

    } catch (error) {
        console.error('Error fetching session participants:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// 3. Get User Activity in Session
app.get('/api/sessions/:sessionId/users/:userId/activity', async (req, res) => {
    try {
        const { sessionId, userId } = req.params;
        const { limit = 100 } = req.query;

        console.log('📊 Fetching user activity for:', userId, 'in session:', sessionId);

        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Filter events for this specific user
        const userEvents = session.events
            .filter(event => event.userId === userId)
            .slice(-parseInt(limit))
            .reverse(); // Most recent first

        if (userEvents.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No activity found for this user in this session'
            });
        }

        // Generate activity statistics
        const activityStats = {
            totalEvents: userEvents.length,
            eventTypes: {},
            firstActivity: userEvents[userEvents.length - 1].timestamp,
            lastActivity: userEvents[0].timestamp
        };

        userEvents.forEach(event => {
            activityStats.eventTypes[event.type] =
                (activityStats.eventTypes[event.type] || 0) + 1;
        });

        // Get user profile from most recent event
        let userProfile = null;
        const latestEventWithProfile = userEvents.find(event => event.raw?.user);
        if (latestEventWithProfile?.raw?.user) {
            const user = latestEventWithProfile.raw.user;
            userProfile = {
                nickname: user.nickname,
                profilePicture: user.profilePicture?.url_list?.[0],
                verified: user.verified,
                followerCount: user.followInfo?.followerCount,
                payGrade: user.payGrade?.name
            };
        }

        res.json({
            success: true,
            sessionId,
            userId,
            username: userEvents[0].username,
            profile: userProfile,
            activity: userEvents,
            stats: activityStats
        });

    } catch (error) {
        console.error('Error fetching user activity:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// 4. Batch User Profiles
app.post('/api/users/profiles/batch', async (req, res) => {
    try {
        const { userIds } = req.body;

        if (!userIds || !Array.isArray(userIds)) {
            return res.status(400).json({
                success: false,
                error: 'userIds array is required'
            });
        }

        console.log('👥 Fetching batch profiles for:', userIds.length, 'users');

        const profiles = {};
        const notFound = [];

        // Search through all active sessions for user data
        for (const userId of userIds) {
            let found = false;

            for (const [sessionId, session] of activeSessions) {
                const userEvents = session.events.filter(event => event.userId === userId);

                if (userEvents.length > 0) {
                    const latestEvent = userEvents[userEvents.length - 1];

                    if (latestEvent.raw?.user) {
                        const user = latestEvent.raw.user;
                        profiles[userId] = {
                            userId: user.userId,
                            username: user.uniqueId,
                            nickname: user.nickname,
                            profilePicture: user.profilePicture?.url_list?.[0],
                            verified: user.verified,
                            followerCount: user.followInfo?.followerCount,
                            payGrade: user.payGrade?.name,
                            lastSeen: latestEvent.timestamp,
                            sessionId: sessionId
                        };
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                notFound.push(userId);
            }
        }

        res.json({
            success: true,
            profiles,
            notFound,
            found: Object.keys(profiles).length,
            requested: userIds.length
        });

    } catch (error) {
        console.error('Error fetching batch profiles:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ===== UNIFIED USER PROFILE API =====

// Get User Profile Picture (unified endpoint)
app.get('/api/users/:userId/profile', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log('🖼️ Fetching profile for user:', userId);

        // Method 1: Check active TikTok sessions for this user
        for (const [sessionId, session] of activeSessions) {
            if (session.streamerUsername === userId || session.streamerUsername === `@${userId}`) {
                if (session.roomInfo?.owner) {
                    const owner = session.roomInfo.owner;
                    const profilePic = owner.avatarLarger || owner.avatarMedium || owner.avatarThumb;

                    if (profilePic) {
                        console.log('✅ Found profile in active session:', profilePic);
                        return res.json({
                            success: true,
                            profilePicture: profilePic,
                            source: 'active_session',
                            username: owner.displayName || owner.uniqueId
                        });
                    }
                }
            }
        }

        // Method 1.5: Check database for any session with this streamer
        try {
            const sessions = await db.getAllSessions();
            for (const session of sessions) {
                if (session.streamer_username === userId || session.streamer_username === `@${userId}`) {
                    // Try to get streamer data from database
                    const streamerData = await db.getStreamer(userId);
                    if (streamerData && streamerData.profileImage) {
                        console.log('✅ Found profile in database session:', streamerData.profileImage);
                        return res.json({
                            success: true,
                            profilePicture: streamerData.profileImage,
                            source: 'database_session',
                            username: streamerData.displayName || userId
                        });
                    }
                }
            }
        } catch (error) {
            console.log('⚠️ Database session lookup failed:', error.message);
        }

        // Method 2: Check database for stored profile
        try {
            const streamerData = await db.getStreamer(userId);
            if (streamerData && streamerData.profileImage) {
                console.log('✅ Found profile in database:', streamerData.profileImage);
                return res.json({
                    success: true,
                    profilePicture: streamerData.profileImage,
                    source: 'database',
                    username: streamerData.displayName || userId
                });
            }
        } catch (error) {
            console.log('⚠️ Database lookup failed:', error.message);
        }

        // Method 3: Try direct TikTok API
        try {
            const tempConnection = new TikTokLiveConnection(userId);
            const roomInfo = await tempConnection.getRoomInfo();

            if (roomInfo?.owner) {
                const profilePic = roomInfo.owner.avatarLarger ||
                    roomInfo.owner.avatarMedium ||
                    roomInfo.owner.avatarThumb;

                if (profilePic) {
                    console.log('✅ Found profile via TikTok API:', profilePic);
                    return res.json({
                        success: true,
                        profilePicture: profilePic,
                        source: 'tiktok_api',
                        username: roomInfo.owner.displayName || roomInfo.owner.uniqueId
                    });
                }
            }
        } catch (error) {
            console.log('❌ TikTok API failed:', error.message);
        }

        // No profile found
        console.log('⚠️ No profile picture found for:', userId);
        res.json({
            success: false,
            error: 'Profile picture not found'
        });

    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ===== TIKTOK PROFILE PICTURE API =====

// Legacy endpoint (keep for compatibility)
app.get('/api/tiktok/profile/:username', async (req, res) => {
    try {
        const { username } = req.params;
        console.log('🖼️ Fetching TikTok profile picture for:', username);

        // Try to get profile picture from active sessions first
        for (const [sessionId, session] of activeSessions) {
            const sessionUsername = session.streamerUsername?.replace('@', '');
            const requestUsername = username.replace('@', '');

            if (sessionUsername === requestUsername) {
                console.log('📡 Found matching session for username:', username);

                // Check if we have room info with profile data
                if (session.roomInfo?.owner) {
                    const owner = session.roomInfo.owner;
                    const profilePic = owner.avatarLarger || owner.avatarMedium || owner.avatarThumb;

                    if (profilePic) {
                        console.log('✅ Found profile picture in session data:', profilePic);
                        return res.json({
                            success: true,
                            profilePicture: profilePic,
                            source: 'session_data',
                            username: owner.displayName || owner.uniqueId
                        });
                    }
                }

                // Also check if we stored profile info in session
                if (session.profilePicture) {
                    console.log('✅ Found cached profile picture');
                    return res.json({
                        success: true,
                        profilePicture: session.profilePicture,
                        source: 'cached'
                    });
                }
            }
        }

        // If not found in active sessions, try to make a direct TikTok request
        try {
            const tempConnection = new TikTokLiveConnection(username);

            // Get room info without connecting
            const roomInfo = await tempConnection.getRoomInfo();
            if (roomInfo?.owner) {
                const profilePic = roomInfo.owner.avatarLarger ||
                    roomInfo.owner.avatarMedium ||
                    roomInfo.owner.avatarThumb;

                if (profilePic) {
                    console.log('✅ Found profile picture via direct TikTok API');
                    return res.json({
                        success: true,
                        profilePicture: profilePic,
                        source: 'tiktok_api'
                    });
                }
            }
        } catch (error) {
            console.log('❌ Direct TikTok API failed:', error.message);
        }

        // No profile picture found
        console.log('⚠️ No profile picture found for:', username);
        res.json({
            success: false,
            error: 'Profile picture not found'
        });

    } catch (error) {
        console.error('Error fetching TikTok profile:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ===== DEBUG ENDPOINTS =====

// Debug endpoint to inspect actual TikTok event data
app.get('/api/debug/session/:sessionId/events/raw', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 10 } = req.query;

        const session = activeSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Get recent chat events with full raw data
        const chatEvents = session.events
            .filter(event => event.type === 'chat')
            .slice(-parseInt(limit))
            .map(event => ({
                username: event.username,
                message: event.message,
                timestamp: event.timestamp,
                userProfile: event.userProfile,
                rawUserKeys: Object.keys(event.raw?.user || {}),
                rawUser: event.raw?.user ? {
                    userId: event.raw.user.userId,
                    uniqueId: event.raw.user.uniqueId,
                    nickname: event.raw.user.nickname,
                    profilePicture: event.raw.user.profilePicture,
                    profilePictureMedium: event.raw.user.profilePictureMedium,
                    profilePictureLarge: event.raw.user.profilePictureLarge,
                    avatarThumb: event.raw.user.avatarThumb,
                    verified: event.raw.user.verified
                } : null
            }));

        res.json({
            success: true,
            sessionId,
            totalChatEvents: session.events.filter(e => e.type === 'chat').length,
            recentEvents: chatEvents,
            sessionRoomInfo: session.roomInfo ? {
                owner: session.roomInfo.owner ? {
                    displayName: session.roomInfo.owner.displayName,
                    uniqueId: session.roomInfo.owner.uniqueId,
                    avatarLarger: session.roomInfo.owner.avatarLarger,
                    avatarMedium: session.roomInfo.owner.avatarMedium,
                    avatarThumb: session.roomInfo.owner.avatarThumb
                } : null
            } : null
        });

    } catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Debug endpoint for profile picture testing
app.post('/api/debug/profile-test', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        console.log(`🔍 Testing profile sources for: ${username}`);
        const results = {};

        // Test 1: Check active sessions
        for (const [sessionId, session] of activeSessions) {
            const chatEvents = session.events.filter(event =>
                event.type === 'chat' && event.username === username
            );

            if (chatEvents.length > 0) {
                const latestEvent = chatEvents[chatEvents.length - 1];
                results.activeSession = {
                    found: true,
                    sessionId,
                    userProfile: latestEvent.userProfile,
                    eventCount: chatEvents.length
                };
                break;
            }
        }

        // Test 2: Direct TikTok API
        try {
            const tempConnection = new TikTokLiveConnection(username);
            const roomInfo = await tempConnection.getRoomInfo();

            results.directAPI = {
                found: !!roomInfo?.owner,
                owner: roomInfo?.owner ? {
                    displayName: roomInfo.owner.displayName,
                    uniqueId: roomInfo.owner.uniqueId,
                    avatarLarger: roomInfo.owner.avatarLarger,
                    avatarMedium: roomInfo.owner.avatarMedium,
                    avatarThumb: roomInfo.owner.avatarThumb
                } : null
            };
        } catch (error) {
            results.directAPI = {
                found: false,
                error: error.message
            };
        }

        // Test 3: Database lookup
        try {
            const streamerData = await db.getStreamer(username);
            results.database = {
                found: !!streamerData,
                data: streamerData
            };
        } catch (error) {
            results.database = {
                found: false,
                error: error.message
            };
        }

        res.json({
            success: true,
            username,
            results
        });

    } catch (error) {
        console.error('Error in profile test:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== GAMING SYSTEM API ENDPOINTS =====

// Start Lucky Wheel Game
app.post('/api/gaming/luckywheel/start', async (req, res) => {
    try {
        const { sessionId, duration = 10000 } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        if (!activeSessions.has(sessionId)) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const gameData = gamingSystem.startLuckyWheel(sessionId, duration);

        const keyword = gameData.keyword || 'GAME';
        res.json({
            success: true,
            game: gameData,
            message: `Lucky Wheel started! Players can type "${keyword}" to enter for ${duration / 1000} seconds.`
        });

    } catch (error) {
        console.error('Error starting Lucky Wheel:', error);
        res.status(500).json({ error: 'Failed to start Lucky Wheel game' });
    }
});

// Spin Lucky Wheel (get winner)
app.post('/api/gaming/luckywheel/spin', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = await gamingSystem.endLuckyWheel(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'No active Lucky Wheel game found for this session' });
        }

        res.json({
            success: true,
            result,
            winner: result.winner,
            totalEntries: result.totalEntries
        });

    } catch (error) {
        console.error('Error spinning Lucky Wheel:', error);
        res.status(500).json({ error: 'Failed to spin Lucky Wheel' });
    }
});

// Start Poll Game
app.post('/api/gaming/poll/start', async (req, res) => {
    try {
        const { sessionId, question, options, duration = 30000 } = req.body;

        if (!sessionId || !question || !options || !Array.isArray(options)) {
            return res.status(400).json({ error: 'sessionId, question, and options array are required' });
        }

        if (!activeSessions.has(sessionId)) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Format options with proper structure
        const formattedOptions = options.map((option, index) => ({
            id: index + 1,
            text: option.text || option,
            keyword: option.keyword || option.text || option,
            votes: []
        }));

        const gameData = gamingSystem.startPoll(sessionId, question, formattedOptions, duration);

        res.json({
            success: true,
            game: gameData,
            message: `Poll started: "${question}" - ${duration / 1000} seconds to vote!`
        });

    } catch (error) {
        console.error('Error starting Poll:', error);
        res.status(500).json({ error: 'Failed to start Poll game' });
    }
});

// End Poll and get results
app.post('/api/gaming/poll/end', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = gamingSystem.endPoll(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'No active Poll game found for this session' });
        }

        res.json({
            success: true,
            result,
            winner: result.winner,
            totalVotes: result.totalVotes
        });

    } catch (error) {
        console.error('Error ending Poll:', error);
        res.status(500).json({ error: 'Failed to end Poll' });
    }
});

// Start Race Game
app.post('/api/gaming/race/start', async (req, res) => {
    try {
        const { sessionId, duration = 20000 } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        if (!activeSessions.has(sessionId)) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const gameData = gamingSystem.startRace(sessionId, duration);

        res.json({
            success: true,
            game: gameData,
            message: `Race started! Comment to move your character for ${duration / 1000} seconds!`
        });

    } catch (error) {
        console.error('Error starting Race:', error);
        res.status(500).json({ error: 'Failed to start Race game' });
    }
});

// End Race and get results
app.post('/api/gaming/race/end', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = gamingSystem.endRace(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'No active Race game found for this session' });
        }

        res.json({
            success: true,
            result,
            winner: result.winner,
            totalParticipants: result.totalParticipants
        });

    } catch (error) {
        console.error('Error ending Race:', error);
        res.status(500).json({ error: 'Failed to end Race' });
    }
});

// Get game status for session
app.get('/api/gaming/status/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const status = gamingSystem.getGameStatus(sessionId);

        res.json({
            success: true,
            status
        });

    } catch (error) {
        console.error('Error getting game status:', error);
        res.status(500).json({ error: 'Failed to get game status' });
    }
});

// Get all active games
app.get('/api/gaming/active', (req, res) => {
    try {
        const activeGames = gamingSystem.getActiveGames();

        res.json({
            success: true,
            activeGames
        });

    } catch (error) {
        console.error('Error getting active games:', error);
        res.status(500).json({ error: 'Failed to get active games' });
    }
});

// Get game history
app.get('/api/gaming/history', (req, res) => {
    try {
        const { sessionId, limit = 10 } = req.query;

        const history = gamingSystem.getGameHistory(sessionId, parseInt(limit));

        res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error('Error getting game history:', error);
        res.status(500).json({ error: 'Failed to get game history' });
    }
});

// Get game history for specific session
app.get('/api/gaming/history/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { limit = 10 } = req.query;

        const history = gamingSystem.getGameHistory(sessionId, parseInt(limit));

        res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error('Error getting game history:', error);
        res.status(500).json({ error: 'Failed to get game history' });
    }
});

// Stop any active game
app.post('/api/gaming/stop', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = gamingSystem.stopGame(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'No active game found for this session' });
        }

        res.json({
            success: true,
            result,
            message: 'Game stopped successfully'
        });

    } catch (error) {
        console.error('Error stopping game:', error);
        res.status(500).json({ error: 'Failed to stop game' });
    }
});

// ===== DJ GAME ENDPOINTS =====

// Start DJ Game
app.post('/api/gaming/djgame/start', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = gamingSystem.startDJGame(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'Failed to start DJ Game' });
        }

        res.json({
            success: true,
            result,
            message: 'DJ Game started successfully'
        });

    } catch (error) {
        console.error('Error starting DJ Game:', error);
        res.status(500).json({ error: 'Failed to start DJ Game' });
    }
});

// Get DJ Game status
app.get('/api/gaming/djgame/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const status = gamingSystem.getDJGameStatus(sessionId);

        if (!status) {
            return res.json({
                success: false,
                message: 'No active DJ Game found'
            });
        }

        res.json({
            success: true,
            status
        });

    } catch (error) {
        console.error('Error getting DJ Game status:', error);
        res.status(500).json({ error: 'Failed to get DJ Game status' });
    }
});

// End DJ Game
app.post('/api/gaming/djgame/end', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const result = gamingSystem.endDJGame(sessionId);

        if (!result) {
            return res.status(404).json({ error: 'No active DJ Game found' });
        }

        res.json({
            success: true,
            result,
            message: 'DJ Game ended successfully'
        });

    } catch (error) {
        console.error('Error ending DJ Game:', error);
        res.status(500).json({ error: 'Failed to end DJ Game' });
    }
});

// Get DJ Game playlist
app.get('/api/gaming/djgame/playlist/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const playlist = gamingSystem.getDJGamePlaylist(sessionId);

        res.json({
            success: true,
            playlist: playlist || []
        });

    } catch (error) {
        console.error('Error getting DJ Game playlist:', error);
        res.status(500).json({ error: 'Failed to get DJ Game playlist' });
    }
});

// ===== SPOTIFY AUTH ENDPOINTS =====

// Initialize Spotify integration
const SpotifyIntegration = require('./spotify-integration');
const spotifyIntegration = new SpotifyIntegration();

// Get Spotify auth URL
app.get('/api/spotify/auth', async (req, res) => {
    try {
        const authUrl = await spotifyIntegration.getAuthUrl();
        res.json({ url: authUrl });
    } catch (error) {
        console.error('Error getting Spotify auth URL:', error);
        res.status(500).json({ error: 'Failed to generate auth URL' });
    }
});

// Handle Spotify callback
app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: 'Authorization code is required' });
    }

    try {
        const result = await spotifyIntegration.handleCallback(code);
        if (result.success) {
            // Redirect to the DJ game interface with success message
            res.redirect('/dj-game.html?auth=success');
        } else {
            res.redirect('/dj-game.html?auth=error');
        }
    } catch (error) {
        console.error('Error handling Spotify callback:', error);
        res.redirect('/dj-game.html?auth=error');
    }
});

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
                'GET /api/sessions/:id/participants': 'Get session participants',
                'DELETE /api/sessions/:id': 'End session'
            },
            users: {
                'GET /api/users/:userId/profile': 'Get user profile by ID',
                'GET /api/sessions/:sessionId/users/:userId/activity': 'Get user activity in session',
                'POST /api/users/profiles/batch': 'Get multiple user profiles'
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

// Game Settings Endpoints
app.post('/api/game-settings', async (req, res) => {
    try {
        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({
                success: false,
                error: 'Settings data is required'
            });
        }

        // Save settings to database
        await db.saveGameSettings(settings);

        // Refresh gaming system settings
        await gamingSystem.refreshSettings();

        console.log('🎮 Game settings saved successfully');

        res.json({
            success: true,
            message: 'Game settings saved successfully'
        });
    } catch (error) {
        console.error('Error in game settings save:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.get('/api/game-settings', async (req, res) => {
    try {
        const settings = await db.getGameSettings();

        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        console.error('Error in game settings load:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Initialize gaming system cleanup interval
setInterval(() => {
    gamingSystem.cleanup();
}, 60000); // Clean up every minute

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TikTok Live Connector Backend Server is running!`);
    console.log(`📍 API Server: http://localhost:${PORT}`);
    console.log(`📊 Database: SQLite (tiktok_sessions.db)`);
    console.log(`🎮 Gaming System: Active (Lucky Wheel, Polls, Races)`);
    console.log(`🔗 API Endpoints:`);
    console.log(`   POST /api/sessions - Create new session`);
    console.log(`   GET  /api/sessions - List all sessions`);
    console.log(`   GET  /api/sessions/:id - Get session info`);
    console.log(`   GET  /api/sessions/:id/events - Get session events`);
    console.log(`   DELETE /api/sessions/:id - End session`);
    console.log(`🖼️ User Profile API:`);
    console.log(`   GET  /api/users/:userId/profile - Get unified user profile picture`);
    console.log(`   GET  /api/tiktok/profile/:username - Legacy TikTok profile endpoint`);
    console.log(`🎯 Gaming Endpoints:`);
    console.log(`   POST /api/gaming/luckywheel/start - Start Lucky Wheel`);
    console.log(`   POST /api/gaming/luckywheel/spin - Spin Lucky Wheel`);
    console.log(`   POST /api/gaming/poll/start - Start Poll Game`);
    console.log(`   POST /api/gaming/race/start - Start Race Game`);
    console.log(`   GET  /api/gaming/status/:sessionId - Get game status`);
    console.log(`⚙️ Settings Endpoints:`);
    console.log(`   POST /api/game-settings - Save game configuration`);
    console.log(`   GET  /api/game-settings - Load game configuration`);
    console.log(`🌐 Web Interface:`);
    console.log(`   http://localhost:${PORT}/game-settings.html - Game Settings`);
    console.log(`🛑 Press Ctrl+C to stop the server`);
});
