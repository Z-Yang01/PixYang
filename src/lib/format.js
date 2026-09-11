// 字节/数值格式化（原散布在 InfoPanel/ImageViewer/ImportDialog/SettingsPage 四处）

// 详细格式：123 B / 12.3 KB / 1.2 MB（详情面板、查看器）
export function formatSizeDisplay(bytes, emptyLabel = '') {
  if (!bytes) return emptyLabel;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// 紧凑格式：0KB / 3KB / 1.2MB（导入列表、设置统计）
export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
