Fixed IME List for GNOME Shell
==============================

Make the IME list in fixed sequence instead of MRU.
---------------------------------------------------

# Usage

```
$ git clone https://github.com/AlynxZhou/gnome-shell-extension-fixed-ime-list.git ~/.local/share/gnome-shell/extensions/fixedimelist@alynx.one
```

or install it from <https://extensions.gnome.org/extension/3663/fixed-ime-list/>.

Then restart GNOME Shell and enable Fixed IME List from GNOME Extensions.

# FAQ

## Who?

The person who has more then 2 input method engines in GNOME Shell like me (English, Simplified Chinese, Japanese).

## Why?

**I hate the MRU IME list in GNOME Shell.**

I am not interested in who added this "feature" into GNOME Shell, but you see, I **could** set my own IME sequence in GNOME Control Center, so I will know how many times I should press before I press the switching keybindings. For example, English, Simplified Chinese, Japanese, and I am in Simplified Chinese, I just press twice for English or once for Japanese.

But with this "feature", things are messed. If I switch from English to Simplified Chinese, what's my list now? How many times I need to press to switch to Japanese? How long will I use to emulate the MRU operations in my brain? Maybe some people have a different brain that can emulate this quickly, but I am not.

## What?

This extension just hooked some functions for `InputSourceManager` in GNOME Shell so it will stop updating the annoying MRU IME list, and will restore your list once enabled. Some dirty hack, but it works.

## How?

Install this extension, and enable it in GNOME Extensions app. Your brain is saved.

## Why NOT Fcitx/KDE/[Input more choice if you are not a GNOME user]?

Fcitx/KDE/[Input more choice if you are not a GNOME user] is good, I agree.

But how much I love your choice is the same as how much you love my choice, and I am doing things to make my choice better.

I won't drop 99% advantages for me because of only 1% disadvantages.

## Why not upstream? I mean I hate extensions!

Upstream was not MRU before some one added this "feature", and it will cost a lot of time to argue "whether user prefer to MRU" if you send a MR to revert it. I'd like to do before I say.

## GNOME Shell upgraded and it stopped working!

Send an issue, I will upgrade it if I am still using it.
