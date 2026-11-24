import './globals.css';
import { Hanken_Grotesk, Spline_Sans_Mono } from 'next/font/google';

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: 'StudyAI · NCLEX-RN — 3D Clinical Judgment Scenario',
  description: 'StudyAI NCLEX-RN 3D Patient Scenario & Personal Gap Chart Engine',
};

// Mobile: render at device width, allow content under the notch/home bar (we pad with safe-area
// insets), and stop iOS from auto-zooming the exam UI.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a1310',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${hankenGrotesk.variable} ${splineSansMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
