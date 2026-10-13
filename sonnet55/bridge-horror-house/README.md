# Bridge Horror House

A first-person haunted-house escape game that runs in the browser. Three.js + Vite, zero asset files:
every texture is painted on a `<canvas>` and every sound is synthesized with the Web Audio API.

```
npm install
npm run dev      # then open the printed URL and click "Enter the house"
npm run build    # production bundle in dist/
```

**Play with headphones, in a dark room.**

| Key | Action |
| --- | --- |
| `W A S D` | move |
| `Shift` | sprint (limited stamina) |
| `E` | interact — take keys / batteries, read notes, open doors (hold at the front door to unlock it) |
| `F` | flashlight on / off |
| `Esc` | release the mouse (pauses the game) |

Find the three brass keys (kitchen, study, bedroom — a random spot in each, every run), then unlock the front door.
Hold your beam on the entity to fill the burn meter and banish him — but he reforms, and burning drains the battery fast.

Design rules live in `SYSTEM_PROMPT.md`. Debug aids: append `?debug` to the URL to expose `window.__bhh` (the Game) and use
click-drag look if pointer lock is unavailable.

```
src/
  main.js              boot + title wiring
  Game.js              renderer/post stack, state machine, interaction, burn mechanic, loop
  world/Textures.js    procedural canvas textures
  world/House.js       floor plan, walls, hinged doors, furniture, items, lights
  player/Player.js     pointer-lock controls, collision, flashlight, battery
  systems/AudioEngine.js  synthesized drone/rain/thunder/stingers/chase music
  systems/Ghost.js     the entity: visuals + apparition/stalk/chase/banish/reform AI
  systems/ScareDirector.js  one-shot scripted scares, ambience, lightning, finale
  ui/HUD.js            objective, keys, battery, burn meter, flashes, shake, jumpscare
```
