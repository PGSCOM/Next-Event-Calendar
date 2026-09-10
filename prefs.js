import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_POSITIONS = ['far-left', 'left', 'clock-left', 'clock-right', 'right', 'far-right'];
const TIME_MODES = ['absolute', 'relative', 'smart'];
const EMPHASIS_MODES = ['urgency', 'always'];

// Preset name -> the full set of detail keys it writes. Both presets pin every
// key (even the ones a mode ignores) so _matchPreset can compare exactly.
const PRESET_NAMES = ['simple', 'prominent'];
const PRESETS = {
    simple: {
        'time-display': 'absolute', 'text-hierarchy': false, 'accent-time': false,
        'tonal-surface': false, 'emphasis-mode': 'urgency',
        'soon-minutes': 15, 'imminent-minutes': 5, 'show-ongoing': false,
    },
    prominent: {
        'time-display': 'smart', 'text-hierarchy': true, 'accent-time': true,
        'tonal-surface': true, 'emphasis-mode': 'urgency',
        'soon-minutes': 15, 'imminent-minutes': 5, 'show-ongoing': true,
    },
};
const PRESET_KEYS = Object.keys(PRESETS.simple);
const PRESET_CUSTOM = PRESET_NAMES.length; // combo index for "Custom"

// ponytail: gdbus text-scrape síncrono; pasar a Gio.DBus async + deep_unpack
// si el diálogo de preferencias llega a colgarse o si "Sources5" sube de versión.
function fetchCalendarSources() {
    try {
        const proc = Gio.Subprocess.new(
            ['gdbus', 'call', '--session',
             '--dest', 'org.gnome.evolution.dataserver.Sources5',
             '--object-path', '/org/gnome/evolution/dataserver/SourceManager',
             '--method', 'org.freedesktop.DBus.ObjectManager.GetManagedObjects'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        if (!stdout)
            return [];

        const entries = stdout.split(/(?=\/org\/gnome\/evolution\/dataserver\/SourceManager\/Source_\d+')/);
        const calendars = [];

        for (const entry of entries) {
            const uidMatch = entry.match(/'UID':\s*<'([^']*)'>/);
            if (!uidMatch)
                continue;
            const uid = uidMatch[1];

            const dataMatch = entry.match(/'Data':\s*<'(.*?)'>/s);
            if (!dataMatch)
                continue;
            const data = dataMatch[1];

            if (!data.includes('[Calendar]'))
                continue;

            const lines = data.split('\\n');

            let displayName = uid;
            for (const line of lines) {
                const eqIdx = line.indexOf('=');
                if (eqIdx === -1)
                    continue;
                const key = line.substring(0, eqIdx);
                const val = line.substring(eqIdx + 1);
                if (key === 'displayName' || key === 'DisplayName') {
                    if (!key.includes('['))
                        displayName = val;
                }
            }

            let color = '#ffffff';
            let inCalendar = false;
            for (const line of lines) {
                const stripped = line.trim();
                if (stripped === '[Calendar]')
                    inCalendar = true;
                else if (stripped.startsWith('['))
                    inCalendar = false;
                else if (inCalendar && line.startsWith('Color='))
                    color = line.substring(6);
            }

            let backend = '';
            for (const line of lines) {
                if (line.startsWith('BackendName='))
                    backend = line.substring(12);
            }

            calendars.push({uid, name: displayName, color, backend});
        }

        return calendars;
    } catch (e) {
        console.error(`[NextEventCalendar] Failed to fetch calendars: ${e.message}`);
        return [];
    }
}

export default class NextEventCalendarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const calendars = fetchCalendarSources();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // --- Calendar group ---
        const calGroup = new Adw.PreferencesGroup({
            title: _('Calendar'),
            description: _('Choose which calendar to display events from'),
        });
        page.add(calGroup);

        const calLabels = [_('All Calendars'), ...calendars.map(c => c.name)];
        const calModel = Gtk.StringList.new(calLabels);

        const calRow = new Adw.ComboRow({
            title: _('Calendar source'),
            subtitle: _('Show events from this calendar only'),
            model: calModel,
        });

        const currentCalUid = settings.get_string('calendar-uid');
        let calSelected = 0;
        if (currentCalUid !== 'ALL') {
            const idx = calendars.findIndex(c => c.uid === currentCalUid);
            if (idx >= 0)
                calSelected = idx + 1;
        }
        calRow.set_selected(calSelected);

        calRow.connect('notify::selected', row => {
            const idx = row.get_selected();
            if (idx === 0)
                settings.set_string('calendar-uid', 'ALL');
            else
                settings.set_string('calendar-uid', calendars[idx - 1].uid);
        });
        calGroup.add(calRow);

        const ongoingRow = new Adw.SwitchRow({
            title: _('Show ongoing event'),
            subtitle: _('Keep showing an event while it is in progress instead of moving on'),
        });
        settings.bind('show-ongoing', ongoingRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        calGroup.add(ongoingRow);

        // --- Panel group ---
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('Where the indicator sits in the top bar'),
        });
        page.add(panelGroup);

        const posRow = new Adw.ComboRow({
            title: _('Panel position'),
            subtitle: _('Anchored to real panel elements, not a raw index'),
            model: Gtk.StringList.new([
                _('Far left'),
                _('Left'),
                _('Left of the clock'),
                _('Right of the clock'),
                _('Right'),
                _('Far right'),
            ]),
        });
        posRow.set_selected(Math.max(0, PANEL_POSITIONS.indexOf(settings.get_string('panel-position'))));
        posRow.connect('notify::selected', row => {
            settings.set_string('panel-position', PANEL_POSITIONS[row.get_selected()]);
        });
        panelGroup.add(posRow);

        // --- Update group ---
        const updateGroup = new Adw.PreferencesGroup({
            title: _('Updating'),
        });
        page.add(updateGroup);

        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
            subtitle: _('How often to check for upcoming events'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 900,
                step_increment: 5,
                page_increment: 30,
            }),
        });
        settings.bind('refresh-interval-seconds', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        updateGroup.add(refreshRow);

        this._fillAppearancePage(window, settings);
    }

    _fillAppearancePage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-appearance-symbolic',
        });
        window.add(page);

        // enum ComboRow bound to a string key (settings.bind can't do enums)
        const comboEnum = (title, subtitle, key, values, labels) => {
            const row = new Adw.ComboRow({
                title, subtitle, model: Gtk.StringList.new(labels),
            });
            row.set_selected(Math.max(0, values.indexOf(settings.get_string(key))));
            row.connect('notify::selected', r => settings.set_string(key, values[r.get_selected()]));
            return row;
        };

        // --- Preset group ---
        const presetGroup = new Adw.PreferencesGroup({
            title: _('Preset'),
            description: _('A quiet default, a bold configured look, or your own mix'),
        });
        page.add(presetGroup);

        const presetRow = new Adw.ComboRow({
            title: _('Style preset'),
            model: Gtk.StringList.new([_('Simple'), _('Prominent'), _('Custom')]),
        });
        const matchPreset = () => {
            for (let i = 0; i < PRESET_NAMES.length; i++) {
                const p = PRESETS[PRESET_NAMES[i]];
                const hit = PRESET_KEYS.every(k => {
                    const v = p[k];
                    if (typeof v === 'boolean')
                        return settings.get_boolean(k) === v;
                    if (typeof v === 'number')
                        return settings.get_int(k) === v;
                    return settings.get_string(k) === v;
                });
                if (hit)
                    return i;
            }
            return PRESET_CUSTOM;
        };
        presetRow.set_selected(matchPreset());
        presetRow.connect('notify::selected', row => {
            const idx = row.get_selected();
            if (idx >= PRESET_CUSTOM)
                return;
            const p = PRESETS[PRESET_NAMES[idx]];
            for (const k of PRESET_KEYS) {
                const v = p[k];
                if (typeof v === 'boolean')
                    settings.set_boolean(k, v);
                else if (typeof v === 'number')
                    settings.set_int(k, v);
                else
                    settings.set_string(k, v);
            }
        });
        presetGroup.add(presetRow);

        // Any detail change re-derives which preset (or Custom) is shown.
        const watched = new Set(PRESET_KEYS);
        const syncId = settings.connect('changed', (_s, key) => {
            if (!watched.has(key))
                return;
            const want = matchPreset();
            if (presetRow.get_selected() !== want)
                presetRow.set_selected(want);
        });
        window.connect('close-request', () => settings.disconnect(syncId));

        // --- Text group ---
        const textGroup = new Adw.PreferencesGroup({
            title: _('Text'),
        });
        page.add(textGroup);

        textGroup.add(comboEnum(
            _('Time display'),
            _('Absolute time, a relative countdown, or the countdown only when near'),
            'time-display', TIME_MODES,
            [_('Absolute'), _('Countdown'), _('Smart')]));

        const hierarchyRow = new Adw.SwitchRow({
            title: _('Typographic hierarchy'),
            subtitle: _('Bold time with a dimmed title, instead of one flat string'),
        });
        settings.bind('text-hierarchy', hierarchyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        textGroup.add(hierarchyRow);

        const maxLenRow = new Adw.SpinRow({
            title: _('Max title length'),
            subtitle: _('Truncate event titles longer than this'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 120,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('max-title-length', maxLenRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        textGroup.add(maxLenRow);

        // --- Emphasis group ---
        const emphasisGroup = new Adw.PreferencesGroup({
            title: _('Emphasis'),
            description: _('How the widget gains presence as the event approaches'),
        });
        page.add(emphasisGroup);

        const accentRow = new Adw.SwitchRow({
            title: _('Accent-coloured time'),
            subtitle: _('Tint the time with the system accent colour once the event is near'),
        });
        settings.bind('accent-time', accentRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        emphasisGroup.add(accentRow);

        const surfaceRow = new Adw.SwitchRow({
            title: _('Tonal surface'),
            subtitle: _('A faint tinted surface behind the widget once the event is imminent'),
        });
        settings.bind('tonal-surface', surfaceRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        emphasisGroup.add(surfaceRow);

        emphasisGroup.add(comboEnum(
            _('When'),
            _('Scale the emphasis as the event nears, or apply it constantly'),
            'emphasis-mode', EMPHASIS_MODES,
            [_('As the event nears'), _('Always')]));

        const thresholds = new Adw.ExpanderRow({
            title: _('Thresholds'),
            subtitle: _('When an event counts as soon and as imminent'),
        });
        emphasisGroup.add(thresholds);

        const soonRow = new Adw.SpinRow({
            title: _('Soon (minutes)'),
            subtitle: _('Switches to the countdown and, if enabled, the accent colour'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 240, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('soon-minutes', soonRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholds.add_row(soonRow);

        const imminentRow = new Adw.SpinRow({
            title: _('Imminent (minutes)'),
            subtitle: _('Brings up the tonal surface, if enabled'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 120, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('imminent-minutes', imminentRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholds.add_row(imminentRow);
    }
}
