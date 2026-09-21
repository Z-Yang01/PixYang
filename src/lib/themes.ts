export type ThemeId = 'dark' | 'midnight' | 'forest' | 'light' | 'sepia';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  swatch: [string, string];
  light: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: 'dark', name: '深色', desc: '经典深空灰', swatch: ['#14151a', '#818cf8'], light: false },
  { id: 'midnight', name: '午夜蓝', desc: '冷调靛蓝夜色', swatch: ['#0b1220', '#38bdf8'], light: false },
  { id: 'forest', name: '森林夜', desc: '沉静的墨绿', swatch: ['#0e1713', '#34d399'], light: false },
  { id: 'light', name: '浅色', desc: '明亮的灰白', swatch: ['#f6f7f9', '#5b6ef5'], light: true },
  { id: 'sepia', name: '羊皮纸', desc: '暖调纸张色', swatch: ['#f5efe2', '#b45309'], light: true },
];

export const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);

export const normalizeTheme = (v: unknown): ThemeId =>
  (THEME_IDS as string[]).includes(String(v)) ? (v as ThemeId) : 'dark';

export const isLightTheme = (v: unknown): boolean =>
  !!THEMES.find((t) => t.id === normalizeTheme(v))?.light;
