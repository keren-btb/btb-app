# BTB Escape Rooms: Puzzle Ideas

*Shared idea list. Any Claude reading this: add new ideas under "Ideas" using the template below, and keep existing entries intact.*

## Template

**Name:**
**Type:** (tech / physical / logic / teamwork / VR)
**Concept:** what players do
**Tech / props needed:**
**Difficulty:** (easy / medium / hard)
**Notes:**

## Ideas

### 1. Human Controller
**Type:** tech / teamwork
**Concept:** One player sits in a dark room sorting or handling items, guided remotely by teammates outside who can see what they can't.
**Tech / props needed:** ESP32
**Difficulty:** TBD
**Notes:** Relies on communication between players.

### 2. LoRa Outdoor Escape Room
**Type:** tech / physical / teamwork
**Concept:** An outdoor escape room (park, garden or property) where props are spread over a wide area and linked wirelessly, with no Wi-Fi needed. Solving a puzzle in one spot triggers something elsewhere, e.g. a lock at one end unlocks a maglock 200 m away. Other options: player-carried beacons with RSSI "hot/cold" tracking, or multi-location puzzles where every station must be in the right state at once.
**Tech / props needed:** ESP32 + LoRa boards (SX1262/SX1276, e.g. Heltec or LilyGO T-Beam/T3S3), one gateway node at the control point (optionally Wi-Fi to the BTB app), simple nodes at each prop, IP-rated enclosures, batteries.
**Difficulty:** medium (build); TBD (players)
**Notes:**
- Range is hundreds of metres to km, and nodes are low power (weeks to months on battery).
- Low bandwidth and latency of hundreds of ms to seconds, so use it for triggers, states and sensor readings only, not audio or video and not instant-response puzzles.
- NZ uses 915-928 MHz, so buy AU915/US915 boards, not EU868, and stay within NZ power and duty-cycle limits.
- Plain point-to-point LoRa in a star topology is simpler than LoRaWAN.
- Plan for weatherproofing and battery swaps.
- Setting still to be decided.

### 3. Drag-the-Leaf Letter Clue
**Type:** logic / physical
**Concept:** Inspired by a word puzzle game ad. Players move a draggable item (a leaf-shaped piece with a small square tag) so it loops around the letter "B" among scattered letters. The square then reveals 3 dots, which is the clue for the next step.
**Tech / props needed:** TBD. Could be a physical sliding or tracked piece on a board, or a screen/projection version.
**Difficulty:** TBD
**Notes:** Early idea from Keren; the second idea from the same source is still to be added.

### 4. *(add next idea here)*
