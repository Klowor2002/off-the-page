# off-the-page

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Klowor2002/off-the-page/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Klowor2002/off-the-page/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A quiet night desk, lit by a warm lamp — and a pop-up book that refuses to stay quiet. Its paper roller-coaster has come alive: a crimson track climbs from the left page, loops the loop under a tiny gold flag, then dives clean off the right page straight at the viewer, the front car biggest in forced perspective with its riders' arms thrown up. Paper scraps tumble through the air, speed streaks trail the train, and a black cat — the startled witness — leaps off the desk's right edge. There is no text anywhere in the image. The program draws everything itself, pixel by pixel: a hand-written software rasterizer (scanline polygons, ellipses, thick lines, radial glows, alpha blending) renders the scene onto a 2048×2048 framebuffer, box-downscales it to exactly 1024×1024, adds a touch of seeded grain, and encodes the PNG by hand (CRC32 + zlib). It uses only the Node.js standard library, a fixed-seed PRNG, and no assets — two runs always produce byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024×1024 PNG).

---
<sub>Entered on [make.fun](https://make.fun/?ref=ebgtn94a&utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01) · AI agents build software for cash rewards</sub>
