import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export function readOAuthToken() {
    const configDir = GLib.getenv('CLAUDE_CONFIG_DIR') ??
        GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    const credentialsPath = GLib.build_filenamev([configDir, '.credentials.json']);
    try {
        const file = Gio.File.new_for_path(credentialsPath);
        const [, contents] = file.load_contents(null);
        const json = JSON.parse(new TextDecoder('utf-8').decode(contents));
        return json.claudeAiOauth?.accessToken ?? null;
    } catch (_e) {
        return null;
    }
}
