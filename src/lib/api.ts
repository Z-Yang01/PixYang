// 统一 window.pixyang 访问层：集中守卫，组件不再散布 if (!window.pixyang) 判断。
// 生产运行时（Tauri）路由规则：tauriBridge/tauriBridgeMedia 存在同名包装且 Tauri 可用 → Rust 命令；
// 否则透传 window.pixyang（单测注入面/无桥降级，缺失时返回 undefined 按空数据处理）。
import { isTauriAvailable, tauriApi } from './tauriBridge.ts';
import * as tauriMedia from './tauriBridgeMedia.ts';

const px = () => (typeof window !== 'undefined' ? window.pixyang : undefined);

// 每个方法透传 IPC；bridge 不存在时返回 undefined（调用方按空数据处理）
const passthrough =
  (name: string) =>
  (...args: unknown[]): unknown => {
    const bridge = px();
    if (!bridge || typeof bridge[name] !== 'function') return undefined;
    return bridge[name]?.(...args);
  };

/** api 面：命令名 → 透传函数。入参/返回按各命令实际契约（生产链路多为 Promise<JSON>），
 *  声明为宽容签名以覆盖动态注册的全量命令名（具名接口会在新增命令时双处维护） */
export type ApiBridge = Record<string, (...args: never[]) => unknown>;

const api: ApiBridge & { isBridgeAvailable: () => boolean } = {
  isBridgeAvailable: () => !!px() || isTauriAvailable(),
};
const mediaMap = tauriMedia as unknown as Record<string, unknown>;
const bridgeMap = tauriApi as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>;
for (const name of [
  'selectDirectory',
  'scanDirectory',
  'collectImportFiles',
  'getPathForFile',
  'getExif',
  'analyzeImage',
  'toFileUrl',
  'toFileUrls',
  'getImagesRoot',
  'setImagesRoot',
  'getThumbsRoot',
  'setThumbsRoot',
  'scanOrphanThumbnails',
  'cleanOrphanThumbnails',
  'openPath',
  'importImages',
  'checkDuplicateSerials',
  'syncCameraFolder',
  'getImages',
  'getAllImageIds',
  'updateImage',
  'renameImage',
  'deleteImage',
  'batchDeleteImages',
  'deleteImageToTrash',
  'batchDeleteImagesToTrash',
  'restoreImageFromTrash',
  'listTrash',
  'purgeTrashEntry',
  'emptyTrash',
  'batchRestoreFromTrash',
  'batchPurgeTrash',
  'getImportDates',
  'rebuildThumbnails',
  'editOpen',
  'saveEdits',
  'undoLastEdit',
  'editBake',
  'editExport',
  'editCancel',
  'getPresets',
  'createPreset',
  'deletePreset',
  'getSnapshots',
  'createSnapshot',
  'deleteSnapshot',
  'onRebuildProgress',
  'onImportProgress',
  'scanBrokenRecords',
  'deleteBrokenRecords',
  'findDuplicates',
  'scanOrphanFiles',
  'adoptOrphanFiles',
  'removeOrphanFiles',
  'getDatabasePath',
  'backupDatabase',
  'getTags',
  'createTag',
  'deleteTag',
  'addTagToImage',
  'removeTagFromImage',
  'getImageTags',
  'getBatchImageTags',
  'addTagToImages',
  'updateImages',
  'getAlbums',
  'createAlbum',
  'renameAlbum',
  'deleteAlbum',
  'addToAlbum',
  'removeFromAlbum',
  'selectExportDirectory',
  'exportAlbumImages',
  'exportImages',
  'getStats',
  'getSettings',
  'getSetting',
  'setSetting',
  'onThumbnailsReady',
  'onEditPreviewReady',
]) {
  api[name] = (...args: never[]) => {
    const impl = (mediaMap[name] ?? bridgeMap[name]) as ((...a: unknown[]) => unknown) | undefined;
    if (impl && isTauriAvailable()) return impl(...args);
    return passthrough(name)(...args);
  };
}

export default api;
