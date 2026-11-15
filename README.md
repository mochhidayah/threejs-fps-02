# IRONBOUND — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/mochhidayah/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/mochhidayah/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the Counter-Strike style, built on three.js: two teams,
short rounds won by eliminating the other team or by planting and defending the bomb,
money earned each round and spent in a buy menu, and gunfire where accuracy counts
more than speed. Single-player against bots, from static files, no build step, no network.

You are a Vanguard attacking the Ironbound Yard. Four bot teammates push with you;
five Sentinel bots hold the Foundry and the Depot. Plant the bomb at a site, defend it
until it blows — or clear the defenders. Win the round, take the money, buy a better
gun, go again. First to 5 rounds takes the match.

- 5v5 with bot AI: waypoint routes, hold positions, reactions to sight and sound
- Bomb plant/defuse objective, round timer, buy menu, per-round economy
- Four weapons (pistol, rifle, SMG, DMR) plus HE and flash grenades, kevlar
- Hitscan gunplay with headshots, recoil, spread bloom, crouch and collision
- Synthesized WebAudio sounds — no audio files, no external assets
- Original map, art, sounds and names

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Controls: WASD move, mouse look, click fire, R reload, Ctrl/C crouch, Space jump,
B buy menu, E plant/defuse, G throw grenade, Q cycle grenade, right-click scope (DMR).

---

<sub>Entered on [make.fun](https://make.fun/?ref=27zee63t&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
