'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Activity, Minus, Maximize2, GripHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react';
import useViewport from '../lib/useViewport';

/**
 * StudyAI Clinical Station Drawer (matches Figma 36:84 "Patient chart" dark forest card).
 * Draggable on desktop/tablet; docks cleanly above the bottom action dock on phones.
 */
export default function DraggableGlassPanel({
  id,
  title,
  subtitle,
  badgeText,
  badgeColor = '#1e4a38',
  icon: Icon = Activity,
  initialPos,
  width = 450,
  minimized,
  onToggleMinimize,
  onClose,
  zIndex = 30,
  onFocus,
  darkMode = true,
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
    if (isPhone) return;
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
    const nextY = Math.max(60, Math.min(Math.max(64, vh - 270), dragRef.current.origY + dy));
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
  const textPrimary = darkMode ? '#eaf2ee' : '#101713';
  const textSecondary = darkMode ? '#8ca69b' : '#6b746a';
  const borderCol = darkMode ? '#1d2e27' : '#e7eae3';

  const effectiveW = isTablet ? Math.min(width, 410, vw - 24) : Math.min(width, vw - 32);
  const clampedX = Math.max(12, Math.min(pos.x, vw - effectiveW - 12));
  const clampedY = Math.max(60, Math.min(pos.y, Math.max(64, vh - 270)));

  const containerStyle = isPhone
    ? {
        position: 'fixed',
        left: '8px',
        right: '8px',
        bottom: 'calc(112px + env(safe-area-inset-bottom, 0px))',
        top: 'auto',
        width: 'auto',
        maxWidth: 'none',
        borderRadius: minimized ? '999px' : '20px',
        zIndex: Math.max(zIndex, 44),
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
        borderRadius: minimized ? '999px' : '20px',
        zIndex: Math.max(zIndex, 44),
        color: textPrimary,
        transition: dragRef.current
          ? 'none'
          : 'border-radius 0.2s ease, box-shadow 0.2s ease',
        overflow: 'hidden',
      };

  // Reserve 148px at bottom for the walk-bar + trace chips + 58px panel header so drawers never get obstructed
  const desktopAvailableBodyPx = Math.max(210, vh - clampedY - 208);
  const bodyMaxHeight = isPhone
    ? isLandscape
      ? 'calc(100dvh - 180px)'
      : '44dvh'
    : `${desktopAvailableBodyPx}px`;

  return (
    <div
      onPointerDown={() => onFocus?.(id)}
      className={glassClass}
      style={containerStyle}
    >
      {/* DRAGGABLE HEADER BAR */}
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
          padding: minimized ? '8px 12px' : isPhone ? '11px 14px' : '13px 18px',
          cursor: isPhone ? 'default' : 'grab',
          borderBottom: minimized ? 'none' : `1px solid ${borderCol}`,
          background: darkMode ? '#0a1310' : '#f8faf5',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: darkMode ? 'rgba(111, 209, 169, 0.14)' : '#dff0c0',
              border: darkMode ? '1.5px solid #6fd1a9' : `1.5px solid ${badgeColor}`,
              color: darkMode ? '#6fd1a9' : '#1e4a38',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={14} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span
                style={{
                  fontSize: '14px',
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
                    fontSize: '10.5px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: darkMode ? '#1e3a2f' : '#dff0c0',
                    color: darkMode ? '#bfe8d6' : '#1e4a38',
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
                  fontSize: '11px',
                  color: textSecondary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: '1px',
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
                width: isTouch ? '34px' : '27px',
                height: isTouch ? '34px' : '27px',
                borderRadius: '50%',
                border: darkMode ? '1px solid #2a4136' : '1px solid #e7eae3',
                background: darkMode ? '#11211a' : '#ffffff',
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
                padding: isTouch ? '7px 11px' : '4px 10px',
                minHeight: isTouch ? '34px' : undefined,
                borderRadius: '999px',
                border: darkMode ? '1px solid #2a4136' : '1px solid #e7eae3',
                background: darkMode ? '#11211a' : '#ffffff',
                color: darkMode ? '#afc6bc' : '#475045',
                fontSize: isTouch ? '11.5px' : '11px',
                fontWeight: 700,
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
            padding: isPhone ? '14px' : '16px 18px',
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
