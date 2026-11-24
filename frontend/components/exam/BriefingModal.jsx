'use client';

import React from 'react';
import { Keyboard } from 'lucide-react';
import { formatClock } from '../../lib/examEngine';
import useViewport from '../../lib/useViewport';

/** Shared centered modal overlay (used for compact dialogs like Conclude Confirmation). */
export function ExamOverlay({ darkMode, width = 760, children }) {
  return (
    <div
      className="exam-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: darkMode ? 'rgba(6, 13, 10, 0.72)' : 'rgba(16, 23, 19, 0.36)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        className={`exam-card ${darkMode ? 'liquid-glass-dark' : 'liquid-glass-light'}`}
        style={{
          width: `min(${width}px, 100%)`,
          maxHeight: 'calc(100dvh - 48px)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          borderRadius: '24px',
          color: darkMode ? '#eaf2ee' : '#101713',
          userSelect: 'text',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function examTokens(darkMode) {
  return {
    text: darkMode ? '#eaf2ee' : '#101713',
    muted: darkMode ? '#8ca69b' : '#6b746a',
    border: darkMode ? '#2a4136' : '#e7eae3',
    divider: darkMode ? '#1d2e27' : '#e7eae3',
    subtle: darkMode ? '#11211a' : '#f8faf5',
    accent: darkMode ? '#6fd1a9' : '#1e4a38',
    primary: darkMode ? '#6fd1a9' : '#1e4a38',
    primaryText: darkMode ? '#0a1310' : '#ffffff',
  };
}

/**
 * Official StudyAI App Shell (Figma 35:895 & 36:156):
 *  - Left 262px white sidebar with STUDYAI star mark, navigation pills, and candidate footer
 *  - Clean white scrollable main workspace with breadcrumb & notification bell
 *  - Collapses gracefully to a compact top brand header on phones & tablets (<960px)
 */
export function StudyAiAppShell({
  breadcrumb,
  completed = false,
  planLabel = 'Free pilot',
  floatingSlot = null,
  children,
}) {
  return (
    <div
      className="studyai-shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        background: '#ffffff',
        color: '#101713',
        userSelect: 'text',
      }}
    >
      {/* LEFT SIDEBAR (262px — Figma 35:897 / 36:158) */}
      <aside
        className="studyai-sidebar"
        style={{
          width: '262px',
          flexShrink: 0,
          height: '100dvh',
          borderRight: '1px solid #e7eae3',
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '28px 16px 18px',
        }}
      >
        <div>
          {/* Brand Logo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingLeft: '12px',
              marginBottom: '40px',
            }}
          >
            <img
              src="/figma-assets/logo-mark-forest.svg"
              alt="StudyAI"
              width={30}
              height={26}
              style={{ display: 'block', flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: '19px',
                fontWeight: 800,
                color: '#1e4a38',
                letterSpacing: '-0.01em',
              }}
            >
              STUDYAI
            </span>
          </div>

          {/* Navigation Items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                height: '42px',
                padding: '0 18px',
                borderRadius: '21px',
                color: '#475045',
                fontSize: '14.5px',
                fontWeight: 600,
              }}
            >
              <img src="/figma-assets/icon-home.svg" alt="" width={19} height={19} />
              <span>Home</span>
            </div>

            {/* Active Item: Entry assessment */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: '45px',
                padding: '0 14px 0 16px',
                borderRadius: '22.5px',
                background: '#dff0c0',
                border: '2px solid #4c7df0',
                color: '#101713',
                fontSize: '14.5px',
                fontWeight: 800,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <img src="/figma-assets/icon-entry.svg" alt="" width={19} height={19} />
                <span>Entry assessment</span>
              </span>
              {completed ? (
                <img src="/figma-assets/icon-check.svg" alt="Completed" width={16} height={16} />
              ) : (
                <span
                  style={{
                    background: '#cde8a2',
                    color: '#1e4a38',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 10px',
                    borderRadius: '999px',
                  }}
                >
                  Start
                </span>
              )}
            </div>

            {/* Question bank */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: '45px',
                padding: '0 18px',
                borderRadius: '22.5px',
                color: '#475045',
                fontSize: '14.5px',
                fontWeight: 600,
                opacity: completed ? 1 : 0.55,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <img src="/figma-assets/icon-qbank.svg" alt="" width={19} height={19} />
                <span>Question bank</span>
              </span>
              {!completed && (
                <img src="/figma-assets/icon-lock.svg" alt="Locked" width={15} height={15} />
              )}
            </div>

            {/* Lectures */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '11px',
                height: '45px',
                padding: '0 18px',
                borderRadius: '22.5px',
                color: '#475045',
                fontSize: '14.5px',
                fontWeight: 600,
              }}
            >
              <img src="/figma-assets/icon-lectures.svg" alt="" width={19} height={19} />
              <span>Lectures</span>
            </div>

            {/* Exit assessment */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: '45px',
                padding: '0 18px',
                borderRadius: '22.5px',
                color: '#475045',
                fontSize: '14.5px',
                fontWeight: 600,
                opacity: completed ? 1 : 0.55,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <img src="/figma-assets/icon-exit.svg" alt="" width={19} height={19} />
                <span>Exit assessment</span>
              </span>
              {completed ? (
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#6fd1a9',
                  }}
                />
              ) : (
                <img src="/figma-assets/icon-lock.svg" alt="Locked" width={15} height={15} />
              )}
            </div>
          </nav>
        </div>

        {/* Candidate Profile Footer (Figma 35:934) */}
        <div
          style={{
            borderTop: '1px solid #e7eae3',
            paddingTop: '14px',
            paddingLeft: '12px',
            paddingRight: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: '#1e4a38',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              CO
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '14.5px',
                  fontWeight: 800,
                  color: '#101713',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Chidinma Okafor
              </div>
              <div style={{ fontSize: '12px', color: '#6b746a', marginTop: '1px' }}>
                {planLabel}
              </div>
            </div>
          </div>
          <img
            src="/figma-assets/icon-chevrons.svg"
            alt=""
            width={16}
            height={16}
            style={{ flexShrink: 0 }}
          />
        </div>
      </aside>

      {/* MAIN SCROLLABLE WORKSPACE */}
      <main
        style={{
          flex: 1,
          height: '100dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          padding: '28px clamp(18px, 3.5vw, 44px) calc(48px + env(safe-area-inset-bottom, 0px))',
          position: 'relative',
        }}
      >
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          {/* Mobile / Tablet compact brand bar (hidden on >=960px where sidebar shows) */}
          <div
            className="studyai-mobile-brand"
            style={{
              display: 'none',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '16px',
              marginBottom: '16px',
              borderBottom: '1px solid #e7eae3',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <img src="/figma-assets/logo-mark-forest.svg" alt="StudyAI" width={26} height={22} />
              <span style={{ fontSize: '17px', fontWeight: 800, color: '#1e4a38' }}>STUDYAI</span>
              <span style={{ fontSize: '12px', color: '#6b746a', fontWeight: 600 }}>· NCLEX-RN</span>
            </div>
            <img src="/figma-assets/icon-bell.svg" alt="Notifications" width={20} height={20} />
          </div>

          {/* Desktop Top Breadcrumb + Bell (Figma 35:941 / 36:195) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '26px',
            }}
          >
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#6b746a' }}>
              {breadcrumb}
            </span>
            <img
              src="/figma-assets/icon-bell.svg"
              alt="Notifications"
              width={22}
              height={22}
              style={{ display: 'block' }}
            />
          </div>

          {children}
        </div>

        {floatingSlot}
      </main>
    </div>
  );
}

/**
 * Entry Assessment Intro Screen — Matches Figma node 35:895 ("Entry assessment intro")
 */
export default function BriefingModal({ scenario, onBegin }) {
  const ex = scenario.exam_config;
  const b = ex.briefing;
  const p = scenario.patient;
  const { isTouch } = useViewport();

  const steps = [
    {
      num: '1',
      title: 'Read the chart',
      body: 'Orders, MAR, allergies, labs and PACU handoff notes are one click away — review them before intervening.',
    },
    {
      num: '2',
      title: 'Assess and act',
      body: 'Click into the 3D room to walk to bedside stations, verify ID, power on telemetry, and act in clinical priority order.',
    },
    {
      num: '3',
      title: 'Get your gap chart',
      body: 'Scored on the server against a nurse-approved key across Knowledge, Prioritisation, Risk recognition, and Clinical judgment.',
    },
  ];

  const stats = [
    { value: '1', label: 'patient scenario' },
    { value: '6', label: 'bedside stations' },
    { value: formatClock(ex.duration_sec), label: 'timed window' },
  ];

  return (
    <StudyAiAppShell breadcrumb="Entry assessment" completed={false} planLabel="Free pilot">
      {/* Title Row (Figma 35:945 + 35:946) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 36px)',
            fontWeight: 800,
            color: '#101713',
            letterSpacing: '-0.36px',
            lineHeight: 1.15,
          }}
        >
          Meet your first patient
        </h1>
        <span
          style={{
            background: '#f1f3ee',
            color: '#475045',
            fontSize: '12px',
            fontWeight: 800,
            padding: '4px 12px',
            borderRadius: '999px',
          }}
        >
          Not started
        </span>
      </div>

      {/* Lead Copy (Figma 35:948) */}
      <p
        style={{
          fontSize: '16px',
          lineHeight: '25.6px',
          color: '#475045',
          maxWidth: '580px',
          marginTop: '14px',
        }}
      >
        One realistic patient scenario. You act as the nurse on shift — read the chart, check the
        monitor, choose what to do and in what order. Your choices build your gap chart.
      </p>

      {/* Two-Column Grid: Steps + Stats + CTA on left, Dark Patient Preview Card on right */}
      <div
        className="studyai-intro-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: '26px',
          alignItems: 'start',
          marginTop: '32px',
        }}
      >
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* 3-Step Card (Figma 35:949) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e7eae3',
              borderRadius: '24px',
              padding: '26px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {steps.map((s) => (
              <div
                key={s.num}
                style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}
              >
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '17px',
                    background: '#cde8a2',
                    color: '#1e4a38',
                    fontSize: '16px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {s.num}
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#101713' }}>
                    {s.title}
                  </div>
                  <div
                    style={{
                      fontSize: '14px',
                      lineHeight: '21.7px',
                      color: '#475045',
                      marginTop: '3px',
                    }}
                  >
                    {s.body}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 3 Stat Tiles (Figma 35:962..35:970) */}
          <div
            className="exam-grid-3"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '12px',
            }}
          >
            {stats.map((st) => (
              <div
                key={st.label}
                style={{
                  background: '#f8faf5',
                  border: '1px solid #e7eae3',
                  borderRadius: '18px',
                  padding: '16px 18px',
                }}
              >
                <div
                  className={st.value.includes(':') ? 'font-mono-clinical' : undefined}
                  style={{
                    fontSize: '26px',
                    fontWeight: 800,
                    color: '#101713',
                    lineHeight: 1.15,
                  }}
                >
                  {st.value}
                </div>
                <div style={{ fontSize: '12.5px', color: '#6b746a', marginTop: '6px' }}>
                  {st.label}
                </div>
              </div>
            ))}
          </div>

          {/* Primary CTA Row (Figma 35:971 + 35:973) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '18px',
              flexWrap: 'wrap',
              marginTop: '2px',
            }}
          >
            <button
              onClick={onBegin}
              style={{
                height: '54px',
                padding: '0 38px',
                borderRadius: '27px',
                background: '#1e4a38',
                color: '#ffffff',
                border: 'none',
                fontSize: '16px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 10px 24px rgba(30, 74, 56, 0.22)',
                transition: 'background 0.15s ease, transform 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#16382a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#1e4a38';
              }}
            >
              Start scenario
            </button>
            <span style={{ fontSize: '13.5px', color: '#8a948a' }}>
              The clock starts when the scenario opens.
            </span>
          </div>

          {/* Subtle navigation controls hint */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              color: '#6b746a',
            }}
          >
            <Keyboard size={14} style={{ flexShrink: 0, color: '#1e4a38' }} />
            <span>
              {isTouch && b.controls_hint_touch ? b.controls_hint_touch : b.controls_hint}
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: Dark Forest Patient Card (Figma 35:974) */}
        <div
          style={{
            background: '#0a1310',
            borderRadius: '24px',
            padding: '22px',
            color: '#eaf2ee',
            boxShadow: '0 20px 44px -16px rgba(10, 19, 16, 0.45)',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: '#6fd1a9',
            }}
          >
            YOUR PATIENT
          </div>

          {/* Stylized Bedside Preview Graphic (Figma 35:976) */}
          <div
            style={{
              marginTop: '14px',
              height: '150px',
              borderRadius: '16px',
              background: 'linear-gradient(180deg, #11231c 0%, #0a1310 100%)',
              border: '1px solid #1d2e27',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Telemetry Monitor Frame */}
            <div
              style={{
                position: 'absolute',
                left: '18px',
                top: '18px',
                width: '96px',
                height: '60px',
                borderRadius: '8px',
                background: '#133028',
                border: '1px solid #22382f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src="/figma-assets/ecg-mini.svg"
                alt="ECG trace"
                width={78}
                height={22}
                style={{ display: 'block' }}
              />
            </div>

            {/* Stylized Bed & Patient Silhouette */}
            <div
              style={{
                position: 'absolute',
                right: '20px',
                bottom: '24px',
                width: '158px',
                height: '26px',
                borderRadius: '8px',
                background: '#d8e2da',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: '140px',
                bottom: '42px',
                width: '26px',
                height: '26px',
                borderRadius: '13px',
                background: '#b98a68',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: '24px',
                bottom: '32px',
                width: '112px',
                height: '24px',
                borderRadius: '12px 6px 4px 4px',
                background: '#2f7a60',
              }}
            />
          </div>

          {/* Patient Name & Clinical Handoff (Figma 35:983 + 35:984) */}
          <div
            style={{
              fontSize: '18px',
              fontWeight: 800,
              color: '#eaf2ee',
              marginTop: '16px',
            }}
          >
            {p.name}, {p.age}
          </div>
          <p
            style={{
              fontSize: '13px',
              lineHeight: '20.2px',
              color: '#afc6bc',
              marginTop: '8px',
            }}
          >
            Arriving from PACU post-{p.surgical_history.toLowerCase()}. Morphine PCA infusing;
            bedside monitor is currently in standby and you are taking over his care.
          </p>

          {/* Compact Clinical Identifiers */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: '1px solid #1d2e27',
            }}
          >
            <span
              className="font-mono-clinical"
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#11211a',
                border: '1px solid #2a4136',
                color: '#bfe8d6',
              }}
            >
              {p.mrn}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#1e3a2f',
                color: '#bfe8d6',
              }}
            >
              DOB {p.dob}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#3a1f1b',
                color: '#f2a493',
              }}
            >
              Check chart allergies
            </span>
          </div>
        </div>
      </div>
    </StudyAiAppShell>
  );
}
