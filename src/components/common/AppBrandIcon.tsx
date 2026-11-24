import React from 'react';
const appIcon = new URL('../../../assets/icon.png', import.meta.url).href;

interface AppBrandIconProps {
    size?: number;
}

const AppBrandIcon: React.FC<AppBrandIconProps> = ({ size = 18 }) => (
    <img
        src={appIcon}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
        style={{ display: 'block', flexShrink: 0 }}
    />
);

export default AppBrandIcon;
