export type ThemeId =
  | 'dark'
  | 'midnight'
  | 'forest'
  | 'light'
  | 'yuebai'
  | 'mist'
  | 'huguang'
  | 'celadon'
  | 'zhulu'
  | 'sakura'
  | 'twilight'
  | 'luoxia'
  | 'sepia';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  swatch: [string, string];
  light: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: 'dark', name: '深色', desc: '经典深空灰', swatch: ['#202128', '#818cf8'], light: false },
  {
    id: 'midnight',
    name: '午夜蓝',
    desc: '冷调靛蓝夜色',
    swatch: ['#101b30', '#38bdf8'],
    light: false,
  },
  {
    id: 'forest',
    name: '森林夜',
    desc: '沉静的墨绿',
    swatch: ['#12211a', '#34d399'],
    light: false,
  },
  { id: 'light', name: '浅色', desc: '明亮的灰白', swatch: ['#f6f7f9', '#5b6ef5'], light: true },
  {
    id: 'yuebai',
    name: '月白',
    desc: '素净的冷月白',
    swatch: ['#eef3f5', '#3a5561'],
    light: true,
  },
  { id: 'mist', name: '晨雾', desc: '清冷的雾蓝灰', swatch: ['#eef1f6', '#3b7fa6'], light: true },
  {
    id: 'huguang',
    name: '湖光',
    desc: '澄澈的湖光碧',
    swatch: ['#e6f1f3', '#16788c'],
    light: true,
  },
  { id: 'celadon', name: '青瓷', desc: '淡雅青釉色', swatch: ['#ecf3ef', '#2f8f6f'], light: true },
  {
    id: 'zhulu',
    name: '竹露',
    desc: '嫩青的竹露绿',
    swatch: ['#eff4e4', '#5f8335'],
    light: true,
  },
  {
    id: 'sakura',
    name: '樱落',
    desc: '柔软的粉藕荷',
    swatch: ['#f9eff2', '#c2658a'],
    light: true,
  },
  {
    id: 'twilight',
    name: '暮山紫',
    desc: '薄暮紫霭',
    swatch: ['#f1eef8', '#7c5cc4'],
    light: true,
  },
  {
    id: 'luoxia',
    name: '落霞',
    desc: '明丽的落霞橙',
    swatch: ['#fdf0e9', '#c85f3f'],
    light: true,
  },
  { id: 'sepia', name: '羊皮纸', desc: '暖调纸张色', swatch: ['#f5efe2', '#b45309'], light: true },
];

export const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);

export const normalizeTheme = (v: unknown): ThemeId =>
  (THEME_IDS as string[]).includes(String(v)) ? (v as ThemeId) : 'dark';

export const isLightTheme = (v: unknown): boolean =>
  !!THEMES.find((t) => t.id === normalizeTheme(v))?.light;
