// TikTok Live Gaming System Frontend
class GamingHub {
    constructor() {
        // Automatically detect API base URL - works both locally and on deployed server
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.API_BASE = isLocalhost
            ? 'http://localhost:3001/api'
            : `${window.location.protocol}//${window.location.host}/api`;

        console.log('🌐 Gaming API Base URL:', this.API_BASE);

        this.currentSession = null;
        this.currentGame = 'luckywheel';
        this.gameStatus = null;
        this.wheelRotation = 0;
        this.isSpinning = false;

        this.init();
    }

    async init() {
        console.log('🎮 Gaming Hub initialized');
        this.loadSessions();
        this.setupEventListeners();
        this.startStatusPolling();
        this.checkUrlParameters();

        // Load settings and update keyword display immediately
        await this.loadGameSettings();
        if (this.gameSettings?.luckyWheel?.keyword) {
            this.updateKeywordDisplay(this.gameSettings.luckyWheel.keyword);
        }
    }

    checkUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('session');
        const username = urlParams.get('username');

        if (sessionId) {
            // Auto-select the session when page loads
            setTimeout(() => {
                const sessionSelect = document.getElementById('sessionSelect');
                sessionSelect.value = sessionId;
                this.currentSession = sessionId;
                this.updateGameStatus();

                if (username) {
                    this.showNotification(`🎮 Auto-selected session for @${username}!`, 'success');
                }
            }, 1000); // Wait for sessions to load
        }
    }

    setupEventListeners() {
        // Session management
        document.getElementById('sessionSelect').addEventListener('change', (e) => {
            this.currentSession = e.target.value;
            console.log('🎯 Session selected:', this.currentSession);
            this.updateGameStatus();

            if (this.currentSession) {
                this.showNotification(`📡 Connected to session: ${this.currentSession.substring(0, 8)}...`, 'info');
            }
        });

        document.getElementById('refreshSessions').addEventListener('click', () => {
            this.loadSessions();
        });

        // Game selector
        document.querySelectorAll('.game-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchGame(e.target.dataset.game);
            });
        });

        // Lucky Wheel controls
        document.getElementById('startWheel').addEventListener('click', () => {
            this.startLuckyWheel();
        });

        document.getElementById('spinWheel').addEventListener('click', () => {
            this.spinLuckyWheel();
        });

        document.getElementById('stopWheel').addEventListener('click', () => {
            this.stopGame();
        });

        // Poll controls
        document.getElementById('startPoll').addEventListener('click', () => {
            this.startPoll();
        });

        document.getElementById('endPoll').addEventListener('click', () => {
            this.endPoll();
        });

        // Race controls
        document.getElementById('startRace').addEventListener('click', () => {
            this.startRace();
        });

        document.getElementById('endRace').addEventListener('click', () => {
            this.endRace();
        });
    }

    async loadSessions() {
        try {
            const response = await fetch(`${this.API_BASE}/sessions`);
            const data = await response.json();

            const sessionSelect = document.getElementById('sessionSelect');
            sessionSelect.innerHTML = '<option value="">Select a session...</option>';

            if (data.sessions && data.sessions.length > 0) {
                data.sessions.forEach(session => {
                    const option = document.createElement('option');
                    option.value = session.id;
                    const statusIcon = session.status === 'active' ? '🟢' : '🔴';
                    option.textContent = `${statusIcon} ${session.streamer_username} (${session.status}) - ${session.total_events || 0} events`;
                    sessionSelect.appendChild(option);
                });
            } else {
                sessionSelect.innerHTML = '<option value="">No active sessions found</option>';
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            document.getElementById('sessionSelect').innerHTML = '<option value="">Error loading sessions</option>';
        }
    }

    switchGame(gameType) {
        // Update game buttons
        document.querySelectorAll('.game-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-game="${gameType}"]`).classList.add('active');

        // Show/hide game areas
        document.querySelectorAll('.game-area').forEach(area => {
            area.classList.add('hidden');
        });
        document.getElementById(`${gameType}-game`).classList.remove('hidden');

        this.currentGame = gameType;
        this.updateGameStatus();
    }

    async updateGameStatus() {
        if (!this.currentSession) {
            console.log('⚠️ No current session selected for status update');
            return;
        }

        try {
            console.log('📡 Checking game status for session:', this.currentSession);
            const response = await fetch(`${this.API_BASE}/gaming/status/${this.currentSession}`);
            const data = await response.json();
            console.log('📊 Game status response:', data);

            this.gameStatus = data.status;
            this.updateUI();
        } catch (error) {
            console.error('Error getting game status:', error);
        }
    }

    updateUI() {
        if (!this.gameStatus) return;

        const { active, type, status, entries, timeRemaining, timeRemainingSeconds, winner } = this.gameStatus;

        if (this.currentGame === 'luckywheel') {
            this.updateLuckyWheelUI(active, type, status, entries, timeRemainingSeconds, winner);
        } else if (this.currentGame === 'poll') {
            this.updatePollUI(active, type, status, timeRemainingSeconds, winner);
        } else if (this.currentGame === 'race') {
            this.updateRaceUI(active, type, status, timeRemainingSeconds, winner);
        }
    }

    updateLuckyWheelUI(active, type, status, entries, timeRemaining, winner) {
        const statusElement = document.getElementById('wheelStatus');
        const startBtn = document.getElementById('startWheel');
        const spinBtn = document.getElementById('spinWheel');
        const stopBtn = document.getElementById('stopWheel');
        const entriesList = document.getElementById('entriesList');
        const entriesTitle = document.querySelector('#wheelEntries h4');

        // Fix entries count - handle both array and number
        const entriesCount = Array.isArray(entries) ? entries.length : (typeof entries === 'number' ? entries : 0);
        const entriesArray = Array.isArray(entries) ? entries : [];

        if (active && type === 'luckywheel') {
            if (status === 'collecting') {
                statusElement.textContent = `🎯 Collecting entries... ${timeRemaining || 0}s remaining`;
                statusElement.style.color = '#4CAF50';
                startBtn.disabled = true;
                spinBtn.disabled = false;
                stopBtn.disabled = false;
            } else if (status === 'ended' && winner) {
                // Don't show winner immediately - let the animation reveal it
                statusElement.textContent = `🎯 Game completed!`;
                statusElement.style.color = '#4CAF50';
                startBtn.disabled = false;
                spinBtn.disabled = true;
                stopBtn.disabled = true;
            }
        } else {
            statusElement.textContent = 'Ready to start Lucky Wheel!';
            statusElement.style.color = '#fff';
            startBtn.disabled = false;
            spinBtn.disabled = true;
            stopBtn.disabled = true;
        }

        // Update entries count with fixed display
        entriesTitle.textContent = `🎫 Current Entries (${entriesCount})`;

        // Update the detailed entries list
        this.updateDetailedEntriesList(entriesArray);

        // Update wheel segments with player names
        this.updateWheelSegments(entriesArray);

        // Update right panel game info
        this.updateGameInfoPanel(entriesCount, status, entriesArray);
    }

    updatePollUI(active, type, status, timeRemaining, winner) {
        const statusElement = document.getElementById('pollStatus');
        const startBtn = document.getElementById('startPoll');
        const endBtn = document.getElementById('endPoll');

        if (active && type === 'poll') {
            if (status === 'active') {
                statusElement.textContent = `🗳️ Poll is active! ${timeRemaining || 0}s remaining`;
                statusElement.style.color = '#4CAF50';
                startBtn.disabled = true;
                endBtn.disabled = false;
            } else if (status === 'ended' && winner) {
                statusElement.textContent = `🏆 Winner: ${winner.text}!`;
                statusElement.style.color = '#FFD700';
                startBtn.disabled = false;
                endBtn.disabled = true;
            }
        } else {
            statusElement.textContent = 'Enter a question and start a poll!';
            statusElement.style.color = '#fff';
            startBtn.disabled = false;
            endBtn.disabled = true;
        }
    }

    updateRaceUI(active, type, status, timeRemaining, winner) {
        const statusElement = document.getElementById('raceStatus');
        const startBtn = document.getElementById('startRace');
        const endBtn = document.getElementById('endRace');

        if (active && type === 'race') {
            if (status === 'active') {
                statusElement.textContent = `🏁 Race is active! ${timeRemaining || 0}s remaining`;
                statusElement.style.color = '#4CAF50';
                startBtn.disabled = true;
                endBtn.disabled = false;
            } else if (status === 'ended' && winner) {
                statusElement.textContent = `🏆 Winner: ${winner.username}!`;
                statusElement.style.color = '#FFD700';
                startBtn.disabled = false;
                endBtn.disabled = true;
            }
        } else {
            statusElement.textContent = 'Start a race and let viewers compete!';
            statusElement.style.color = '#fff';
            startBtn.disabled = false;
            endBtn.disabled = true;
        }
    }

    async startLuckyWheel() {
        if (!this.currentSession) {
            alert('Please select a session first!');
            return;
        }

        try {
            // First load the settings to get the keyword and duration
            await this.loadGameSettings();

            const response = await fetch(`${this.API_BASE}/gaming/luckywheel/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.currentSession,
                    duration: (this.gameSettings?.luckyWheel?.duration || 10) * 1000
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('🎰 Lucky Wheel started!', data);

                // Get settings for display
                const keyword = this.gameSettings?.luckyWheel?.keyword || 'GAME';
                const duration = this.gameSettings?.luckyWheel?.duration || 10;

                // Update UI with current keyword
                this.updateKeywordDisplay(keyword);

                // Start countdown
                this.startCountdown(duration);

                // Update game status
                this.updateGameStatus();

                // Clear previous entries
                this.clearEntries();

                // Start polling for live entries
                this.startLiveEntriesPolling();

                this.showNotification(`🎯 Lucky Wheel started! Tell viewers to type "${keyword}" to enter!`, 'success');
            } else {
                throw new Error(data.error || 'Failed to start Lucky Wheel');
            }
        } catch (error) {
            console.error('Error starting Lucky Wheel:', error);
            this.showNotification('❌ Failed to start Lucky Wheel: ' + error.message, 'error');
        }
    }

    async spinLuckyWheel() {
        if (!this.currentSession) return;

        try {
            // Stop countdown and polling
            if (this.countdownInterval) {
                clearInterval(this.countdownInterval);
            }
            if (this.entriesPollingInterval) {
                clearInterval(this.entriesPollingInterval);
            }

            // Hide countdown timer
            const timer = document.getElementById('countdownTimer');
            if (timer) {
                timer.style.display = 'none';
            }

            const response = await fetch(`${this.API_BASE}/gaming/luckywheel/spin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.currentSession })
            });

            const data = await response.json();

            if (data.success) {
                console.log('🎯 Lucky Wheel spun!', data);
                console.log('🔍 Backend winner data:', data.result.winner);
                console.log('🔍 Backend entries:', data.result.entries);

                if (!data.result.winner) {
                    this.showNotification('😔 No entries found - no winner could be selected!', 'error');
                    this.updateGameStatus();
                    return;
                }

                // Update final entries count
                this.updateLiveEntries(data.result.entries || []);

                // Animate wheel spin
                await this.animateWheelSpin();

                // Show real winner with epic celebration
                this.showWinner(data.result.winner, 'luckywheel', data.result.entries);
                this.updateGameStatus();

                // Don't show winner notification immediately - let animation complete first
            } else {
                throw new Error(data.error || 'Failed to spin Lucky Wheel');
            }
        } catch (error) {
            console.error('Error spinning Lucky Wheel:', error);
            this.showNotification('❌ Failed to spin Lucky Wheel: ' + error.message, 'error');
        }
    }

    async animateWheelSpin() {
        const wheel = document.getElementById('luckyWheelElement');
        const wheelCenter = wheel.querySelector('.wheel-center');
        this.isSpinning = true;

        // Add spinning class for enhanced glow effect
        wheel.classList.add('spinning');

        // Play spinning sound effect
        this.playSpinSound();

        // Random rotation between 2160-4320 degrees (6-12 full rotations)
        const finalRotation = this.wheelRotation + (Math.random() * 2160 + 2160);
        this.wheelRotation = finalRotation;

        // Update wheel center during spin
        if (wheelCenter) {
            wheelCenter.innerHTML = '🌟';
        }

        // Enhanced animation with multiple stages
        wheel.style.transition = 'transform 4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        wheel.style.transform = `rotate(${finalRotation}deg)`;

        // Add excitement during spin
        setTimeout(() => {
            if (wheelCenter) wheelCenter.innerHTML = '✨';
        }, 1500);

        setTimeout(() => {
            if (wheelCenter) wheelCenter.innerHTML = '🔥';
        }, 2500);

        // Wait for animation to complete
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Reset wheel center and remove spinning effect
        if (wheelCenter) wheelCenter.innerHTML = '🎯';
        wheel.classList.remove('spinning');
        this.isSpinning = false;

        console.log(`🎡 Wheel spin animation completed - final rotation: ${finalRotation}deg`);
    }

    playSpinSound() {
        // Create a simple audio context for sound effects
        if (typeof (Audio) !== "undefined") {
            // You can add actual sound files here later
            // For now, we'll use a simple beep using Web Audio API
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.5);

                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            } catch (e) {
                // Audio not supported, continue silently
                console.log('Audio not supported');
            }
        }
    }

    async startPoll() {
        if (!this.currentSession) {
            alert('Please select a session first!');
            return;
        }

        const question = document.getElementById('pollQuestion').value.trim();
        if (!question) {
            alert('Please enter a poll question!');
            return;
        }

        // Default poll options - in a real app, you'd let users customize these
        const options = [
            { text: 'Option A', keyword: 'A' },
            { text: 'Option B', keyword: 'B' },
            { text: 'Option C', keyword: 'C' },
            { text: 'Option D', keyword: 'D' }
        ];

        try {
            const response = await fetch(`${this.API_BASE}/gaming/poll/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.currentSession,
                    question: question,
                    options: options,
                    duration: 30000 // 30 seconds
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('📊 Poll started!', data);
                this.createPollOptions(options);
                this.updateGameStatus();
                this.showNotification('🗳️ Poll started! Tell viewers to type A, B, C, or D to vote!', 'success');
            } else {
                throw new Error(data.error || 'Failed to start poll');
            }
        } catch (error) {
            console.error('Error starting poll:', error);
            this.showNotification('❌ Failed to start poll: ' + error.message, 'error');
        }
    }

    createPollOptions(options) {
        const container = document.getElementById('pollOptions');
        container.innerHTML = '';

        options.forEach(option => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'poll-option';
            optionDiv.innerHTML = `
                <h4>${option.text}</h4>
                <p>Type "${option.keyword}" to vote</p>
                <div class="vote-count">0 votes (0%)</div>
            `;
            container.appendChild(optionDiv);
        });
    }

    async endPoll() {
        if (!this.currentSession) return;

        try {
            const response = await fetch(`${this.API_BASE}/gaming/poll/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.currentSession })
            });

            const data = await response.json();

            if (data.success) {
                console.log('📊 Poll ended!', data);
                this.showWinner(data.result.winner, 'poll');
                this.updatePollResults(data.result.results);
                this.updateGameStatus();
                this.showNotification(`🏆 Poll winner: ${data.result.winner.text}!`, 'success');
            } else {
                throw new Error(data.error || 'Failed to end poll');
            }
        } catch (error) {
            console.error('Error ending poll:', error);
            this.showNotification('❌ Failed to end poll: ' + error.message, 'error');
        }
    }

    updatePollResults(results) {
        const options = document.querySelectorAll('.poll-option');
        results.forEach((result, index) => {
            if (options[index]) {
                const voteCount = options[index].querySelector('.vote-count');
                voteCount.textContent = `${result.voteCount} votes (${result.percentage}%)`;

                if (result.voteCount === Math.max(...results.map(r => r.voteCount))) {
                    options[index].classList.add('winning');
                }
            }
        });
    }

    async startRace() {
        if (!this.currentSession) {
            alert('Please select a session first!');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/gaming/race/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.currentSession,
                    duration: 20000 // 20 seconds
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('🏁 Race started!', data);
                this.initializeRaceTrack();
                this.updateGameStatus();
                this.showNotification('🏁 Race started! Tell viewers to comment to move their characters!', 'success');
            } else {
                throw new Error(data.error || 'Failed to start race');
            }
        } catch (error) {
            console.error('Error starting race:', error);
            this.showNotification('❌ Failed to start race: ' + error.message, 'error');
        }
    }

    initializeRaceTrack() {
        const track = document.getElementById('raceTrack');
        // Clear existing participants
        track.querySelectorAll('.race-participant').forEach(p => p.remove());
    }

    async endRace() {
        if (!this.currentSession) return;

        try {
            const response = await fetch(`${this.API_BASE}/gaming/race/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.currentSession })
            });

            const data = await response.json();

            if (data.success) {
                console.log('🏁 Race ended!', data);
                this.showWinner(data.result.winner, 'race');
                this.updateGameStatus();
                this.showNotification(`🏆 Race winner: ${data.result.winner.username}!`, 'success');
            } else {
                throw new Error(data.error || 'Failed to end race');
            }
        } catch (error) {
            console.error('Error ending race:', error);
            this.showNotification('❌ Failed to end race: ' + error.message, 'error');
        }
    }

    async stopGame() {
        if (!this.currentSession) return;

        try {
            const response = await fetch(`${this.API_BASE}/gaming/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.currentSession })
            });

            const data = await response.json();

            if (data.success) {
                console.log('⏹️ Game stopped!', data);
                this.updateGameStatus();
                this.showNotification('⏹️ Game stopped successfully!', 'info');
            } else {
                throw new Error(data.error || 'Failed to stop game');
            }
        } catch (error) {
            console.error('Error stopping game:', error);
            this.showNotification('❌ Failed to stop game: ' + error.message, 'error');
        }
    }

    showWinner(winner, gameType, entries = null) {
        if (gameType === 'luckywheel') {
            // Epic full-screen celebration for Lucky Wheel
            this.showEpicWinnerCelebration(winner.username, entries);
        } else if (gameType === 'poll') {
            // Standard display for other games
            const winnerDisplay = document.getElementById('pollWinner');
            const message = `📊 Poll Winner: ${winner.text} with ${winner.voteCount} votes! 🎉`;
            winnerDisplay.textContent = message;
            winnerDisplay.style.display = 'block';
            setTimeout(() => {
                winnerDisplay.style.display = 'none';
            }, 10000);
        } else if (gameType === 'race') {
            const winnerDisplay = document.getElementById('raceWinner');
            const message = `🏁 Race Winner: ${winner.username}! 🎉`;
            winnerDisplay.textContent = message;
            winnerDisplay.style.display = 'block';
            setTimeout(() => {
                winnerDisplay.style.display = 'none';
            }, 10000);
        }
    }

    async showEpicWinnerCelebration(username, entries = null) {
        console.log('🎉 showEpicWinnerCelebration called with username:', username);
        console.log('🎯 Game entries for profile pictures:', entries);

        const overlay = document.getElementById('winnerOverlay');
        const avatarLarge = document.getElementById('winnerAvatarLarge');
        const usernameLarge = document.getElementById('winnerUsernameLarge');
        const particlesContainer = document.getElementById('celebrationParticles');

        // Set username
        console.log('🎯 Setting winner username to:', username);
        usernameLarge.textContent = `@${username}`;

        // Setup avatar with game entries for profile pictures
        await this.setupWinnerAvatar(avatarLarge, username, entries);

        // Create floating particles
        this.createCelebrationParticles(particlesContainer);

        // Show overlay with entrance animation
        overlay.style.display = 'flex';
        overlay.style.opacity = '0';

        // Ensure close button works
        const closeButton = overlay.querySelector('.close-celebration');
        if (closeButton) {
            closeButton.onclick = () => {
                console.log('🚪 Close button clicked');
                this.closeWinnerCelebration();
            };
        }

        // Animate entrance
        setTimeout(() => {
            overlay.style.transition = 'opacity 0.8s ease-out';
            overlay.style.opacity = '1';
        }, 50);

        // Play epic winner sound
        this.playEpicWinnerSound();

        // Trigger massive confetti
        this.triggerMassiveConfetti();

        // Show winner notification AFTER the epic celebration starts
        setTimeout(() => {
            this.showNotification(`🎉 WINNER: ${username}! 🎉`, 'success');
        }, 2000);

        // Add screen shake effect
        this.addScreenShake();

        // Auto-hide after 20 seconds
        setTimeout(() => {
            if (overlay.style.display !== 'none') {
                window.closeWinnerCelebration();
            }
        }, 20000);
    }

    closeWinnerCelebration() {
        console.log('🚪 Closing winner celebration');
        const overlay = document.getElementById('winnerOverlay');
        if (overlay) {
            overlay.style.transition = 'all 0.5s ease-out';
            overlay.style.opacity = '0';
            overlay.style.transform = 'scale(0.8)';
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.style.opacity = '1';
                overlay.style.transform = 'scale(1)';
            }, 500);
        }
    }

    async setupWinnerAvatar(avatarElement, username, gameEntries = null) {
        console.log('🖼️ Setting up avatar for:', username);

        // First, try to get profile picture from game entries (most reliable)
        if (gameEntries) {
            const entry = gameEntries.find(e => e.username === username);
            if (entry && entry.profilePicture) {
                console.log('✅ Using profile picture from game entry:', entry.profilePicture);
                const img = new Image();
                img.onload = () => {
                    avatarElement.innerHTML = `<img src="${entry.profilePicture}" alt="${username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: relative; z-index: 2;">`;
                };
                img.onerror = () => {
                    console.log('❌ Game entry profile picture failed to load, using fallback');
                    this.setFallbackAvatar(avatarElement, username);
                };
                img.src = entry.profilePicture;
                return;
            }
        }

        // Fallback: Try to get profile picture from external service
        const profilePic = await this.getTikTokProfilePicture(username);

        if (profilePic) {
            console.log('✅ Using external profile picture:', profilePic);
            const img = new Image();
            img.onload = () => {
                avatarElement.innerHTML = `<img src="${profilePic}" alt="${username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: relative; z-index: 2;">`;
            };
            img.onerror = () => {
                console.log('❌ External profile picture failed to load, using fallback');
                this.setFallbackAvatar(avatarElement, username);
            };
            img.src = profilePic;
        } else {
            console.log('🎨 Using fallback avatar');
            this.setFallbackAvatar(avatarElement, username);
        }
    }

    setFallbackAvatar(avatarElement, username) {
        // Fallback to colorful initials
        const initials = this.getUserInitials(username);
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const color = colors[username.length % colors.length];

        avatarElement.style.background = `linear-gradient(45deg, ${color}, ${this.lightenColor(color, 20)})`;
        avatarElement.innerHTML = `<span style="position: relative; z-index: 2; font-size: 2em; font-weight: bold;">${initials}</span>`;
    }

    createCelebrationParticles(container) {
        // Clear existing particles
        container.innerHTML = '';

        // Create 50 floating particles
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';

            // Random colors
            const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];

            // Random position and animation delay
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 4 + 's';
            particle.style.animationDuration = (Math.random() * 3 + 3) + 's';

            container.appendChild(particle);
        }
    }

    addScreenShake() {
        const body = document.body;
        body.style.animation = 'screenShake 0.5s ease-in-out 3';

        // Add shake keyframes if not exists
        if (!document.getElementById('shake-keyframes')) {
            const style = document.createElement('style');
            style.id = 'shake-keyframes';
            style.textContent = `
                @keyframes screenShake {
                    0%, 100% { transform: translate(0, 0); }
                    25% { transform: translate(-5px, 5px); }
                    50% { transform: translate(5px, -5px); }
                    75% { transform: translate(-3px, -3px); }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            body.style.animation = '';
        }, 1500);
    }

    playEpicWinnerSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Play an epic victory fanfare - more notes and longer
            const melody = [
                { freq: 523.25, time: 0 },    // C5
                { freq: 659.25, time: 0.3 },  // E5
                { freq: 783.99, time: 0.6 },  // G5
                { freq: 1046.50, time: 0.9 }, // C6
                { freq: 783.99, time: 1.2 },  // G5
                { freq: 1046.50, time: 1.5 }, // C6
                { freq: 1318.51, time: 1.8 }  // E6
            ];

            melody.forEach(note => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(note.freq, audioContext.currentTime + note.time);
                gainNode.gain.setValueAtTime(0.15, audioContext.currentTime + note.time);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + note.time + 0.4);

                oscillator.start(audioContext.currentTime + note.time);
                oscillator.stop(audioContext.currentTime + note.time + 0.4);
            });
        } catch (e) {
            console.log('Audio not supported');
        }
    }

    triggerMassiveConfetti() {
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];

        // Create 200 confetti pieces
        for (let i = 0; i < 200; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.style.cssText = `
                    position: fixed;
                    width: ${Math.random() * 10 + 5}px;
                    height: ${Math.random() * 10 + 5}px;
                    background: ${colors[Math.floor(Math.random() * colors.length)]};
                    left: ${Math.random() * 100}vw;
                    top: -20px;
                    z-index: 10001;
                    border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
                    animation: confettiFall ${Math.random() * 3 + 3}s linear forwards;
                    pointer-events: none;
                `;

                document.body.appendChild(confetti);

                setTimeout(() => {
                    confetti.remove();
                }, 6000);
            }, i * 10);
        }

        // Add confetti animation if not exists
        if (!document.getElementById('confetti-animation')) {
            const style = document.createElement('style');
            style.id = 'confetti-animation';
            style.textContent = `
                @keyframes confettiFall {
                    0% {
                        transform: translateY(-20px) rotate(0deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(100vh) rotate(720deg);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    async getTikTokProfilePicture(username) {
        try {
            console.log('🔍 Fetching TikTok profile picture for:', username);

            // Method 1: Try our new unified user profile API
            try {
                const response = await fetch(`${this.API_BASE}/users/${encodeURIComponent(username)}/profile`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.profilePicture) {
                        console.log('✅ Got profile from unified API:', data.source);
                        return data.profilePicture;
                    }
                }
            } catch (e) {
                console.log('⚠️ Unified profile API not available');
            }

            // Method 2: Fallback to legacy TikTok profile API
            try {
                const response = await fetch(`${this.API_BASE}/tiktok/profile/${encodeURIComponent(username)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.profilePicture) {
                        console.log('✅ Got profile from legacy API');
                        return data.profilePicture;
                    }
                }
            } catch (e) {
                console.log('⚠️ Legacy profile API not available');
            }

            // Method 2: Use a high-quality generated avatar with the username
            console.log('🎨 Creating high-quality avatar for:', username);
            const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=400&font-size=0.6&rounded=true&bold=true`;

            // Verify the service is available
            try {
                const testResponse = await fetch(avatarUrl, { method: 'HEAD' });
                if (testResponse.ok) {
                    console.log('✅ Using high-quality generated avatar');
                    return avatarUrl;
                }
            } catch (e) {
                console.log('❌ Generated avatar service failed');
            }

            return null;

        } catch (error) {
            console.log('❌ All profile methods failed:', error.message);
            return null;
        }
    }

    getUserInitials(username) {
        // Remove @ symbol and get first 2 characters
        const cleanUsername = username.replace('@', '');
        return cleanUsername.substring(0, 2).toUpperCase();
    }

    lightenColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const B = (num >> 8 & 0x00FF) + amt;
        const G = (num & 0x0000FF) + amt;
        return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (B < 255 ? B < 1 ? 0 : B : 255) * 0x100 +
            (G < 255 ? G < 1 ? 0 : G : 255)).toString(16).slice(1);
    }

    playWinnerSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Play victory fanfare
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

            notes.forEach((freq, index) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime + index * 0.2);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.2 + 0.3);

                oscillator.start(audioContext.currentTime + index * 0.2);
                oscillator.stop(audioContext.currentTime + index * 0.2 + 0.3);
            });
        } catch (e) {
            console.log('Audio not supported');
        }
    }

    triggerConfetti() {
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8'];

        for (let i = 0; i < 100; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + 'vw';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animation = `confetti-fall ${Math.random() * 3 + 2}s linear forwards`;

                document.body.appendChild(confetti);

                setTimeout(() => {
                    confetti.remove();
                }, 5000);
            }, i * 20);
        }

        // Add confetti animation
        if (!document.getElementById('confetti-style')) {
            const style = document.createElement('style');
            style.id = 'confetti-style';
            style.textContent = `
                @keyframes confetti-fall {
                    0% {
                        transform: translateY(-100vh) rotate(0deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(100vh) rotate(360deg);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 10px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            max-width: 300px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
        `;

        // Set background color based on type
        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#FF9800',
            info: '#2196F3'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }

    startStatusPolling() {
        // Update game status every 2 seconds
        setInterval(() => {
            if (this.currentSession) {
                this.updateGameStatus();
            }
        }, 2000);
    }

    // Modern Lucky Wheel Methods
    async loadGameSettings() {
        try {
            const response = await fetch(`${this.API_BASE}/game-settings`);
            const data = await response.json();
            this.gameSettings = data.settings;
        } catch (error) {
            console.error('Error loading game settings:', error);
            this.gameSettings = null;
        }
    }

    updateKeywordDisplay(keyword) {
        // Update all keyword displays
        const elements = ['luckyWheelKeyword', 'countdownKeyword'];
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = keyword;
            }
        });
    }

    startCountdown(duration) {
        const timer = document.getElementById('countdownTimer');
        const countdownValue = document.getElementById('countdownValue');

        timer.style.display = 'block';

        let remaining = duration;
        countdownValue.textContent = remaining;

        this.countdownInterval = setInterval(() => {
            remaining--;
            countdownValue.textContent = remaining;

            // Add animation for last 5 seconds
            if (remaining <= 5) {
                timer.style.animation = 'pulse 1s infinite';
                timer.style.background = 'rgba(255,0,0,0.2)';
            }

            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                timer.style.display = 'none';
                timer.style.animation = '';
                timer.style.background = 'rgba(255,215,0,0.1)';

                // Auto-spin after countdown
                setTimeout(() => {
                    this.spinLuckyWheel();
                }, 1000);
            }
        }, 1000);
    }

    clearEntries() {
        const entriesCount = document.getElementById('entriesCount');
        const entriesList = document.getElementById('entriesList');

        if (entriesCount) entriesCount.textContent = '0';
        if (entriesList) {
            entriesList.innerHTML = `
                <div style="text-align: center; opacity: 0.7; padding: 20px;">
                    Waiting for entries... 🎯
                </div>
            `;
        }
    }

    startLiveEntriesPolling() {
        // Clear any existing polling
        if (this.entriesPollingInterval) {
            clearInterval(this.entriesPollingInterval);
        }

        // Poll for entries every 1 second during active game
        this.entriesPollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`${this.API_BASE}/gaming/status/${this.currentSession}`);
                const data = await response.json();

                if (data.success && data.status?.type === 'luckywheel') {
                    // Always update with real entries from backend
                    const entries = data.status.entries || [];
                    console.log(`🔄 Live entries poll: ${entries.length} entries found`, entries.map(e => e.username));
                    this.updateLiveEntries(entries);

                    if (data.status.status !== 'collecting') {
                        // Game ended, stop polling after a delay
                        setTimeout(() => {
                            clearInterval(this.entriesPollingInterval);
                        }, 2000);
                    }
                } else {
                    // Game ended, stop polling
                    clearInterval(this.entriesPollingInterval);
                }
            } catch (error) {
                console.error('Error polling entries:', error);
            }
        }, 1000);
    }

    updateLiveEntries(entries) {
        const entriesCount = document.getElementById('entriesCount');
        const entriesList = document.getElementById('entriesList');

        if (!entriesCount || !entriesList) return;

        entriesCount.textContent = entries.length;

        // Also update the enhanced UI components
        this.updateDetailedEntriesList(entries);
        this.updateWheelSegments(entries);
        this.updateGameInfoPanel(entries.length, 'collecting', entries);

        if (entries.length === 0) {
            entriesList.innerHTML = `
                <div style="text-align: center; opacity: 0.7; padding: 20px;">
                    Waiting for entries... 🎯
                </div>
            `;
            return;
        }

        // Show latest entries with animation
        const entriesHtml = entries.map((entry, index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; 
                        padding: 8px 12px; margin: 5px 0; background: rgba(255,215,0,0.1); 
                        border-radius: 8px; border-left: 3px solid #FFD700;
                        animation: slideInRight 0.5s ease;">
                <div style="font-weight: bold; color: #FFD700;">
                    ${index + 1}. @${entry.username}
                </div>
                <div style="font-size: 0.8em; opacity: 0.8;">
                    ${new Date(entry.timestamp).toLocaleTimeString()}
                </div>
            </div>
        `).join('');

        entriesList.innerHTML = entriesHtml;

        // Auto-scroll to bottom
        entriesList.scrollTop = entriesList.scrollHeight;
    }

    // Enhanced UI Methods for Modern Lucky Wheel
    updateDetailedEntriesList(entries) {
        const detailedEntrants = document.getElementById('detailedEntrants');
        if (!detailedEntrants) return;

        if (entries.length === 0) {
            detailedEntrants.innerHTML = `
                <div class="entrant-card empty">
                    <div class="entrant-placeholder">
                        <span class="placeholder-icon">🎯</span>
                        <span class="placeholder-text">Waiting for entries...</span>
                    </div>
                </div>
            `;
            return;
        }

        const entrantsHtml = entries.map((entry, index) => {
            const timeAgo = this.getTimeAgo(entry.timestamp);
            const profilePic = entry.profilePicture || this.generateInitialsAvatar(entry.username);

            return `
                <div class="entrant-card" data-username="${entry.username}">
                    <div class="entrant-number">${index + 1}</div>
                    <div class="entrant-avatar">
                        ${entry.profilePicture ?
                    `<img src="${entry.profilePicture}" alt="${entry.username}" onerror="this.outerHTML='${this.generateInitialsAvatar(entry.username)}'" />` :
                    this.generateInitialsAvatar(entry.username)
                }
                    </div>
                    <div class="entrant-info">
                        <div class="entrant-username">@${entry.username}</div>
                        <div class="entrant-timestamp">${timeAgo}</div>
                    </div>
                    <div class="entrant-status">✅</div>
                </div>
            `;
        }).join('');

        detailedEntrants.innerHTML = entrantsHtml;
    }

    updateWheelSegments(entries) {
        const wheelSegments = document.getElementById('wheelSegments');
        if (!wheelSegments) return;

        wheelSegments.innerHTML = '';

        if (entries.length === 0) {
            // Show empty wheel with default message
            wheelSegments.innerHTML = `
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                           color: rgba(255, 255, 255, 0.6); font-size: 1.5em; text-align: center;">
                    🎯<br/>Ready to spin!
                </div>
            `;
            return;
        }

        // Create SVG-based wheel segments
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', '0 0 400 400');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';

        const centerX = 200;
        const centerY = 200;
        const radius = 180;
        const segmentAngle = 360 / entries.length;

        entries.forEach((entry, index) => {
            const startAngle = index * segmentAngle - 90; // Start from top
            const endAngle = (index + 1) * segmentAngle - 90;

            const color = this.getSegmentColor(index);

            // Create path for segment
            const path = document.createElementNS(svgNamespace, 'path');
            const startAngleRad = (startAngle * Math.PI) / 180;
            const endAngleRad = (endAngle * Math.PI) / 180;

            const x1 = centerX + radius * Math.cos(startAngleRad);
            const y1 = centerY + radius * Math.sin(startAngleRad);
            const x2 = centerX + radius * Math.cos(endAngleRad);
            const y2 = centerY + radius * Math.sin(endAngleRad);

            const largeArcFlag = segmentAngle > 180 ? 1 : 0;

            const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                'Z'
            ].join(' ');

            path.setAttribute('d', pathData);
            path.setAttribute('fill', color);
            path.setAttribute('stroke', 'rgba(255, 255, 255, 0.2)');
            path.setAttribute('stroke-width', '2');
            path.style.transition = 'all 0.3s ease';

            svg.appendChild(path);

            // Add text label
            const textAngle = startAngle + segmentAngle / 2;
            const textAngleRad = (textAngle * Math.PI) / 180;
            const textRadius = radius * 0.7;
            const textX = centerX + textRadius * Math.cos(textAngleRad);
            const textY = centerY + textRadius * Math.sin(textAngleRad);

            const text = document.createElementNS(svgNamespace, 'text');
            text.setAttribute('x', textX);
            text.setAttribute('y', textY);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('fill', '#000');
            text.setAttribute('font-size', '14');
            text.setAttribute('font-weight', 'bold');
            text.style.textShadow = '1px 1px 2px rgba(255, 255, 255, 0.8)';
            text.style.pointerEvents = 'none';

            // Rotate text to be readable
            text.setAttribute('transform', `rotate(${textAngle}, ${textX}, ${textY})`);

            // Truncate long usernames
            const username = entry.username.length > 8 ? entry.username.substring(0, 8) + '...' : entry.username;
            text.textContent = `@${username}`;

            svg.appendChild(text);
        });

        wheelSegments.appendChild(svg);
        console.log(`🎡 Updated wheel with ${entries.length} dynamic segments`);
    }

    updateGameInfoPanel(entriesCount, status, entries) {
        const gameKeyword = document.getElementById('gameKeyword');
        const gameStatus = document.getElementById('gameStatus');
        const latestEntry = document.getElementById('latestEntry');
        const totalEntries = document.getElementById('totalEntries');

        if (gameKeyword) {
            const keyword = this.gameSettings?.luckyWheel?.keyword || 'GAME';
            gameKeyword.textContent = keyword;
        }

        if (gameStatus) {
            const statusText = status === 'collecting' ? '🟡 Collecting' :
                status === 'ended' ? '🔴 Ended' :
                    '🟢 Ready';
            gameStatus.textContent = statusText;
            gameStatus.className = `status ${status || 'ready'}`;
        }

        if (latestEntry) {
            if (entries.length > 0) {
                const latest = entries[entries.length - 1];
                latestEntry.innerHTML = `
                    <span class="latest-user">@${latest.username}</span>
                    <span class="latest-time">${this.getTimeAgo(latest.timestamp)}</span>
                `;
            } else {
                latestEntry.textContent = 'None yet';
            }
        }

        if (totalEntries) {
            totalEntries.textContent = entriesCount;
        }
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diffInSeconds = Math.floor((now - time) / 1000);

        if (diffInSeconds < 10) return 'just now';
        if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        return `${Math.floor(diffInSeconds / 3600)}h ago`;
    }

    generateInitialsAvatar(username) {
        const initials = this.getUserInitials(username);
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const color = colors[username.length % colors.length];

        return `<div class="initials-avatar" style="background: linear-gradient(45deg, ${color}, ${this.lightenColor(color, 20)});">${initials}</div>`;
    }

    getSegmentColor(index) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#74B9FF',
            '#FD79A8', '#FDCB6E', '#6C5CE7', '#A29BFE'
        ];
        return colors[index % colors.length];
    }
}

// Add CSS animations for modern Lucky Wheel
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
    }
    @keyframes glow {
        0% { box-shadow: 0 0 5px #FFD700; }
        50% { box-shadow: 0 0 20px #FFD700, 0 0 30px #FFD700; }
        100% { box-shadow: 0 0 5px #FFD700; }
    }
`;
document.head.appendChild(style);

// Initialize the gaming hub when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.gamingHub = new GamingHub();
});
