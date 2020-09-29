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

/* exported init, enable, disable */

const {Gio, Meta, Shell} = imports.gi;
const {
  getInputSourceManager,
  InputSourcePopup,
  InputSourceManager
} = imports.ui.status.keyboard;
const Main = imports.ui.main;

let activeSource = null;

function init() {
  // This extension does not use init function.
}

function enable() {
  // A dirty hack to stop updating the annoying MRU IME list.
  InputSourceManager.prototype._currentInputSourceChangedOrig =
    InputSourceManager.prototype._currentInputSourceChanged;
  InputSourceManager.prototype._currentInputSourceChanged = function (
    newSource
  ) {
    let oldSource;
    [oldSource, this._currentSource] = [this._currentSource, newSource];

    this.emit("current-source-changed", oldSource);

    // Noooooooooooo! Stop doing this!
    /*
    for (let i = 1; i < this._mruSources.length; ++i) {
      if (this._mruSources[i] === newSource) {
        let currentSource = this._mruSources.splice(i, 1);
        this._mruSources = currentSource.concat(this._mruSources);
        break;
      }
    }
    */
    this._changePerWindowSource();
  };

  // I don't know why they use hard coded 0 or last
  // when they have `_selectedIndex` here!
  // Maybe they never consider to use it as a initial parameter.
  // Anyway this is another dirty hack to let InputSourcePopup init
  // with `selectedIndex`.
  // Actually this is inherited from SwitcherPopup,
  // but I don't want to change other parts' behavior.
  InputSourcePopup.prototype._initialSelectionOrig =
    InputSourcePopup.prototype._initialSelection;
  InputSourcePopup.prototype._initialSelection = function (backward, _binding) {
    if (backward) {
      this._select(this._previous());
    } else if (this._items.length === 1) {
      this._select(0);
    } else {
      this._select(this._next());
    }
  }

  // A dirty hack to let InputSourcePopup starts from current source
  // instead of 0.
  InputSourceManager.prototype._switchInputSourceOrig =
    InputSourceManager.prototype._switchInputSource;
  InputSourceManager.prototype._switchInputSource = function (
    display,
    window,
    binding
  ) {
    if (this._mruSources.length < 2) {
      return;
    }

    // HACK: Fall back on simple input source switching since we
    // can't show a popup switcher while a GrabHelper grab is in
    // effect without considerable work to consolidate the usage
    // of pushModal/popModal and grabHelper. See
    // https://bugzilla.gnome.org/show_bug.cgi?id=695143 .
    if (Main.actionMode === Shell.ActionMode.POPUP) {
      // _modifiersSwitcher() always starts from current source,
      // so we don't hook it.
      this._modifiersSwitcher();
      return;
    }

    let popup = new InputSourcePopup(
      this._mruSources,
      this._keybindingAction,
      this._keybindingActionBackward
    );
    // By default InputSourcePopup starts at 0, this is ok for MRU.
    // But we need to set popup current index to current source.
    // I think it's OK to start from 0 if we don't have current source.
    if (this._currentSource != null) {
      popup._selectedIndex = this._mruSources.indexOf(this._currentSource);
    }

    if (!popup.show(
      binding.is_reversed(),
      binding.get_name(),
      binding.get_mask()
    )) {
      popup.fadeAndDestroy();
    }
  };

  // A dirty hack because iBus will set content type with a password entry,
  // which will call reload before unlock and after extension enable
  // so the active source changed before extension enable.
  // We need to restore what we have before locking.
  // TODO: Still some problem, there should be a better way.
  InputSourceManager.prototype.reloadOrig =
    InputSourceManager.prototype.reload;
  InputSourceManager.prototype.reload = function () {
    this._reloading = true;
    this._keyboardManager.setKeyboardOptions(this._settings.keyboardOptions);
    this._inputSourcesChanged();
    // _inputSourcesChanged() will active the first one so we must
    // restore after it.
    if (activeSource != null && this._currentSource != activeSource) {
      activeSource.activate(true);
      // We only restore once.
      activeSource = null;
    }
    this._reloading = false;
  }

  // A dirty hack to stop loading MRU IME list from settings.
  // This is needed for restoring the user's sequence in settings when enabling.
  InputSourceManager.prototype._updateMruSourcesOrig =
    InputSourceManager.prototype._updateMruSources;
  InputSourceManager.prototype._updateMruSources = function () {
    let sourcesList = [];
    for (let i in this._inputSources) {
      sourcesList.push(this._inputSources[i]);
    }

    this._keyboardManager.setUserLayouts(sourcesList.map((x) => {
      return x.xkbId;
    }));

    if (!this._disableIBus && this._mruSourcesBackup) {
      this._mruSources = this._mruSourcesBackup;
      this._mruSourcesBackup = null;
    }

    // Noooooooooooo! Stop doing this!
    /*
    // Initialize from settings when we have no MRU sources list
    if (this._mruSources.length === 0) {
      let mruSettings = this._settings.mruSources;
      for (let i = 0; i < mruSettings.length; i++) {
        let mruSettingSource = mruSettings[i];
        let mruSource = null;

        for (let j = 0; j < sourcesList.length; j++) {
          let source = sourcesList[j];
          if (source.type === mruSettingSource.type &&
              source.id === mruSettingSource.id) {
            mruSource = source;
            break;
          }
        }

        if (mruSource) {
          this._mruSources.push(mruSource);
        }
      }
    }
    */

    let mruSources = [];
    // Those are useless because we stop loading MRU sources from settings.
    // We just concat the user's sequence in settings.
    /*
    for (let i = 0; i < this._mruSources.length; i++) {
        for (let j = 0; j < sourcesList.length; j++) {
            if (this._mruSources[i].type === sourcesList[j].type &&
                this._mruSources[i].id === sourcesList[j].id) {
                mruSources = mruSources.concat(sourcesList.splice(j, 1));
                break;
            }
        }
    }
    */
    this._mruSources = mruSources.concat(sourcesList);
  };

  // A dirty hack to stop updating MRU settings.
  // Because we stop updating MRU sources, and I don't want to touch settings.
  InputSourceManager.prototype._updateMruSettingsOrig =
    InputSourceManager.prototype._updateMruSettings;
  InputSourceManager.prototype._updateMruSettings = function () {
    // If IBus is not ready we don't have a full picture of all
    // the available sources, so don't update the setting
    if (!this._ibusReady) {
      return;
    }

    // If IBus is temporarily disabled, don't update the setting
    if (this._disableIBus) {
      return;
    }

    // Noooooooooooo! Stop doing this!
    /*
    let sourcesList = [];
    for (let i = 0; i < this._mruSources.length; ++i) {
      let source = this._mruSources[i];
      sourcesList.push([source.type, source.id]);
    }

    this._settings.mruSources = sourcesList;
    */
  }

  // This function is used to get the running instance of InputSourceManager.
  const _inputSourceManager = getInputSourceManager();

  // Reloading keybindings is needed because we changed the bound callback.
  Main.wm.removeKeybinding("switch-input-source");
  _inputSourceManager._keybindingAction =
    Main.wm.addKeybinding(
      "switch-input-source",
      new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      InputSourceManager.prototype._switchInputSource.bind(_inputSourceManager)
    );
  Main.wm.removeKeybinding("switch-input-source-backward");
  _inputSourceManager._keybindingActionBackward =
    Main.wm.addKeybinding(
      "switch-input-source-backward",
      new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
      Meta.KeyBindingFlags.IS_REVERSED,
      Shell.ActionMode.ALL,
      InputSourceManager.prototype._switchInputSource.bind(_inputSourceManager)
    );

  // The input source list may already be messed.
  // So we restore it.
  _inputSourceManager._mruSources = [];
  _inputSourceManager._mruSourcesBackup = null;
  _inputSourceManager._updateMruSources();
}

function disable() {
  if (
    InputSourceManager.prototype._currentInputSourceChangedOrig instanceof
      Function
  ) {
    InputSourceManager.prototype._currentInputSourceChanged =
      InputSourceManager.prototype._currentInputSourceChangedOrig;
    InputSourceManager.prototype._currentInputSourceChangedOrig = undefined;
  }

  if (InputSourcePopup.prototype._initialSelectionOrig instanceof Function) {
    InputSourcePopup.prototype._initialSelection =
      InputSourcePopup.prototype._initialSelectionOrig;
    InputSourcePopup.prototype._initialSelectionOrig = undefined;
  }

  if (InputSourceManager.prototype._switchInputSourceOrig instanceof Function) {
    InputSourceManager.prototype._switchInputSourceSources =
      InputSourceManager.prototype._switchInputSourceOrig;
    InputSourceManager.prototype._switchInputSourceOrig = undefined;
  }

  if (InputSourceManager.prototype.reloadOrig instanceof Function) {
    InputSourceManager.prototype.reload =
      InputSourceManager.prototype.reloadOrig;
    InputSourceManager.prototype.reloadOrig = undefined;
  }

  if (InputSourceManager.prototype._updateMruSourcesOrig instanceof Function) {
    InputSourceManager.prototype._updateMruSources =
      InputSourceManager.prototype._updateMruSourcesOrig;
    InputSourceManager.prototype._updateMruSourcesOrig = undefined;
  }

  if (InputSourceManager.prototype._updateMruSettingsOrig instanceof Function) {
    InputSourceManager.prototype._updateMruSettings =
      InputSourceManager.prototype._updateMruSettingsOrig;
    InputSourceManager.prototype._updateMruSettingsOrig = undefined;
  }

  // This function is used to get the running instance of InputSourceManager.
  const _inputSourceManager = getInputSourceManager();

  // Bind to the original function.
  Main.wm.removeKeybinding("switch-input-source");
  _inputSourceManager._keybindingAction =
    Main.wm.addKeybinding(
      "switch-input-source",
      new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      InputSourceManager.prototype._switchInputSource.bind(_inputSourceManager)
    );
  Main.wm.removeKeybinding("switch-input-source-backward");
  _inputSourceManager._keybindingActionBackward =
    Main.wm.addKeybinding(
      "switch-input-source-backward",
      new Gio.Settings({"schema_id": "org.gnome.desktop.wm.keybindings"}),
      Meta.KeyBindingFlags.IS_REVERSED,
      Shell.ActionMode.ALL,
      InputSourceManager.prototype._switchInputSource.bind(_inputSourceManager)
    );

  // Load the MRU list from settings.
  _inputSourceManager._mruSources = [];
  _inputSourceManager._mruSourcesBackup = null;
  _inputSourceManager._updateMruSources();
  // Save active source before lock screen.
  activeSource = _inputSourceManager._currentSource;
  // InputSourcePopup assume the first one is selected,
  // so we re-activate current source to make it the first.
  if (
    _inputSourceManager._currentSource != null &&
    _inputSourceManager._mruSources[0] !== _inputSourceManager._currentSource
  ) {
    _inputSourceManager._currentSource.activate(true);
  }
}
