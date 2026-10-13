import { Game } from './Game.js';

// Boot: builds the renderer, world and HUD, then starts the frame loop on the title screen.
const game = new Game(document.getElementById('app'));

// Dev builds expose the game for console debugging.
if (import.meta.env.DEV) window.game = game;
