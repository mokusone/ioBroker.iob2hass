# Design — `iobroker.iob2hass` Bridge-Adapter

**Status**: Design freigegeben, bereit für Implementation-Plan
**Datum**: 2026-05-14
**Bezug**: Migrations-Workspace, Architektur-Doku 02 (Bridge ioBroker → HA), 04 (Loop-Vermeidung), 05 (Migrationsphasen). Diese Dokumente liegen außerhalb dieses Repos im Migrations-Workspace.

## 1. Zweck und Umfang

`iobroker.iob2hass` ist ein temporärer ioBroker-Adapter, der während der HA-Migration ausgewählte ioBroker-Datenpunkte per MQTT-Discovery als Mirror-Entities in Home Assistant verfügbar macht. Er ist die offizielle Schreibstrecke für „HA steuert Geräte, die noch in ioBroker hängen". Wird bei Adapter-Migrationen schrittweise entlastet und am Migrationsende deinstalliert.

**Nicht im Umfang**: Composite-/Alias-Logik, Modellierungs-Heuristik, KNX-Gruppen-Erkennung, Multi-DP-Zusammenfassung, Werte-Transformationen jenseits Discovery-Metadaten, Web-UI im Adapter, Migrations-Generatoren, InfluxDB-Continuity (alles separate Themen).

## 2. Grundsatzentscheidungen

| Entscheidung | Wahl | Begründung |
|---|---|---|
| Form | ioBroker-Adapter | Adapter-API liefert States und `common`-Metadaten in einem Aufruf, Pattern-Subscribes serverseitig optimiert, Lifecycle passt zur temporären Natur, keine zusätzliche Infrastruktur. |
| Transport zu HA | MQTT-Discovery | HA-WebSocket-API kann Entities mit Metadaten nicht extern provisionieren. MQTT-Discovery ist der offizielle Pfad. Mosquitto ist laut Phase 0 ohnehin gesetzt. |
| Sprache/Stack | TypeScript, `@iobroker/adapter-core`, npm `mqtt` | Konsistent zum `iobroker.hass`-Fork-Stack. |
| Konfiguration | JsonConfig (Admin-UI) | Keine Dateisystem-Konfig, alles im Admin. Backup über ioBroker. |
| Subscription | Pro Whitelist-Eintrag ein `subscribeForeignStates(pattern)` | Saubere Identifikation pro Adapter-Quelle, ioBroker filtert serverseitig. |
| Blacklist | Keine | Whitelist startet leer, User entscheidet bewusst. Loop-Schutz übernehmen `iobroker.hass`-Fork-Filter, `loop-guard` und die leere Default-Whitelist. |
| Cleanup | Adapter-autonomer Reconcile beim Boot | Optional über Flag `autoDeleteOrphans` (Default off). Manuelle Bereinigung über Admin-Button. |
| Wiederanlauf | Stateless | Jeder Boot ist voller Neustart. Kein Resume-Mechanismus. |

## 3. Architektur

```
ioBroker (LXC)
   │
   ├── iobroker.iob2hass (Adapter)
   │     - Adapter-API: getForeignObjectsAsync, subscribeForeignStates
   │     - Whitelist + Override-Tabelle aus JsonConfig
   │     - Discovery-JSON aus common + Overrides
   │     - MQTT-Client zu Mosquitto (LWT, retained Publish)
   │     - command_topic-Subscribe für Schreibrichtung
   ▼
Mosquitto (HA-Addon)
   │ Discovery + State-Topics + Command-Topics
   ▼
Home Assistant
   └── Gerät „ioBroker Bridge" mit allen iob_*-Entities
```

### 3.1 Modul-Struktur

```
adapters/ioBroker.iob2hass/
├── src/
│   ├── main.ts                  # Iob2HassAdapter — Lifecycle, Boot, Subscribes
│   ├── lib/
│   │   ├── config.ts            # JsonConfig laden, validieren, normalisieren
│   │   ├── matcher.ts           # Glob-Match (Whitelist + Override-Patterns)
│   │   ├── discovery.ts         # common + Overrides → HA-MQTT-Discovery-JSON
│   │   ├── sanitizer.ts         # DP-ID → entity-ID-Slug
│   │   ├── mqtt-client.ts       # Mosquitto-Verbindung, LWT, retained Publish
│   │   ├── command-router.ts    # Eingehende command-Topics → setForeignStateAsync
│   │   ├── loop-guard.ts        # from-Feld-Filter
│   │   ├── reconcile.ts         # Discovery-Cleanup von Waisen-Topics
│   │   └── stats.ts             # Adapter-States für info/stats
│   └── types.ts
├── admin/
│   ├── jsonConfig.json5
│   └── i18n/
├── test/
├── io-package.json
├── package.json
└── README.md
```

**Modul-Verantwortung**:

- `main.ts`: Adapter-Boot, baut Subscribe-Liste, registriert MQTT-Client, ruft `reconcile`, leitet State-Events weiter.
- `matcher.ts`: einziger Ort, an dem Glob-Match definiert ist (`*` → `.*`, identisch zum `hass`-Fork).
- `discovery.ts`: reine Funktion `buildConfig(obj, overrides) → discoveryJson`, side-effect-frei, gut testbar.
- `sanitizer.ts`: deterministische Slug-Erzeugung — lowercase, `[^a-z0-9_]` → `_`, mehrfache `_` zusammenfalten, Edge-`_` trimmen.
- `reconcile.ts`: scannt retained Discovery-Topics auf Mosquitto unter dem Prefix, vergleicht mit Soll-Liste, publisht leere Messages für Waisen — **nur wenn `autoDeleteOrphans=true` UND Whitelist nicht leer**.
- `loop-guard.ts`: filtert State-Events nach `state.from === 'system.adapter.iob2hass.<instance>'`.
- `command-router.ts`: einziger Ort, der `setForeignStateAsync` aufruft (Audit-Punkt für Schreibrichtung).

## 4. Datenfluss

### 4.1 Boot
1. JsonConfig laden, Mosquitto-Verbindung mit LWT (`<baseTopic>/status = offline`) öffnen.
2. `<baseTopic>/status` retained = `online` publishen.
3. Für jeden aktiven Whitelist-Eintrag: `getForeignObjectsAsync(pattern, 'state')` → DP-Objekte holen.
4. Pro DP: Auto-Detection aus `common` → Overrides mergen → Discovery-JSON bauen → retained nach `<discoveryPrefix>/<domain>/<unique_id>/config` publishen → aktuellen State holen und auf `state_topic` publishen.
5. Reconcile: alte Discovery-Topics scannen, Waisen löschen (sofern Flag aktiv + Whitelist nicht leer).
6. `subscribeForeignStates(pattern)` pro Whitelist-Eintrag.
7. `subscribe('<baseTopic>/cmd/#')` auf Mosquitto.
8. Reverse-Lookup-Cache (`unique_id` → DP-ID) aufbauen.
9. `subscribe('<discoveryPrefix>/status')` auf Mosquitto (für HA-Birth-Message, siehe 4.7).

### 4.2 State-Update (ioBroker → HA)
1. State-Event kommt rein.
2. `loop-guard`: eigener `from`? → verwerfen.
3. Modus prüfen:
   - `discover` → `stats.unmapped++`, ggf. ID ins Log (verbose-Flag), kein Publish.
   - `dry-run` → würde-Publish ins Log, kein echter Publish.
   - `live` → State auf `<baseTopic>/state/<unique_id>` publishen (nicht retained, damit alte Werte HA nach Restart nicht verfälschen).

### 4.3 Command (HA → ioBroker)
1. MQTT-Message auf `<baseTopic>/cmd/<unique_id>`.
2. Reverse-Lookup `unique_id` → DP-ID (Boot-Cache).
3. Prüfung `common.write === true`. Wenn nicht: `stats.errors++`, Warnung loggen, abbrechen.
4. `setForeignStateAsync(dpId, value, false)` (`ack=false` = Steuerbefehl).
5. Echo (Aktor schaltet, Adapter setzt `ack=true`) durchläuft den normalen State-Update-Pfad — `loop-guard` lässt durch (from ist der Aktor-Adapter, nicht wir). State erscheint korrekt in HA.

### 4.4 Config-Change
JsonConfig-Save → js-controller startet Adapter neu → kompletter Boot-Pfad. Kein dynamischer Reload.

### 4.5 Disconnect/Reconnect Mosquitto
- MQTT-Client reconnected automatisch (Lib-Default).
- LWT hat in Zwischenzeit `status=offline` retained → HA zeigt alle Mirror-Entities als `unavailable`.
- Bei Reconnect: `status=online`, States republishen, Discovery muss nicht neu (retained).

### 4.6 Disconnect ioBroker
Adapter wird vom js-controller neugestartet → Boot-Pfad.

### 4.7 HA-Restart (Birth-Message)
- Adapter subscribed beim Boot zusätzlich `<discoveryPrefix>/status`.
- Wenn HA online geht, publisht HA dort `online` (HA-Birth-Message-Konvention).
- Adapter empfängt → republisht aktuellen State aller bekannten Mirror-Entities → HA-UI ist sofort versorgt, kein „unknown".
- State-Topics bleiben dadurch **nicht retained** (saubere Trennung: aktueller Zustand kommt aus dem Adapter, nicht aus dem Broker-Cache).

## 5. JsonConfig (Admin-UI)

### Tab „Verbindung"
| Feld | Typ | Default |
|---|---|---|
| `mqtt.host` | string | `core-mosquitto` |
| `mqtt.port` | number | `1883` |
| `mqtt.user` | string | (leer) |
| `mqtt.password` | password | (leer) |
| `mqtt.tls` | bool | `false` |
| `mqtt.baseTopic` | string | `iob2hass` |
| `mqtt.discoveryPrefix` | string | `homeassistant` |

### Tab „Verhalten"
| Feld | Typ | Default |
|---|---|---|
| `mode` | select (`discover`/`dry-run`/`live`) | `discover` |
| `entityPrefix` | string | `iob_` |
| `autoDeleteOrphans` | bool | `false` |
| `markAsDiagnostic` | bool | `false` |
| `verboseDiscoverLog` | bool | `false` |
| `republishOnBoot` | bool | `true` |

### Tab „Whitelist" (Tabelle)
| Spalte | Beschreibung |
|---|---|
| `pattern` | DP-Pattern, Glob mit `*` (`shelly.0.*`, `homematic.0.*`). |
| `aktiv` | Bool — `false` ignoriert Eintrag (Audit-Spur). |
| `notiz` | Freitext. |

### Tab „Overrides" (Tabelle)
| Spalte | Beschreibung |
|---|---|
| `pattern` | DP-Pattern (kann adapterübergreifend sein, z.B. `*.Power`). |
| `domain` | optional, erzwingt HA-Domain. |
| `unit` | optional |
| `role` | optional |
| `device_class` | optional |
| `state_class` | optional |
| `min` / `max` | optional |

Merge-Logik: alle Patterns, die zu einem DP passen, werden in Listen-Reihenfolge gemergt — späterer Eintrag überschreibt früheren. CSS-Mental-Model: oben generelle Defaults, unten spezifische Korrekturen.

### Tab „Status" (read-only)
- Verbindungsstatus Mosquitto + ioBroker
- Counter: subscribed, published, unmapped, errors
- Last reload timestamp
- Button **„HA-Seite bereinigen"** — publisht leere Retained-Messages für alle bekannten Discovery-Topics. Vor Deinstallation manuell auszulösen.

## 6. Discovery-Mapping-Regeln

Input: ioBroker-Objekt mit `common`, zutreffende Overrides. Output: Discovery-JSON inklusive Domain.

### 6.1 Domain-Auswahl (Vorrang „Schreibbarkeit")

| Bedingung | Domain |
|---|---|
| `write=true`, `type=boolean` | `switch` |
| `write=true`, `type=number`, `role` enthält `level.dimmer` oder `level.brightness`, `min`/`max` definiert | `light` |
| `write=true`, `type=number` (sonst) | `number` (HA-Helper-Domain) |
| `write=true`, `type=string` | `text` (HA-Helper-Domain) |
| `write=true`, `type=mixed` | `text` |
| `write=false`, `type=boolean` | `binary_sensor` |
| `write=false`, alles andere | `sensor` |

Override-Feld `domain` überschreibt das immer.

**MVP-Beschränkung**: keine `climate`- oder `cover`-Auto-Detection. Was wie eine Heizung oder ein Rollladen aussieht, fällt auf `number`/`sensor` zurück. Begründung: echtes `climate` braucht Multi-Topic-Provisioning, Heizung und KNX-Rollläden werden ohnehin früh nativ migriert, dann ist die Bridge dort nicht mehr Quelle.

### 6.2 device_class und state_class (Heuristik aus `role` + `unit`)

| Heuristik | device_class | state_class |
|---|---|---|
| `role` enthält `value.power` oder `unit=W` | `power` | `measurement` |
| `role` enthält `value.energy` oder `unit ∈ {kWh, Wh}` | `energy` | `total_increasing` |
| `role` enthält `value.temperature` oder `unit ∈ {°C, °F}` | `temperature` | `measurement` |
| `role` enthält `value.humidity` oder `role` enthält `humidity` mit `unit=%` | `humidity` | `measurement` |
| `role` enthält `sensor.motion` | `motion` (binary_sensor) | – |
| `role` enthält `sensor.window` oder `sensor.door` | `opening` (binary_sensor) | – |
| `role` enthält `value.voltage` oder `unit=V` | `voltage` | `measurement` |
| `role` enthält `value.current` oder `unit=A` | `current` | `measurement` |
| sonst | (weggelassen) | (weggelassen) |

### 6.3 Gemeinsame Felder

In jeder Discovery-Config:

- `unique_id`: `<entityPrefix><sanitized-dp-id>`
- `object_id`: identisch zu `unique_id`
- `name`: `common.name` (falls vorhanden) sonst sanitized DP-ID
- `state_topic`: `<baseTopic>/state/<unique_id>`
- `availability`: `topic=<baseTopic>/status`, `payload_available=online`, `payload_not_available=offline`
- `device`: `{ identifiers: ['iob2hass-<instance>'], name: 'ioBroker Bridge', manufacturer: 'iob2hass', model: 'Mirror-Bridge' }` — alle Mirror-Entities hängen am gemeinsamen Bridge-Device (UI-Aufräumung in HA)
- `entity_category`: `diagnostic`, sofern `markAsDiagnostic=true`

### 6.4 Schreibende Entities

- `command_topic`: `<baseTopic>/cmd/<unique_id>`
- Bei `switch`: `payload_on=true`/`payload_off=false`; bei vorhandenem `common.states` als Map dort entnommen.
- Bei `light` mit Dimmer: `brightness_command_topic`, `brightness_scale=common.max`.

### 6.5 Override-Merge

Pro DP werden alle zutreffenden Override-Patterns in Listen-Reihenfolge angewendet. Auto-Resultat zuerst, Overrides patchen darüber.

## 7. Fehlerbehandlung und Edge Cases

| Fall | Verhalten |
|---|---|
| `common` fehlt / unvollständig | Fallback auf `sensor`, kein device_class, Warnung im Log mit DP-ID. |
| `common.type=mixed` | Behandlung als `string`, Domain wird `text`/`sensor`. Override kann korrigieren. |
| Read-only-DP bekommt Command aus HA | `stats.errors++`, Warnung, `setForeignStateAsync` wird **nicht** ausgeführt. |
| Mosquitto unerreichbar beim Boot | Retry mit Backoff. Adapter-Connection-State bleibt `false`, HA sieht nichts. |
| `baseTopic` kollidiert mit fremdem Service | Warnung beim Boot (Topic ist nicht leer). User stellt im Admin um. |
| Whitelist leer | Adapter läuft, publisht nur LWT. Reconcile löscht nichts (Schutz). |
| Adapter-Crash mitten im Boot | Restart durch js-controller, vollständig stateless. |

## 8. Tests

Mocha + `@iobroker/testing` (analog zum `hass`-Fork-Setup).

**Unit-Tests**:
- `matcher.ts`: Glob-Patterns gegen DP-IDs, Edge-Cases mit `.`, `#`, `:`.
- `sanitizer.ts`: DP-ID → Slug, deterministisch, kollisionsfrei auf realistischem Testset.
- `discovery.ts`: tabellengetestet pro Domain — gegeben `common` + Overrides → erwartetes Discovery-JSON.
- `loop-guard.ts`: eigene vs. fremde `from`-Werte.

**Integration**:
- `@iobroker/legacy-testing` spinnt js-controller hoch, Adapter startet, dummy-MQTT-Broker in-process (`aedes`), Discovery-Topics werden geprüft, Command-Topics werden ausgewertet.
- Smoke-Test: Adapter mit leerer Whitelist startet sauber, publisht nur LWT.

**Qualität**:
- `npm run lint` (ESLint)
- `npx prettier --check .`
- `npm run test:package` (validiert `io-package.json`)

## 9. Migration und Lifecycle

- **Installation**: Custom-Adapter via URL-Install in ioBroker-Admin oder lokaler `iobroker url <path>`-Install.
- **Erststart**: Modus `discover`, leere Whitelist. Nutzer sieht im Log/Stats, was reinkäme.
- **Iterativ**: Whitelist füllen, `dry-run` zum Verifizieren der Discovery-JSONs, dann `live`.
- **Während Migration**: HA-User legt einmalig die Area `Bridge-Quelle` (o.ä.) an, ordnet das Bridge-Device dieser Area zu — Mirror-Entities sind aus normalen Raum-Dashboards weggeräumt.
- **Adapter-Cutover** (Doku 05 Phase 5): pro migriertem Adapter Whitelist-Eintrag deaktivieren (`aktiv=false`). Wenn `autoDeleteOrphans` aktiv: nächster Boot löscht zugehörige Mirror-Entities. Sonst manuell „HA-Seite bereinigen" für den gesamten Adapter-Scope.
- **Migrationsende**: Admin-Button „HA-Seite bereinigen" → alle Mirror-Entities verschwinden aus HA → Adapter deinstallieren.

## 10. Doku-Anpassungen (außerhalb dieses Specs)

Sobald Spec freigegeben, müssen folgende Architektur-Docs nachgezogen werden:

- **Doku 02**: Abschnitt „Hartkodierte Blacklist" streichen, Hinweis auf neuen Block „Whitelist startet leer" + drei Loop-Schutz-Mechanismen.
- **Doku 04**: Abschnitt „Bridge-Blacklist (hartkodiert)" streichen, Loop-Schutz erklärt über Whitelist-Default + Fork-Filter + `loop-guard`.
- **Doku 03**: `bridge/blacklist.yaml` aus Repo-Struktur entfernen (Konfig liegt im Adapter, nicht im Filesystem). `bridge/`-Verzeichnis entfällt oder reduziert sich auf optionale Migrations-Berichte aus dem Generator (Doku 02 offene Punkte).

## 11. Explizite Nicht-Ziele

- Keine Composite-/Alias-Logik (siehe Doku 01).
- Keine Modellierungs-Heuristik, keine KNX-Gruppen-Erkennung, keine Multi-DP-Zusammenfassung.
- Keine Werte-Transformation jenseits Discovery-Metadaten.
- Kein eigenes Web-UI, kein HTTP-Endpoint.
- Keine Migrations-Vorschläge (potentiell späterer separater Generator).
- Keine InfluxDB-Anbindung (Continuity über Doku 06).
- Kein `climate`- oder `cover`-Mapping im MVP.

## 12. Implementation-Phasen (Vorschlag für Plan-Skill)

Diese Liste dient als Vorlage für `writing-plans`, nicht als verbindliche Reihenfolge.

1. Adapter-Skelett aus `@iobroker/create-adapter`-Template, TypeScript, basics.
2. JsonConfig + i18n.
3. `config.ts`, `matcher.ts`, `sanitizer.ts` (reine Logik, unit-getestet vorab).
4. `discovery.ts` + Override-Merge.
5. `mqtt-client.ts` mit LWT.
6. Boot-Pfad in `main.ts` (Snapshot, Subscribe, initial Publish).
7. State-Update-Pfad + `loop-guard.ts`.
8. `command-router.ts` (Schreibrichtung).
9. `reconcile.ts` + Admin-Button „HA-Seite bereinigen".
10. `stats.ts` + Adapter-States.
11. Tests (Unit + Integration).
12. README, Versionierung, Release-Setup.
