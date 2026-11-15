// Rounds & economy for IRONBOUND: menu -> buy (12 s) -> live (100 s) ->
// over (4 s banner) -> buy ... -> match. First to 5 wins (max 9 rounds).
// Money: start $800, kill +$300, win +$3250, loss +$1900 (+$2400 after 2+
// consecutive losses), plant +$300. rounds.js owns money; weapon.js owns
// the loadout; player.js owns health/armor. ctx gains `spawns` (world
// spawns) so the player can be reset to the Vanguard spawn each round.
const BUY_TIME = 12;
const ROUND_TIME = 100;
const OVER_TIME = 4;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const START_MONEY = 800;
const KILL_MONEY = 300;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const LOSS_STREAK_MONEY = 2400;
const PLANT_MONEY = 300;
const KEVLAR_ARMOR = 50;

const ITEMS = [
  { id: '1', key: 'vk9', label: 'VK-9 Jackal — rifle', price: 2700, owned: false },
  { id: '2', key: 'wasp9', label: 'Wasp-9 — SMG', price: 1500, owned: false },
  { id: '3', key: 'longbow', label: 'Longbow — DMR', price: 4000, owned: false },
  { id: '4', key: 'he', label: 'HE grenade', price: 300, owned: false },
  { id: '5', key: 'flash', label: 'Flash grenade', price: 200, owned: false },
  { id: '6', key: 'kevlar', label: 'Kevlar vest (+50 armor)', price: 650, owned: false },
  { id: '0', key: 'done', label: 'Done — close the shop', price: 0, owned: false },
];

const REASON_TEXT = {
  elimination: 'Enemy team eliminated',
  detonation: 'Device detonated',
  defused: 'Device defused',
  time: 'Time expired',
};

export function createRounds(ctx) {
  const { weapon, objective, bots, player, audio, hud } = ctx;
  const api = {
    phase: 'menu',
    round: 1,
    timer: 0,
    scores: { vanguard: 0, sentinel: 0 },
    money: START_MONEY,
    kills: 0,
    grenades: { he: 0, flash: 0 },
    owned: { vk9: false, wasp9: false, longbow: false },
    items: ITEMS,
    losses: 0,
    armorKept: false,
    playerDied: false,

    step(dt) {
      if (api.phase === 'buy') {
        api.timer -= dt;
        if (api.timer <= 0) api.startRound();
      } else if (api.phase === 'live') {
        const planted = objective.state === 'planted' || objective.state === 'defusing';
        if (planted) {
          api.timer = Math.max(0, objective.fuseLeft);
        } else {
          api.timer -= dt;
          if (api.timer <= 0) { api.endRound('sentinel', 'time'); return; }
        }
        const senAlive = bots.aliveCount('sentinel');
        const vanAlive = bots.aliveCount('vanguard') + (player.state.alive ? 1 : 0);
        if (senAlive === 0) api.endRound('vanguard', 'elimination');
        else if (vanAlive === 0 && !planted) api.endRound('sentinel', 'elimination');
      } else if (api.phase === 'over') {
        api.timer -= dt;
        if (api.timer <= 0) {
          if (api.scores.vanguard >= WIN_ROUNDS || api.scores.sentinel >= WIN_ROUNDS || api.round >= MAX_ROUNDS) {
            api.phase = 'match';
            api.timer = 0;
            if (ctx.onMatchEnd) ctx.onMatchEnd({ v: api.scores.vanguard, s: api.scores.sentinel });
          } else {
            api.round += 1;
            api.startBuyPhase();
          }
        }
      }
    },

    startBuyPhase() {
      if (api.playerDied) {
        // Bought primaries (and grenades) are lost with the player; pistol kept.
        api.owned = { vk9: false, wasp9: false, longbow: false };
        for (const item of ITEMS) item.owned = false;
        api.grenades = { he: 0, flash: 0 };
        api.armorKept = false;
        weapon.select('p9');
        api.playerDied = false;
      }
      api.phase = 'buy';
      api.timer = BUY_TIME;
      const spawn = ctx.spawns && ctx.spawns.vanguard ? ctx.spawns.vanguard[2] : null;
      if (spawn) player.reset(spawn);
      if (api.armorKept) player.addArmor(KEVLAR_ARMOR);
      bots.reset(api.round);
      objective.reset();
      weapon.refill();
      hud.showBuy(ITEMS, api.money);
    },

    startRound() {
      api.phase = 'live';
      api.timer = ROUND_TIME;
      hud.hideBuy();
      if (ctx.onRoundStart) ctx.onRoundStart();
    },

    endRound(winner, reason) {
      if (api.phase !== 'live') return;
      api.playerDied = !player.state.alive;
      if (winner === 'vanguard') {
        api.scores.vanguard += 1;
        api.money += WIN_MONEY;
        api.losses = 0;
        audio.roundWin();
      } else {
        api.scores.sentinel += 1;
        api.losses += 1;
        api.money += api.losses >= 2 ? LOSS_STREAK_MONEY : LOSS_MONEY;
        audio.roundLoss();
      }
      api.phase = 'over';
      api.timer = OVER_TIME;
      hud.banner(
        winner === 'vanguard' ? 'VANGUARDS TAKE THE ROUND' : 'SENTINELS HOLD THE ROUND',
        `${REASON_TEXT[reason] || reason} — VAN ${api.scores.vanguard} : ${api.scores.sentinel} SEN`,
      );
    },

    buy(id) {
      const item = ITEMS.find((it) => it.id === String(id));
      if (!item) return false;
      if (item.key === 'done') { hud.hideBuy(); return true; }
      if (api.phase !== 'buy') return false;
      if (item.key === 'he' || item.key === 'flash') {
        if (api.money < item.price) return false;
        api.money -= item.price;
        api.grenades[item.key] += 1;
      } else if (item.key === 'kevlar') {
        if (api.money < item.price) return false;
        api.money -= item.price;
        player.addArmor(KEVLAR_ARMOR);
        api.armorKept = true;
      } else if (api.owned[item.key]) {
        weapon.select(item.key);
        audio.click();
        hud.showBuy(ITEMS, api.money);
        return true;
      } else {
        if (api.money < item.price) return false;
        api.money -= item.price;
        api.owned[item.key] = true;
        item.owned = true;
        weapon.select(item.key);
      }
      audio.buy();
      hud.setMoney(api.money);
      hud.showBuy(ITEMS, api.money);
      return true;
    },

    resetMatch() {
      api.scores = { vanguard: 0, sentinel: 0 };
      api.money = START_MONEY;
      api.round = 1;
      api.kills = 0;
      api.losses = 0;
      api.grenades = { he: 0, flash: 0 };
      api.owned = { vk9: false, wasp9: false, longbow: false };
      for (const item of ITEMS) item.owned = false;
      api.armorKept = false;
      api.playerDied = false;
      api.phase = 'menu';
      api.timer = 0;
      weapon.select('p9');
      hud.hideBuy();
    },

    addKill() {
      api.kills += 1;
      api.money += KILL_MONEY;
      hud.setMoney(api.money);
    },

    plantBonus() {
      api.money += PLANT_MONEY;
      hud.setMoney(api.money);
    },

    hasWeapon(key) {
      return key === 'p9' || !!api.owned[key];
    },
  };
  return api;
}
