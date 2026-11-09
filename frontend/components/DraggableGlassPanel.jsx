'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Activity, Minus, Maximize2, GripHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import useViewport from '../lib/useViewport';

/**
 * Context-Sensitive Draggable + Minimizable + Closable ([X / Esc]) Liquid Glass Drawer.
 * On phones (<640px or short landscape), docks cleanly as a collapsible bottom sheet above
 * the Walk bar so it never overflows off-screen or blocks the entire 3D room.
 */
export default function DraggableGlassPanel({
  id,
  title,
  subtitle,
  badgeText,
  badgeColor = '#0066ff',
  icon: Icon = Activity,
  initialPos,
  width = 470,
  minimized,
  onToggleMinimize,
  onClose,
  zIndex = 30,
  onFocus,
  darkMode,
  resetSignal,
  children,
}) {
  const { width: vw, height: vh, isPhone, isTablet, isTouch, isLandscape } = useViewport();
  const [pos, setPos] = useState(initialPos);
  const dragRef = useRef(null);

  useEffect(() => {
    setPos(initialPos);
  }, [resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = (e) => {
    if (isPhone) return; // Bottom-sheet docked on phone
    if (e.target.closest('button, select, input')) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus?.(id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current || isPhone) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const panelW = Math.min(width, vw - 24);
    const nextX = Math.max(8, Math.min(vw - panelW - 8, dragRef.current.origX + dx));
    const nextY = Math.max(56, Math.min(vh - 110, dragRef.current.origY + dy));
    setPos({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const glassClass = darkMode ? 'liquid-glass-dark' : 'liquid-glass-light';
  const textPrimary = darkMode ? '#f8fafc' : '#0f172a';
  const textSecondary = darkMode ? '#94a3b8' : '#64748b';

  // Clamp floating position on tablet/desktop resize so panel never clips off-screen
  const effectiveW = isTablet ? Math.min(width, 410, vw - 24) : Math.min(width, vw - 32);
  const clampedX = Math.max(12, Math.min(pos.x, vw - effectiveW - 12));
  const clampedY = Math.max(64, Math.min(pos.y, vh - 120));

  const containerStyle = isPhone
    ? {
        position: 'fixed',
        left: '8px',
        right: '8px',
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        top: 'auto',
        width: 'auto',
        maxWidth: 'none',
        borderRadius: minimized ? '999px' : '22px',
        zIndex,
        color: textPrimary,
        transition: 'border-radius 0.2s ease, box-shadow 0.2s ease',
        overflow: 'hidden',
      }
    : {
        position: 'fixed',
        left: `${clampedX}px`,
        top: `${clampedY}px`,
        width: minimized ? 'auto' : `${effectiveW}px`,
        minWidth: minimized ? '220px' : undefined,
        maxWidth: minimized ? '320px' : 'calc(100vw - 24px)',
        borderRadius: minimized ? '999px' : '24px',
        zIndex,
        color: textPrimary,
        transition: dragRef.current
          ? 'none'
          : 'border-radius 0.2s ease, box-shadow 0.2s ease',
        overflow: 'hidden',
      };

  const bodyMaxHeight = isPhone
    ? isLandscape
      ? 'calc(100dvh - 150px)'
      : '44dvh'
    : 'calc(100dvh - 160px)';

  return (
    <div
      onPointerDown={() => onFocus?.(id)}
      className={glassClass}
      style={containerStyle}
    >
      {/* DRAGGABLE / SHEET HEADER BAR */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => {
          if (isPhone && minimized && onToggleMinimize) onToggleMinimize(id);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: minimized ? '8px 12px' : isPhone ? '10px 14px' : '11px 16px',
          cursor: isPhone ? 'default' : 'grab',
          borderBottom: minimized
            ? 'none'
            : darkMode
              ? '1px solid rgba(255,255,255,0.09)'
              : '1px solid rgba(15,23,42,0.06)',
          background: darkMode
            ? 'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))'
            : 'linear-gradient(90deg, rgba(255,255,255,0.55), rgba(255,255,255,0.2))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: badgeColor,
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: `0 4px 12px ${badgeColor}55`,
            }}
          >
            <Icon size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 800,
                  color: textPrimary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {title}
              </span>
              {badgeText && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: '999px',
                    background: darkMode
                      ? 'rgba(255,255,255,0.12)'
                      : 'rgba(0, 102, 255, 0.1)',
                    color: darkMode ? '#bae6fd' : '#0066ff',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {badgeText}
                </span>
              )}
            </div>
            {!minimized && subtitle && (
              <div
                style={{
                  fontSize: '10px',
                  color: textSecondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          {!isPhone && (
            <GripHorizontal
              size={14}
              color={textSecondary}
              style={{ opacity: 0.6 }}
            />
          )}
          {onToggleMinimize && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMinimize(id);
              }}
              title={minimized ? 'Expand Drawer' : 'Minimize Drawer'}
              style={{
                width: isTouch ? '34px' : '26px',
                height: isTouch ? '34px' : '26px',
                borderRadius: '50%',
                border: darkMode
                  ? '1px solid rgba(255,255,255,0.16)'
                  : '1px solid rgba(15,23,42,0.1)',
                background: darkMode
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.75)',
                color: textPrimary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {isPhone ? (
                minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />
              ) : minimized ? (
                <Maximize2 size={12} />
              ) : (
                <Minus size={13} />
              )}
            </button>
          )}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Close Station Drawer (Esc)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: isTouch ? '7px 11px' : '4px 9px',
                minHeight: isTouch ? '34px' : undefined,
                borderRadius: '999px',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                background: 'rgba(239, 68, 68, 0.18)',
                color: '#f87171',
                fontSize: isTouch ? '11px' : '10px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              <X size={13} />
              <span>{isTouch ? 'Close' : 'Esc'}</span>
            </button>
          )}
        </div>
      </div>

      {/* PANEL BODY */}
      {!minimized && (
        <div
          style={{
            padding: isPhone ? '12px 14px' : '14px 16px',
            maxHeight: bodyMaxHeight,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
