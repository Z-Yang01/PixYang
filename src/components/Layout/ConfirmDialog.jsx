import React from 'react';

export default function ConfirmDialog({ title, message, confirmLabel = '确认', danger = false, onConfirm, onCancel }) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 400 }}>
        <div className="dialog-header">{title}</div>
        <div className="dialog-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
