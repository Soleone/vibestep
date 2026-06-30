# Flow Fight Design Notes

## Current direction: music-synced parry encounters

Flow Fight started as a parry prototype and drifted toward rhythm-game tooling. The stronger identity may be a hybrid:

> A music-synced parry game where reusable enemies perform attack vocabularies to songs.

Instead of requiring a full hand-authored beatmap for every song, songs provide tempo, structure, and energy. Enemies provide readable attack patterns. Encounters mix enemies and attack patterns into song sections.

## Core distinction

### Pure rhythm game

The player primarily reads the music/chart.

Strengths:

- High replay value from songs and maps.
- Editor/community content can scale.
- Compatibility with formats like Beat Saber/Osu/StepMania may become valuable.
- Abstract visuals can still be fun if timing readability is strong.

Best presentation:

- Top-down or toward-player note highway.
- Lane identity on one axis, timing on the other.
- Holds and chords are visually straightforward.

### Pure parry game

The player primarily reads the enemy.

Strengths:

- More distinctive; fewer games are fundamentally about parrying.
- Mastery comes from reading tells, delays, feints, and movesets.
- Encounters can feel richer and more characterful.

Costs:

- Usually needs authored enemy tells, animations, camera framing, and VFX.
- Full 3D character animation is a much larger production burden.

Examples / references:

- Expedition 33 works partly because attacks have readable character, rhythm, windup, and impact timing.
- Sekiro-style mastery comes from learning enemy body language and move timing.

### Flow Fight hybrid

The player reads both:

- Music provides timing grid, energy, and replayable structure.
- Enemies provide attack vocabulary, tells, and encounter identity.

This suggests a game that is not simply “map every note in the song,” but “compose encounters that perform to the song.”

## Proposed content model

### Song

A song provides:

- Audio file / imported URL
- BPM
- Downbeat / beat offset
- Sections: intro, verse, chorus, drop, bridge, outro
- Energy curve / density hints
- Optional detected musical events

The song does not necessarily need a complete authored note chart.

### Enemy

An enemy defines a reusable attack vocabulary.

Example:

```txt
Enemy: Twin Duelist
Works well: 90–150 BPM
Attack patterns:
- Jab: 1-beat single parry
- Double cut: eighth-note pair
- Sweep: low-lane hold
- Feint slash: delayed hit after windup
- Cross combo: left-right-left
- Chorus rush: 2-bar phrase
- Recovery taunt: safe gap
```

Enemy data might include:

- Supported BPM range
- Visual theme / silhouette / VFX
- Attack patterns
- Difficulty tags
- Pattern weights
- Allowed song-section types
- Telegraph style
- Recovery windows

### Attack pattern

An attack pattern is beat-relative, not absolute song-time-only.

It might define:

- Duration in beats/bars
- Lane sequence
- Hit timings relative to pattern start
- Holds
- Telegraph timing
- Feints or delayed hits
- Intensity/difficulty
- Required spacing before/after

Example shape:

```json
{
  "id": "double-cut",
  "enemyId": "twin-duelist",
  "beats": 1,
  "notes": [
    { "beat": 0, "lane": "low" },
    { "beat": 0.5, "lane": "high" }
  ],
  "tags": ["eighths", "combo", "duelist"]
}
```

### Encounter

An encounter assigns enemies and pattern rules to song sections.

Example:

```txt
Verse:
- enemy: Twin Duelist
- density: low
- allowed attacks: jab, double cut, sweep

Chorus:
- enemy: Twin Duelist + Bell Mage
- density: high
- allowed attacks: cross combo, chorus rush, projectile pulse

Bridge:
- enemy: Bell Mage
- density: medium
- allowed attacks: delayed bells, hold pulse
```

The encounter generator chooses patterns that fit the current BPM, section energy, difficulty, and spacing constraints.

## Editor implications

The editor may evolve from a beatmap editor into an encounter composer with multiple layers.

### 1. Song setup mode

Purpose: make the song usable.

Features:

- Import audio.
- Detect/adjust BPM.
- Set downbeat/beat offset.
- Mark sections.
- Review detected energy/onsets.

### 2. Enemy/pattern mode

Purpose: author reusable enemy behavior.

Features:

- Create enemy.
- Define supported BPM range.
- Build attack patterns on a beat grid.
- Preview pattern at different BPMs.
- Define telegraph / impact / recovery timing.
- Tag difficulty and section suitability.

### 3. Encounter mode

Purpose: compose a song-specific fight from reusable enemies.

Features:

- Assign enemies to sections.
- Set density/intensity per section.
- Choose allowed/blocked patterns.
- Generate draft encounter.
- Jam-refine generated result.
- Save overrides where needed.

## Roguelike possibility

This model naturally supports roguelike or run-based structure.

Ideas:

- A run uses a playlist or song pool.
- Each room chooses a song section + enemy/enemy group.
- Enemies have attack decks.
- Bosses have signature attacks synced to choruses/drops.
- Relics/modifiers alter parry windows, rewards, lane behavior, or pattern generation.
- The player learns enemy vocabularies across different songs.

This could create replayability without needing every song to be fully hand-mapped.

## Visual/presentation direction

Avoid jumping straight to full 3D character animation. Start with readable abstract enemies.

Possible enemy representations:

- Stylized silhouettes
- Masks/totems
- Mechanical cannons
- VFX-first attackers
- Simple rigged figures
- Animated symbols
- Enemy “cards” or avatars that trigger attacks

The key requirement is readable authored tells, not expensive realism.

## Open design question: note highway vs parry arena

### Top-down / Guitar Hero-like

Pros:

- Best for rhythm readability.
- Lanes map clearly left-to-right.
- Timing is easy to read against a horizontal hit line.
- Holds/chords/dense patterns are easier to parse.

Cons:

- Less immediately “parry combat.”
- Can feel like a conventional rhythm game if enemy presentation is weak.

### Right-to-left / current parry arena

Pros:

- Stronger combat/parry fantasy.
- Projectiles attacking a shield reads thematically.
- Enemy/cannon source is spatially clear.

Cons:

- Less standard for rhythm literacy.
- Lane/input mapping is less obvious.
- Dense patterns and holds may be harder to parse.

### Hybrid possibility

Use a clear rhythm highway for timing while placing enemy tells/avatars at the source side/top of the highway.

Possible framing:

- Enemy at top/source side performs tells.
- Notes/attacks travel toward a clear parry line.
- Hit/parry feedback remains combat-flavored.

## Near-term prototype goals

1. Keep current gameplay working.
2. Prototype a top-down/toward-player highway layout for readability comparison.
3. Add a simple enemy-pattern data model separate from song beatmaps.
4. Create 2–3 reusable attack patterns and generate them against BPM.
5. Let a song section choose from enemy patterns instead of requiring full manual mapping.
6. Preserve manual jam editing as an override/refinement layer.
