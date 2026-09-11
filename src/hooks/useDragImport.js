import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

// 窗口级拖拽导入：拖入文件/文件夹时展示遮罩，松手后收集路径交给导入对话框
export default function useDragImport({ enabled, onCollect }) {
  const [dragImport, setDragImport] = useState(false);
  const dragDepthRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onCollectRef = useRef(onCollect);
  onCollectRef.current = onCollect;

  useEffect(() => {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onDragOver = (e) => { e.preventDefault(); };
    const onDragEnter = (e) => {
      e.preventDefault();
      if (!hasFiles(e) || !enabledRef.current) return;
      dragDepthRef.current += 1;
      setDragImport(true);
    };
    const onDragLeave = (e) => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragImport(false);
    };
    const onDrop = async (e) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragImport(false);
      if (!enabledRef.current || !api.isBridgeAvailable() || !e.dataTransfer?.files?.length) return;
      const paths = [];
      for (const file of e.dataTransfer.files) {
        try {
          const p = api.getPathForFile(file);
          if (p) paths.push(p);
        } catch { /* 忽略无法取路径的项 */ }
      }
      if (paths.length === 0) return;
      const files = await api.collectImportFiles(paths);
      onCollectRef.current(files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragImport;
}
