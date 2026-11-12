// ==UserScript==
// @name         No Flag Mod
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  For 1v1 in private squads. Two switches in the No Flag menu: hide the flag icons, and never pick up the enemy flag.
// @author       Lumos
// @match        *://narrow.one/*
// @run-at       document-start
// @grant        none
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='none' stroke='%234a90d9' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M30 12v76M30 18h42l-11 14 11 14H30M12 88 88 12'/%3E%3C/svg%3E
// ==/UserScript==

/*
Two independent switches
  Hide flag icons      The flag markers you see through walls are hidden, for both teams.
  Never pick up flags  Your game never asks the server for the enemy flag, so you cannot pick it up.
Everything else is untouched: the flag models, the score board, capturing a flag
you already hold, returning your own flag. Nothing extra is sent to the server.
It only changes your side; the other player needs the script too.

How the game works (checked against the live game, 2026-10)
  - Picking up a flag starts on the client. Every frame the player's loop checks
    the distance to each enemy flag and, within 1.5 units, calls
        player.sendChangeFlag(flagId, 0)        // 0 grab, 1 capture, 2 drop, 3 return
    which sends the request. The server answers and only then is the flag held.
    Not sending the request is the same, to the server, as never walking there.
  - Each flag owns a HUD icon:  flag.icon = hudIcons.createIcon(...)  and the game
    shows or hides it with  flag.icon.setVisibility(boolean).
  - Flags are made per match by  game.createFlag(...)  and kept in  game.flags.

Shared with love for the Narrow.One community :)
*/

/* eslint-disable no-console */
(function () {
    'use strict';

    const TAG = '[N1NF]';
    const VERSION = '1.0';

    if (window.__n1nf) { console.warn(TAG, 'already running, this second copy does nothing'); return; }

    /* ============================================================
     * 1. Config
     * ============================================================ */
    const CFG_KEY = 'n1nf_config_v1';
    const cfg = { hideIcons: false, blockPickup: false };
    try {
        const saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {};
        if (typeof saved.hideIcons === 'boolean') cfg.hideIcons = saved.hideIcons;
        if (typeof saved.blockPickup === 'boolean') cfg.blockPickup = saved.blockPickup;
    } catch (e) { /* unreadable or blocked storage: start switched off */ }
    function saveCfg() {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
        catch (e) { /* storage blocked: the choice lasts until the tab is closed */ }
    }
    const anythingOn = () => cfg.hideIcons || cfg.blockPickup;

    /* ============================================================
     * 2. What we know about the running game
     *    null = not known yet, true = works, false = this game version differs
     * ============================================================ */
    const support = { found: false, grab: null, icons: null, problems: [] };
    const counters = { blockedGrabs: 0, skippedCandidates: 0 };
    function problem(what) {
        if (support.problems.includes(what)) return;
        support.problems.push(what);
        console.warn(TAG, 'not found in this version of the game:', what);
    }

    /* ============================================================
     * 3. Wrapping a method of a game class
     *    The game's classes are minified (their names change every build) but
     *    method names stay, so we reach a class through one of its objects and
     *    replace the method on the class itself. Every object of that class,
     *    in this match and the next, then goes through the wrapper.
     * ============================================================ */
    const originalOf = new WeakMap();   // our wrapper -> the game's own function

    function findMethod(obj, name) {
        for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
            const desc = Object.getOwnPropertyDescriptor(p, name);
            if (desc) return typeof desc.value === 'function' ? { owner: p, desc } : null;
        }
        return null;
    }

    // Returns the game's own function, or null when the method does not exist.
    function wrapMethod(obj, name, build) {
        const found = findMethod(obj, name);
        if (!found) return null;
        const current = found.desc.value;
        if (originalOf.has(current)) return originalOf.get(current);   // class already wrapped
        const wrapper = build(current);
        originalOf.set(wrapper, current);
        Object.defineProperty(found.owner, name, Object.assign({}, found.desc, { value: wrapper }));
        return current;
    }

    /* ============================================================
     * 4. Never pick up flags
     * ============================================================ */
    const OP_GRAB = 0;

    function patchPlayerClass(player) {
        const original = wrapMethod(player, 'sendChangeFlag', (gameSend) => function sendChangeFlag(flagId, changeOperation) {
            if (cfg.blockPickup && changeOperation === OP_GRAB) {
                counters.blockedGrabs++;
                return undefined;                 // the request is simply never made
            }
            return gameSend.apply(this, arguments);
        });
        support.grab = !!original;
        if (!original) problem('player.sendChangeFlag');
    }

    /* ============================================================
     * 5. Hide flag icons
     *    We sit in front of icon.setVisibility for flag icons only. The game's
     *    wish is remembered and, while switched on, replaced by "hidden".
     *    Switching off replays the remembered wish, so the icon comes back in
     *    exactly the state the game wants.
     * ============================================================ */
    const flagIcons = new WeakMap();    // icon -> { wanted, gameSetVisibility }
    const knownFlags = new Set();

    // Same rule the game uses: visible, except for the flag I am carrying myself.
    function gameWantsIconVisible(flag) {
        const holder = flag.currentHoldingPlayer;
        return !holder || !holder.hasOwnership;
    }

    function applyIcon(flag) {
        const rec = flagIcons.get(flag.icon);
        if (!rec) return;
        try { rec.gameSetVisibility.call(flag.icon, cfg.hideIcons ? false : rec.wanted); }
        catch (e) { problem('icon.setVisibility call'); console.warn(TAG, e); }
    }

    function forgetDeadFlags() {
        for (const flag of knownFlags) if (flag.destructed) knownFlags.delete(flag);
    }

    function applyAllIcons() {
        forgetDeadFlags();
        for (const flag of knownFlags) applyIcon(flag);
    }

    function registerFlag(flag) {
        if (!flag || typeof flag !== 'object' || flag.destructed || knownFlags.has(flag)) return;
        const icon = flag.icon;
        if (!icon || typeof icon !== 'object') { support.icons = false; problem('flag.icon'); return; }

        const gameSetVisibility = wrapMethod(icon, 'setVisibility', (gameSet) => function setVisibility(visible) {
            const rec = flagIcons.get(this);
            if (!rec) return gameSet.apply(this, arguments);     // player icons share the class: untouched
            rec.wanted = !!visible;
            return gameSet.call(this, cfg.hideIcons ? false : visible);
        });
        if (!gameSetVisibility) { support.icons = false; problem('icon.setVisibility'); return; }

        knownFlags.add(flag);
        flagIcons.set(icon, { wanted: gameWantsIconVisible(flag), gameSetVisibility });
        if (support.icons === null) support.icons = true;
        if (cfg.hideIcons) applyIcon(flag);
    }

    function registerFlagsOf(game) {
        forgetDeadFlags();
        if (Array.isArray(game.flags)) for (const flag of game.flags) registerFlag(flag);
    }

    function patchGameClass(game) {
        const original = wrapMethod(game, 'createFlag', (gameCreate) => function createFlag() {
            const result = gameCreate.apply(this, arguments);
            try { registerFlagsOf(this); } catch (e) { console.warn(TAG, e); }
            return result;
        });
        if (!original) problem('game.createFlag');
    }

    /* ============================================================
     * 6. Finding the game
     *    The game keeps no global reference to itself. During a match its
     *    physics pushes collision records into an array every frame, and each
     *    record leads to the player and from there to the game. We listen on
     *    Array.prototype.push only until the first such record shows up, then
     *    put the browser's own push back. After that the wrapped classes cover
     *    every later match, so the listener is never needed again.
     *    While both switches are off we do not listen at all.
     * ============================================================ */
    const skipped = new WeakSet();

    const pushTap = {
        armed: false,
        inChain: false,     // is our function currently installed as Array.prototype.push?
        base: null,         // whatever push was when we installed ours

        arm() {
            this.armed = true;
            if (this.inChain) return;
            this.base = Array.prototype.push;
            Array.prototype.push = pushListener;
            this.inChain = true;
        },
        disarm() {
            this.armed = false;
            // Another script may have wrapped push after us. Then ours has to stay
            // in the chain, where it only passes calls through.
            if (this.inChain && Array.prototype.push === pushListener) {
                Array.prototype.push = this.base;
                this.inChain = false;
            }
        }
    };

    function pushListener() {
        if (pushTap.armed) {
            const first = arguments[0];
            if (first !== null && typeof first === 'object') inspectPushed(first);
        }
        return pushTap.base.apply(this, arguments);
    }

    function inspectPushed(item) {
        let player, game;
        try {
            const collider = item.playerCollider;
            if (!collider) return;
            player = collider.rigidBody && collider.rigidBody.player;
            game = player && player.game;
        } catch (e) { return; }
        if (!game || typeof game !== 'object' || skipped.has(game)) return;

        let looksLikeMatch = false;
        try { looksLikeMatch = Array.isArray(game.flags) && typeof game.createFlag === 'function'; } catch (e) { /* ignore */ }
        if (!looksLikeMatch) { skipped.add(game); counters.skippedCandidates++; return; }

        pushTap.disarm();
        // We are inside the game's physics step here; do the work right after it.
        setTimeout(() => adoptGame(game, player), 0);
    }

    function adoptGame(game, player) {
        if (support.found) return;
        support.found = true;
        try {
            patchPlayerClass(player);
            patchGameClass(game);
            registerFlagsOf(game);
        } catch (e) {
            problem('unexpected error while attaching');
            console.warn(TAG, e);
        }
        console.log(TAG, 'attached to the game | pickup block:', support.grab, '| icons:', support.icons, '| flags in this match:', knownFlags.size);
    }

    /* ============================================================
     * 7. Switching
     * ============================================================ */
    function setOption(name, value) {
        cfg[name] = !!value;
        saveCfg();
        if (!support.found) { if (anythingOn()) pushTap.arm(); else pushTap.disarm(); }
        applyAllIcons();
        syncSwitches();
    }

    /* ============================================================
     * 8. Styles (same structure as Chat Mod: the game's own paper dialog classes,
     *    our CSS only positions things)
     * ============================================================ */
    function applyStyles() {
        const style = document.createElement('style');
        style.id = 'n1nf-style';
        style.textContent = `
#n1nf-curtain {
  position: fixed; inset: 0; z-index: 99998;
  transition: opacity .2s ease, visibility .2s ease;
}
#n1nf-menu {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 480px; max-width: calc(100% - 20px);
  box-sizing: border-box; padding: 30px;
  z-index: 99999;
  transition: transform .2s cubic-bezier(0.3,-0.8,0.7,1.8),
              opacity .2s cubic-bezier(0.3,-0.8,0.7,1.8),
              visibility .2s cubic-bezier(0.3,-0.8,0.7,1.8);
  max-height: calc(100vh - 40px); overflow-y: auto;
}
#n1nf-menu.n1nf-hidden {
  transform: translate(-50%, -50%) scale(.6);
  opacity: 0; visibility: hidden; pointer-events: none;
}
#n1nf-curtain.n1nf-hidden { opacity: 0; visibility: hidden; pointer-events: none; }

#n1nf-menu .dialogTitle { margin: 0 0 14px; }

/* One block per switch: the switch row, then what it does. */
#n1nf-menu .n1nf-option { padding: 12px 0 14px; border-top: 1px solid rgba(128,128,128,.45); }
#n1nf-menu .n1nf-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-family: sans-serif; font-size: 17px; font-weight: 700; cursor: pointer;
}
#n1nf-menu .n1nf-toggle input { flex: none; width: 18px; height: 18px; cursor: pointer; accent-color: currentColor; }
#n1nf-menu .n1nf-effects {
  list-style: none; margin: 8px 0 0; padding: 0;
  font-family: sans-serif; font-size: 14px; line-height: 1.55; opacity: .8;
}
#n1nf-menu .n1nf-effects li { position: relative; padding-left: 16px; margin-top: 3px; }
#n1nf-menu .n1nf-effects li::before { content: '-'; position: absolute; left: 3px; }

#n1nf-menu .n1nf-warning {
  margin: 0; padding-top: 12px; border-top: 1px solid rgba(128,128,128,.45);
  font-family: sans-serif; font-size: 14px; line-height: 1.55; font-weight: 700;
}

#n1nf-menu .dialogButtonsContainer { display: flex; justify-content: center; margin-top: 20px; }
#n1nf-menu .dialog-button { cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  #n1nf-curtain, #n1nf-menu { transition: none; }
}

/* Main menu button: a copy of a game button, only the picture is ours. */
#n1nf-menu-btn .buttonImage {
  background-image: var(--n1nf-icon) !important;
  background-size: 66% !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    /* ============================================================
     * 9. Settings dialog
     * ============================================================ */
    let menu = null, curtain = null, iconsBox = null, pickupBox = null;
    const rndSeed = () => Math.floor(Math.random() * 99999) + 1;   // the paper texture wants a seed per element

    function createMenu() {
        if (menu) return menu;

        curtain = document.createElement('div');
        curtain.id = 'n1nf-curtain';
        curtain.className = 'dialogCurtain fullScreen n1nf-hidden';
        curtain.addEventListener('click', () => closeMenu());
        document.body.appendChild(curtain);

        menu = document.createElement('div');
        menu.id = 'n1nf-menu';
        menu.className = 'dialog wrinkledPaper n1nf-hidden';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-labelledby', 'n1nf-title');
        menu.style.setProperty('--wrinkled-paper-seed', rndSeed());
        menu.innerHTML = `
      <h2 id="n1nf-title" class="dialogTitle blueNight">No Flag <span style="font-size:14px;opacity:.5">v${VERSION}</span></h2>

      <div class="n1nf-option">
        <label class="n1nf-toggle"><span class="settings-item-text">Hide flag icons</span><input type="checkbox" id="n1nf-icons" aria-describedby="n1nf-icons-effects"></label>
        <ul class="n1nf-effects" id="n1nf-icons-effects">
          <li>The flag icons of both teams disappear from your screen.</li>
          <li>You no longer see where the flags are, even while someone carries one.</li>
          <li>The flags themselves and the score board stay visible.</li>
        </ul>
      </div>

      <div class="n1nf-option">
        <label class="n1nf-toggle"><span class="settings-item-text">Never pick up flags</span><input type="checkbox" id="n1nf-pickup" aria-describedby="n1nf-pickup-effects"></label>
        <ul class="n1nf-effects" id="n1nf-pickup-effects">
          <li>Walking over the enemy flag no longer picks it up.</li>
          <li>So you are never slowed down or shown to the enemy by a flag.</li>
          <li>A flag you already carry stays in your hands.</li>
        </ul>
      </div>

      <p class="n1nf-warning">&#9888;&#65038; Both switches only change your own game. Other players still see the icons and can still take flags.</p>

      <div class="dialogButtonsContainer">
        <button type="button" class="dialog-button blueNight wrinkledPaper" id="n1nf-close">Close</button>
      </div>
    `;
        document.body.appendChild(menu);

        const closeBtn = menu.querySelector('#n1nf-close');
        closeBtn.style.setProperty('--wrinkled-paper-seed', rndSeed());
        closeBtn.addEventListener('click', () => closeMenu());

        iconsBox = menu.querySelector('#n1nf-icons');
        pickupBox = menu.querySelector('#n1nf-pickup');
        iconsBox.addEventListener('change', () => setOption('hideIcons', iconsBox.checked));
        pickupBox.addEventListener('change', () => setOption('blockPickup', pickupBox.checked));

        syncSwitches();
        return menu;
    }

    function syncSwitches() {
        if (!menu) return;
        iconsBox.checked = cfg.hideIcons;
        pickupBox.checked = cfg.blockPickup;
    }

    const menuIsOpen = () => !!menu && !menu.classList.contains('n1nf-hidden');

    function openMenu() {
        const m = createMenu();
        m.style.setProperty('--wrinkled-paper-seed', rndSeed());
        syncSwitches();
        void m.offsetWidth;   // apply the hidden styles first so the opening transition plays
        curtain.classList.remove('n1nf-hidden');
        m.classList.remove('n1nf-hidden');
        try { iconsBox.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    function closeMenu() {
        if (!menu) return;
        menu.classList.add('n1nf-hidden');
        curtain.classList.add('n1nf-hidden');
        const focused = document.activeElement;
        if (focused && menu.contains(focused)) focused.blur();   // do not leave focus on a hidden control
    }
    function toggleMenu() { if (menuIsOpen()) closeMenu(); else openMenu(); }

    // Esc closes our dialog before the game sees the key.
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menuIsOpen()) { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    }, true);

    /* ============================================================
     * 10. Main menu button
     *     .menu-buttons-container holds one .main-menu-button-container per entry
     *     (Settings, Shop, ... Full Screen). The game hides that whole menu when
     *     you enter a match, so a button placed inside it leaves and returns
     *     together with the others.
     * ============================================================ */
    const MENU_BTN_ID = 'n1nf-menu-btn';

    // Black line art like the game's own icons; the game recolours icons for dark themes.
    const MENU_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
        'stroke="#000000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M30 12 v76"/>' +
        '<path d="M30 18 h42 l-11 14 l11 14 h-42"/>' +
        '<path d="M12 88 L88 12"/>' +
        '</svg>'
    );

    function findFullScreenEntry() {
        for (const entry of document.querySelectorAll('.main-menu-button-container')) {
            const btn = entry.querySelector('button.main-menu-button');
            if (btn && (btn.getAttribute('aria-label') || '').trim().toLowerCase() === 'full screen') return entry;
        }
        return null;
    }

    function injectMenuButton() {
        if (document.getElementById(MENU_BTN_ID)) return;
        const fsEntry = findFullScreenEntry();
        if (!fsEntry || !fsEntry.parentElement) return;

        // Copy the Full Screen entry so ours looks exactly like the game's.
        const ours = fsEntry.cloneNode(true);
        ours.id = MENU_BTN_ID;
        ours.style.display = '';      // in full screen the game hides that entry; ours must not inherit that
        ours.style.setProperty('--n1nf-icon', 'url("' + MENU_ICON + '")');

        const btn = ours.querySelector('button.main-menu-button');
        if (btn) {
            btn.setAttribute('aria-label', 'No Flag');
            btn.style.setProperty('--wrinkled-paper-seed', rndSeed());
            const img = btn.querySelector('.buttonImage');     // drop the copied picture
            if (img) { img.style.backgroundImage = ''; img.style.backgroundSize = ''; }
        }
        const label = ours.querySelector('.main-menu-button-text');
        if (label) label.textContent = 'No Flag';
        ours.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); }, true);

        // Go below Full Screen and below buttons other scripts of this family put there.
        let after = fsEntry;
        while (after.nextElementSibling && /^n1[a-z]+-menu-btn$/.test(after.nextElementSibling.id)) after = after.nextElementSibling;
        after.parentElement.insertBefore(ours, after.nextSibling);
    }

    /* ============================================================
     * 11. Boot
     * ============================================================ */
    // For troubleshooting: type  __n1nf.status()  in the console.
    window.__n1nf = {
        version: VERSION,
        status() {
            forgetDeadFlags();
            return {
                version: VERSION,
                hideIcons: cfg.hideIcons,
                blockPickup: cfg.blockPickup,
                gameFound: support.found,
                pickupBlockSupported: support.grab,
                iconsSupported: support.icons,
                problems: support.problems.slice(),
                blockedGrabs: counters.blockedGrabs,
                skippedCandidates: counters.skippedCandidates,
                listening: pushTap.armed,
                listenerInstalled: pushTap.inChain,
                flags: Array.from(knownFlags, (flag) => {
                    const rec = flagIcons.get(flag.icon);
                    return { teamId: flag.teamId, gameWantsIcon: rec ? rec.wanted : null, shownNow: rec ? (cfg.hideIcons ? false : rec.wanted) : null };
                })
            };
        }
    };

    if (anythingOn()) pushTap.arm();

    function boot() {
        applyStyles();
        injectMenuButton();
        // The game can redraw its menu and drop our button, so keep checking (cheap when it is there).
        setInterval(injectMenuButton, 1000);
        console.log(TAG, 'v' + VERSION, 'ready | hideIcons=' + cfg.hideIcons, 'blockPickup=' + cfg.blockPickup);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();