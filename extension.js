import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_UPDATE_INTERVAL = 10; // 10 minutes (stored as minutes in settings)
const COUNTDOWN_INTERVAL = 1; // 1 second
const SESSION_STATE_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'session-state.json']);
const DEBUG = false; // Set to true to log API responses

const ClaudeUsageIndicator = GObject.registerClass(
class ClaudeUsageIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Claude Usage');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._usageData = null;
        this._sessionState = null;
        this._updateTimeoutId = null;
        this._countdownTimeoutId = null;
        this._fileMonitor = null;
        this._lastUpdated = null;
        this._lastError = null;

        // Create main box for the panel
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box claude-usage-box',
        });
        this.add_child(this._box);

        // Status label (single word: Thinking, Running, Ready, or empty)
        this._statusLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-status',
            style: 'font-size: 11px; margin-right: 8px;',
        });
        this._box.add_child(this._statusLabel);

        // Session usage display
        this._sessionLabel = new St.Label({
            text: 'S: --%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-session-usage',
            style: 'font-size: 11px; margin-right: 8px;',
        });
        this._box.add_child(this._sessionLabel);

        // Weekly usage display
        this._weeklyLabel = new St.Label({
            text: 'W: --%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-weekly-usage',
            style: 'font-size: 11px; margin-right: 8px;',
        });
        this._box.add_child(this._weeklyLabel);

        // Time remaining display
        this._timeLabel = new St.Label({
            text: '--:--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-time-remaining',
            style: 'font-size: 11px;',
        });
        this._box.add_child(this._timeLabel);

        // Build popup menu
        this._buildMenu();

        // HTTP session
        this._session = new Soup.Session();

        // Setup monitoring and load initial state
        this._setupSessionStateMonitor();
        this._loadSessionState();
        this._startUpdateLoop();

        // Fetch usage data if there's already an active session
        if (this._hasActiveSession()) {
            this._fetchUsageData();
        }
    }

    _buildMenu() {
        // Claude Code session section
        this._sessionStatusItem = new PopupMenu.PopupMenuItem('Claude Code: Inactive');
        this._sessionStatusItem.setSensitive(false);
        this.menu.addMenuItem(this._sessionStatusItem);

        this._sessionDurationItem = new PopupMenu.PopupMenuItem('Session: --');
        this._sessionDurationItem.setSensitive(false);
        this.menu.addMenuItem(this._sessionDurationItem);

        this._lastToolItem = new PopupMenu.PopupMenuItem('Last: --');
        this._lastToolItem.setSensitive(false);
        this.menu.addMenuItem(this._lastToolItem);

        this._contextSizeItem = new PopupMenu.PopupMenuItem('Context: --');
        this._contextSizeItem.setSensitive(false);
        this.menu.addMenuItem(this._contextSizeItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Recent commands submenu
        this._recentCommandsMenu = new PopupMenu.PopupSubMenuMenuItem('Recent Commands');
        this.menu.addMenuItem(this._recentCommandsMenu);

        // All sessions submenu
        this._allSessionsMenu = new PopupMenu.PopupSubMenuMenuItem('All Sessions');
        this.menu.addMenuItem(this._allSessionsMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // API Usage section header
        const usageHeader = new PopupMenu.PopupMenuItem('API Usage');
        usageHeader.setSensitive(false);
        usageHeader.label.add_style_class_name('popup-subtitle-menu-item');
        this.menu.addMenuItem(usageHeader);

        // Session details
        this._apiSessionMenuItem = new PopupMenu.PopupMenuItem('Session: --% (resets in --)');
        this._apiSessionMenuItem.setSensitive(false);
        this.menu.addMenuItem(this._apiSessionMenuItem);

        // Weekly details
        this._weeklyMenuItem = new PopupMenu.PopupMenuItem('Weekly: --% (resets in --)');
        this._weeklyMenuItem.setSensitive(false);
        this.menu.addMenuItem(this._weeklyMenuItem);

        // Last updated
        this._lastUpdatedMenuItem = new PopupMenu.PopupMenuItem('Last updated: --');
        this._lastUpdatedMenuItem.setSensitive(false);
        this.menu.addMenuItem(this._lastUpdatedMenuItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button (doesn't close menu)
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        refreshItem.activate = (_event) => {
            this._fetchUsageData(true); // Force refresh even without active session
            this._loadSessionState();
            // Don't call parent activate, which would close the menu
        };
        this.menu.addMenuItem(refreshItem);

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _setupSessionStateMonitor() {
        try {
            const file = Gio.File.new_for_path(SESSION_STATE_PATH);
            const parent = file.get_parent();

            // Ensure directory exists
            if (!parent.query_exists(null)) {
                return;
            }

            // Monitor the file for changes
            this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', (monitor, file, otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CREATED) {
                    this._loadSessionState();
                }
            });
        } catch (e) {
            console.error('Claude Usage: Failed to setup session state monitor', e);
        }
    }

    _loadSessionState() {
        try {
            const file = Gio.File.new_for_path(SESSION_STATE_PATH);
            if (!file.query_exists(null)) {
                this._sessionState = null;
                this._updateSessionDisplay();
                return;
            }

            const hadActiveSession = this._hasActiveSession();
            const [success, contents] = file.load_contents(null);
            if (success) {
                const decoder = new TextDecoder('utf-8');
                this._sessionState = JSON.parse(decoder.decode(contents));
                this._updateSessionDisplay();

                // Fetch usage data when a session becomes active
                if (!hadActiveSession && this._hasActiveSession()) {
                    this._fetchUsageData();
                }
            }
        } catch (e) {
            console.error('Claude Usage: Failed to load session state', e);
            this._sessionState = null;
            this._updateSessionDisplay();
        }
    }

    _updateSessionDisplay() {
        if (!this._sessionState || !this._sessionState.active_session) {
            // No active session
            this._statusLabel.set_text('');
            this._sessionStatusItem.label.set_text('Claude Code: Inactive');
            this._sessionDurationItem.label.set_text('Session: --');
            this._lastToolItem.label.set_text('Last: --');
            this._contextSizeItem.label.set_text('Context: --');
            return;
        }

        const activeSession = this._sessionState.sessions[this._sessionState.active_session];
        if (!activeSession) {
            this._statusLabel.set_text('');
            return;
        }

        const status = activeSession.status || 'idle';

        // Single-word status for the panel
        let statusText = '';

        switch (status) {
            case 'thinking':
                statusText = 'Thinking';
                break;
            case 'running_tool':
                statusText = 'Running';
                break;
            case 'active':
            case 'idle':
                statusText = 'Ready';
                break;
            case 'ended':
                statusText = '';
                break;
            default:
                statusText = '';
        }

        this._statusLabel.set_text(statusText);

        // Update menu items
        this._sessionStatusItem.label.set_text(`Claude Code: ${this._capitalizeFirst(status)}`);

        // Show last completed tool from recent_commands
        const recentCommands = activeSession.recent_commands || [];
        let lastToolText = '--';
        if (recentCommands.length > 0) {
            const lastCmd = recentCommands[0];
            lastToolText = lastCmd.description || lastCmd.tool;
            if (lastCmd.duration_ms !== undefined) {
                lastToolText += ` (${this._formatMs(lastCmd.duration_ms)})`;
            }
        }
        this._lastToolItem.label.set_text(`Last: ${lastToolText}`);

        // Session duration
        if (activeSession.started_at) {
            const duration = this._formatDuration(activeSession.started_at);
            this._sessionDurationItem.label.set_text(`Session: ${duration}`);
        }

        // Context size
        if (activeSession.context && activeSession.context.estimated_tokens) {
            const tokens = activeSession.context.estimated_tokens;
            const msgs = activeSession.context.message_count || 0;
            this._contextSizeItem.label.set_text(
                `Context: ~${this._formatTokens(tokens)} tokens (${msgs} msgs)`
            );
        } else {
            this._contextSizeItem.label.set_text('Context: --');
        }

        // Update recent commands
        this._recentCommandsMenu.menu.removeAll();

        if (recentCommands.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No recent commands');
            emptyItem.setSensitive(false);
            this._recentCommandsMenu.menu.addMenuItem(emptyItem);
        } else {
            for (const cmd of recentCommands.slice(0, 5)) {
                let label = cmd.description || cmd.tool;
                if (cmd.duration_ms !== undefined) {
                    label += ` (${this._formatMs(cmd.duration_ms)})`;
                }
                const item = new PopupMenu.PopupMenuItem(label);
                item.setSensitive(false);
                this._recentCommandsMenu.menu.addMenuItem(item);
            }
        }

        // Update all sessions submenu
        this._updateAllSessionsMenu();
    }

    _updateAllSessionsMenu() {
        this._allSessionsMenu.menu.removeAll();

        if (!this._sessionState || !this._sessionState.sessions) {
            const emptyItem = new PopupMenu.PopupMenuItem('No sessions');
            emptyItem.setSensitive(false);
            this._allSessionsMenu.menu.addMenuItem(emptyItem);
            return;
        }

        const sessions = this._sessionState.sessions;
        const sessionIds = Object.keys(sessions);
        const activeId = this._sessionState.active_session;

        if (sessionIds.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No sessions');
            emptyItem.setSensitive(false);
            this._allSessionsMenu.menu.addMenuItem(emptyItem);
            return;
        }

        // Sort by last activity, most recent first
        sessionIds.sort((a, b) => {
            const aTime = sessions[a].last_activity || sessions[a].started_at || '';
            const bTime = sessions[b].last_activity || sessions[b].started_at || '';
            return bTime.localeCompare(aTime);
        });

        for (const sessionId of sessionIds) {
            const session = sessions[sessionId];
            const isActive = sessionId === activeId;
            const status = session.status || 'unknown';
            const shortId = sessionId.substring(0, 8);

            // Build session label
            let label = isActive ? `● ${shortId}` : `  ${shortId}`;
            label += ` - ${this._capitalizeFirst(status)}`;

            // Add working directory if available
            if (session.cwd) {
                const cwdName = session.cwd.split('/').pop() || session.cwd;
                label += ` (${cwdName})`;
            }

            // Add duration
            if (session.started_at) {
                label += ` - ${this._formatDuration(session.started_at)}`;
            }

            const item = new PopupMenu.PopupMenuItem(label);
            item.setSensitive(false);
            this._allSessionsMenu.menu.addMenuItem(item);
        }

        // Show count in submenu header
        const activeCount = sessionIds.filter(id =>
            sessions[id].status && sessions[id].status !== 'ended'
        ).length;
        this._allSessionsMenu.label.set_text(`All Sessions (${activeCount} active)`);
    }

    _capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
    }

    _formatDuration(isoDate) {
        try {
            const start = new Date(isoDate);
            const now = new Date();
            const diffMs = now - start;

            const minutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(minutes / 60);

            if (hours > 0) {
                return `${hours}h ${minutes % 60}m`;
            } else {
                return `${minutes}m`;
            }
        } catch (e) {
            return '--';
        }
    }

    _formatMs(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
        }
    }

    _formatTokens(tokens) {
        if (tokens === undefined || tokens === null) return '--';
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(1)}M`;
        } else if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}k`;
        }
        return tokens.toString();
    }

    _startUpdateLoop() {
        // Fetch data based on configurable interval (stored in minutes)
        const intervalMinutes = this._settings.get_int('update-interval') || DEFAULT_UPDATE_INTERVAL;
        this._updateTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalMinutes * 60,
            () => {
                this._fetchUsageData();
                return GLib.SOURCE_CONTINUE;
            }
        );

        // Update countdown and session display every second
        this._countdownTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            COUNTDOWN_INTERVAL,
            () => {
                this._updateDisplay();
                this._updateSessionDisplay();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _hasActiveSession() {
        if (!this._sessionState || !this._sessionState.active_session) {
            return false;
        }
        const activeSession = this._sessionState.sessions?.[this._sessionState.active_session];
        return activeSession && activeSession.status !== 'ended';
    }

    _fetchUsageData(forceRefresh = false) {
        // Only fetch automatically if there's an active Claude Code session
        // Manual refresh (forceRefresh=true) bypasses this check
        if (!forceRefresh && !this._hasActiveSession()) {
            return;
        }

        const sessionKey = this._settings.get_string('session-key');
        const orgId = this._settings.get_string('organization-id');

        if (!sessionKey || !orgId) {
            this._sessionLabel.set_text('S: N/A');
            this._weeklyLabel.set_text('W: N/A');
            this._timeLabel.set_text('Login');
            return;
        }

        const url = `https://claude.ai/api/organizations/${orgId}/usage`;
        const message = Soup.Message.new('GET', url);

        message.request_headers.append('Cookie', `sessionKey=${sessionKey}`);
        message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) GNOME Shell Extension');

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);

                    if (message.status_code !== 200) {
                        const errorMsg = `HTTP ${message.status_code}`;
                        console.error(`Claude Usage: ${errorMsg}`);
                        this._setError(errorMsg);
                        return;
                    }

                    const decoder = new TextDecoder('utf-8');
                    const text = decoder.decode(bytes.get_data());
                    this._usageData = JSON.parse(text);
                    if (DEBUG) {
                        console.log('Claude Usage API response:', text);
                    }
                    this._lastUpdated = new Date();
                    this._lastError = null;
                    this._updateDisplay();
                } catch (e) {
                    const errorMsg = e.message || 'Unknown error';
                    console.error('Claude Usage: Failed to fetch data', e);
                    this._setError(errorMsg);
                }
            }
        );
    }

    _setError(errorMsg) {
        this._lastError = errorMsg || 'Unknown error';
        this._sessionLabel.set_text('S: ERR');
        this._weeklyLabel.set_text('W: ERR');
        this._timeLabel.set_text('--:--');
        this._lastUpdatedMenuItem.label.set_text(`Error: ${this._lastError}`);
    }

    _updateDisplay() {
        if (!this._usageData) return;

        const sessionUtil = this._usageData.five_hour?.utilization ?? 0;
        const weeklyUtil = this._usageData.seven_day?.utilization ?? 0;
        const sessionResets = this._usageData.five_hour?.resets_at;
        const weeklyResets = this._usageData.seven_day?.resets_at;

        // Update panel labels
        this._sessionLabel.set_text(`S: ${Math.round(sessionUtil)}%`);
        this._weeklyLabel.set_text(`W: ${Math.round(weeklyUtil)}%`);

        // Color coding based on usage
        this._sessionLabel.remove_style_class_name('warning');
        this._sessionLabel.remove_style_class_name('danger');
        this._weeklyLabel.remove_style_class_name('warning');
        this._weeklyLabel.remove_style_class_name('danger');

        if (sessionUtil >= 90) {
            this._sessionLabel.add_style_class_name('danger');
        } else if (sessionUtil >= 75) {
            this._sessionLabel.add_style_class_name('warning');
        }

        if (weeklyUtil >= 90) {
            this._weeklyLabel.add_style_class_name('danger');
        } else if (weeklyUtil >= 75) {
            this._weeklyLabel.add_style_class_name('warning');
        }

        // Show time until session reset (shorter window = more urgent)
        const sessionTime = this._formatTimeRemaining(sessionResets);
        this._timeLabel.set_text(sessionTime);

        // Update menu items
        this._apiSessionMenuItem.label.set_text(
            `Session: ${Math.round(sessionUtil)}% (resets in ${sessionTime})`
        );
        this._weeklyMenuItem.label.set_text(
            `Weekly: ${Math.round(weeklyUtil)}% (resets in ${this._formatTimeRemaining(weeklyResets)})`
        );

        // Update last updated timestamp
        if (this._lastUpdated) {
            const now = new Date();
            const diffMs = now - this._lastUpdated;
            const diffMins = Math.floor(diffMs / (1000 * 60));

            let updatedText;
            if (diffMins < 1) {
                updatedText = 'just now';
            } else if (diffMins === 1) {
                updatedText = '1 minute ago';
            } else if (diffMins < 60) {
                updatedText = `${diffMins} minutes ago`;
            } else {
                const hours = Math.floor(diffMins / 60);
                updatedText = hours === 1 ? '1 hour ago' : `${hours} hours ago`;
            }
            this._lastUpdatedMenuItem.label.set_text(`Last updated: ${updatedText}`);
        }
    }

    _formatTimeRemaining(isoDate) {
        if (!isoDate) return '--:--';

        const resetDate = new Date(isoDate);
        const now = new Date();
        const diff = resetDate - now;

        if (diff <= 0) return 'Now';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `${days}d ${remainingHours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    destroy() {
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = null;
        }
        if (this._countdownTimeoutId) {
            GLib.source_remove(this._countdownTimeoutId);
            this._countdownTimeoutId = null;
        }
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new ClaudeUsageIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
