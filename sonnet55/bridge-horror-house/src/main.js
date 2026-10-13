// Boot: show the title instantly, build the house on the next frame, then enable the Start button.
import { HUD } from './ui/HUD.js';
import { Game } from './Game.js';

const hud = new HUD();
hud.showTitle(true);
hud.showHUD(false);

setTimeout(() => {
  try {
    const game = new Game(document.getElementById('app'), hud);
    hud.el.startBtn.disabled = false;
    hud.el.startBtn.textContent = 'Enter the house';
    if (/[?&]autostart/.test(location.search)) game.begin();
  } catch (err) {
    console.error(err);
    hud.el.startBtn.textContent = 'Could not start (WebGL2 required)';
  }
}, 40);
