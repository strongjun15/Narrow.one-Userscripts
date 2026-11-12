# Userscripts for Narrow One 🏹
> This repository contains JS scripts developed by Lumos to make playing [Narrow One](https://narrow.one) more fun and convenient.

To run these scripts, Tampermonkey or Violentmonkey (Google Chrome extensions to run JS) is needed :
* have a look at this [guidline by N1CN](https://github.com/N1CNmod/narrowone-mod#how-to-run-the-scripts-step-by-step-guide)
* or [youtube vedio made by 【/ℕ𝕏/】 𝕶𝖛𝖊𝖝](https://www.youtube.com/watch?v=Cq7HAGtWuQ0)

## 💬 Chat Mod with Translation

![Chat Mod with Translation](chatmod.png)

Real-time translation and adaptive text color features considering the background to enhance your gameplay experience.

Deepest gratitude and honor to [Wolfart](https://github.com/N1-wolfart). I developed this by adding some features on original transparent chat UI mod created by [N1CNmod](https://github.com/N1CNmod/narrowone-mod) :)

I express gratitude to [vyrin](https://github.com/n1vyrin) as well who helped develope more polished code.

### Features

* Transparent Chat UI (Original): Replaces the bulky default chat box with a clean, transparent, and non-intrusive interface.
* **Adaptive Text Color:** The script reads the game background in real-time and automatically adjusts the chat text color (switching between dark and light modes with a subtle glow) to ensure maximum readability against any environment.
* **Two-Way Translation:** 
  * **Incoming Chat:** Translate messages from other players into your native language.
  * **Outgoing Chat:** Translate what you are typing into your friend's language instantly before sending.
* **Auto-Translation:** Automatically translates new incoming chat messages as they appear on the screen. (This can be toggled on/off in the settings).
* **No API Key Required:** Uses a lightweight Google Translate backend that works out of the box.

### How to Use (Keybinds)

Click the file named **Chat Mod with Translation**, download it, and upload it on Tampermonkey.
Or you can just copy the script, create a new file in Tampermonkey by clicking `+`, and pasting it.

| Shortcut | Action | Description |
|---|---|---|
| `_` (underbar, Shift + `-`)  | Open/Close Settings Menu | Opens the **Chat Translator** panel. Press again to close it. |
| `\` (When not typing) | Translate Chat Log | Press outside the chat input box to instantly translate all currently visible chat messages into your language. Press again to revert to the original messages. (Note : if you are unfamiliar with this shortcut key, don't you worry! `-` from v1.0 still works.) |
| `\`   (When typing) | Translate Your Input | While typing a message in the chat input box, press this to instantly translate your typed text into your designated "Friend's Language." |

### Settings Menu Overview

Press `_` or click 'CHAT TRANSLATION' to access the configuration panel:

| Setting | Description |
|---|---|
| **My language** | Set this to your native language. Incoming chat messages will be translated into this language. |
| **My friend's language** | Set this to the language you want your outgoing messages to be translated into. |
| **Adaptive text color** | Toggle the real-time contrast-aware text color engine. |
| **Auto-translate new messages** | When enabled, any new message popping up in the chat log will be automatically translated to your language. (Disabled by default). |
| **Translate player names** | When enabled, player names are translated along with their messages, not just the message text. (Disabled by default). |
| **Show language when it changes** | When enabled, a small tag appears next to a translated message showing what language it was originally written in — but only when it's different from the last one shown, so short back-to-back messages in the same language don't get tagged individually. (Enabled by default). |

⚠️ Clicking the panel shows the frequently used languages, but searching reveals many more.

### Changelog

* **Chat Mod with Translation v1.0 :**
  * The first version. Added adaptive text color and translation feature on original chat mod made by Wolfart.

* **Chat Mod with Translation v1.1 :**
  * Modified Settings Medu's UI  just like other Menu's (Settigns, Shop, Squad, etc) in Narrow One
  * Modified shortcut keys (You can know translate others' messages and the message you are typing with just one shortcut key `\`)
  * Added a dashboard icon (`@icon`) to the userscript metadata block for easier identification in Tampermonkey/Violentmonkey
  * Fixed minor bugs

 * **Chat Mod with Translation v2.0 :**
   * **Backup translation engine (Microsoft)** — translations now try Google and Microsoft at the same time and use whichever comes back first. If one service is slow or temporarily down, you won't notice — it just falls back to the other.
   * **Player name translation** — you can now translate player names too, not just chat messages (off by default, turn it on in settings).
   * **"What language is this?" tags** — translated messages now show what language they were originally written in, but only when it's different from the last one shown. This keeps short spammy chat (`uh`, `bruh`, `thx`) from getting cluttered with a tag on every single line, while still making sure you're never left wondering what language is currently being spoken, even if the last tagged message already scrolled away.
   * Slightly reduced how often the mod checks chat background color for text contrast, for a small performance improvement with no visible difference in how fast colors adapt.
   
### Additional Licensing

This script is based on the work of N1CNmod.

The original source code remains the intellectual property of its original author.
All original copyright notices and attributions have been preserved.

The MIT License included in this repository applies only to the original code,
modifications, and additions created by me, Lumos. It does not replace,
override, or relicense any portion of the original author's work.

If you reuse this repository, please preserve both the original attribution and
the attribution for my modifications :)

## 📖 Adaptive Center Dot
Adds a centered dot to the screen for easier aiming.

### Features
* **Color Sync:** Synchronizes with your in-game crosshair's color and crosshair's outline color.

### How to Use

Click the file named **Adaptive Center Dot**, download it, and upload it on Tampermonkey.
Or you can just copy the script, create a new file in Tampermonkey by clicking `+`, and pasting it.

## 🗡️ Kill Feed
Shows a kill feed in the top right corner of the screen.

### Features
* **Kills & Deaths:** Kills confirmed by the server, plus deaths from falling and spikes.
* **Flag Events:** Flag grabs, captures, drops and returns, shown in team colors.
* **Customizable:** Change text size, font and display time from the **Kill Feed** button in the main menu, with a live preview. You can also turn the feed off there.

### How to Use

Click the file named **Kill Feed**, download it, and upload it on Tampermonkey.
Or you can just copy the script, create a new file in Tampermonkey by clicking `+`, and pasting it.

## 🚩 No Flag Mod
Made for 1v1s in private squads, so you can fight without the flags getting in the way.

### Features
* **Hide flag icons:** Hides the flag markers you see through walls, for both teams.
* **Never pick up flags:** Walking over the enemy flag no longer picks it up.

Both can be switched on and off separately from the **No Flag** button in the main menu.

⚠️ It only changes your own game, so the other player needs the script too.

### How to Use

Click the file named **No Flag Mod**, download it, and upload it on Tampermonkey.
Or you can just copy the script, create a new file in Tampermonkey by clicking `+`, and pasting it.
