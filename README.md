# iobroker.iob2hass

ioBroker-Adapter, der ausgewählte ioBroker-Datenpunkte per MQTT-Discovery als Mirror-Entities in Home Assistant verfügbar macht. Gedacht als temporäre Bridge während einer Migration von ioBroker zu Home Assistant.

**Status**: Design freigegeben, Implementation steht aus.

Siehe [docs/design.md](docs/design.md) für die vollständige Architektur, JsonConfig-Schema, Discovery-Mapping-Regeln, Datenfluss und Test-Strategie.

## Kurz-Überblick

- Whitelist-basiert: kein DP wird automatisch durchgelassen.
- Drei Modi: `discover` (sammelt unmapped States), `dry-run` (zeigt Discovery-JSON), `live` (publisht).
- HA-Mirror-Entities mit konfigurierbarem Präfix (Default `iob_`).
- Schreibrichtung: HA → ioBroker über `command_topic` pro Entity.
- Alle Mirror-Entities hängen am gemeinsamen Bridge-Device in HA — einmaliger Area-Zuordnung genügt, um sie aus Raum-Dashboards rauszuhalten.
- Loop-Schutz über `from`-Feld der ioBroker-State-Events (kein Timing-Trick).
- Cleanup: optional autonom beim Boot (Flag) oder per Admin-Button „HA-Seite bereinigen".

## Stack

- TypeScript, `@iobroker/adapter-core`, npm `mqtt`
- Test: Mocha, `@iobroker/testing`, in-process `aedes` als Dummy-Broker
- Lint: ESLint, Prettier

## Lizenz

MIT — wird beim Release ergänzt.
