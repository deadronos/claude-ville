import { useEffect, useState } from 'react';

import { getNameMode } from '../../../config/agentNames.js';
import { i18n } from '../../../config/i18n.js';
import { getBubbleConfig } from '../../../config/bubbleConfig.js';
import { ClaudeVilleController } from '../state/ClaudeVilleController.js';
import { TEXT_SIZE_PRESETS, getTextSizePresetKey } from '../../shared/textSizePresets.js';

export function SettingsModal({ open, controller, bubbleConfig }: { open: boolean; controller: ClaudeVilleController; bubbleConfig: ReturnType<typeof getBubbleConfig> }) {
  const initialScale = getTextSizePresetKey(bubbleConfig.textScale);
  const [nameMode, setLocalNameMode] = useState(getNameMode());
  const [sizeKey, setSizeKey] = useState(initialScale);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLocalNameMode(getNameMode());
    setSizeKey(initialScale);
  }, [open, initialScale]);

  if (!open) {
    return null;
  }

  const preset = TEXT_SIZE_PRESETS.find((item) => item.key === sizeKey) || TEXT_SIZE_PRESETS[1];

  return (
    <div id="modalOverlay" className="modal-overlay" onClick={() => controller.closeSettings()}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <span id="modalTitle" className="modal__title">{i18n.t('settingsTitle')}</span>
          <button id="modalClose" type="button" className="modal__close" onClick={() => controller.closeSettings()}>X</button>
        </div>
        <div id="modalContent" className="modal__content">
          <div className="settings-form">
            <div className="settings-row">
              <span className="settings-label">{i18n.t('nameMode')}</span>
              <div className="settings-lang-btns">
                {['autodetected', 'pooled'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`settings-lang-btn ${nameMode === mode ? 'settings-lang-btn--active' : ''}`}
                    onClick={() => setLocalNameMode(mode)}
                  >
                    {i18n.t(mode === 'pooled' ? 'pooledRandomNames' : 'autodetectedNames')}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-note">{i18n.t('providerNameModeNote')}</div>
            <div className="settings-divider" />
            <div className="settings-row">
              <span className="settings-label">{i18n.t('textSize')}</span>
              <div className="settings-lang-btns">
                {TEXT_SIZE_PRESETS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`settings-lang-btn ${sizeKey === entry.key ? 'settings-lang-btn--active' : ''}`}
                    onClick={() => setSizeKey(entry.key)}
                  >
                    {i18n.t(entry.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-lang-btns">
                <button type="button" className="settings-lang-btn" onClick={() => controller.closeSettings()}>Cancel</button>
                <button
                  type="button"
                  className="settings-lang-btn settings-lang-btn--active"
                  onClick={() => controller.saveSettings(nameMode, preset.textScale, {
                    statusFontSize: preset.statusFontSize,
                    statusMaxWidth: preset.maxWidth,
                    statusBubbleH: preset.bubbleH,
                    statusPaddingH: preset.paddingH,
                    chatFontSize: preset.statusFontSize,
                  })}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
