import {
    createDarkTheme,
    createLightTheme,
    type BrandVariants,
    type Theme,
} from '@fluentui/react-components';

import type { ThemePalette } from '../types';

const modernFontBase = 'var(--mc-font-ui)';
const windowBlue: BrandVariants = {
    10: '#061328',
    20: '#0c2344',
    30: '#12305b',
    40: '#183d72',
    50: '#1b488b',
    60: '#2055a6',
    70: '#2461bc',
    80: '#296bd0',
    90: '#427de1',
    100: '#6092ed',
    110: '#7aa6f4',
    120: '#97bafa',
    130: '#b0ccfc',
    140: '#c7dcfe',
    150: '#dfebff',
    160: '#eff5ff',
};
const modernFontMono =
    "'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', 'SFMono-Regular', 'Consolas', monospace";

const neutral: BrandVariants = {
    10: '#0d0d0d', 20: '#171717', 30: '#212121', 40: '#292929',
    50: '#303030', 60: '#383838', 70: '#404040', 80: '#484848',
    90: '#666666', 100: '#808080', 110: '#999999', 120: '#b5b5b5',
    130: '#cacaca', 140: '#dcdcdc', 150: '#e9e9e9', 160: '#f5f5f5',
};
const sage: BrandVariants = {
    10: '#0e1912', 20: '#18281c', 30: '#223827', 40: '#2d4432',
    50: '#354e3b', 60: '#3c5843', 70: '#42604a', 80: '#496950',
    90: '#618269', 100: '#789980', 110: '#91af98', 120: '#a9c5ae',
    130: '#c0d5c3', 140: '#d3e1d4', 150: '#e3ece3', 160: '#f0f5ef',
};
const brands = { neutral, blue: windowBlue, sage };
export const paletteNames = {
    neutral: ['简白', 'Minimal'], blue: ['雾蓝', 'Mist Blue'], sage: ['鼠尾草绿', 'Sage'],
} as const;

const lightBase: Partial<Theme> = {
    fontFamilyBase: modernFontBase,
    fontFamilyMonospace: modernFontMono,
    fontFamilyNumeric: modernFontBase,
    borderRadiusMedium: '8px',
    borderRadiusLarge: '12px',
    borderRadiusXLarge: '16px',
    colorNeutralBackground1: '#ffffff',
    colorNeutralBackground1Hover: '#f1f4f8',
    colorNeutralBackground1Pressed: '#e4eaf1',
    colorNeutralBackground1Selected: '#eaf1ff',
    colorNeutralBackground2: '#f5f6f8',
    colorNeutralBackground3: '#eceff3',
    colorNeutralBackground4: '#e2e6ec',
    colorNeutralForeground1: '#202631',
    colorNeutralForeground2: '#414b59',
    colorNeutralForeground3: '#596473',
    colorNeutralStroke1: '#b7bfc9',
    colorNeutralStroke2: '#dce0e6',
    colorSubtleBackgroundSelected: '#dae7fb',
    colorSubtleBackgroundHover: '#e5e9ef',
    colorPaletteGreenForeground1: '#107454',
};

const darkBase: Partial<Theme> = {
    fontFamilyBase: modernFontBase,
    fontFamilyMonospace: modernFontMono,
    fontFamilyNumeric: modernFontBase,
    borderRadiusMedium: '8px',
    borderRadiusLarge: '12px',
    borderRadiusXLarge: '16px',
    colorNeutralBackground1: '#2a2d34',
    colorNeutralBackground2: '#25282e',
    colorNeutralBackground3: '#202329',
    colorNeutralBackground4: '#1a1c21',
    colorNeutralBackground1Hover: '#31363f',
    colorNeutralBackground1Pressed: '#383f4a',
    colorNeutralBackground1Selected: '#293b55',
    colorNeutralForeground1: '#f1f2f5',
    colorNeutralForeground2: '#c9ced7',
    colorNeutralForeground3: '#acb4c1',
    colorNeutralStroke1: '#565d68',
    colorNeutralStroke2: '#3d424b',
    colorSubtleBackgroundSelected: '#30435f',
    colorSubtleBackgroundHover: '#343942',
    colorPaletteGreenForeground1: '#70dab1',
};

export function getWindowTheme(palette: ThemePalette, dark: boolean): Theme {
    const brand = brands[palette];
    const darkSelection = { neutral: '#404040', blue: '#293b55', sage: '#344b3b' };
    const selected = dark ? darkSelection[palette] : brand[150];
    const base = dark ? { ...createDarkTheme(brand), ...darkBase } : { ...createLightTheme(brand), ...lightBase };
    return {
        ...base,
        ...(palette !== 'blue' && {
            colorNeutralBackground1: dark ? '#292929' : '#ffffff',
            colorNeutralBackground2: dark ? '#252525' : '#f7f7f6',
            colorNeutralBackground3: dark ? '#202020' : '#efefee',
            colorNeutralBackground4: dark ? '#191919' : '#e6e6e5',
            colorNeutralBackground1Hover: dark ? '#333333' : '#f1f1f0',
            colorNeutralBackground1Pressed: dark ? '#393939' : '#e5e5e4',
            colorSubtleBackgroundHover: dark ? '#343434' : '#ededec',
        }),
        colorNeutralBackground1Selected: selected,
        colorSubtleBackgroundSelected: selected,
        ...(dark && {
            colorBrandBackground: brand[120],
            colorBrandBackgroundHover: brand[130],
            colorBrandBackgroundPressed: brand[110],
            colorNeutralForegroundOnBrand: brand[10],
            colorBrandBackground2: selected,
            colorBrandForeground1: brand[120],
            colorBrandForeground2: brand[130],
        }),
    };
}
