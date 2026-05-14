# iobroker.iob2hass

ioBroker-Adapter, der ausgewählte ioBroker-Datenpunkte per MQTT-Discovery als Mirror-Entities in Home Assistant verfügbar macht. Gedacht als temporäre Bridge während einer Migration von ioBroker zu Home Assistant.

## Funktionsweise

- **Whitelist-basiert**: kein DP wird automatisch durchgelassen. Du pflegst im Admin eine Liste von DP-Patterns (z.B. `shelly.0.*`).
- **Drei Modi**: `discover` (sammelt unmapped States ohne Publish), `dry-run` (zeigt Discovery-JSON im Log), `live` (publisht).
- **HA-Mirror-Entities** mit konfigurierbarem Präfix (Default `iob_`). Alle Entities hängen am gemeinsamen HA-Gerät `ioBroker Bridge`.
- **Schreibrichtung**: HA → ioBroker über `command_topic` pro Entity. Read-only-DPs werden geschützt.
- **Loop-Schutz** über `from`-Feld der ioBroker-State-Events.
- **Cleanup**: optional autonom beim Boot (Flag `autoDeleteOrphans`) oder per Admin-Button „HA-Seite bereinigen".

## Setup

1. Adapter installieren (Custom-URL in ioBroker-Admin: `https://github.com/mokusone/ioBroker.iob2hass`).
2. Instanz öffnen, Tab „Verbindung": MQTT-Host/Port/User/Passwort eintragen.
3. Modus `discover` lassen, Adapter starten — Adapter cached, was reinkäme, ohne nach HA zu publishen.
4. Im Tab „Whitelist" Patterns hinzufügen (z.B. `shelly.0.*`).
5. Modus auf `dry-run` umstellen — Discovery-JSONs werden ins Log geschrieben, zur Verifikation.
6. Modus auf `live` umstellen — Mirror-Entities erscheinen in HA.
7. Einmalig in HA das Gerät `ioBroker Bridge` einer eigenen Area (z.B. „Bridge-Quelle") zuweisen.

## Vor dem Deinstallieren

Den Button „HA-Seite bereinigen" im Admin-Status-Tab drücken — der Adapter publisht leere Retained-Messages für alle bekannten Discovery-Topics, HA löscht damit alle Mirror-Entities. Erst danach den Adapter deinstallieren.

## Konfiguration im Detail

Siehe [docs/design.md](docs/design.md) für vollständige Spezifikation (Datenfluss, JsonConfig-Schema, Discovery-Mapping-Regeln, Lifecycle, Edge Cases).

## Stack

- TypeScript, `@iobroker/adapter-core`, `mqtt`
- Test: Mocha, `@iobroker/testing`, `aedes` als In-Process-Broker
- Lint: `@iobroker/eslint-config`

## Tests laufen lassen

```bash
npm install
npm run lint
npm test
```

## Lizenz

MIT — siehe [LICENSE](LICENSE).
