import './globals.css';

export const metadata = {
  title: 'Study AI — NCLEX-RN 3D Clinical Judgment Simulation PoC',
  description: 'Hybrid Deterministic 3D Visual Simulation + Probabilistic AI Diagnostic Telemetry Engine',
};

// Mobile: render at device width, allow content under the notch/home bar (we pad with safe-area
// insets), and stop iOS from auto-zooming the exam UI.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#09101d',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
