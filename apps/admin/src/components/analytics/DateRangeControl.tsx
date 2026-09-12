import { useState } from 'react';
import { Button } from '../Button';
import { cardStyle, inputStyle } from '../../styles';
import { DateRangeSelection, PRESET_OPTIONS } from '../../lib/analytics-range';
import { DateRangePreset } from '../../types/analytics';

interface DateRangeControlProps {
  value: DateRangeSelection;
  onChange: (next: DateRangeSelection) => void;
}

/**
 * Shared date-range control at the top of the dashboard. Selecting a preset
 * immediately re-fetches every section with the new preset. Selecting
 * "Custom" only reveals the two date inputs - the actual range change (and
 * therefore every section's re-fetch) is deferred until "Apply" is clicked,
 * so an incomplete custom range never fires a malformed request.
 */
export function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');
  const [customFrom, setCustomFrom] = useState(value.preset === 'custom' ? value.from : '');
  const [customTo, setCustomTo] = useState(value.preset === 'custom' ? value.to : '');

  const activePreset: DateRangePreset = showCustom ? 'custom' : value.preset;

  function selectPreset(preset: DateRangePreset) {
    if (preset === 'custom') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    onChange({ preset, from: '', to: '' });
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    onChange({ preset: 'custom', from: customFrom, to: customTo });
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {PRESET_OPTIONS.map((opt) => {
          const isActive = activePreset === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => selectPreset(opt.value)}
              style={{
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                borderRadius: 999,
                border: isActive ? '1px solid #4f46e5' : '1px solid #d1d5db',
                background: isActive ? '#eef2ff' : '#fff',
                color: isActive ? '#4338ca' : '#374151',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {showCustom && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <input
            type="date"
            style={{ ...inputStyle, minWidth: 160 }}
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span style={{ fontSize: 13, color: '#6b7280' }}>to</span>
          <input
            type="date"
            style={{ ...inputStyle, minWidth: 160 }}
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => setCustomTo(e.target.value)}
          />
          <Button variant="primary" onClick={applyCustom} disabled={!customFrom || !customTo}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
