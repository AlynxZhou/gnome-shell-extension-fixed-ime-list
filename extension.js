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
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  getInputSourceManager,
  InputSourcePopup,
  InputSourceManager
} from "resource:///org/gnome/shell/ui/status/keyboard.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  InjectionManager
} from "resource:///org/gnome/shell/extensions/extension.js";

export default class FixedIMEList {
  constructor() {
    this._injectionManager = new InjectionManager();
    this._activeSource = null;
  }

  enable() {
    // NOTE: Don't use arrow expressions for the function used to inject, we
    // want it to use the calling context, but arrow expressions will bind this
    // extension object to it. Also the document is wrong, it says it will
    // change `this` for you, but actually not.

    // To use this extension object, we need to rename it.
    const that = this;

    // A dirty hack to stop updating the annoying MRU IME list.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_currentInputSourceChanged",
      () => {
        return function (newSource) {
          let oldSource;
          [oldSource, this._currentSource] = [this._currentSource, newSource];
          that._activeSource = this._currentSource;

          this.emit("current-source-changed", oldSource);

          // AZ: Just never do MRU sorting.
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

    // I don't know why they use hard coded 0 or last when they have
    // `_selectedIndex` here! Maybe they never consider to use it as a initial
    // parameter. Anyway this is another dirty hack to let InputSourcePopup init
    // with `selectedIndex`. Actually this is inherited from SwitcherPopup,
    // but I don't want to affect others.
    this._injectionManager.overrideMethod(
      InputSourcePopup.prototype,
      "_initialSelection",
      () => {
        return function (backward, _binding) {
          if (backward) {
            this._select(this._previous());
          } else if (this._items.length === 1) {
            this._select(0);
          } else {
            this._select(this._next());
          }
        };
      }
    );

    // A dirty hack to let InputSourcePopup starts from current source
    // instead of 0.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_switchInputSource",
      () => {
        return function (display, window, binding) {
          if (this._mruSources.length < 2) {
            return;
          }

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

          let popup = new InputSourcePopup(
            this._mruSources,
            this._keybindingAction,
            this._keybindingActionBackward
          );
          // AZ: By default InputSourcePopup starts at 0, this is ok for MRU,
          // but we need to set popup current index to current source. It's OK
          // to start from 0 if we don't have current source.
          if (this._currentSource != null) {
            popup._selectedIndex =
              this._mruSources.indexOf(this._currentSource);
          }

          if (!popup.show(
            binding.is_reversed(),
            binding.get_name(),
            binding.get_mask()
          )) {
            popup.fadeAndDestroy();
          }
        };
      }
    );

    // IBus will set content type with a password entry, which will call
    // `reload()` twice, before and after unlock, and `reload()` changes active
    // source, so we restore active source we saved.
    // TODO: There should be a better way, things will be messed if we change
    // sources when using password entry. And this currently does not solve the
    // password problem.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "reload",
      () => {
        return function () {
          this._reloading = true;
          this._keyboardManager.setKeyboardOptions(
            this._settings.keyboardOptions
          );
          this._inputSourcesChanged();
          // AZ: `_inputSourcesChanged()` will active the first source so we
          // must restore after it.
          if (that._activeSource != null &&
              this._currentSource !== that._activeSource) {
            that._activeSource.activate(true);
          }
          this._reloading = false;
        };
      }
    );

    // A dirty hack to stop loading MRU sources list from settings.
    // This is needed because it is also used to load fixed sources list from
    // GSettings.
    this._injectionManager.overrideMethod(
      InputSourceManager.prototype,
      "_updateMruSources",
      () => {
        return function () {
          let sourcesList = [];
          for (let i of Object.keys(this._inputSources).sort((a, b) => {
            return a - b;
          })) {
            sourcesList.push(this._inputSources[i]);
          }

          this._keyboardManager.setUserLayouts(sourcesList.map((x) => {
            return x.xkbId;
          }));

          if (!this._disableIBus && this._mruSourcesBackup) {
            this._mruSources = this._mruSourcesBackup;
            this._mruSourcesBackup = null;
          }

          // AZ: We don't care about MRU sources list so skip those codes.
          // // Initialize from settings when we have no MRU sources list
          // if (this._mruSources.length === 0) {
          //   let mruSettings = this._settings.mruSources;
          //   for (let i = 0; i < mruSettings.length; i++) {
          //     let mruSettingSource = mruSettings[i];
          //     let mruSource = null;

          //     for (let j = 0; j < sourcesList.length; j++) {
          //       let source = sourcesList[j];
          //       if (source.type === mruSettingSource.type &&
          //           source.id === mruSettingSource.id) {
          //         mruSource = source;
          //         break;
          //       }
          //     }

          //     if (mruSource)
          //       this._mruSources.push(mruSource);
          //   }
          // }


          let mruSources = [];
          // AZ: Because we don't use MRU sources list, those codes are useless.
          // if (this._mruSources.length > 1) {
          //   for (let i = 0; i < this._mruSources.length; i++) {
          //     for (let j = 0; j < sourcesList.length; j++) {
          //       if (this._mruSources[i].type === sourcesList[j].type &&
          //           this._mruSources[i].id === sourcesList[j].id) {
          //         mruSources = mruSources.concat(sourcesList.splice(j, 1));
          //         break;
          //       }
          //     }
          //   }
          // }

          this._mruSources = mruSources.concat(sourcesList);
        };
      }
    );

    // A dirty hack to stop updating MRU settings.
    // Because we stop updating MRU sources list, we also don't touch GSettings.
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

    this.reloadKeybindings();
  }

  disable() {
    this._injectionManager.clear();

    this.reloadKeybindings();

    const _inputSourceManager = getInputSourceManager();
    // GNOME Shell will disable all extensions before lock, and enable all
    // extensions after unlock, so we need to save active source.
    this._activeSource = _inputSourceManager._currentSource;
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
