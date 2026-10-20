# Tower Defence sprite pack (optional)

Drop PNGs here plus a `manifest.json` and the game uses them instead of its vector art.
Transparent PNGs, top-down view, facing RIGHT (the game rotates turrets). Suggested sizes at 1×:

| key            | what                                   | size    |
|----------------|----------------------------------------|---------|
| tile_grass     | ground tile (tiled)                    | 36×36   |
| tile_road      | road tile (tiled along the path)       | 36×36   |
| tile_road_turn | road corner (rotated)                  | 36×36   |
| tree, rock, flowers | decor                             | ~40×40  |
| base_plinth    | tower base (no turret)                 | 36×36   |
| turret_arrow, turret_cannon, turret_frost, turret_tesla, turret_sniper | turrets facing right | 36×36 |
| enemy_runner, enemy_grunt, enemy_tank, enemy_flyer, enemy_boss | facing right | 24–40 px |
| shot_arrow, shot_shell, shot_ice | projectiles facing right | 16×8 |
| base_crystal, spawn_portal | ends of the path                | 48×48   |

Example `manifest.json`:

```json
{ "scale": 1, "sprites": {
  "turret_arrow": { "file": "turret_arrow.png", "anchor": [0.4, 0.5] },
  "enemy_grunt":  { "file": "enemy_grunt.png", "frames": 4 }
} }
```

A ready-made CC0 option is Kenney's "Tower Defense (top-down)" pack (kenney.nl/assets/tower-defense-top-down):
rename the PNGs to the keys above. Any key you leave out keeps the built-in vector drawing.
