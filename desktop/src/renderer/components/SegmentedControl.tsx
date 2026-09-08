import React from 'react';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  ariaLabel,
  className = '',
  style = {},
}: SegmentedControlProps<T>): React.ReactElement {
  const paddingMap = {
    sm: '3px 8px',
    md: '6px 14px',
    lg: '8px 18px',
  };

  const fontSizeMap = {
    sm: '11.5px',
    md: '12.5px',
    lg: '13.5px',
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`segmented-control ${className}`}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        alignItems: 'center',
        backgroundColor: 'var(--bg-subtle)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '3px',
        gap: '2px',
        width: fullWidth ? '100%' : 'auto',
        ...style,
      }}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={opt.disabled}
            onClick={() => {
              if (!opt.disabled && opt.value !== value) {
                onChange(opt.value);
              }
            }}
            className={`segmented-option ${isSelected ? 'active' : ''}`}
            style={{
              flex: fullWidth ? 1 : 'initial',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: paddingMap[size],
              fontSize: fontSizeMap[size],
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
              backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
              border: isSelected ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              boxShadow: isSelected ? '0 2px 8px rgba(0, 0, 0, 0.35)' : 'none',
              cursor: opt.disabled ? 'not-allowed' : 'pointer',
              opacity: opt.disabled ? 0.4 : 1,
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              outline: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.icon && <span style={{ display: 'inline-flex', fontSize: '13px' }}>{opt.icon}</span>}
            <span>{opt.label}</span>
            {opt.badge && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '4px',
                  backgroundColor: isSelected ? 'var(--primary-subtle)' : 'rgba(255, 255, 255, 0.06)',
                  color: isSelected ? '#a5b4fc' : 'var(--text-muted)',
                  border: isSelected ? '1px solid var(--primary-border)' : 'none',
                  letterSpacing: '0.03em',
                }}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
