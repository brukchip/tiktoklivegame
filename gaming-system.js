// TikTok Live Gaming System
const DJGameSystem = require('./dj-game-system');

class GamingSystem {
    constructor(database = null) {
        this.activeGames = new Map(); // sessionId -> gameData
        this.gameHistory = [];
        this.chatEntries = new Map(); // sessionId -> chat entries for games
        this.db = database;
        this.settings = null;
        
        // Initialize DJ Game System
        this.djGameSystem = new DJGameSystem(database);
        
        // Load settings on startup
        this.loadSettings();
    }

    async loadSettings() {
        if (!this.db) {
            console.log('🎮 Gaming System: No database provided, using default settings');
            return;
        }

        try {
            this.settings = await this.db.getGameSettings();
            if (this.settings) {
                console.log('🎮 Gaming System: Settings loaded successfully');
                console.log(`   Lucky Wheel keyword: "${this.settings.luckyWheel?.keyword || 'GAME'}"`);
                console.log(`   Race keyword: "${this.settings.race?.keyword || 'RACE'}"`);
            } else {
                console.log('🎮 Gaming System: No settings found, using defaults');
            }
        } catch (error) {
            console.error('🎮 Gaming System: Error loading settings:', error);
        }
    }

    // Get setting value with fallback to default
    getSetting(category, key, defaultValue) {
        if (!this.settings || !this.settings[category]) {
            return defaultValue;
        }
        return this.settings[category][key] || defaultValue;
    }

    // Refresh settings from database
    async refreshSettings() {
        await this.loadSettings();
    }

    // Lucky Wheel Game Implementation
    startLuckyWheel(sessionId, duration = null) {
        // Get settings or use defaults
        const gameDuration = duration || this.getSetting('luckyWheel', 'duration', 10) * 1000;
        const keyword = this.getSetting('luckyWheel', 'keyword', 'GAME');
        
        const gameData = {
            type: 'luckywheel',
            sessionId,
            status: 'collecting',
            entries: [],
            startTime: new Date(),
            duration: gameDuration,
            endTime: new Date(Date.now() + gameDuration),
            winner: null,
            keyword: keyword // Store the keyword with the game
        };

        this.activeGames.set(sessionId, gameData);
        console.log(`🎰 Lucky Wheel started for session ${sessionId} - collecting entries for ${gameDuration/1000}s with keyword "${keyword}"`);

        // Auto-end game after duration
        setTimeout(() => {
            this.endLuckyWheel(sessionId);
        }, gameDuration);

        return gameData;
    }

    // Add entry to Lucky Wheel with profile picture capture
    addLuckyWheelEntry(sessionId, username, message, userProfile = null) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'luckywheel' || game.status !== 'collecting') {
            return false;
        }

        // Check if message contains the game keyword as a whole word (case insensitive)
        const gameKeyword = game.keyword || "GAME"; // Use keyword from game data
        const messageUpper = message.toUpperCase();
        const keywordUpper = gameKeyword.toUpperCase();
        
        // Use word boundary regex for exact word matching
        const wordBoundaryRegex = new RegExp(`\\b${keywordUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (wordBoundaryRegex.test(messageUpper)) {
            // Prevent duplicate entries from same user
            const existingEntry = game.entries.find(entry => entry.username === username);
            if (!existingEntry) {
                // Extract profile picture from userProfile with enhanced debugging
                let profilePicture = null;
                if (userProfile) {
                    // Try multiple profile picture sources in order of quality
                    profilePicture = userProfile.profilePictureLarge ||
                                   userProfile.profilePictureMedium || 
                                   userProfile.profilePicture;
                    
                    console.log(`🖼️ Profile extraction for ${username}:`);
                    console.log(`   profilePicture: ${userProfile.profilePicture || 'null'}`);
                    console.log(`   profilePictureMedium: ${userProfile.profilePictureMedium || 'null'}`);
                    console.log(`   profilePictureLarge: ${userProfile.profilePictureLarge || 'null'}`);
                    console.log(`   Selected: ${profilePicture || 'null'}`);
                    
                    // Validate URL format
                    if (profilePicture && typeof profilePicture === 'string' && profilePicture.startsWith('http')) {
                        console.log(`✅ Valid profile URL captured for ${username}`);
                    } else if (profilePicture) {
                        console.log(`⚠️ Invalid profile URL format for ${username}:`, profilePicture);
                        profilePicture = null;
                    }
                } else {
                    console.log(`❌ No userProfile data provided for ${username}`);
                }
                
                const entry = {
                    username,
                    message,
                    timestamp: new Date(),
                    entryId: `${sessionId}-${username}-${Date.now()}`,
                    profilePicture: profilePicture // Store the real-time captured profile picture
                };
                game.entries.push(entry);
                console.log(`🎯 New Lucky Wheel entry: ${username} with profile: ${profilePicture ? '✅' : '❌'}`);
                return true;
            }
        }
        return false;
    }

    // End Lucky Wheel and select winner
    async endLuckyWheel(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'luckywheel') {
            return null;
        }

        // Prevent double spinning
        if (game.status === 'ended' || game.winner) {
            console.log(`⚠️ Lucky Wheel already ended for session ${sessionId}, returning cached result`);
            return {
                winner: game.winner,
                entries: game.entries,
                totalEntries: game.entries.length,
                gameData: game
            };
        }

        game.status = 'ended';
        game.actualEndTime = new Date();

        console.log(`🎰 Lucky Wheel ending for session ${sessionId} - Found ${game.entries.length} entries:`, game.entries.map(e => e.username));
        
        if (game.entries.length === 0) {
            console.log(`🎰 Lucky Wheel ended for session ${sessionId} - No entries`);
            return { winner: null, entries: [], totalEntries: 0 };
        }

        // Profile pictures are now captured in real-time when users enter
        // No need to fetch them again - they're already stored with entries
        console.log(`🖼️ Profile pictures status for ${game.entries.length} entries:`);
        game.entries.forEach(entry => {
            console.log(`  ${entry.username}: ${entry.profilePicture ? '✅ Has profile' : '❌ No profile'}`);
        });
        
        // Select random winner
        const randomIndex = Math.floor(Math.random() * game.entries.length);
        const winner = game.entries[randomIndex];
        game.winner = winner;

        // Add to history
        this.gameHistory.push({
            ...game,
            totalEntries: game.entries.length
        });

        console.log(`🏆 Lucky Wheel winner: ${winner.username} (${game.entries.length} total entries)`);

        return {
            winner,
            entries: game.entries,
            totalEntries: game.entries.length,
            gameData: game
        };
    }

    // Get current game status with enhanced debugging
    getGameStatus(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game) {
            return { active: false, type: null, status: null };
        }

        const timeRemaining = Math.max(0, game.endTime.getTime() - Date.now());
        
        // Enhanced entries with profile status
        const entriesWithProfileStatus = game.entries.map(entry => ({
            ...entry,
            hasValidProfile: !!(entry.profilePicture && entry.profilePicture.startsWith('http'))
        }));
        
        return {
            active: true,
            type: game.type,
            status: game.status,
            entries: entriesWithProfileStatus,
            entriesCount: game.entries.length,
            profileStats: {
                totalEntries: game.entries.length,
                withProfiles: game.entries.filter(e => e.profilePicture && e.profilePicture.startsWith('http')).length,
                withoutProfiles: game.entries.filter(e => !e.profilePicture || !e.profilePicture.startsWith('http')).length
            },
            timeRemaining: timeRemaining,
            timeRemainingSeconds: Math.ceil(timeRemaining / 1000),
            winner: game.winner
        };
    }

    // Get specific active game data (including keyword)
    getActiveGame(sessionId) {
        return this.activeGames.get(sessionId);
    }

    // Polls Game Implementation
    startPoll(sessionId, question, options, duration = 30000) {
        const gameData = {
            type: 'poll',
            sessionId,
            status: 'active',
            question,
            options, // Array of option objects: [{ id, text, keyword, votes: [] }]
            startTime: new Date(),
            duration,
            endTime: new Date(Date.now() + duration),
            votes: new Map() // username -> optionId
        };

        this.activeGames.set(sessionId, gameData);
        console.log(`📊 Poll started for session ${sessionId}: "${question}"`);

        // Auto-end poll after duration
        setTimeout(() => {
            this.endPoll(sessionId);
        }, duration);

        return gameData;
    }

    // Add vote to poll
    addPollVote(sessionId, username, message) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'poll' || game.status !== 'active') {
            return false;
        }

        // Check if message matches any option keyword
        const messageUpper = message.toUpperCase();
        const matchedOption = game.options.find(option => 
            messageUpper.includes(option.keyword.toUpperCase())
        );

        if (matchedOption && !game.votes.has(username)) {
            game.votes.set(username, matchedOption.id);
            if (!matchedOption.votes) matchedOption.votes = [];
            matchedOption.votes.push({ username, timestamp: new Date() });
            console.log(`🗳️ Vote received: ${username} voted for "${matchedOption.text}"`);
            return true;
        }
        return false;
    }

    // End poll and get results
    endPoll(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'poll') {
            return null;
        }

        game.status = 'ended';
        game.actualEndTime = new Date();

        // Calculate results
        const results = game.options.map(option => ({
            ...option,
            voteCount: option.votes ? option.votes.length : 0,
            percentage: game.votes.size > 0 ? 
                Math.round((option.votes ? option.votes.length : 0) / game.votes.size * 100) : 0
        }));

        // Find winner (most votes)
        const winner = results.reduce((prev, current) => 
            (current.voteCount > prev.voteCount) ? current : prev
        );

        game.results = results;
        game.winner = winner;

        // Add to history
        this.gameHistory.push({
            ...game,
            totalVotes: game.votes.size
        });

        console.log(`📊 Poll ended: "${winner.text}" won with ${winner.voteCount} votes`);

        return {
            results,
            winner,
            totalVotes: game.votes.size,
            gameData: game
        };
    }

    // Races Game Implementation
    startRace(sessionId, duration = 20000) {
        const gameData = {
            type: 'race',
            sessionId,
            status: 'active',
            participants: new Map(), // username -> { position, speed, lastComment }
            startTime: new Date(),
            duration,
            endTime: new Date(Date.now() + duration),
            winner: null,
            raceDistance: 100 // Total race distance (percentage)
        };

        this.activeGames.set(sessionId, gameData);
        console.log(`🏁 Race started for session ${sessionId} - ${duration/1000}s duration`);

        // Auto-end race after duration
        setTimeout(() => {
            this.endRace(sessionId);
        }, duration);

        return gameData;
    }

    // Add participant to race (when they comment)
    addRaceParticipant(sessionId, username, message) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'race' || game.status !== 'active') {
            return false;
        }

        let participant = game.participants.get(username);
        
        if (!participant) {
            // New participant
            participant = {
                username,
                position: 0,
                speed: Math.random() * 2 + 1, // Random speed 1-3
                lastComment: new Date(),
                commentCount: 1,
                avatar: `🏃‍${Math.random() > 0.5 ? '♂️' : '♀️'}`
            };
            game.participants.set(username, participant);
        }

        // Move participant forward based on comment
        const moveDistance = Math.random() * 5 + 3; // Move 3-8 units per comment
        participant.position = Math.min(100, participant.position + moveDistance);
        participant.lastComment = new Date();
        participant.commentCount++;

        console.log(`🏃 ${username} moved to position ${participant.position.toFixed(1)}%`);

        // Check if someone won
        if (participant.position >= 100 && !game.winner) {
            game.winner = participant;
            this.endRace(sessionId);
        }

        return true;
    }

    // End race and determine winner
    endRace(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'race') {
            return null;
        }

        game.status = 'ended';
        game.actualEndTime = new Date();

        // Get all participants sorted by position
        const participants = Array.from(game.participants.values())
            .sort((a, b) => b.position - a.position);

        if (!game.winner && participants.length > 0) {
            game.winner = participants[0]; // Participant with highest position
        }

        // Add to history
        this.gameHistory.push({
            ...game,
            totalParticipants: participants.length
        });

        console.log(`🏁 Race ended: ${game.winner ? game.winner.username : 'No winner'} won!`);

        return {
            winner: game.winner,
            participants,
            totalParticipants: participants.length,
            gameData: game
        };
    }

    // Stop any active game
    stopGame(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game) {
            return false;
        }

        switch (game.type) {
            case 'luckywheel':
                return this.endLuckyWheel(sessionId);
            case 'poll':
                return this.endPoll(sessionId);
            case 'race':
                return this.endRace(sessionId);
            case 'djgame':
                return this.djGameSystem.endDJGame(sessionId);
            default:
                return false;
        }
    }

    // DJ Game Methods (delegated to DJ Game System)
    startDJGame(sessionId) {
        return this.djGameSystem.startDJGame(sessionId);
    }

    getDJGameStatus(sessionId) {
        return this.djGameSystem.getDJGameStatus(sessionId);
    }

    endDJGame(sessionId) {
        return this.djGameSystem.endDJGame(sessionId);
    }

    getDJGamePlaylist(sessionId) {
        return this.djGameSystem.getDJGamePlaylist(sessionId);
    }

    // Get game history
    getGameHistory(sessionId = null, limit = 10) {
        let history = this.gameHistory;
        
        if (sessionId) {
            history = history.filter(game => game.sessionId === sessionId);
        }
        
        return history
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .slice(0, limit);
    }

    // Get all active games
    getActiveGames() {
        const activeGames = {};
        for (const [sessionId, game] of this.activeGames.entries()) {
            activeGames[sessionId] = this.getGameStatus(sessionId);
        }
        return activeGames;
    }

    // Clean up ended games (call periodically)
    cleanup() {
        const now = Date.now();
        for (const [sessionId, game] of this.activeGames.entries()) {
            if (game.status === 'ended' || now > game.endTime.getTime() + 60000) {
                this.activeGames.delete(sessionId);
                console.log(`🧹 Cleaned up ended game for session ${sessionId}`);
            }
        }
    }

    // Fetch profile pictures for all game entries
    async fetchProfilePicturesForEntries(entries) {
        console.log('🖼️ Fetching profile pictures for entries...');
        
        for (const entry of entries) {
            if (!entry.profilePicture) {
                try {
                    // Try to get profile picture from active sessions first
                    for (const [sessionId, session] of this.activeGames) {
                        if (session.roomInfo?.owner) {
                            const owner = session.roomInfo.owner;
                            const profilePic = owner.avatarLarger || owner.avatarMedium || owner.avatarThumb;
                            
                            if (profilePic) {
                                entry.profilePicture = profilePic;
                                console.log(`✅ Got profile picture for ${entry.username}:`, profilePic);
                                break;
                            }
                        }
                    }
                    
                    // If still no profile picture, try direct TikTok API
                    if (!entry.profilePicture) {
                        try {
                            const { TikTokLiveConnection } = require('./dist/index');
                            const tempConnection = new TikTokLiveConnection(entry.username);
                            const roomInfo = await tempConnection.getRoomInfo();
                            
                            if (roomInfo?.owner) {
                                const profilePic = roomInfo.owner.avatarLarger || 
                                                 roomInfo.owner.avatarMedium ||
                                                 roomInfo.owner.avatarThumb;
                                
                                if (profilePic) {
                                    entry.profilePicture = profilePic;
                                    console.log(`✅ Got profile picture via API for ${entry.username}:`, profilePic);
                                }
                            }
                        } catch (error) {
                            console.log(`❌ Could not fetch profile for ${entry.username}:`, error.message);
                        }
                    }
                } catch (error) {
                    console.log(`❌ Error processing profile for ${entry.username}:`, error.message);
                }
            }
        }
        
        console.log('🖼️ Profile picture fetching completed');
    }
}

module.exports = GamingSystem;
