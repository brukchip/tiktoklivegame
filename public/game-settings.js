// Game Settings Management System
class GameSettings {
    constructor() {
        this.API_BASE = 'http://localhost:3001/api';
        this.settings = this.getDefaultSettings();
        this.init();
    }

    init() {
        console.log('🎮 Game Settings initialized (Manual Save Mode)');
        this.setupEventListeners();
        this.loadSettings();
        this.updateUI();
    }

    getDefaultSettings() {
        return {
            // Lucky Wheel Settings
            luckyWheel: {
                duration: 10,
                keyword: "GAME",
                colors: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4"],
                soundEnabled: true,
                confettiEnabled: true,
                spinDuration: 4
            },
            
            // Poll Game Settings
            poll: {
                duration: 30,
                maxOptions: 4,
                caseSensitive: false,
                showLiveResults: true,
                themeColor: "#3498db"
            },
            
            // Race Game Settings
            race: {
                duration: 60,
                maxRacers: 20,
                keyword: "RACE",
                animationEnabled: true,
                leaderboardEnabled: true
            },
            
            // General Settings
            general: {
                masterVolume: 70,
                autoSave: false,
                showNotifications: true,
                defaultGameMode: "luckywheel",
                celebrationDuration: 8
            },
            
            // Chat Integration
            chat: {
                filteringEnabled: true,
                minUsernameLength: 3,
                allowDuplicateEntries: false,
                entryCooldown: 5
            },
            
            // Theme & Appearance
            theme: {
                gamingTheme: "neon",
                primaryColor: "#FFD700",
                secondaryColor: "#FF6B6B",
                darkMode: true,
                animationsEnabled: true
            }
        };
    }

    setupEventListeners() {
        // Range sliders with live updates - MANUAL SAVE ONLY
        const ranges = [
            'wheelDuration', 'wheelSpinDuration', 'pollDuration', 'pollMaxOptions',
            'raceDuration', 'raceMaxRacers', 'masterVolume', 'celebrationDuration',
            'minUsernameLength', 'entryCooldown'
        ];

        ranges.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    this.updateRangeValue(id, e.target.value);
                    // Manual save only - no auto-save
                });
            }
        });

        // Text inputs - MANUAL SAVE ONLY
        const textInputs = ['wheelKeyword', 'raceKeyword'];
        textInputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    // Manual save only - no auto-save
                });
            }
        });

        // Color inputs - MANUAL SAVE ONLY
        const colorInputs = [
            'wheelColor1', 'wheelColor2', 'wheelColor3', 'wheelColor4',
            'pollThemeColor', 'primaryThemeColor', 'secondaryThemeColor'
        ];
        colorInputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    // Manual save only - no auto-save
                });
            }
        });

        // Checkboxes - MANUAL SAVE ONLY
        const checkboxes = [
            'wheelSound', 'wheelConfetti', 'pollCaseSensitive', 'pollShowLive',
            'raceAnimation', 'raceLeaderboard', 'autoSave', 'showNotifications',
            'chatFiltering', 'duplicateEntries', 'darkMode', 'animations'
        ];
        checkboxes.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    // Manual save only - no auto-save
                });
            }
        });

        // Select dropdowns - MANUAL SAVE ONLY
        const selects = ['defaultGameMode', 'gamingTheme'];
        selects.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    // Manual save only - no auto-save
                });
            }
        });
    }

    updateRangeValue(id, value) {
        const units = {
            'wheelDuration': 'seconds',
            'wheelSpinDuration': 'seconds',
            'pollDuration': 'seconds',
            'pollMaxOptions': 'options',
            'raceDuration': 'seconds',
            'raceMaxRacers': 'racers',
            'masterVolume': '%',
            'celebrationDuration': 'seconds',
            'minUsernameLength': 'characters',
            'entryCooldown': 'seconds'
        };

        const valueElement = document.getElementById(id + 'Value');
        if (valueElement) {
            valueElement.textContent = `${value} ${units[id] || ''}`;
        }
    }

    async loadSettings() {
        try {
            const response = await fetch(`${this.API_BASE}/game-settings`);
            if (response.ok) {
                const data = await response.json();
                if (data.settings) {
                    this.settings = { ...this.getDefaultSettings(), ...data.settings };
                    this.updateUI();
                    this.showNotification('✅ Settings loaded successfully', 'success');
                }
            } else {
                console.log('No saved settings found, using defaults');
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showNotification('⚠️ Could not load saved settings, using defaults', 'info');
        }
    }

    async saveSettings() {
        this.collectSettingsFromUI();
        
        try {
            const response = await fetch(`${this.API_BASE}/game-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: this.settings })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showNotification('✅ Settings saved successfully!', 'success');
                localStorage.setItem('gameSettings', JSON.stringify(this.settings));
            } else {
                throw new Error(result.error || 'Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            // Fallback to local storage
            localStorage.setItem('gameSettings', JSON.stringify(this.settings));
            this.showNotification('⚠️ Settings saved locally (server unavailable)', 'info');
        }
    }

    collectSettingsFromUI() {
        // Lucky Wheel
        this.settings.luckyWheel.duration = parseInt(document.getElementById('wheelDuration').value);
        this.settings.luckyWheel.keyword = document.getElementById('wheelKeyword').value;
        this.settings.luckyWheel.colors = [
            document.getElementById('wheelColor1').value,
            document.getElementById('wheelColor2').value,
            document.getElementById('wheelColor3').value,
            document.getElementById('wheelColor4').value
        ];
        this.settings.luckyWheel.soundEnabled = document.getElementById('wheelSound').checked;
        this.settings.luckyWheel.confettiEnabled = document.getElementById('wheelConfetti').checked;
        this.settings.luckyWheel.spinDuration = parseInt(document.getElementById('wheelSpinDuration').value);

        // Poll Game
        this.settings.poll.duration = parseInt(document.getElementById('pollDuration').value);
        this.settings.poll.maxOptions = parseInt(document.getElementById('pollMaxOptions').value);
        this.settings.poll.caseSensitive = document.getElementById('pollCaseSensitive').checked;
        this.settings.poll.showLiveResults = document.getElementById('pollShowLive').checked;
        this.settings.poll.themeColor = document.getElementById('pollThemeColor').value;

        // Race Game
        this.settings.race.duration = parseInt(document.getElementById('raceDuration').value);
        this.settings.race.maxRacers = parseInt(document.getElementById('raceMaxRacers').value);
        this.settings.race.keyword = document.getElementById('raceKeyword').value;
        this.settings.race.animationEnabled = document.getElementById('raceAnimation').checked;
        this.settings.race.leaderboardEnabled = document.getElementById('raceLeaderboard').checked;

        // General
        this.settings.general.masterVolume = parseInt(document.getElementById('masterVolume').value);
        this.settings.general.autoSave = document.getElementById('autoSave').checked;
        this.settings.general.showNotifications = document.getElementById('showNotifications').checked;
        this.settings.general.defaultGameMode = document.getElementById('defaultGameMode').value;
        this.settings.general.celebrationDuration = parseInt(document.getElementById('celebrationDuration').value);

        // Chat Integration
        this.settings.chat.filteringEnabled = document.getElementById('chatFiltering').checked;
        this.settings.chat.minUsernameLength = parseInt(document.getElementById('minUsernameLength').value);
        this.settings.chat.allowDuplicateEntries = document.getElementById('duplicateEntries').checked;
        this.settings.chat.entryCooldown = parseInt(document.getElementById('entryCooldown').value);

        // Theme
        this.settings.theme.gamingTheme = document.getElementById('gamingTheme').value;
        this.settings.theme.primaryColor = document.getElementById('primaryThemeColor').value;
        this.settings.theme.secondaryColor = document.getElementById('secondaryThemeColor').value;
        this.settings.theme.darkMode = document.getElementById('darkMode').checked;
        this.settings.theme.animationsEnabled = document.getElementById('animations').checked;
    }

    updateUI() {
        // Lucky Wheel
        document.getElementById('wheelDuration').value = this.settings.luckyWheel.duration;
        document.getElementById('wheelKeyword').value = this.settings.luckyWheel.keyword;
        document.getElementById('wheelColor1').value = this.settings.luckyWheel.colors[0];
        document.getElementById('wheelColor2').value = this.settings.luckyWheel.colors[1];
        document.getElementById('wheelColor3').value = this.settings.luckyWheel.colors[2];
        document.getElementById('wheelColor4').value = this.settings.luckyWheel.colors[3];
        document.getElementById('wheelSound').checked = this.settings.luckyWheel.soundEnabled;
        document.getElementById('wheelConfetti').checked = this.settings.luckyWheel.confettiEnabled;
        document.getElementById('wheelSpinDuration').value = this.settings.luckyWheel.spinDuration;

        // Poll Game
        document.getElementById('pollDuration').value = this.settings.poll.duration;
        document.getElementById('pollMaxOptions').value = this.settings.poll.maxOptions;
        document.getElementById('pollCaseSensitive').checked = this.settings.poll.caseSensitive;
        document.getElementById('pollShowLive').checked = this.settings.poll.showLiveResults;
        document.getElementById('pollThemeColor').value = this.settings.poll.themeColor;

        // Race Game
        document.getElementById('raceDuration').value = this.settings.race.duration;
        document.getElementById('raceMaxRacers').value = this.settings.race.maxRacers;
        document.getElementById('raceKeyword').value = this.settings.race.keyword;
        document.getElementById('raceAnimation').checked = this.settings.race.animationEnabled;
        document.getElementById('raceLeaderboard').checked = this.settings.race.leaderboardEnabled;

        // General
        document.getElementById('masterVolume').value = this.settings.general.masterVolume;
        document.getElementById('autoSave').checked = this.settings.general.autoSave;
        document.getElementById('showNotifications').checked = this.settings.general.showNotifications;
        document.getElementById('defaultGameMode').value = this.settings.general.defaultGameMode;
        document.getElementById('celebrationDuration').value = this.settings.general.celebrationDuration;

        // Chat Integration
        document.getElementById('chatFiltering').checked = this.settings.chat.filteringEnabled;
        document.getElementById('minUsernameLength').value = this.settings.chat.minUsernameLength;
        document.getElementById('duplicateEntries').checked = this.settings.chat.allowDuplicateEntries;
        document.getElementById('entryCooldown').value = this.settings.chat.entryCooldown;

        // Theme
        document.getElementById('gamingTheme').value = this.settings.theme.gamingTheme;
        document.getElementById('primaryThemeColor').value = this.settings.theme.primaryColor;
        document.getElementById('secondaryThemeColor').value = this.settings.theme.secondaryColor;
        document.getElementById('darkMode').checked = this.settings.theme.darkMode;
        document.getElementById('animations').checked = this.settings.theme.animationsEnabled;

        // Update range value displays
        this.updateRangeValue('wheelDuration', this.settings.luckyWheel.duration);
        this.updateRangeValue('wheelSpinDuration', this.settings.luckyWheel.spinDuration);
        this.updateRangeValue('pollDuration', this.settings.poll.duration);
        this.updateRangeValue('pollMaxOptions', this.settings.poll.maxOptions);
        this.updateRangeValue('raceDuration', this.settings.race.duration);
        this.updateRangeValue('raceMaxRacers', this.settings.race.maxRacers);
        this.updateRangeValue('masterVolume', this.settings.general.masterVolume);
        this.updateRangeValue('celebrationDuration', this.settings.general.celebrationDuration);
        this.updateRangeValue('minUsernameLength', this.settings.chat.minUsernameLength);
        this.updateRangeValue('entryCooldown', this.settings.chat.entryCooldown);
    }

    loadDefaultSettings() {
        if (confirm('Are you sure you want to reset all settings to default values?')) {
            this.settings = this.getDefaultSettings();
            this.updateUI();
            this.saveSettings();
            this.showNotification('🔄 Settings reset to defaults', 'info');
        }
    }

    exportSettings() {
        const dataStr = JSON.stringify(this.settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `game-settings-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        this.showNotification('📤 Settings exported successfully', 'success');
    }

    importSettings() {
        document.getElementById('importFile').click();
    }

    handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedSettings = JSON.parse(e.target.result);
                
                // Validate settings structure
                if (this.validateSettings(importedSettings)) {
                    this.settings = { ...this.getDefaultSettings(), ...importedSettings };
                    this.updateUI();
                    this.saveSettings();
                    this.showNotification('📥 Settings imported successfully', 'success');
                } else {
                    throw new Error('Invalid settings file format');
                }
            } catch (error) {
                console.error('Error importing settings:', error);
                this.showNotification('❌ Failed to import settings: Invalid file format', 'error');
            }
        };
        reader.readAsText(file);
        
        // Reset file input
        event.target.value = '';
    }

    validateSettings(settings) {
        // Basic validation of settings structure
        const requiredSections = ['luckyWheel', 'poll', 'race', 'general', 'chat', 'theme'];
        return requiredSections.every(section => settings.hasOwnProperty(section));
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    // Public API for other components to access settings
    getSettings() {
        return this.settings;
    }

    getSetting(category, key) {
        return this.settings[category] && this.settings[category][key];
    }
}

// Global functions for HTML event handlers
function saveSettings() {
    gameSettings.saveSettings();
}

function loadDefaultSettings() {
    gameSettings.loadDefaultSettings();
}

function exportSettings() {
    gameSettings.exportSettings();
}

function importSettings() {
    gameSettings.importSettings();
}

function handleFileImport(event) {
    gameSettings.handleFileImport(event);
}

// Initialize when DOM is loaded
let gameSettings;
document.addEventListener('DOMContentLoaded', () => {
    gameSettings = new GameSettings();
    
    // Make settings globally available
    window.gameSettings = gameSettings;
});
