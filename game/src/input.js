// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it holds it.
// Edge actions: B opens the buy menu (onBuy callback), G queues a grenade throw, Q queues
// a grenade cycle (consumed via takeGrenade/takeCycle). Right mouse is tracked as state.rmb
// for DMR zoom. E and Digit keys ride the keys set for plant/defuse and buy choices.
export function createInput(canvas, onLockChange, onBuy) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, rmb: false, lookX: 0, lookY: 0 };
  let grenadeQueued = false;
  let cycleQueued = false;

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => {
    setKey(event, true);
    if (event.repeat) return;
    if (event.code === 'KeyB' && onBuy) onBuy();
    else if (event.code === 'KeyG') grenadeQueued = true;
    else if (event.code === 'KeyQ') cycleQueued = true;
  });
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    else if (event.button === 2) state.rmb = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    else if (event.button === 2) state.rmb = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.rmb = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    takeGrenade() {
      const queued = grenadeQueued;
      grenadeQueued = false;
      return queued;
    },
    takeCycle() {
      const queued = cycleQueued;
      cycleQueued = false;
      return queued;
    },
  };
}
