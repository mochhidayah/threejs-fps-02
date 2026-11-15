// The DOM HUD: health, armor, ammo, money, score, timer, bomb line, killfeed,
// hitmarker, dynamic crosshair, damage vignette, flash overlay, buy menu,
// objective banner and the one overlay panel. It never touches the
// simulation; main.js pushes numbers in and reads the play / buy callbacks
// out. All nodes are cached once; nothing is created per frame (killfeed
// rows and buy rows are built on events, never in the frame loop).
const COPY = {
  start: {
    title: 'IRONBOUND',
    copy: 'Hold the yard. Plant the device at Foundry or Depot, or clear every Sentinel. First crew to five rounds takes the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'IRONBOUND',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Round over',
    copy: 'The round is done.',
    action: 'Play again',
  },
  match: {
    title: 'Match over',
    copy: 'The yard is decided.',
    action: 'Play again',
  },
};

const BUY_KEYS = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit0: '0' };

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const moneyEl = $('money');
  const scoreVan = $('score-van');
  const scoreSen = $('score-sen');
  const roundNum = $('round-num');
  const timerEl = $('timer');
  const bombEl = $('bomb');
  const feed = $('killfeed');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyEl = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const dmgEl = $('dmg');
  const dmgDir = $('dmg-dir');
  const flashEl = $('flash');

  let hitTimer = 0;
  let bannerTimer = 0;
  let dmgTimer = 0;
  let buyHandler = null;
  let buyOpenFlag = false;
  let buyRowsBuilt = false;
  const buyRows = [];
  let lastMag = -1;
  let lastReserve = -1;
  let lastName = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScoreV = -1;
  let lastScoreS = -1;
  let lastRound = -1;
  let lastBomb = '';
  let lastSpread = -1;

  window.addEventListener('keydown', (event) => {
    if (!buyOpenFlag || !buyHandler || event.repeat) return;
    const id = BUY_KEYS[event.code];
    if (id) buyHandler(id);
  });

  return {
    setHealth(hp, armor) {
      if (hp === lastHealth && armor === lastArmor) return;
      lastHealth = hp;
      lastArmor = armor;
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      armorNum.textContent = String(Math.max(0, Math.ceil(armor)));
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastName) return;
      lastMag = mag;
      lastReserve = reserve;
      lastName = name || '';
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = lastName;
      ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(n) {
      if (n === lastMoney) return;
      lastMoney = n;
      moneyEl.textContent = `$${n}`;
    },
    setTimer(s) {
      if (s === lastTimer) return;
      lastTimer = s;
      const m = Math.floor(s / 60);
      const r = s % 60;
      timerEl.textContent = `${m}:${r < 10 ? '0' : ''}${r}`;
    },
    setScore(v, s) {
      if (v === lastScoreV && s === lastScoreS) return;
      lastScoreV = v;
      lastScoreS = s;
      scoreVan.textContent = s === undefined ? `Score ${v}` : `VAN ${v}`;
      scoreSen.textContent = s === undefined ? '' : `${s} SEN`;
    },
    setRound(n) {
      if (n === lastRound) return;
      lastRound = n;
      roundNum.textContent = `ROUND ${n}`;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombEl.textContent = text;
    },
    setSpread(px) {
      const p = Math.round(px);
      if (p === lastSpread) return;
      lastSpread = p;
      crosshair.style.setProperty('--gap', `${p}px`);
    },
    killfeed(text) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      feed.prepend(row);
      while (feed.children.length > 4) feed.lastChild.remove();
      setTimeout(() => row.remove(), 5000);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    banner(titleText, sub) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = sub || '';
      bannerEl.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('on'), 3800);
    },
    showBuy(items, money) {
      if (!buyRowsBuilt) {
        buyRowsBuilt = true;
        for (const item of items) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'buy-row';
          const key = document.createElement('span');
          key.className = 'buy-key';
          key.textContent = item.id;
          const label = document.createElement('span');
          label.className = 'buy-label';
          label.textContent = item.label;
          const price = document.createElement('span');
          price.className = 'buy-price';
          price.textContent = item.price ? `$${item.price}` : '';
          row.append(key, label, price);
          row.addEventListener('click', () => { if (buyHandler) buyHandler(item.id); });
          buyList.appendChild(row);
          buyRows.push({ row, item });
        }
      }
      buyMoney.textContent = `$${money}`;
      for (const { row, item } of buyRows) {
        row.classList.toggle('cant', item.price > money && !item.owned);
        row.classList.toggle('owned', !!item.owned);
      }
      buyEl.hidden = false;
      buyOpenFlag = true;
    },
    hideBuy() {
      buyEl.hidden = true;
      buyOpenFlag = false;
    },
    buyOpen() {
      return buyOpenFlag;
    },
    damageFlash(dirAngle) {
      dmgEl.style.opacity = '0.85';
      dmgDir.style.transform = `translate(-50%, -50%) rotate(${dirAngle}rad)`;
      dmgDir.classList.add('on');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => {
        dmgEl.style.opacity = '0';
        dmgDir.classList.remove('on');
      }, 180);
    },
    flashWhite(strength) {
      const s = Math.max(0, Math.min(1, strength));
      if (s <= 0) return;
      flashEl.style.transition = 'none';
      flashEl.style.opacity = String(s);
      void flashEl.offsetWidth;
      flashEl.style.transition = 'opacity 2.5s linear';
      flashEl.style.opacity = '0';
    },
    showOverlay(mode, data) {
      const text = COPY[mode] || COPY.start;
      title.textContent = text.title;
      if (mode === 'match' && data && typeof data === 'object') {
        copy.textContent = `Final score — Vanguards ${data.v} — ${data.s} Sentinels. ${data.v > data.s ? 'The yard is yours.' : 'The Sentinels held the yard.'}`;
      } else if (mode === 'end' && typeof data === 'number') {
        copy.textContent = `${text.copy} You scored ${data}.`;
      } else {
        copy.textContent = text.copy;
      }
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
