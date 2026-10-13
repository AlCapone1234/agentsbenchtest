import { Game } from './Game.js';

const game = new Game();

function boot() {
  try {
    game.init();
  } catch (err) {
    console.error(err);
    const title = document.getElementById('title-screen');
    if (title) {
      title.insertAdjacentHTML(
        'beforeend',
        '<p class="fine">This browser could not start WebGL.</p>',
      );
    }
  }
}

document.getElementById('start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  game.start();
});
document.getElementById('title-screen').addEventListener('click', () => game.start());
document.getElementById('retry-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  game.restart();
});
document.getElementById('again-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  game.restart();
});
document.getElementById('note-screen').addEventListener('click', () => game.closeNote());
document.getElementById('pause').addEventListener('click', () => game.resume());

requestAnimationFrame(boot);
