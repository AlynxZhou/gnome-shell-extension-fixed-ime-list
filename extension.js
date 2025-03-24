/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from "gi://Gio";
import IBus from 'gi://IBus';
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  getInputSourceManager,
  InputSource,
  InputSourcePopup,
  InputSourceManager,
  INPUT_SOURCE_TYPE_XKB,
  INPUT_SOURCE_TYPE_IBUS
} from "resource:///org/gnome/shell/ui/status/keyboard.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  InjectionManager
} from "resource:///org/gnome/shell/extensions/extension.js";

/**
 * I already have a MR for gnome-shell to implement fixed IME list, however,
 * that requires agreement from design team, and I don't know how to achieve it.
 *
 * See <https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2719>.
 *
 * This is actually a HACK version of that MR to implement it as an extension.
 * To understand it, you'd better read that MR first.
 */
export default class FixedIMEList {
  constructor() {
  }

  enable() {
    // To use this extension object, we need to rename it.
    const that = this;
    // When we enter a password entry, IBus sources will be filtered out, so
    // we need a variable to store the previous source, so we could restore it
    // after leaving the password entry.
    this._previousFixedSource = null;

    // NOTE: Don't use arrow expressions for the function used to inject, we
    // want it to use the calling context, but arrow expressions will bind this
    // extension object to it. Also the document is wrong, it says it will
    // change `this` for you, but actually not.
    this._injectionManager = new InjectionManager();

    // I don't know why they use hard coded 0 or last when they have
    // `_selectedIndex` here, it is totally OK that we want to start from
    // non-beginning items.
    //
    // Actually `InputSourcePopup` is inherited from `SwitcherPopup`.
    this._injectionManager.overrideMethod(
      InputSourcePopup.prototype,
      "_initialSelection",
      () => {
        return function (backward, _binding) {
          if (backward)
            this._select(this._previous());
          else if (this._items.length === 1)
            this._select(0);
          else
            this._select(this._next());
        };
      }
    );

    // Set correct selected item after creating `InputSourcePopup`.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_switchInputSource",
      () => {
        return function (display, window, event, binding) {
          // GNOME Shell 48 adds `event` parameter, keep backward compatibility.
          //
          // See <https://gjs.guide/extensions/upgrading/gnome-shell-48.html#inputsourcemanager>.
          binding = binding || event;

          if (this._mruSources.length < 2)
            return;

          // HACK: Fall back on simple input source switching since we
          // can't show a popup switcher while a GrabHelper grab is in
          // effect without considerable work to consolidate the usage
          // of pushModal/popModal and grabHelper. See
          // https://bugzilla.gnome.org/show_bug.cgi?id=695143 .
          if (Main.actionMode === Shell.ActionMode.POPUP) {
            // AZ: `_modifiersSwitcher()` always starts from current source,
            // so we don't hook it.
            this._modifiersSwitcher();
            return;
          }

          this._switcherPopup = new InputSourcePopup(
            this._mruSources, this._keybindingAction, this._keybindingActionBackward);
          if (this._mruSources.includes(this._currentSource)) {
            this._switcherPopup._selectedIndex =
              this._mruSources.indexOf(this._currentSource);
          }
          this._switcherPopup.connect('destroy', () => {
            this._switcherPopup = null;
          });
          if (!this._switcherPopup.show(
            binding.is_reversed(), binding.get_name(), binding.get_mask()))
            this._switcherPopup.fadeAndDestroy();
        };
      }
    );

    // There is no need to update the annoying MRU IME list.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_currentInputSourceChanged",
      () => {
        return function (newSource) {
          let oldSource;
          [oldSource, this._currentSource] = [this._currentSource, newSource];

          this.emit('current-source-changed', oldSource);

          // for (let i = 1; i < this._mruSources.length; ++i) {
          //   if (this._mruSources[i] === newSource) {
          //     let currentSource = this._mruSources.splice(i, 1);
          //     this._mruSources = currentSource.concat(this._mruSources);
          //     break;
          //   }
          // }
          this._changePerWindowSource();
        };
      }
    );

    // Load fixed sources list instead of loading MRU sources list.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_updateMruSources",
      () => {
        // AZ: I just rewrite this function totally.
        return function () {
          let sourcesList = [];
          for (let i of Object.keys(this._inputSources).sort((a, b) => a - b))
            sourcesList.push(this._inputSources[i]);

          this._keyboardManager.setUserLayouts(sourcesList.map(x => x.xkbId));

          // If we are back from IBus' password mode to normal mode, we need to
          // try restoring previous source.
          if (!this._disableIBus && that._previousFixedSource) {
            const previousSource = sourcesList.find((source) => {
              return source.type === that._previousFixedSource.type &&
                source.id === that._previousFixedSource.id;
            });
            if (previousSource)
              previousSource.activate(false);
            that._previousFixedSource = null;
          }
          // Because reload will clear `_currentSource`, if we failed to restore
          // previous source, we will use the first source here.
          if (this._currentSource == null && sourcesList.length > 0)
            sourcesList[0].activate(false);

          this._mruSources = sourcesList;
        };
      }
    );

    // Stop activating the first item, we already activate the saved one.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_inputSourcesChanged",
      () => {
        return function () {
          let sources = this._settings.inputSources;
          let nSources = sources.length;

          this._currentSource = null;
          this._inputSources = {};
          this._ibusSources = {};

          let infosList = [];
          for (let i = 0; i < nSources; i++) {
            let displayName;
            let shortName;
            let type = sources[i].type;
            let id = sources[i].id;
            let exists = false;

            if (type === INPUT_SOURCE_TYPE_XKB) {
              [exists, displayName, shortName] =
                this._xkbInfo.get_layout_info(id);
            } else if (type === INPUT_SOURCE_TYPE_IBUS) {
              if (this._disableIBus)
                continue;
              let engineDesc = this._ibusManager.getEngineDesc(id);
              if (engineDesc) {
                let language = IBus.get_language_name(engineDesc.get_language());
                let longName = engineDesc.get_longname();
                let textdomain = engineDesc.get_textdomain();
                if (textdomain !== '')
                  longName = Gettext.dgettext(textdomain, longName);
                exists = true;
                displayName = `${language} (${longName})`;
                shortName = this._makeEngineShortName(engineDesc);
              }
            }

            if (exists)
              infosList.push({type, id, displayName, shortName});
          }

          if (infosList.length === 0) {
            let type = INPUT_SOURCE_TYPE_XKB;
            let id = KeyboardManager.DEFAULT_LAYOUT;
            let [, displayName, shortName] = this._xkbInfo.get_layout_info(id);
            infosList.push({type, id, displayName, shortName});
          }

          let inputSourcesByShortName = {};
          for (let i = 0; i < infosList.length; i++) {
            let is = new InputSource(infosList[i].type,
                                     infosList[i].id,
                                     infosList[i].displayName,
                                     infosList[i].shortName,
                                     i);
            is.connect('activate', this.activateInputSource.bind(this));

            if (!(is.shortName in inputSourcesByShortName))
              inputSourcesByShortName[is.shortName] = [];
            inputSourcesByShortName[is.shortName].push(is);

            this._inputSources[is.index] = is;

            if (is.type === INPUT_SOURCE_TYPE_IBUS)
              this._ibusSources[is.id] = is;
          }

          for (let i in this._inputSources) {
            let is = this._inputSources[i];
            if (inputSourcesByShortName[is.shortName].length > 1) {
              let sub = inputSourcesByShortName[is.shortName].indexOf(is) + 1;
              is.shortName += String.fromCharCode(0x2080 + sub);
            }
          }

          this.emit('sources-changed');

          this._updateMruSources();

          // AZ: Don't do this, we already done the right things in
          // `_updateMruSources`.
          // if (this._mruSources.length > 0)
          //   this._mruSources[0].activate(false);

          // All ibus engines are preloaded here to reduce the launching time
          // when users switch the input sources.
          this._ibusManager.preloadEngines(Object.keys(this._ibusSources));
        };
      }
    );

    // Don't touch GSettings so user can still get MRU list after disabling.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_updateMruSettings",
      () => {
        return function () {
          // If IBus is not ready we don't have a full picture of all
          // the available sources, so don't update the setting
          if (!this._ibusReady) {
            return;
          }

          // If IBus is temporarily disabled, don't update the setting
          if (this._disableIBus) {
            return;
          }

          // AZ: We leave MRU sources list in GSettings untouched so when user
          // disables this extension we could restore to the original state.
          // let sourcesList = [];
          // for (let i = 0; i < this._mruSources.length; ++i) {
          //   let source = this._mruSources[i];
          //   sourcesList.push([source.type, source.id]);
          // }

          // this._settings.mruSources = sourcesList;
        };
      }
    );

    // Sources will be filtered when entering password entry, we need to save
    // and restore previous source.
    //
    // The best place is `_ibusSetContentType()`, but we have no way to
    // disconnect the signal handler and replace it. However,
    // `_ibusSetContentType()` will call `reload()`, and the actual clearing
    // `_currentSource` happens in `_inputSourcesChanged()`, so this is the
    // best we can achieve.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "reload",
      () => {
        return function () {
          this._reloading = true;
          this._keyboardManager.setKeyboardOptions(this._settings.keyboardOptions);
          // AZ: We only do this when IBus is disabled.
          if (this._disableIBus && this._currentSource) {
            that._previousFixedSource = {
              type: this._currentSource.type,
              id: this._currentSource.id
            };
          }
          this._inputSourcesChanged();
          this._reloading = false;
        };
      }
    );

    this.reloadKeybindings();
  }

  /**
   * To reviewers: This extension requires to run in `unlock-dialog` so user
   * won't get inconsistence about why the IME list is not fixed when pressing
   * `Super + Space` in lock screen. This also allows it to restore previous
   * source correctly after entering the password entry in `unlock-dialog`,
   * otherwise the first source of the MRU list is activated and it might not
   * be the one user used before entering password.
   */
  disable() {
    if (this._injectionManager != null) {
      this._injectionManager.clear();
      this._injectionManager = null;
    }
    this._previousFixedSource = null;

    this.reloadKeybindings();

    const _inputSourceManager = getInputSourceManager();
    // `InputSourcePopup` assume the first one is selected, so we re-activate
    // current source to make it them consistent after disabling extension.
    if (_inputSourceManager._currentSource != null &&
        _inputSourceManager._mruSources[0] !==
        _inputSourceManager._currentSource) {
      _inputSourceManager._currentSource.activate(true);
    }
  }

  reloadKeybindings() {
    // This function is used to get the running instance of InputSourceManager.
    const _inputSourceManager = getInputSourceManager();

    // We changed methods in prototypes, but keybinds still use old methods, so
    // let them use new methods here.
    Main.wm.removeKeybinding("switch-input-source");
    _inputSourceManager._keybindingAction =
      Main.wm.addKeybinding(
        "switch-input-source",
        new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.ALL,
        InputSourceManager.prototype._switchInputSource.bind(
          _inputSourceManager
        )
      );
    Main.wm.removeKeybinding("switch-input-source-backward");
    _inputSourceManager._keybindingActionBackward =
      Main.wm.addKeybinding(
        "switch-input-source-backward",
        new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
        Meta.KeyBindingFlags.IS_REVERSED,
        Shell.ActionMode.ALL,
        InputSourceManager.prototype._switchInputSource.bind(
          _inputSourceManager
        )
      );

    // Those codes refresh sources list but work differently:
    //   - When we enable this extension, it just reloads sources list which is
    //     fixed because we skips MRU sources list in GSettings.
    //   - When we disable this extension, it loads MRU sources list in
    //     GSettings.
    _inputSourceManager._mruSources = [];
    _inputSourceManager._mruSourcesBackup = null;
    _inputSourceManager._updateMruSources();
  }
};
