// Tauri 后端探测与调用封装。window.__TAURI__ 不存在（纯浏览器/单测）时
// isTauriAvailable() 为 false，api.ts 回落 window.pixyang 注入面。
// 依赖 tauri.conf.json 的 app.withGlobalTauri 注入的全局，不新增 npm 依赖。
import editSchema from '../../shared/editSchema.ts';
import renderSpecModule from '../../shared/renderSpec.ts';
import type { RenderSpec } from '../../shared/renderSpec.ts';

const { upgradeEdits } = editSchema;
const { editParamsToRenderSpec, buildProxySpec } = renderSpecModule;

function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

export function isTauriAvailable(): boolean {
  return typeof tauriCore()?.invoke === 'function';
}

export async function tauriInvoke(
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const core = tauriCore();
  if (!core || typeof core.invoke !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return core.invoke(cmd, args);
}

function tauriDialog() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.dialog ?? null;
}

// 原实现经 requirePluginGlobal 断言后直调 plugin[method]；类型层把「缺插件」的运行时
// 检查收敛为方法提取，语义不变（缺插件/缺方法同样抛「Tauri 运行时不可用」）
function requireDialogOpen(): (opts?: Record<string, unknown>) => Promise<unknown> {
  const dialog = tauriDialog();
  if (!dialog || typeof dialog.open !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return dialog.open.bind(dialog);
}

/** Rust 命令返回的 JSON 行（getPresets/getSnapshots 投影） */
type PresetRow = {
  id: number;
  name: string;
  params: unknown;
  createdAt?: string;
  imageId?: number;
};

/** 命令返回结果的公共形状（成功无 error；失败 Rust 侧归一为 {error: 中文串}） */
type CmdResult = { error?: unknown } | null | undefined;

/** 编辑会话（edit_open 返回）的桥面所需子集 */
type EditSessionInfo = { error?: unknown; basePath?: string; width?: number; height?: number };

const asSession = (v: unknown): EditSessionInfo | null =>
  v && typeof v === 'object' ? (v as EditSessionInfo) : null;

const asRows = (v: unknown): PresetRow[] => (Array.isArray(v) ? (v as PresetRow[]) : []);

const asResult = (v: unknown): CmdResult =>
  v && typeof v === 'object' ? (v as CmdResult) : (v as CmdResult);

export const tauriApi = {
  getSettings: () => tauriInvoke('get_settings'),
  getSetting: (key: string) => tauriInvoke('get_setting', { key }),
  setSetting: (key: string, value: unknown) => tauriInvoke('set_setting', { key, value }),
  getTags: () => tauriInvoke('get_tags'),
  getAlbums: () => tauriInvoke('get_albums'),
  getImageTags: (imageId: number) => tauriInvoke('get_image_tags', { imageId }),
  getBatchImageTags: (imageIds: number[]) => tauriInvoke('get_batch_image_tags', { imageIds }),
  getImages: (options: unknown) => tauriInvoke('get_images', { query: options ?? {} }),
  getImportDates: () => tauriInvoke('get_import_dates'),
  getStats: () => tauriInvoke('get_stats'),
  createTag: (name: string, color?: string) => tauriInvoke('create_tag', { name, color }),
  deleteTag: (id: number) => tauriInvoke('delete_tag', { id }),
  addTagToImage: (imageId: number, tagId: number) =>
    tauriInvoke('add_tag_to_image', { imageId, tagId }),
  removeTagFromImage: (imageId: number, tagId: number) =>
    tauriInvoke('remove_tag_from_image', { imageId, tagId }),
  addTagToImages: (imageIds: number[], tagId: number) =>
    tauriInvoke('add_tag_to_images', { imageIds, tagId }),
  createAlbum: (name: string, description?: string) =>
    tauriInvoke('create_album', { name, description }),
  renameAlbum: (id: number, newName: string) => tauriInvoke('rename_album', { id, newName }),
  deleteAlbum: (id: number) => tauriInvoke('delete_album', { id }),
  addToAlbum: (albumId: number, imageIds: number[]) =>
    tauriInvoke('add_to_album', { albumId, imageIds }),
  removeFromAlbum: (albumId: number, imageId: number) =>
    tauriInvoke('remove_from_album', { albumId, imageId }),
  deleteImage: (id: number) => tauriInvoke('delete_image', { id }),
  batchDeleteImages: (ids: number[]) => tauriInvoke('batch_delete_images', { ids }),
  deleteImageToTrash: (id: number) => tauriInvoke('delete_image_to_trash', { id }),
  batchDeleteImagesToTrash: (ids: number[]) => tauriInvoke('batch_delete_images_to_trash', { ids }),
  restoreImageFromTrash: (id: number) => tauriInvoke('restore_image_from_trash', { id }),
  listTrash: () => tauriInvoke('list_trash', {}),
  purgeTrashEntry: (id: number) => tauriInvoke('purge_trash_entry', { id }),
  emptyTrash: () => tauriInvoke('empty_trash', {}),
  batchRestoreFromTrash: (ids: number[]) => tauriInvoke('batch_restore_from_trash', { ids }),
  batchPurgeTrash: (ids: number[]) => tauriInvoke('batch_purge_trash', { ids }),
  // presets：upgradeEdits 规整在桥接层（前端与桥同用 shared/editSchema）
  getPresets: async () => {
    const rows = asRows(await tauriInvoke('get_presets'));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      params: (() => {
        try {
          return upgradeEdits(r.params);
        } catch {
          return null;
        }
      })(),
      createdAt: r.createdAt,
    }));
  },
  createPreset: (name: string, params: unknown) =>
    tauriInvoke('create_preset', { name, params: upgradeEdits(params) }),
  deletePreset: (id: number) => tauriInvoke('delete_preset', { id }),
  // 命名快照：与预设同款 upgradeEdits 规整（params 为完整 EditParams v1）
  getSnapshots: async (imageId: number) => {
    const rows = asRows(await tauriInvoke('get_snapshots', { imageId }));
    return rows.map((r) => ({
      id: r.id,
      imageId: r.imageId,
      name: r.name,
      params: (() => {
        try {
          return upgradeEdits(r.params);
        } catch {
          return null;
        }
      })(),
      createdAt: r.createdAt,
    }));
  },
  createSnapshot: (imageId: number, name: string, params: unknown) =>
    tauriInvoke('create_snapshot', { imageId, name, params: upgradeEdits(params) }),
  deleteSnapshot: (id: number) => tauriInvoke('delete_snapshot', { id }),
  getImagesRoot: () => tauriInvoke('get_images_root'),
  // 与 Rust set_images_root(dir_path) 对齐；sync_camera_folder 无用户参数（相机根取自 settings）
  setImagesRoot: (dirPath: string) => tauriInvoke('set_images_root', { dirPath }),
  // 缩略图目录（大数据，可独立指到 E 盘）：空串 = 恢复默认（数据目录下 thumbnails）
  getThumbsRoot: () => tauriInvoke('get_thumbs_root'),
  setThumbsRoot: (dirPath: string) => tauriInvoke('set_thumbs_root', { dirPath }),
  // 孤儿缩略图：数字命名且 images 表已无对应 id 的文件（可安全清理，重建可再生）
  scanOrphanThumbnails: () => tauriInvoke('scan_orphan_thumbnails', {}),
  cleanOrphanThumbnails: (paths: string[]) =>
    tauriInvoke('clean_orphan_thumbnails', { pathsList: paths }),
  syncCameraFolder: () => tauriInvoke('sync_camera_folder', {}),
  getDatabasePath: () => tauriInvoke('get_database_path'),
  getAllImageIds: (options: unknown) => tauriInvoke('get_all_image_ids', { query: options ?? {} }),
  selectDirectory: async () => {
    const open = requireDialogOpen();
    return open({ directory: true, title: '选择要导入的图片文件夹' });
  },
  selectExportDirectory: async () => {
    const open = requireDialogOpen();
    return open({ directory: true, title: '选择导出的目标文件夹' });
  },
  openPath: (path: string) => tauriInvoke('open_path', { path }),
  backupDatabase: () => tauriInvoke('backup_database'),
  importImages: (files: unknown[], dateOverride?: string | null) =>
    tauriInvoke('import_images', { files, dateOverride: dateOverride ?? null }),
  // R156：导入前按文件名序列号查重（只读），返回 { duplicates: [{filepath, filename, existing}] }
  checkDuplicateSerials: (filepaths: string[]) =>
    tauriInvoke('check_duplicate_serials', { filepaths }),
  renameImage: (id: number, newFilename: string) =>
    tauriInvoke('rename_image', { id, newFilename }),
  // options 缺省/null = 原样复制（Rust BatchExportOptions::from_json 的 None 回退）；转换模式传 { mode:'convert', ... }
  exportImages: (ids: number[], destDir: string, options?: unknown) =>
    tauriInvoke('export_images', options == null ? { ids, destDir } : { ids, destDir, options }),
  // R99 相册导出与批量导出同口径：options 缺省/null = 原样复制（invoke 不带 options 键）
  exportAlbumImages: (albumId: number, destDir: string, options?: unknown) =>
    tauriInvoke(
      'export_album_images',
      options == null ? { albumId, destDir } : { albumId, destDir, options }
    ),
  getExif: (filepath: string) => tauriInvoke('get_exif', { filepath }),
  analyzeImage: (id: number) => tauriInvoke('analyze_image', { id }),
  scanDirectory: (dirPath: string) => tauriInvoke('scan_directory', { dir: dirPath }),
  collectImportFiles: (paths: string[]) => tauriInvoke('collect_import_files', { paths }),
  updateImage: (id: number, updates: Record<string, unknown>) =>
    tauriInvoke('update_image', { id, updates }),
  updateImages: (imageIds: number[], updates: Record<string, unknown>) =>
    tauriInvoke('update_images', { imageIds, updates }),
  rebuildThumbnails: () => tauriInvoke('rebuild_thumbnails_with_events', { all: true }),
  scanBrokenRecords: () => tauriInvoke('scan_broken_records', {}),
  deleteBrokenRecords: (ids: number[]) => tauriInvoke('delete_broken_records', { ids }),
  findDuplicates: () => tauriInvoke('find_duplicates', {}),
  scanOrphanFiles: () => tauriInvoke('scan_orphan_files', {}),
  adoptOrphanFiles: (paths: string[], rearchive?: boolean) =>
    tauriInvoke('adopt_orphan_files', { pathsList: paths, rearchive: !!rearchive }),
  removeOrphanFiles: (paths: string[], targetDir: string) =>
    tauriInvoke('remove_orphan_files', { pathsList: paths, targetDir }),
  saveEdits: (id: number, params: unknown, command?: unknown) =>
    tauriInvoke('save_edit_params', { id, params: upgradeEdits(params), command }).then((raw) => {
      const result = asResult(raw);
      // 保存成功后异步刷新编辑预览缩略图（不阻塞保存；失败仅告警）
      if (result && !result.error) {
        renderEditPreviewAfterSave(id, params).catch((e: unknown) =>
          console.error('[tauriBridge] 编辑预览渲染失败:', e instanceof Error ? e.message : e)
        );
      }
      return result;
    }),
  // 持久化历史撤销：Rust 侧原子组合（读回退目标 → save_edit_params 链写回，全程持写锁），
  // 成功后桥内补 edit_render_preview 链刷新缩略图（同 saveEdits 成功路径）。空历史返回 {error}
  undoLastEdit: async (id: number) => {
    const result = asResult(await tauriInvoke('undo_last_edit', { id }));
    if (result?.error) return result;
    const params = await tauriInvoke('get_edits', { id }).then(
      (r) => (r as { params?: unknown } | null)?.params ?? null
    );
    if (params) {
      renderEditPreviewAfterSave(id, params).catch((e: unknown) =>
        console.error('[tauriBridge] 撤销预览渲染失败:', e instanceof Error ? e.message : e)
      );
    }
    return result;
  },
  // 前端语义接缝（桥内闭环，无后端命令）：编辑底图是按 id 复用的 sidecar 校验缓存，
  // 后端无会话注册表，此通道只供查看器统一收口退出/卸载路径
  editCancel: (_id: number) => Promise.resolve({ ok: true }),
  // 编辑器三通道：spec 桥内构建（sourceHash 仅作 renderSpec 必填占位，Tauri 执行器不消费）；
  // bake/export 的输出格式、maxEdge、命名循环由 Rust 命令内部自理
  editOpen: (id: number) => tauriInvoke('edit_open', { id }),
  editBake: async (id: number, edits: unknown) => {
    const session = asSession(await tauriInvoke('edit_open', { id }));
    if (!session) throw new Error('[tauriBridge] edit_open 无会话返回');
    if (session.error) return session;
    const spec = editParamsToRenderSpec(edits, { sourceHash: session.basePath });
    return tauriInvoke('edit_bake', { id, edits, spec, inputPath: session.basePath });
  },
  editExport: async (id: number, edits: unknown, destDir: string, output?: unknown) => {
    const session = asSession(await tauriInvoke('edit_open', { id }));
    if (!session) throw new Error('[tauriBridge] edit_open 无会话返回');
    if (session.error) return session;
    const spec = editParamsToRenderSpec(edits, { sourceHash: session.basePath });
    return tauriInvoke('edit_export', {
      id,
      edits,
      spec,
      inputPath: session.basePath,
      destDir,
      output: output ?? null,
    });
  },
};

// 保存参数后的网格缩略图预览：400 长边代理 spec（crop/蒙版坐标由 buildProxySpec 等比缩放），
// 渲染/写库/发 edit-preview-ready 事件在 edit_render_preview 内闭环
async function renderEditPreviewAfterSave(id: number, params: unknown): Promise<void> {
  const session = asSession(await tauriInvoke('edit_open', { id }));
  // 无会话与原实现同口径：落到属性访问的 TypeError 由调用方 catch 告警
  if (!session) throw new Error('[tauriBridge] edit_open 无会话返回');
  if (session.error) return;
  const spec: RenderSpec = editParamsToRenderSpec(params, { sourceHash: session.basePath });
  const { spec: proxySpec } = buildProxySpec(spec, session.width ?? 0, session.height ?? 0, 400);
  await tauriInvoke('edit_render_preview', { id, spec: proxySpec, inputPath: session.basePath });
}
