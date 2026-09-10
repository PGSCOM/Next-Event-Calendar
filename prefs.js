import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_BOXES = ['left', 'center', 'right'];

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

        // --- Panel group ---
        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('Configure position in the top bar'),
        });
        page.add(panelGroup);

        const boxRow = new Adw.ComboRow({
            title: _('Panel position'),
            subtitle: _('Which section of the top panel'),
            model: Gtk.StringList.new([_('Left'), _('Center'), _('Right')]),
        });
        const currentBox = settings.get_string('panel-box');
        boxRow.set_selected(Math.max(0, PANEL_BOXES.indexOf(currentBox)));
        boxRow.connect('notify::selected', row => {
            settings.set_string('panel-box', PANEL_BOXES[row.get_selected()]);
        });
        panelGroup.add(boxRow);

        const orderRow = new Adw.SpinRow({
            title: _('Position order'),
            subtitle: _('Index within the selected panel section'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        settings.bind('panel-order', orderRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelGroup.add(orderRow);

        // --- Appearance group ---
        const appGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
        });
        page.add(appGroup);

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
        appGroup.add(maxLenRow);

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
        appGroup.add(refreshRow);
    }
}
