# Next Event Calendar

GNOME Shell extension that shows your **next event of the day** with its time
in the top panel. Once there are no more timed events left today, the
indicator **disappears**. Clicking it opens **GNOME Calendar**.

It reads the same data as the GNOME clock's calendar (Evolution Data
Server / Online Accounts), with no extra dependencies or typelibs.

**Available on extensions.gnome.org:**
https://extensions.gnome.org/extension/10932/next-event-calendar/

---

## Requirements

- GNOME Shell **47 to 50** (tested on 50; 47–49 should work but are
  unverified). Accent-color emphasis requires 47+.
- At least one calendar configured in **Settings → Online Accounts** or in
  the **GNOME Calendar** app.
- Command-line tools: `glib-compile-schemas` and `gnome-extensions` (ship
  with `gnome-shell`; on some distros the preferences panel needs
  `gnome-shell-extension-prefs`).

---

## Installation

### Option A — extensions.gnome.org (recommended)

Install directly from https://extensions.gnome.org/extension/10932/next-event-calendar/
using the toggle switch (requires the GNOME Shell integration browser
extension).

### Option B — script

```bash
git clone https://github.com/PGSCOM/Next-Event-Calendar.git
cd Next-Event-Calendar
./install.sh enable
```

Then **reload GNOME Shell**:

- **Wayland**: log out and log back in (no other way).
- **X11**: `Alt`+`F2`, type `r`, `Enter`.

If it still doesn't show up after reloading a Wayland session, enable it by
hand:

```bash
gnome-extensions enable next-event-calendar@gnome-shell-extension
```

### Option C — manual

```bash
UUID=next-event-calendar@gnome-shell-extension
DEST=~/.local/share/gnome-shell/extensions/$UUID

mkdir -p "$DEST"
cp metadata.json extension.js prefs.js stylesheet.css "$DEST/"
cp -r schemas "$DEST/"
glib-compile-schemas "$DEST/schemas"

gnome-extensions enable "$UUID"
```

Then reload the shell (see above).

### Option D — from zip

```bash
./package.sh   # builds dist/next-event-calendar@gnome-shell-extension.shell-extension.zip
gnome-extensions install --force \
  dist/next-event-calendar@gnome-shell-extension.shell-extension.zip
```

Reload the session and enable it with `gnome-extensions enable …`.

---

## Configuration

```bash
gnome-extensions prefs next-event-calendar@gnome-shell-extension
```

Or from the **Extensions** app → *Next Event Calendar* → gear icon. There are
two pages.

**General**

| Setting | Default | What it does |
|---|---|---|
| Calendar | All | Only shows events from that EDS calendar |
| Show event in progress | No | Keeps showing the event while it's happening, instead of jumping to the next one |
| Panel position | Right | Far left / left / left of clock / right of clock / right / far right |
| Refresh interval | 60 s | How often the next event is re-evaluated |

**Appearance**: a quick preset plus fine detail.

| Setting | Default | What it does |
|---|---|---|
| Preset | *(depends on the rest)* | **Simple**: the classic flat look. **Featured**: hierarchy + accent + surface. **Custom**: your own mix |
| Time format | Smart | Absolute time, countdown, or countdown only when close |
| Typographic hierarchy | Yes | Bold time with a dimmed title, instead of a flat `·`-separated string |
| Max title length | 35 | Truncates longer titles with `…` |
| Accent-colored time | Yes | Tints the time with the system accent color when the event is near |
| Tonal surface | Yes | Dim background behind the widget when the event is imminent |
| Emphasis: when | As it approaches | Scale up as the event gets closer, or always apply it |
| Thresholds | 15 / 5 min | Minutes at which the event counts as *soon* and as *imminent* |

All appearance and calendar changes apply **without reloading** the shell.
Panel position too, except on the first load under Wayland.

---

## How it works

- **Data source**: GNOME Shell's `Calendar.DBusEventSource` — the same
  aggregator the clock's calendar uses. No custom login, no stored
  credentials.
- **Calendar filtering**: each event carries an id
  `source_uid\ncomp_uid\nrid`; the first part is compared against the UID
  chosen in preferences.
- **Refresh**: a periodic timer plus EDS's `changed` signal. Each refresh
  requests today's range, discards past and all-day events, and shows the
  first one remaining.
- **Preferences**: the calendar list is fetched from Evolution Data Server
  over D-Bus (`org.gnome.evolution.dataserver.Sources5`).

---

## License

[GPL-2.0-or-later](LICENSE).

---

## Uninstall

```bash
gnome-extensions disable next-event-calendar@gnome-shell-extension
rm -rf ~/.local/share/gnome-shell/extensions/next-event-calendar@gnome-shell-extension
```
