'use client';

import { useEffect, useState } from 'react';

/**
 * Responsive breakpoints for the exam UI.
 *   phone  : narrow screens (< 640 px) or any short landscape phone (height < 500 px)
 *   tablet : < 1024 px wide (iPad portrait / small laptops)
 *   touch  : coarse primary pointer (no hover, fingers) — enlarges tap targets, swaps keyboard hints
 */
const read = () => {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900, isPhone: false, isTablet: false, isTouch: false, isLandscape: true };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const isPhone = width < 640 || (isTouch && height < 500);
  return {
    width,
    height,
    isPhone,
    isTablet: !isPhone && width < 1024,
    isTouch,
    isLandscape: width > height,
  };
};

export default function useViewport() {
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const onResize = () => setVp(read());
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
}
