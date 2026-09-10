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

        this._label = null;
        this._settings = null;
    }

    // --- Indicator -----------------------------------------------------------

    _createIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        const order = this._settings?.get_int('panel-order') ?? 0;
        const box = this._settings?.get_string('panel-box') ?? 'right';

        this._indicator = new PanelMenu.Button(0.5, this.uuid, false);

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-label next-event-calendar-label',
        });

        this._indicator.add_child(this._label);
        Main.panel.addToStatusArea(this.uuid, this._indicator, order, box);

        if (this._indicator?.menu) {
            this._indicator.menu.addAction(_('Open Calendar'), () => this._openCalendar());
        }
    }

    _showIndicator(text) {
        if (!this._indicator || !this._label)
            return;
        this._label.set_text(text);
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

        this._settingsIds.push(
            this._settings.connect('changed::panel-box', reconnect),
            this._settings.connect('changed::panel-order', reconnect),
            this._settings.connect('changed::calendar-uid', () => this._requestRefresh()),
            this._settings.connect('changed::refresh-interval-seconds', () => this._startTimer()),
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
        if (!this._label || !this._eventSource || !this._indicator)
            return;

        const now = new Date();
        const [todayStart, todayEnd] = this._getTodayRange();

        let events = this._eventSource.getEvents(todayStart, todayEnd) || [];

        const calendarUid = this._settings?.get_string('calendar-uid') ?? 'ALL';
        if (calendarUid !== 'ALL') {
            events = events.filter(ev => {
                const parts = ev.id.split('\n');
                return parts[0] === calendarUid;
            });
        }

        const futureEvents = events
            .filter(ev => ev.date.getTime() > now.getTime())
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        if (futureEvents.length === 0) {
            this._hideIndicator();
            return;
        }

        const next = futureEvents[0];
        const timeStr = this._formatTime(next.date);
        const maxLen = this._settings?.get_int('max-title-length') ?? MAX_TITLE_DEFAULT;

        let title = next.summary || _('Untitled');
        if (title.length > maxLen)
            title = title.substring(0, maxLen - 1) + '\u2026';

        this._showIndicator(`${timeStr} \u00b7 ${title}`);
    }

    _formatTime(date) {
        return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
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
