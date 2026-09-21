import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { onNativeDragDrop } from '../lib/tauriBridgeMedia';

// 窗口级拖拽导入：拖入文件/文件夹时展示遮罩，松手后收集路径交给导入对话框
export default function useDragImport({ enabled, onCollect }) {
  const [dragImport, setDragImport] = useState(false);
  const dragDepthRef = useRef(0);
  const busyRef = useRef(false);
  const pendingPathsRef = useRef([]);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onCollectRef = useRef(onCollect);
  onCollectRef.current = onCollect;

  useEffect(() => {
    const importPaths = async (paths) => {
      if (!paths.length || !enabledRef.current || !api.isBridgeAvailable()) return;
      if (busyRef.current) {
        pendingPathsRef.current.push(...paths);
        return;
      }
      busyRef.current = true;
      let queue = paths;
      try {
        do {
          let files = [];
          try {
            files = (await api.collectImportFiles(queue)) || [];
          } catch (e) {
            console.error('[拖拽导入] 收集文件失败:', e.message);
          }
          onCollectRef.current(files);
          queue = pendingPathsRef.current;
          pendingPathsRef.current = [];
        } while (queue.length > 0);
      } finally {
        busyRef.current = false;
        pendingPathsRef.current = [];
      }
    };

    const hasFiles = (e) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onDragOver = (e) => {
      e.preventDefault();
    };
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
      if (!e.dataTransfer?.files?.length) return;
      const paths = [];
      for (const file of e.dataTransfer.files) {
        try {
          const p = api.getPathForFile(file);
          if (p) paths.push(p);
        } catch {
          /* 忽略无法取路径的项 */
        }
      }
      await importPaths(paths);
    };

    // Tauri 原生拖拽（fileDropEnabled 下 DOM drop 不触发，绝对路径由原生事件给出）；
    // 非 Tauri 环境（浏览器/单测）该注册为 no-op，两套事件源并存互不干扰
    const removeNative = onNativeDragDrop({
      onEnter: (paths) => {
        if (!enabledRef.current || !paths.length) return;
        setDragImport(true);
      },
      onLeave: () => setDragImport(false),
      onDrop: (paths) => {
        setDragImport(false);
        importPaths(paths);
      },
    });

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      removeNative();
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragImport;
}
