import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create preference page
        const page = new Adw.PreferencesPage({
            title: 'Claude Usage',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Credentials group
        const credentialsGroup = new Adw.PreferencesGroup({
            title: 'API Credentials',
            description: 'Enter your Claude session credentials. You can find these in your browser cookies after logging into claude.ai',
        });
        page.add(credentialsGroup);

        // Session Key entry
        const sessionKeyRow = new Adw.EntryRow({
            title: 'Session Key',
            text: settings.get_string('session-key'),
        });
        sessionKeyRow.connect('changed', () => {
            settings.set_string('session-key', sessionKeyRow.get_text());
        });
        credentialsGroup.add(sessionKeyRow);

        // Organization ID entry
        const orgIdRow = new Adw.EntryRow({
            title: 'Organization ID',
            text: settings.get_string('organization-id'),
        });
        orgIdRow.connect('changed', () => {
            settings.set_string('organization-id', orgIdRow.get_text());
        });
        credentialsGroup.add(orgIdRow);

        // Settings group
        const settingsGroup = new Adw.PreferencesGroup({
            title: 'Settings',
        });
        page.add(settingsGroup);

        // Update interval spinner
        const updateIntervalRow = new Adw.SpinRow({
            title: 'Update Interval',
            subtitle: 'How often to fetch usage data (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('update-interval'),
            }),
        });
        updateIntervalRow.connect('notify::value', () => {
            settings.set_int('update-interval', updateIntervalRow.get_value());
        });
        settingsGroup.add(updateIntervalRow);

        // Instructions group
        const instructionsGroup = new Adw.PreferencesGroup({
            title: 'How to get credentials',
        });
        page.add(instructionsGroup);

        const instructionsRow = new Adw.ActionRow({
            title: 'Instructions',
            subtitle: '1. Log into claude.ai in your browser\n2. Open Developer Tools (F12)\n3. Go to Application > Cookies > claude.ai\n4. Copy the "sessionKey" value\n5. Go to Network tab, find a request to claude.ai/api\n6. Look for organization ID in the URL or response',
        });
        instructionsRow.set_activatable(false);
        instructionsGroup.add(instructionsRow);
    }
}
