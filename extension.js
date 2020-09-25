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

const {getInputSourceManager, InputSourceManager} = imports.ui.status.keyboard;

function init() {
  // This extension does not use init function.
}

function enable() {
  // A dirty hack to stop updating the annoying MRU IME list.
  InputSourceManager.prototype._currentInputSourceChangedOrig = InputSourceManager.prototype._currentInputSourceChanged;
  InputSourceManager.prototype._currentInputSourceChanged = function (newSource) {
    let oldSource;
    [oldSource, this._currentSource] = [this._currentSource, newSource];

    this.emit("current-source-changed", oldSource);

    // Noooooooooooo! Stop doing this!
    /*
    for (let i = 1; i < this._mruSources.length; ++i) {
      if (this._mruSources[i] == newSource) {
        let currentSource = this._mruSources.splice(i, 1);
        this._mruSources = currentSource.concat(this._mruSources);
        break;
      }
    }
    */
    this._changePerWindowSource();
  };
  // A dirty hack to stop loading MRU IME list from settings.
  // This is needed for restoring the user's sequence in settings when enabling.
  InputSourceManager.prototype._updateMruSourcesOrig = InputSourceManager.prototype._updateMruSources;
  InputSourceManager.prototype._updateMruSources = function () {
    let sourcesList = [];
    for (let i in this._inputSources) {
      sourcesList.push(this._inputSources[i]);
    }

    this._keyboardManager.setUserLayouts(sourcesList.map(x => x.xkbId));

    if (!this._disableIBus && this._mruSourcesBackup) {
      this._mruSources = this._mruSourcesBackup;
      this._mruSourcesBackup = null;
    }

    // Noooooooooooo! Stop doing this!
    /*
    // Initialize from settings when we have no MRU sources list
    if (this._mruSources.length == 0) {
      let mruSettings = this._settings.mruSources;
      for (let i = 0; i < mruSettings.length; i++) {
        let mruSettingSource = mruSettings[i];
        let mruSource = null;

        for (let j = 0; j < sourcesList.length; j++) {
          let source = sourcesList[j];
          if (source.type == mruSettingSource.type &&
              source.id == mruSettingSource.id) {
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
            if (this._mruSources[i].type == sourcesList[j].type &&
                this._mruSources[i].id == sourcesList[j].id) {
                mruSources = mruSources.concat(sourcesList.splice(j, 1));
                break;
            }
        }
    }
    */
    this._mruSources = mruSources.concat(sourcesList);
  };
  // This function is used to get the running instance of InputSourceManager.
  const _inputSourceManager = getInputSourceManager();
  // The input source list may already be messed.
  // So we restore it.
  _inputSourceManager._updateMruSources();
}

function disable() {
  if (InputSourceManager.prototype._currentInputSourceChangedOrig instanceof Function) {
    InputSourceManager.prototype._currentInputSourceChanged = InputSourceManager.prototype._currentInputSourceChangedOrig;
    InputSourceManager.prototype._currentInputSourceChangedOrig = undefined;
  }
  if (InputSourceManager.prototype._updateMruSourcesOrig instanceof Function) {
    InputSourceManager.prototype._updateMruSources = InputSourceManager.prototype._updateMruSourcesOrig;
    InputSourceManager.prototype._updateMruSourcesOrig = undefined;
  }
}
