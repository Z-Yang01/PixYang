import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUT_GROUPS } from '@/lib/shortcuts';

export default function ShortcutsHelp({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard className="size-4" />
          快捷键
          <Button
            variant="ghost"
            size="icon-xs"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            title="关闭"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="dialog-body" style={{ maxHeight: '65vh' }}>
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.title} style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                marginBottom: 8,
              }}>
                {group.title}
              </div>
              <div className="info-group" style={{ padding: '6px 12px' }}>
                {group.items.map(item => (
                  <div key={item.desc} className="info-row" style={{ gap: 12 }}>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {item.keys.map(k => (
                        <kbd key={k} className="kbd">{k}</kbd>
                      ))}
                    </span>
                    <span className="info-value" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
