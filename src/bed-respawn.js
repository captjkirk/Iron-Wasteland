'use strict';
// ── src/bed-respawn.js — bed respawn in 2-player Survival (#294) ──
// Loads after src/game-scene.js and adds _bedRespawn to GameScene (ADR 0002).
// Sleeping in a bed records it as that player's respawn bed (toggleSleep sets p.respawnBed). When a
// downed player's timer runs out in 2-player Survival and their bed still stands, they come back at
// it with half health and half of each carried resource instead of dying for good.

Object.assign(GameScene.prototype, {
  // Returns true when the player came back at their bed; false leaves today's permanent death.
  _bedRespawn(p) {
    const bed = p.respawnBed;
    if (this.solo || this.hardcore || !bed || !bed.spr || !bed.spr.active || !this.beds.includes(bed)) return false;
    if (p.downText) { p.downText.destroy(); p.downText = null; }
    p.isDowned = false;
    p.downTimer = 0;
    p._revivePromptShown = false;
    if (this.reviveTarget === p) { this.reviveProgress = 0; this.reviving = false; this.reviveTarget = null; }
    p.hp = Math.ceil(p.maxHp / 2);
    // ponytail: rounds down, so a single carried item is lost.
    for (const k of Object.keys(p.inv)) p.inv[k] = Math.floor((p.inv[k] || 0) / 2);
    p.carriedAmmo = Math.floor((p.carriedAmmo || 0) / 2);
    p.spr.setPosition(bed.x, bed.y);
    if (p.spr.body) p.spr.body.reset(bed.x, bed.y);
    if (p._frostSlowed) p.spr.setTint(0x88ccff);
    else p.spr.clearTint();
    p.spr.setAlpha(1);
    this._hudDirty = true;
    const tile = `(${Math.floor(bed.x / CFG.TILE)},${Math.floor(bed.y / CFG.TILE)})`;
    this._log(`${p.charData.player} RESPAWNED at bed ${tile}  hp=${p.hp}/${p.maxHp}  inv=${JSON.stringify(p.inv)}  day=${this.dayNum}`, 'player');
    this.hint(p.charData.player + ' woke up at their bed with half health and half their items!', 4000, { urgent: true });
    return true;
  },
});
