import React from 'react';

export default function Toast({ message, type = 'info', visible }) {
  if (!visible || !message) return null;

  return (
    <div className={`toast toast-${type}`}>
      {message}
    </div>
  );
}
