# Next Event Calendar

Extensión de GNOME Shell que muestra en el panel superior el **próximo evento
del día** con su hora. Cuando ya no quedan eventos con hora por delante hoy,
el indicador **desaparece**. Al hacer clic se abre **GNOME Calendar**.

Lee los mismos datos que el calendario del reloj de GNOME (Evolution Data
Server / Cuentas en línea), sin dependencias ni typelibs extra.

---

## Requisitos

- GNOME Shell **45 a 50** (probado en 50; en 45–49 debería funcionar pero no
  está verificado).
- Al menos un calendario configurado en **Configuración → Cuentas en línea**
  o en la app **GNOME Calendar**.
- Herramientas de línea de comandos: `glib-compile-schemas` y
  `gnome-extensions` (vienen con `gnome-shell`; en algunas distros el panel
  de preferencias requiere `gnome-shell-extension-prefs`).

---

## Instalación

### Opción A — script (recomendada)

```bash
git clone <url-del-repo> Next-Event-Calendar
cd Next-Event-Calendar
./install.sh enable
```

Después **recarga GNOME Shell**:

- **Wayland**: cierra sesión y vuelve a entrar (no hay otra forma).
- **X11**: `Alt`+`F2`, escribe `r`, `Enter`.

Si tras reiniciar la sesión en Wayland sigue sin aparecer, actívala a mano:

```bash
gnome-extensions enable next-event-calendar@gnome-shell-extension
```

### Opción B — manual

```bash
UUID=next-event-calendar@gnome-shell-extension
DEST=~/.local/share/gnome-shell/extensions/$UUID

mkdir -p "$DEST"
cp metadata.json extension.js prefs.js stylesheet.css "$DEST/"
cp -r schemas "$DEST/"
glib-compile-schemas "$DEST/schemas"

gnome-extensions enable "$UUID"
```

Luego recarga la shell (ver arriba).

### Opción C — desde zip

```bash
./package.sh   # genera dist/next-event-calendar@gnome-shell-extension.shell-extension.zip
gnome-extensions install --force \
  dist/next-event-calendar@gnome-shell-extension.shell-extension.zip
```

Recarga la sesión y actívala con `gnome-extensions enable …`.

---

## Configuración

```bash
gnome-extensions prefs next-event-calendar@gnome-shell-extension
```

O desde la app **Extensiones** → *Next Event Calendar* → engranaje.

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| Calendario | Todos | Muestra eventos solo de ese calendario de EDS |
| Posición en el panel | Derecha | Extremo izq. / izquierda / a la izq. del reloj / a la der. del reloj / derecha / extremo der. |
| Largo máx. de título | 35 | Trunca títulos más largos con `…` |
| Intervalo de refresco | 60 s | Cada cuánto se reevalúa el próximo evento |

Los cambios de posición y de calendario se aplican **sin recargar** la shell.

---

## Cómo funciona

- **Origen de datos**: `Calendar.DBusEventSource` de GNOME Shell — el mismo
  agregador que usa el calendario del reloj. No hace login propio ni guarda
  credenciales.
- **Filtrado por calendario**: cada evento trae un id
  `source_uid\ncomp_uid\nrid`; se compara la primera parte con el UID
  elegido en preferencias.
- **Refresco**: temporizador periódico + señal `changed` de EDS. En cada
  refresco se pide el rango de hoy, se descartan los eventos ya pasados y los
  de día completo, y se muestra el primero que queda.
- **Preferencias**: la lista de calendarios se obtiene de Evolution Data
  Server por D-Bus (`org.gnome.evolution.dataserver.Sources5`).

---

## Limitaciones conocidas

- Depende de **dos APIs internas** de GNOME Shell (`DBusEventSource` y el
  formato del id de evento). Son estables desde hace años, pero una versión
  futura de GNOME podría romperlas.
- Los **eventos de día completo no se muestran** (no tienen hora). Solo
  cuentan los eventos de hoy con hora y que aún no han empezado.
- El **selector de calendario** en preferencias lee EDS por D-Bus de forma
  síncrona; si EDS cambia la versión del bus (`Sources5` → `Sources6`) la
  lista puede quedar vacía y solo se ofrece «Todos los calendarios» (la
  extensión sigue funcionando).
- `uuid` y `url` son *placeholders* y no hay `LICENSE`: sirve para uso
  personal, **no** para subir a extensions.gnome.org tal cual.

---

## Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| No aparece en la lista de extensiones | La shell no se ha recargado. En Wayland hay que cerrar sesión y volver a entrar. |
| Aparece activada pero no se ve nada en el panel | No hay eventos futuros con hora hoy (comportamiento correcto), o EDS aún está sincronizando: abre GNOME Calendar para forzar la sincronización y espera al siguiente refresco. |
| Preferencias: el desplegable solo muestra «Todos los calendarios» | EDS no respondió por D-Bus. Comprueba `gnome-extensions prefs …` desde una terminal y revisa la salida; ver *Limitaciones conocidas*. |
| Errores en el log | `journalctl --user -b -o cat /usr/bin/gnome-shell \| grep next-event` |

---

## Desinstalar

```bash
gnome-extensions disable next-event-calendar@gnome-shell-extension
rm -rf ~/.local/share/gnome-shell/extensions/next-event-calendar@gnome-shell-extension
```
