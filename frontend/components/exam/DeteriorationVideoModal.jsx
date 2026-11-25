'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Volume2, VolumeX, X, Eye } from 'lucide-react';

export const DETERIORATION_VIDEO_URL = '/clinical-media/hypoxia_distress_deterioration.mp4?v=cinema1';
export const DETERIORATION_POSTER_URL = '/clinical-media/hypoxia_distress_poster.jpg?v=cinema1';

/**
 * Non-blocking Screen Pop-Over Emote Toast that alerts the candidate when subtle bedside
 * physiological deterioration (diaphoresis, shallow gasping, heavy opioid sedation) occurs,
 * inviting them to walk the nurse over and watch the close-up acting clip.
 */
export function PatientDistressPopover({ onInspect, onDismiss, isPhone = false }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: isPhone ? '62px' : '70px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 36,
        width: isPhone ? 'calc(100vw - 24px)' : 'min(540px, calc(100vw - 48px))',
        padding: '11px 14px',
        borderRadius: '18px',
        background: 'rgba(10, 19, 16, 0.95)',
        border: '1.5px solid #e8b04b',
        boxShadow: '0 18px 46px rgba(0, 0, 0, 0.62), 0 0 0 4px rgba(232, 176, 75, 0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        animation: 'studyaiPopoverSlide 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`
        @keyframes studyaiPopoverSlide {
          from { opacity: 0; transform: translate(-50%, -12px) scale(0.97); }
          to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes studyaiCueRing {
          0% { transform: scale(0.95); opacity: 0.75; }
          75% { transform: scale(1.38); opacity: 0; }
          100% { transform: scale(1.38); opacity: 0; }
        }
      `}</style>

      {/* Left: Pulsing Emote + Poster Thumbnail */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div
          onClick={onInspect}
          style={{
            position: 'relative',
            width: '54px',
            height: '42px',
            borderRadius: '11px',
            overflow: 'hidden',
            border: '1.5px solid #e8b04b',
            flexShrink: 0,
            cursor: 'pointer',
            background: '#050a08',
          }}
        >
          <img
            src={DETERIORATION_POSTER_URL}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <span
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(10, 19, 16, 0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
            }}
          >
            😮‍💨
          </span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span
              style={{
                position: 'relative',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#e8b04b',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: -3,
                  borderRadius: '50%',
                  border: '1.5px solid #e8b04b',
                  animation: 'studyaiCueRing 1.8s ease-out infinite',
                }}
              />
            </span>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 800,
                letterSpacing: '0.07em',
                color: '#e8b04b',
                textTransform: 'uppercase',
              }}
            >
              Bedside Cue Detected
            </span>
          </div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 800,
              color: '#eaf2ee',
              marginTop: '2px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Labored Breathing & Clammy Sweat
          </div>
          {!isPhone && (
            <div style={{ fontSize: '11.5px', color: '#9cb6ab', marginTop: '1px' }}>
              Walk nurse to bedside for a close-up look at the patient
            </div>
          )}
        </div>
      </div>

      {/* Right: Action CTA + Dismiss */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onInspect}
          style={{
            height: '34px',
            padding: '0 14px',
            borderRadius: '999px',
            background: '#e8b04b',
            border: 'none',
            color: '#0a1310',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <Play size={13} fill="#0a1310" /> Observe Close-Up
        </button>

        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss alert (3D emote remains above patient)"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: '#11211a',
            border: '1px solid #2a4136',
            color: '#8ca69b',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Full-screen StudyAI Clinical Cinema Modal playing the close-up patient deterioration
 * & nurse bedside assessment clip with optional clinical audio (breathing + SpO2 beeps).
 */
export function DeteriorationCinemaModal({ open, onClose }) {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(false);

  if (!open || typeof document === 'undefined') return null;

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (videoRef.current) videoRef.current.muted = next;
      return next;
    });
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(5, 11, 9, 0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(860px, 95vw)',
          borderRadius: '22px',
          overflow: 'hidden',
          background: '#0a1310',
          border: '1.5px solid #2a4136',
          boxShadow: '0 28px 72px rgba(0, 0, 0, 0.72)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '13px 18px',
            borderBottom: '1px solid #1d2e27',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span
              style={{
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'rgba(232, 176, 75, 0.16)',
                border: '1px solid rgba(232, 176, 75, 0.45)',
                color: '#e8b04b',
                fontSize: '10.5px',
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              <Eye size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} />
              Bedside Observation
            </span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: '#eaf2ee' }}>
              Close-Up Patient Assessment — Respiratory & Skin Cues
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={toggleMute}
              style={{
                height: '30px',
                padding: '0 12px',
                borderRadius: '999px',
                background: '#11211a',
                border: '1px solid #2a4136',
                color: '#bfe8d6',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              {muted ? 'Unmute Audio' : 'Audio On'}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                height: '30px',
                padding: '0 13px',
                borderRadius: '999px',
                background: '#6fd1a9',
                border: 'none',
                color: '#0a1310',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Return to Bedside ✕
            </button>
          </div>
        </div>

        {/* Video Stage */}
        <div style={{ background: '#050a08', position: 'relative' }}>
          <video
            ref={videoRef}
            src={DETERIORATION_VIDEO_URL}
            poster={DETERIORATION_POSTER_URL}
            autoPlay
            loop
            muted={muted}
            playsInline
            controls
            style={{
              width: '100%',
              maxHeight: '68vh',
              display: 'block',
              background: '#050a08',
            }}
          />
        </div>

        {/* Spoiler-Free Clinical Observation Prompt */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #1d2e27',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            fontSize: '12.5px',
            color: '#afc6bc',
            lineHeight: 1.5,
          }}
        >
          <span>
            Observe the patient&apos;s slow, shallow open-mouth gasping, heavy sedated eyelids, glistening diaphoretic brow sweat, and pale perioral mucosa as the nurse assesses responsiveness.
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
