import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const MIN_REFRESH = 10;
const MAX_TITLE_DEFAULT = 35;
const REFRESH_DEFAULT = 60;
const REBUILD_DELAY = 500;

// position -> [panel box, index]. -1 means append. The two clock-* values land
// in the center box and are then reordered relative to the clock (dateMenu).
const PANEL_POSITIONS = {
    'far-left': ['left', 0],
    'left': ['left', -1],
    'clock-left': ['center', 0],
    'clock-right': ['center', 0],
    'right': ['right', 0],
    'far-right': ['right', -1],
};

export default class NextEventCalendarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsIds = [];
        this._timerId = null;
        this._rebuildId = null;
        this._refreshId = null;
        this._eventSource = null;
        this._changedId = null;
        this._label = null;
        this._indicator = null;

        this._timeLabel = null;
        this._sepLabel = null;
        this._titleLabel = null;

        this._createIndicator();
        this._createEventSource();
        this._startTimer();
        this._connectSettings();
        this._requestRefresh();
    }

    disable() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = null;
        }

        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = null;
        }

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        this._disconnectEventSource();

        if (this._settings) {
            for (const id of this._settingsIds)
                this._settings.disconnect(id);
            this._settingsIds = [];
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._timeLabel = null;
        this._sepLabel = null;
        this._titleLabel = null;
        this._settings = null;
    }

    // --- Indicator -----------------------------------------------------------

    _createIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        const position = this._settings?.get_string('panel-position') ?? 'right';
        const [box, index] = PANEL_POSITIONS[position] ?? PANEL_POSITIONS['right'];

        this._indicator = new PanelMenu.Button(0.5, this.uuid, false);

        const mkLabel = styleClass => new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: styleClass,
        });
        this._timeLabel = mkLabel('nec-time');
        this._sepLabel = mkLabel('nec-sep');
        this._sepLabel.set_text('·');
        this._titleLabel = mkLabel('nec-title');

        const hbox = new St.BoxLayout({
            style_class: 'next-event-calendar-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        hbox.add_child(this._timeLabel);
        hbox.add_child(this._sepLabel);
        hbox.add_child(this._titleLabel);
        this._indicator.add_child(hbox);

        try {
            Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);

            if (position === 'clock-left' || position === 'clock-right') {
                const clock = Main.panel.statusArea.dateMenu?.container;
                const parent = this._indicator.container.get_parent();
                if (clock && parent) {
                    if (position === 'clock-left')
                        parent.set_child_below_sibling(this._indicator.container, clock);
                    else
                        parent.set_child_above_sibling(this._indicator.container, clock);
                }
            }
        } catch (e) {
            console.error(`[${this.uuid}] Failed to add indicator at '${position}': ${e.message}`);
            this._indicator?.destroy();
            this._indicator = null;
            this._timeLabel = null;
            this._sepLabel = null;
            this._titleLabel = null;
            return;
        }

        if (this._indicator?.menu) {
            this._indicator.menu.addAction(_('Open Calendar'), () => this._openCalendar());
        }
    }

    // state: 'nec-normal' | 'nec-soon' | 'nec-imminent' | 'nec-ongoing'
    _render(timeStr, titleStr, state) {
        if (!this._indicator || !this._timeLabel)
            return;

        const hierarchy = this._settings?.get_boolean('text-hierarchy') ?? true;
        const accent = this._settings?.get_boolean('accent-time') ?? true;
        const surface = this._settings?.get_boolean('tonal-surface') ?? true;

        this._timeLabel.set_text(timeStr);
        this._titleLabel.set_text(titleStr);
        this._sepLabel.visible = !hierarchy;

        this._indicator.set_style_class_name(
            ['panel-button', 'next-event-calendar', state,
             hierarchy && 'nec-hierarchy',
             accent && 'nec-accent',
             surface && 'nec-surface']
            .filter(Boolean).join(' '));

        if (!this._indicator.visible)
            this._indicator.show();
    }

    _hideIndicator() {
        if (this._indicator?.visible)
            this._indicator.hide();
    }

    // --- Event Source ---------------------------------------------------------

    _createEventSource() {
        this._disconnectEventSource();

        this._eventSource = new Calendar.DBusEventSource();
        this._changedId = this._eventSource.connect('changed', () => {
            this._requestRefresh();
        });
    }

    _disconnectEventSource() {
        if (this._changedId && this._eventSource) {
            this._eventSource.disconnect(this._changedId);
            this._changedId = null;
        }
        if (this._eventSource) {
            this._eventSource.destroy();
            this._eventSource = null;
        }
    }

    // --- Timer ---------------------------------------------------------------

    _startTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        const interval = Math.max(
            MIN_REFRESH,
            this._settings?.get_uint('refresh-interval-seconds') ?? REFRESH_DEFAULT
        );

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._requestRefresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    // --- Settings ------------------------------------------------------------

    _connectSettings() {
        const reconnect = () => {
            this._scheduleRebuild();
        };

        const restyle = () => this._requestRefresh();

        this._settingsIds.push(
            this._settings.connect('changed::panel-position', reconnect),
            this._settings.connect('changed::refresh-interval-seconds', () => this._startTimer()),
            this._settings.connect('changed::calendar-uid', restyle),
            this._settings.connect('changed::max-title-length', restyle),
            this._settings.connect('changed::time-display', restyle),
            this._settings.connect('changed::text-hierarchy', restyle),
            this._settings.connect('changed::accent-time', restyle),
            this._settings.connect('changed::tonal-surface', restyle),
            this._settings.connect('changed::emphasis-mode', restyle),
            this._settings.connect('changed::soon-minutes', restyle),
            this._settings.connect('changed::imminent-minutes', restyle),
            this._settings.connect('changed::show-ongoing', restyle),
        );
    }

    _scheduleRebuild() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = null;
        }
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBUILD_DELAY, () => {
            this._rebuildId = null;
            this._createIndicator();
            this._requestRefresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- Refresh -------------------------------------------------------------

    _getTodayRange() {
        const now = new Date();
        return [
            new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
            new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0),
        ];
    }

    _requestRefresh() {
        if (!this._eventSource)
            return;

        const [todayStart, todayEnd] = this._getTodayRange();
        this._eventSource.requestRange(todayStart, todayEnd);

        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = null;
        }

        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._refreshId = null;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (!this._timeLabel || !this._eventSource || !this._indicator)
            return;

        const nowMs = Date.now();
        const [todayStart, todayEnd] = this._getTodayRange();

        let events = this._eventSource.getEvents(todayStart, todayEnd) || [];

        const calendarUid = this._settings?.get_string('calendar-uid') ?? 'ALL';
        if (calendarUid !== 'ALL') {
            events = events.filter(ev => {
                const parts = ev.id.split('\n');
                return parts[0] === calendarUid;
            });
        }

        const showOngoing = this._settings?.get_boolean('show-ongoing') ?? false;
        const candidates = events
            .filter(ev => showOngoing
                ? (ev.end?.getTime() ?? ev.date.getTime()) > nowMs
                : ev.date.getTime() > nowMs)
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        if (candidates.length === 0) {
            this._hideIndicator();
            return;
        }

        const next = candidates[0];
        const ongoing = showOngoing && next.date.getTime() <= nowMs;
        const minutesUntil = Math.max(0, Math.round((next.date.getTime() - nowMs) / 60000));

        const soonMin = this._settings?.get_int('soon-minutes') ?? 15;
        const imminentMin = this._settings?.get_int('imminent-minutes') ?? 5;
        const emphasis = this._settings?.get_string('emphasis-mode') ?? 'urgency';

        let state;
        if (ongoing)
            state = 'nec-ongoing';
        else if (minutesUntil <= imminentMin)
            state = 'nec-imminent';
        else if (minutesUntil <= soonMin || emphasis === 'always')
            state = 'nec-soon';
        else
            state = 'nec-normal';

        const timeMode = this._settings?.get_string('time-display') ?? 'smart';
        let relative;
        if (timeMode === 'relative')
            relative = true;
        else if (timeMode === 'absolute')
            relative = false;
        else
            relative = minutesUntil <= soonMin;

        let timeStr;
        if (ongoing)
            timeStr = _('now');
        else if (relative)
            timeStr = this._formatRelative(minutesUntil);
        else
            timeStr = this._formatTime(next.date);

        const maxLen = this._settings?.get_int('max-title-length') ?? MAX_TITLE_DEFAULT;
        let title = next.summary || _('Untitled');
        if (title.length > maxLen)
            title = title.substring(0, maxLen - 1) + '\u2026';

        this._render(timeStr, title, state);
    }

    _formatTime(date) {
        return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }

    _formatRelative(minutes) {
        if (minutes < 1)
            return _('now');
        if (minutes < 60)
            return `${_('in')} ${minutes} min`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m === 0
            ? `${_('in')} ${h} h`
            : `${_('in')} ${h} h ${m} min`;
    }

    // --- Open Calendar --------------------------------------------------------

    _openCalendar() {
        try {
            Util.spawn(['gnome-calendar']);
        } catch (e) {
            console.error(`[${this.uuid}] Failed to launch GNOME Calendar: ${e.message}`);
        }
    }
}
