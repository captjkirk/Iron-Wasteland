'use strict';
// ── src/recipes.js — the craft menu's recipes (data only) ───────────────────────────────
// The one table of what each thing costs. The craft menu lists it in this order, craftSelected
// charges rec.cost for instant items and upgrades, and getBuildCost (src/building-crafting.js)
// charges the same cost when a build is placed and refunds half of it on teardown.
// scripts/check-recipes.js (npm run check) checks every cost names a resource and every charId a CHARS id.
//
// type: build (enter build mode, pay on placement), instant (pay and apply now), upgrade (pay,
// then set the charId player's upgrade flag). charId on an instant item: only that character crafts it.

const RECIPES = [
  { label: 'Wall',               key: 'wall',              cost: {wood:3},                  needsBench: false, type: 'build',   tooltip: 'Blocks enemies and absorbs damage before collapsing.' },
  { label: 'Gate',               key: 'gate',              cost: {wood:4, metal:2},         needsBench: false, type: 'build',   tooltip: 'Players pass through freely; blocks all enemies. Toggle with interact.' },
  { label: 'Campfire',           key: 'campfire',          cost: {wood:5},                  needsBench: false, type: 'build',   tooltip: 'Slowly restores HP for nearby players. Provides light at night.' },
  { label: 'Torch',              key: 'torch',             cost: {wood:2, fiber:1},         needsBench: false, type: 'build',   tooltip: 'Lights a small area at night. Cheap — place liberally around your base.' },
  { label: 'Spike Trap',         key: 'spike_trap',        cost: {wood:2, metal:1},         needsBench: false, type: 'build',   tooltip: 'Damages any enemy that steps on it. Stays active indefinitely.' },
  { label: 'Craftbench',         key: 'craftbench',        cost: {wood:5, metal:3},         needsBench: false, type: 'build',   tooltip: 'Required to unlock advanced recipes, upgrades, and the Bed.' },
  { label: 'Bed',                key: 'bed',               cost: {wood:8, fiber:6, metal:2},needsBench: true,  type: 'build',   tooltip: 'Sleep in it to heal over time. When everyone sleeps, the night skips ahead.' },
  { label: 'Reinforced Wall',    key: 'reinforced_wall',   cost: {wood:4, metal:3},         needsBench: true,  type: 'build',   tooltip: 'Twice as durable as a standard wall. Holds the line against heavy raids.' },
  { label: 'Med Kit (+40 HP)',   key: 'med_kit',           cost: {fiber:3, food:2},         needsBench: true,  type: 'instant', tooltip: 'Instantly restores 40 HP to the crafter. Use when critically wounded.' },
  { label: 'Ammo Pack (+8)',     key: 'ammo_pack',         cost: {metal:2},                 needsBench: false, type: 'instant', charId: 'gunslinger', tooltip: 'Gunslinger only: adds 8 rounds to the Gunslinger\'s reserve immediately.' },
  { label: 'Knight Upgrade',     key: 'knight_upgrade',    cost: {metal:3, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'knight',     tooltip: 'Knight: unlocks Shield Throw ability + passive 70% damage block.' },
  { label: 'Architect Upgrade',  key: 'architect_upgrade', cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'architect',  tooltip: 'Architect: unlocks Nail Gun secondary attack.' },
  { label: 'Gunslinger Upgrade', key: 'gunslinger_upgrade',cost: {metal:2, fiber:1},        needsBench: true,  type: 'upgrade', charId: 'gunslinger', tooltip: 'Gunslinger: increases clip size by 4 rounds (8 → 12).' },
  { label: 'Flower Bouquet (+8)',key: 'flower_bouquet',    cost: {wood:1, fiber:1},         needsBench: false, type: 'instant', charId: 'charmer',    tooltip: 'Lauren only: gives her 8 flower tosses immediately.' },
  { label: 'Lauren Upgrade',     key: 'charmer_upgrade',   cost: {metal:2, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'charmer',    tooltip: 'Lauren: daytime charm aura 200→280px; night aura 0→140px.' },
  { label: 'Abigail Upgrade',    key: 'ranger_upgrade',    cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'ranger',     tooltip: 'Abigail: unlocks Ranger passive buff and special ability.' },
];
